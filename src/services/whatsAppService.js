import crypto from 'crypto';
import WhatsAppMessage from '../models/WhatsAppMessage.js';

function configurationError() {
  const error = new Error('WhatsApp Cloud API is not configured');
  error.statusCode = 503;
  return error;
}

export function isWhatsAppConfigured() {
  return Boolean(process.env.META_WHATSAPP_ACCESS_TOKEN && process.env.META_WHATSAPP_PHONE_NUMBER_ID);
}

export function normalizeWhatsAppRecipient(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (/^[6-9]\d{9}$/.test(digits)) return `91${digits}`;
  if (/^91[6-9]\d{9}$/.test(digits)) return digits;
  const error = new Error('A valid Indian mobile number is required for WhatsApp');
  error.statusCode = 400;
  throw error;
}

function graphEndpoint() {
  const version = process.env.META_WHATSAPP_API_VERSION;
  if (!version) {
    const error = new Error('META_WHATSAPP_API_VERSION is required');
    error.statusCode = 503;
    throw error;
  }
  return `https://graph.facebook.com/${version}/${process.env.META_WHATSAPP_PHONE_NUMBER_ID}/messages`;
}

async function sendToMeta(payload) {
  if (!isWhatsAppConfigured()) throw configurationError();

  const response = await fetch(graphEndpoint(), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.META_WHATSAPP_ACCESS_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ messaging_product: 'whatsapp', ...payload })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.error?.message || 'WhatsApp Cloud API request failed');
    error.statusCode = response.status >= 400 && response.status < 500 ? 400 : 502;
    error.providerResponse = data;
    throw error;
  }
  return data;
}

function templatePayload({ recipient, templateName, language, bodyParameters = [] }) {
  const template = {
    name: templateName,
    language: { code: language }
  };
  if (bodyParameters.length) {
    template.components = [{
      type: 'body',
      parameters: bodyParameters.map((value) => ({ type: 'text', text: String(value ?? '') }))
    }];
  }
  return { to: recipient, type: 'template', template };
}

async function dispatch(message, payload) {
  try {
    const data = await sendToMeta(payload);
    message.providerMessageId = data.messages?.[0]?.id;
    message.status = 'sent';
    message.providerResponse = data;
    await message.save();
    return message;
  } catch (error) {
    message.status = 'failed';
    message.failureReason = error.message;
    message.providerResponse = error.providerResponse;
    message.failedAt = new Date();
    await message.save();
    throw error;
  }
}

export async function sendTemplateMessage({ borrower, loan, installmentId, sentBy, kind = 'template', templateName, language, bodyParameters, scheduledFor }) {
  if (!borrower.whatsappOptIn) {
    const error = new Error('Borrower has not opted in to WhatsApp messages');
    error.statusCode = 400;
    throw error;
  }
  if (!templateName) {
    const error = new Error('An approved WhatsApp template name is required');
    error.statusCode = 400;
    throw error;
  }

  const recipient = normalizeWhatsAppRecipient(borrower.mobileNumbers?.[0] || borrower.phone);
  let message;
  if (scheduledFor) {
    message = await WhatsAppMessage.findOne({ loan: loan?._id || loan, installmentId, kind, scheduledFor });
    if (message?.status !== 'failed' && message) return message;
  }
  if (!message) {
    message = await WhatsAppMessage.create({
      borrower: borrower._id || borrower,
      loan: loan?._id || loan,
      installmentId,
      sentBy,
      recipient,
      kind,
      templateName,
      templateLanguage: language,
      scheduledFor
    });
  }
  return dispatch(message, templatePayload({ recipient, templateName, language, bodyParameters }));
}

export async function sendTextMessage({ borrower, sentBy, body }) {
  if (!borrower.whatsappOptIn) {
    const error = new Error('Borrower has not opted in to WhatsApp messages');
    error.statusCode = 400;
    throw error;
  }
  const text = String(body || '').trim();
  if (!text) {
    const error = new Error('Message text is required');
    error.statusCode = 400;
    throw error;
  }
  const recipient = normalizeWhatsAppRecipient(borrower.mobileNumbers?.[0] || borrower.phone);
  const message = await WhatsAppMessage.create({ borrower: borrower._id, sentBy, recipient, kind: 'text', body: text });
  return dispatch(message, { to: recipient, type: 'text', text: { preview_url: false, body: text } });
}

export async function sendInstallmentReminder({ loan, installment, kind, scheduledFor }) {
  if (!isWhatsAppConfigured() || !loan.borrower?.whatsappOptIn) return null;
  const templateName = kind === 'due_reminder'
    ? process.env.WHATSAPP_DUE_REMINDER_TEMPLATE
    : process.env.WHATSAPP_OVERDUE_REMINDER_TEMPLATE;
  if (!templateName) return null;

  const dueDate = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata' }).format(new Date(installment.dueDate));
  const amount = Number(installment.amount || 0).toFixed(2);
  return sendTemplateMessage({
    borrower: loan.borrower,
    loan,
    installmentId: installment._id,
    kind,
    templateName,
    language: process.env.WHATSAPP_TEMPLATE_LANGUAGE || 'en_US',
    // Configure the approved template with these variables in this exact order:
    // borrower name, installment number, due date, and installment amount.
    bodyParameters: [loan.borrower.name, installment.sequence, dueDate, amount],
    scheduledFor
  });
}

export function verifyWebhookSignature(rawBody, signature) {
  const secret = process.env.META_WHATSAPP_APP_SECRET;
  if (!secret || !rawBody || !signature?.startsWith('sha256=')) return false;
  const expected = `sha256=${crypto.createHmac('sha256', secret).update(rawBody).digest('hex')}`;
  return expected.length === signature.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

export async function applyWebhookStatuses(statuses = []) {
  await Promise.all(statuses.map(async (status) => {
    const update = { status: status.status };
    const timestamp = status.timestamp ? new Date(Number(status.timestamp) * 1000) : new Date();
    if (status.status === 'delivered') update.deliveredAt = timestamp;
    if (status.status === 'read') update.readAt = timestamp;
    if (status.status === 'failed') {
      update.failedAt = timestamp;
      update.failureReason = status.errors?.map((item) => item.title || item.message).filter(Boolean).join('; ') || 'Delivery failed';
    }
    await WhatsAppMessage.findOneAndUpdate({ providerMessageId: status.id }, update);
  }));
}

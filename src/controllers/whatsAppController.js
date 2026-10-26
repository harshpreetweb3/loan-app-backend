import Borrower from '../models/Borrower.js';
import WhatsAppMessage from '../models/WhatsAppMessage.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { applyWebhookStatuses, isWhatsAppConfigured, sendTemplateMessage, sendTextMessage, verifyWebhookSignature } from '../services/whatsAppService.js';

export const getWhatsAppStatus = asyncHandler(async (_req, res) => {
  res.json({ configured: isWhatsAppConfigured() });
});

export const listWhatsAppMessages = asyncHandler(async (req, res) => {
  const query = req.query.borrower ? { borrower: req.query.borrower } : {};
  const messages = await WhatsAppMessage.find(query)
    .populate('borrower', 'name customerId')
    .populate('loan', 'receipt.receiptNumber')
    .populate('sentBy', 'name username')
    .sort({ createdAt: -1 })
    .limit(200);
  res.json({ messages });
});

export const updateBorrowerWhatsAppOptIn = asyncHandler(async (req, res) => {
  if (typeof req.body.optedIn !== 'boolean') return res.status(400).json({ message: 'optedIn must be true or false' });
  const borrower = await Borrower.findByIdAndUpdate(
    req.params.borrowerId,
    { whatsappOptIn: req.body.optedIn, whatsappOptInAt: req.body.optedIn ? new Date() : undefined },
    { new: true }
  );
  if (!borrower) return res.status(404).json({ message: 'Borrower not found' });
  res.json({ borrower });
});

export const sendBorrowerTemplate = asyncHandler(async (req, res) => {
  const borrower = await Borrower.findById(req.params.borrowerId);
  if (!borrower) return res.status(404).json({ message: 'Borrower not found' });
  const message = await sendTemplateMessage({
    borrower,
    sentBy: req.user._id,
    templateName: req.body.templateName,
    language: req.body.language || process.env.WHATSAPP_TEMPLATE_LANGUAGE || 'en_US',
    bodyParameters: Array.isArray(req.body.bodyParameters) ? req.body.bodyParameters : []
  });
  res.status(201).json({ message });
});

export const sendBorrowerText = asyncHandler(async (req, res) => {
  const borrower = await Borrower.findById(req.params.borrowerId);
  if (!borrower) return res.status(404).json({ message: 'Borrower not found' });
  const message = await sendTextMessage({ borrower, sentBy: req.user._id, body: req.body.body });
  res.status(201).json({ message });
});

export function verifyWebhook(req, res) {
  if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === process.env.META_WHATSAPP_VERIFY_TOKEN) {
    return res.status(200).send(req.query['hub.challenge']);
  }
  return res.sendStatus(403);
}

export async function receiveWebhook(req, res) {
  if (!verifyWebhookSignature(req.rawBody, req.get('x-hub-signature-256'))) return res.sendStatus(401);
  const statuses = req.body?.entry?.flatMap((entry) => entry.changes || [])
    .flatMap((change) => change.value?.statuses || []) || [];
  try {
    await applyWebhookStatuses(statuses);
    return res.sendStatus(200);
  } catch (error) {
    return res.status(500).json({ message: 'Unable to process WhatsApp webhook' });
  }
}

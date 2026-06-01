import fs from 'fs';
import path from 'path';
import PDFDocument from 'pdfkit';
import { nocDir, publicPath } from '../utils/storage.js';

function money(value) {
  return `Rs. ${Number(value || 0).toFixed(2)}`;
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'Asia/Kolkata'
  }).format(date);
}

function formatDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${formatDate(date)}, ${new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' }).format(date)}`;
}

const receiptTheme = {
  primary: '#2563EB',
  secondary: '#1E40AF',
  pale: '#EFF6FF',
  line: '#DBEAFE',
  ink: '#0F172A',
  muted: '#64748B',
  soft: '#F8FAFC'
};

function receiptNumber(value) {
  const raw = String(value || '').toUpperCase();
  const numeric = raw.match(/\d+$/)?.[0];
  if (numeric) return `RCPT-${numeric.slice(-3).padStart(3, '0')}`;
  const hex = raw.match(/[A-F0-9]+$/)?.[0] || raw;
  const valueNumber = Number.parseInt(hex.slice(-6), 16);
  const suffix = Number.isFinite(valueNumber) ? ((valueNumber % 999) + 1) : 1;
  return `RCPT-${String(suffix).padStart(3, '0')}`;
}

function textValue(value) {
  return value || 'N/A';
}

function drawReceiptShell(doc, { title, number, date }) {
  doc.rect(0, 0, 612, 116).fill(receiptTheme.primary);
  doc.rect(0, 104, 612, 12).fill(receiptTheme.secondary);

  doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(21).text('Satluj Finance', 42, 32);
  doc.font('Helvetica-Bold').fontSize(13).fillColor('#FFFFFF').text(title, 42, 72);

  doc.roundedRect(382, 28, 172, 60, 6).fill('#FFFFFF');
  doc.fillColor(receiptTheme.muted).font('Helvetica').fontSize(8).text('RECEIPT NO.', 398, 42);
  doc.fillColor(receiptTheme.ink).font('Helvetica-Bold').fontSize(9).text(textValue(number), 398, 54, { width: 140, align: 'right' });
  doc.fillColor(receiptTheme.muted).font('Helvetica').fontSize(8).text('DATE', 398, 70);
  doc.fillColor(receiptTheme.ink).font('Helvetica-Bold').fontSize(9).text(textValue(date), 438, 70, { width: 100, align: 'right' });
}

function sectionTitle(doc, label, x, y) {
  doc.fillColor(receiptTheme.secondary).font('Helvetica-Bold').fontSize(10).text(label.toUpperCase(), x, y);
  doc.moveTo(x, y + 16).lineTo(x + 511, y + 16).strokeColor(receiptTheme.line).lineWidth(1).stroke();
}

function drawInfoGrid(doc, rows, x, y, width) {
  const labelWidth = 118;
  const rowHeight = 26;
  rows.forEach(([label, value], index) => {
    const rowY = y + index * rowHeight;
    doc.rect(x, rowY, width, rowHeight).fill(index % 2 === 0 ? receiptTheme.soft : '#FFFFFF');
    doc.fillColor(receiptTheme.muted).font('Helvetica').fontSize(8).text(label, x + 12, rowY + 8, { width: labelWidth });
    doc.fillColor(receiptTheme.ink).font('Helvetica-Bold').fontSize(9).text(textValue(value), x + labelWidth + 16, rowY + 8, { width: width - labelWidth - 28 });
  });
  doc.roundedRect(x, y, width, rows.length * rowHeight, 5).strokeColor(receiptTheme.line).lineWidth(1).stroke();
}

function drawAmountCards(doc, cards, x, y) {
  const gap = 12;
  const cardWidth = (511 - gap * (cards.length - 1)) / cards.length;
  cards.forEach((card, index) => {
    const cardX = x + index * (cardWidth + gap);
    doc.roundedRect(cardX, y, cardWidth, 72, 6).fillAndStroke(index === 0 ? receiptTheme.pale : '#FFFFFF', receiptTheme.line);
    doc.fillColor(receiptTheme.muted).font('Helvetica').fontSize(8).text(card.label.toUpperCase(), cardX + 12, y + 15, { width: cardWidth - 24 });
    doc.fillColor(card.emphasis ? receiptTheme.primary : receiptTheme.ink).font('Helvetica-Bold').fontSize(14).text(card.value, cardX + 12, y + 35, { width: cardWidth - 24 });
  });
}

function drawReceiptFooter(doc) {
  doc.moveTo(42, 692).lineTo(553, 692).strokeColor(receiptTheme.line).lineWidth(1).stroke();
  doc.fillColor(receiptTheme.muted).font('Helvetica').fontSize(8).text('This computer generated receipt confirms the recorded transaction in Satluj Finance system.', 42, 706, { width: 330 });
  doc.fillColor(receiptTheme.ink).font('Helvetica-Bold').fontSize(9).text('Authorized Signatory', 410, 706, { width: 143, align: 'right' });
}

function loanPenaltyTotal(loan) {
  return (loan.installments || []).reduce((sum, item) => sum + Number(item.penaltyAmount || 0), 0);
}

function loanTotalWithPenalty(loan) {
  return Number(loan.loanAmount || 0) + Number(loan.interestAmount || 0) + Number(loan.processingCharges || 0) + loanPenaltyTotal(loan);
}

function drawLoanSummaryBreakdown(doc, loan, x, y, width) {
  const totalAmount = loanTotalWithPenalty(loan);
  const pendingAmount = Math.max(totalAmount - Number(loan.totalPaid || 0), 0);
  const rows = [
    ['Loan Amount', money(loan.loanAmount)],
    ['Interest Amount', money(loan.interestAmount)],
    ['Processing Fees', money(loan.processingCharges)]
  ];
  const penaltyAmount = loanPenaltyTotal(loan);
  if (penaltyAmount > 0) rows.push(['Penalty Amount', money(penaltyAmount)]);
  rows.push(['Total Amount', money(totalAmount)]);
  rows.push(['Amount Paid So Far', money(loan.totalPaid)]);
  rows.push(['Pending Amount', money(pendingAmount)]);

  const rowHeight = 28;
  rows.forEach(([label, value], index) => {
    const rowY = y + index * rowHeight;
    const isTotal = index === rows.length - 1;
    if (isTotal) doc.moveTo(x, rowY).lineTo(x + width, rowY).strokeColor(receiptTheme.line).lineWidth(1).stroke();
    doc.rect(x, rowY, width, rowHeight).fill(isTotal ? receiptTheme.pale : (index % 2 === 0 ? receiptTheme.soft : '#FFFFFF'));
    doc.fillColor(isTotal ? receiptTheme.secondary : receiptTheme.muted).font(isTotal ? 'Helvetica-Bold' : 'Helvetica').fontSize(isTotal ? 10 : 9).text(label, x + 12, rowY + 9, { width: 220 });
    doc.fillColor(isTotal ? receiptTheme.primary : receiptTheme.ink).font('Helvetica-Bold').fontSize(isTotal ? 11 : 9).text(value, x + 260, rowY + 9, { width: width - 272, align: 'right' });
  });
  doc.roundedRect(x, y, width, rows.length * rowHeight, 5).strokeColor(receiptTheme.line).lineWidth(1).stroke();
}

function writeDocument(filePath, writer) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 42 });
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);
    writer(doc);
    doc.end();
    stream.on('finish', () => resolve(publicPath(filePath)));
    stream.on('error', reject);
  });
}

export function generatePaymentReceiptBuffer({ payment, loan, borrower }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 42 });
    const chunks = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const mobile = (borrower.mobileNumbers || [borrower.phone]).filter(Boolean).join(', ');

    drawReceiptShell(doc, {
      title: 'Receipt',
      number: receiptNumber(payment._id),
      date: formatDateTime(payment.createdAt)
    });

    sectionTitle(doc, 'Customer Details', 42, 148);
    drawInfoGrid(doc, [
      ['Customer ID', borrower.customerId],
      ['Customer Name', borrower.name],
      ['Mobile Number', mobile],
      ['Address', borrower.address]
    ], 42, 178, 511);

    sectionTitle(doc, 'Receipt Details', 42, 306);
    drawInfoGrid(doc, [
      ['Receipt Amount', money(payment.amount)],
      ['Receipt Mode', `${payment.mode}${payment.chequeNumber ? ` (${payment.chequeNumber})` : ''}`],
      ['Collected By', payment.collectedBy?.name || payment.collectedBy?.username],
      ['Notes', payment.notes]
    ], 42, 336, 511);

    sectionTitle(doc, 'Loan Summary', 42, 464);
    drawLoanSummaryBreakdown(doc, loan, 42, 494, 511);

    drawReceiptFooter(doc);

    doc.end();
  });
}

export function generateLoanReceiptBuffer({ loan, borrower, agent }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 42 });
    const chunks = [];
    const number = loan.receipt?.receiptNumber || loan._id;

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const mobile = (borrower.mobileNumbers || [borrower.phone]).filter(Boolean).join(', ');

    drawReceiptShell(doc, {
      title: 'Loan Receipt',
      number: receiptNumber(number),
      date: formatDateTime(loan.receipt?.generatedAt || new Date())
    });

    sectionTitle(doc, 'Customer Details', 42, 148);
    drawInfoGrid(doc, [
      ['Customer ID', borrower.customerId],
      ['Customer Name', borrower.name],
      ['Mobile Number', mobile],
      ['Address', borrower.address]
    ], 42, 178, 511);

    sectionTitle(doc, 'Receipt Details', 42, 306);
    drawInfoGrid(doc, [
      ['Loan Type', loan.loanCategory],
      ['Installment Type', loan.installmentType],
      ['Installment Amount', money(loan.installmentAmount)],
      ['Total Installments', loan.totalInstallments],
      ['Cheque Number', loan.chequeNumber],
      ['Created By', agent?.name || agent?.username]
    ], 42, 336, 511);

    sectionTitle(doc, 'Loan Summary', 42, 510);
    drawLoanSummaryBreakdown(doc, loan, 42, 540, 511);

    drawReceiptFooter(doc);

    doc.end();
  });
}

export async function generateNocPdf({ loan, borrower }) {
  const filePath = path.join(nocDir, `noc-${loan._id}.pdf`);
  return writeDocument(filePath, (doc) => {
    doc.fontSize(20).text('Satluj Finance', { align: 'center' });
    doc.fontSize(16).text('No Objection Certificate', { align: 'center' }).moveDown(2);
    doc.fontSize(12).text(`This is to certify that ${borrower.name}, ${borrower.fatherOrCareOf}, has completed all payments for loan ${loan._id}.`);
    doc.moveDown().text(`Loan Amount: ${money(loan.loanAmount)}`);
    doc.text(`Total Paid: ${money(loan.totalPaid)}`);
    doc.text(`Completion Date: ${formatDate(new Date())}`);
    doc.moveDown(3).text('Authorized Signatory');
  });
}

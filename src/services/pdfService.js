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
    year: 'numeric'
  }).format(date);
}

function formatDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${formatDate(date)} ${new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: true }).format(date)}`;
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

    const pendingAmount = Math.max(Number(loan.totalPayable || 0) - Number(loan.totalPaid || 0), 0);

    doc.rect(42, 36, 511, 92).fill('#111827');
    doc.fillColor('#ffffff').fontSize(22).text('New Satluj Finance', 62, 58);
    doc.fontSize(12).text('Payment Receipt', 62, 88);
    doc.fontSize(10).text(`Receipt No: ${payment._id}`, 320, 58, { width: 213, align: 'right' });
    doc.text(`Date: ${formatDateTime(payment.createdAt)}`, 320, 78, { width: 213, align: 'right' });
    doc.fillColor('#111827');

    doc.roundedRect(42, 154, 511, 108, 6).stroke('#d1d5db');
    doc.fontSize(13).text('Borrower Details', 62, 174);
    doc.fontSize(10).fillColor('#6b7280').text('Name', 62, 200);
    doc.fillColor('#111827').fontSize(11).text(borrower.name || '', 62, 216, { width: 170 });
    doc.fillColor('#6b7280').fontSize(10).text('Mobile', 248, 200);
    doc.fillColor('#111827').fontSize(11).text(borrower.phone || borrower.mobileNumbers?.[0] || '', 248, 216, { width: 110 });
    doc.fillColor('#6b7280').fontSize(10).text('Address', 376, 200);
    doc.fillColor('#111827').fontSize(11).text(borrower.address || '', 376, 216, { width: 150 });

    doc.roundedRect(42, 286, 511, 106, 6).fillAndStroke('#f9fafb', '#d1d5db');
    doc.fillColor('#6b7280').fontSize(10).text('Loan Amount', 62, 310);
    doc.fillColor('#111827').fontSize(16).text(money(loan.totalPayable), 62, 328, { width: 150 });
    doc.fillColor('#6b7280').fontSize(10).text('Amount Paid So Far', 236, 310);
    doc.fillColor('#111827').fontSize(16).text(money(loan.totalPaid), 236, 328, { width: 140 });
    doc.fillColor('#6b7280').fontSize(10).text('Pending Amount', 410, 310);
    doc.fillColor('#111827').fontSize(16).text(money(pendingAmount), 410, 328, { width: 120 });

    doc.roundedRect(42, 416, 511, 118, 6).stroke('#d1d5db');
    doc.fillColor('#111827').fontSize(13).text('Payment Details', 62, 436);
    doc.fillColor('#6b7280').fontSize(10).text('Payment Amount', 62, 464);
    doc.fillColor('#111827').fontSize(18).text(money(payment.amount), 62, 482);
    doc.fillColor('#6b7280').fontSize(10).text('Payment Mode', 248, 464);
    doc.fillColor('#111827').fontSize(11).text(`${payment.mode}${payment.chequeNumber ? ` (${payment.chequeNumber})` : ''}`, 248, 482);
    doc.fillColor('#6b7280').fontSize(10).text('Collected By', 410, 464);
    doc.fillColor('#111827').fontSize(11).text(payment.collectedBy?.name || payment.collectedBy?.username || 'N/A', 410, 482, { width: 120 });

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

    doc.fontSize(20).text('New Satluj Finance', { align: 'center' });
    doc.fontSize(14).text('Loan Receipt', { align: 'center' }).moveDown();
    doc.fontSize(11).text(`Receipt Number: ${number}`);
    doc.text(`Date: ${formatDate(new Date())}`);
    doc.text(`Agent Name: ${agent?.name || agent?.username || ''}`).moveDown();

    doc.fontSize(14).text('Borrower Details');
    doc.fontSize(11).text(`Customer ID: ${borrower.customerId || ''}`);
    doc.text(`Name: ${borrower.name}`);
    doc.text(`Mobile: ${(borrower.mobileNumbers || [borrower.phone]).filter(Boolean).join(', ')}`);
    doc.text(`Address: ${borrower.address}`).moveDown();

    doc.fontSize(14).text('Loan Details');
    doc.fontSize(11).text(`Loan Type: ${loan.loanCategory}`);
    doc.text(`Installment Type: ${loan.installmentType}`);
    doc.text(`Loan Amount: ${money(loan.loanAmount)}`);
    doc.text(`Processing Charges: ${money(loan.processingCharges)}`);
    doc.text(`Interest: ${loan.interestPercent}% (${money(loan.interestAmount)})`);
    doc.text(`Total Amount: ${money(loan.totalPayable)}`);
    doc.text(`Installment Amount: ${money(loan.installmentAmount)}`);
    doc.text(`Total Installments: ${loan.totalInstallments}`).moveDown();

    doc.fontSize(14).text('Installment Plan');
    loan.installments.forEach((item) => {
      doc.fontSize(9).text(`#${item.sequence} | Due: ${formatDate(item.dueDate)} | Amount: ${money(item.amount)} | Status: ${item.status}`);
    });

    doc.end();
  });
}

export async function generateNocPdf({ loan, borrower }) {
  const filePath = path.join(nocDir, `noc-${loan._id}.pdf`);
  return writeDocument(filePath, (doc) => {
    doc.fontSize(20).text('New Satluj Finance', { align: 'center' });
    doc.fontSize(16).text('No Objection Certificate', { align: 'center' }).moveDown(2);
    doc.fontSize(12).text(`This is to certify that ${borrower.name}, ${borrower.fatherOrCareOf}, has completed all payments for loan ${loan._id}.`);
    doc.moveDown().text(`Loan Amount: ${money(loan.loanAmount)}`);
    doc.text(`Total Paid: ${money(loan.totalPaid)}`);
    doc.text(`Completion Date: ${formatDate(new Date())}`);
    doc.moveDown(3).text('Authorized Signatory');
  });
}

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

    doc.rect(42, 36, 511, 86).fill('#111827');
    doc.fillColor('#ffffff').fontSize(22).text('New Satluj Finance', 62, 56);
    doc.fontSize(11).text('Payment Receipt', 62, 86);
    doc.fontSize(10).text(`Receipt No: ${payment._id}`, 330, 58, { align: 'right' });
    doc.text(`Date: ${formatDateTime(payment.createdAt)}`, 330, 78, { align: 'right' });
    doc.fillColor('#111827').moveDown(4);

    doc.fontSize(14).text('Borrower Details').moveDown(0.4);
    doc.fontSize(11).text(`Name: ${borrower.name}`);
    doc.text(`Father/Care of: ${borrower.fatherOrCareOf || ''}`);
    doc.text(`Phone: ${borrower.phone || borrower.mobileNumbers?.[0] || ''}`);
    doc.text(`Address: ${borrower.address}`).moveDown();

    doc.roundedRect(42, doc.y, 511, 100, 6).stroke('#d1d5db');
    const boxY = doc.y + 16;
    doc.fontSize(10).fillColor('#6b7280').text('Total Payable as Loan Amount', 62, boxY);
    doc.fillColor('#111827').fontSize(16).text(money(loan.totalPayable), 62, boxY + 18);
    doc.fillColor('#6b7280').fontSize(10).text('Amount Paid So Far', 260, boxY);
    doc.fillColor('#111827').fontSize(16).text(money(loan.totalPaid), 260, boxY + 18);
    doc.fillColor('#6b7280').fontSize(10).text('Pending Amount', 430, boxY);
    doc.fillColor('#111827').fontSize(16).text(money(pendingAmount), 430, boxY + 18);
    doc.y = boxY + 76;

    doc.fontSize(14).text('Payment Details').moveDown(0.4);
    doc.fontSize(11).text(`Payment Amount: ${money(payment.amount)}`);
    doc.text(`Payment Mode: ${payment.mode}${payment.chequeNumber ? ` (${payment.chequeNumber})` : ''}`);
    doc.text(`Collected By: ${payment.collectedBy?.name || payment.collectedBy?.username || 'N/A'}`);

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

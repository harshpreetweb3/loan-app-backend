import fs from 'fs';
import path from 'path';
import PDFDocument from 'pdfkit';
import { nocDir, publicPath, receiptDir } from '../utils/storage.js';

function money(value) {
  return `Rs. ${Number(value || 0).toFixed(2)}`;
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

export async function generateReceiptPdf({ payment, loan, borrower }) {
  const filePath = path.join(receiptDir, `receipt-${payment._id}.pdf`);
  return writeDocument(filePath, (doc) => {
    doc.fontSize(20).text('Payment Receipt', { align: 'center' }).moveDown();
    doc.fontSize(11).text(`Receipt ID: ${payment._id}`);
    doc.text(`Date: ${new Date(payment.createdAt).toLocaleString()}`).moveDown();
    doc.fontSize(14).text('Borrower Details');
    doc.fontSize(11).text(`Name: ${borrower.name}`);
    doc.text(`Father/Care of: ${borrower.fatherOrCareOf}`);
    doc.text(`Phone: ${borrower.phone}`);
    doc.text(`Address: ${borrower.address}`).moveDown();
    doc.fontSize(14).text('Loan Details');
    doc.fontSize(11).text(`Loan Amount: ${money(loan.loanAmount)}`);
    doc.text(`Interest: ${loan.interestPercent}%`);
    doc.text(`Total Payable: ${money(loan.totalPayable)}`);
    doc.text(`Total Paid: ${money(loan.totalPaid)}`);
    doc.text(`Remaining Amount: ${money(Math.max(loan.totalPayable - loan.totalPaid, 0))}`).moveDown();
    doc.fontSize(14).text('Installment History');
    loan.installments.forEach((item) => {
      doc.fontSize(9).text(
        `#${item.sequence} | Due: ${new Date(item.dueDate).toLocaleDateString()} | Amount: ${money(item.amount)} | Paid: ${money(item.paidAmount)} | ${item.status}`
      );
    });
  });
}

export async function generateLoanReceiptPdf({ loan, borrower }) {
  const number = loan.receipt?.receiptNumber || loan._id;
  const filePath = path.join(receiptDir, `loan-receipt-${number}.pdf`);
  return writeDocument(filePath, (doc) => {
    doc.fontSize(20).text('Loan Receipt', { align: 'center' }).moveDown();
    doc.fontSize(11).text(`Receipt Number: ${number}`);
    doc.text(`Date: ${new Date(loan.createdAt || Date.now()).toLocaleString()}`).moveDown();
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
    doc.text(`Installment Amount: ${money(loan.installmentAmount)}`).moveDown();
    doc.fontSize(14).text('Installment Plan');
    loan.installments.forEach((item) => {
      doc.fontSize(9).text(`#${item.sequence} | Due: ${new Date(item.dueDate).toLocaleDateString()} | Amount: ${money(item.amount)}`);
    });
  });
}

export async function generateNocPdf({ loan, borrower }) {
  const filePath = path.join(nocDir, `noc-${loan._id}.pdf`);
  return writeDocument(filePath, (doc) => {
    doc.fontSize(20).text('No Objection Certificate', { align: 'center' }).moveDown(2);
    doc.fontSize(12).text(`This is to certify that ${borrower.name}, ${borrower.fatherOrCareOf}, has completed all payments for loan ${loan._id}.`);
    doc.moveDown().text(`Loan Amount: ${money(loan.loanAmount)}`);
    doc.text(`Total Paid: ${money(loan.totalPaid)}`);
    doc.text(`Completion Date: ${new Date().toLocaleDateString()}`);
    doc.moveDown(3).text('Authorized Signatory');
  });
}

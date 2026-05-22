import Loan from '../models/Loan.js';
import Payment from '../models/Payment.js';
import { generatePaymentReceiptBuffer } from '../services/pdfService.js';
import { buildChanges, writeAudit } from '../utils/audit.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { refreshLoanTotals } from '../utils/loanCalculator.js';

export const createPayment = asyncHandler(async (req, res) => {
  const { loanId, installmentIds = [], mode, notes, chequeNumber } = req.body;
  if (mode === 'cheque' && !String(chequeNumber || '').trim()) return res.status(400).json({ message: 'Cheque number is required' });
  const loan = await Loan.findById(loanId).populate('borrower');
  if (!loan) return res.status(404).json({ message: 'Loan not found' });

  const selected = loan.installments.filter((item) => installmentIds.includes(String(item._id)) && item.status !== 'paid' && !item.convertedAt);
  if (!selected.length) return res.status(400).json({ message: 'Select at least one unpaid installment' });

  const amount = selected.reduce((sum, item) => sum + Math.max(item.amount + (item.penaltyAmount || 0) - (item.paidAmount || 0), 0), 0);
  selected.forEach((item) => {
    item.paidAmount = item.amount + (item.penaltyAmount || 0);
    item.status = 'paid';
    item.paidAt = new Date();
  });
  refreshLoanTotals(loan);
  await loan.save();

  const payment = await Payment.create({
    borrower: loan.borrower._id,
    loan: loan._id,
    amount,
    mode,
    chequeNumber: mode === 'cheque' ? chequeNumber : undefined,
    installmentIds,
    collectedBy: req.user._id,
    notes
  });

  res.status(201).json({ payment, loan });
});

export const listPayments = asyncHandler(async (req, res) => {
  const query = {};
  if (req.query.scope === 'mine') query.collectedBy = req.user._id;
  if (req.query.agent) query.collectedBy = req.query.agent;
  if (req.query.borrower) query.borrower = req.query.borrower;
  if (req.query.mode) query.mode = req.query.mode;
  if (req.query.from || req.query.to) {
    query.createdAt = {};
    if (req.query.from) query.createdAt.$gte = new Date(req.query.from);
    if (req.query.to) query.createdAt.$lte = new Date(req.query.to);
  }
  const payments = await Payment.find(query)
    .populate('borrower')
    .populate('loan')
    .populate('collectedBy', 'name username')
    .sort({ createdAt: -1 });
  const filtered = req.query.borrowerName
    ? payments.filter((payment) => payment.borrower?.name?.toLowerCase().includes(String(req.query.borrowerName).toLowerCase()))
    : payments;
  res.json({ payments: filtered });
});

export const updatePayment = asyncHandler(async (req, res) => {
  const payment = await Payment.findById(req.params.id);
  if (!payment) return res.status(404).json({ message: 'Payment not found' });
  const fields = ['mode', 'notes', 'chequeNumber'];
  const changes = buildChanges(payment, req.body, fields);
  fields.forEach((field) => {
    if (req.body[field] !== undefined) payment[field] = req.body[field];
  });
  await payment.save();
  await writeAudit({ entity: 'Payment', entityId: payment._id, action: 'admin_update', changes, admin: req.user._id });
  res.json({ payment });
});

export const generateReceipt = asyncHandler(async (req, res) => {
  const payment = await Payment.findById(req.params.id).populate('loan').populate('borrower').populate('collectedBy', 'name username');
  if (!payment) return res.status(404).json({ message: 'Payment not found' });
  const pdf = await generatePaymentReceiptBuffer({ payment, loan: payment.loan, borrower: payment.borrower });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="payment-receipt-${payment._id}.pdf"`);
  res.setHeader('Content-Length', pdf.length);
  res.send(pdf);
});

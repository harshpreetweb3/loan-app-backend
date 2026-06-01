import Loan from '../models/Loan.js';
import Payment from '../models/Payment.js';
import { generatePaymentReceiptBuffer } from '../services/pdfService.js';
import { buildChanges, writeAudit } from '../utils/audit.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { refreshLoanTotals } from '../utils/loanCalculator.js';
import { applyPenaltyToLoan } from '../utils/penalty.js';

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function activeInstallments(loan) {
  return loan.installments
    .filter((item) => !item.convertedAt && item.status !== 'paid')
    .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
}

function installmentRemaining(item) {
  return Math.max(roundMoney(Number(item.amount || 0) - Number(item.paidAmount || 0)), 0);
}

function penaltyRemaining(item) {
  return Math.max(roundMoney(Number(item.penaltyAmount || 0) - Number(item.penaltyPaidAmount || 0) - Number(item.penaltyWaivedAmount || 0)), 0);
}

function updateInstallmentStatus(item) {
  if (installmentRemaining(item) <= 0) {
    item.status = penaltyRemaining(item) <= 0 ? 'paid' : 'overdue';
    if (item.status === 'paid') item.paidAt = new Date();
  } else if (Number(item.paidAmount || 0) > 0) {
    item.status = 'partial';
  }
}

function allocateInstallmentPayment(loan, selectedIds, amount) {
  let remaining = roundMoney(amount);
  const selectedSet = new Set((selectedIds || []).map(String));
  const ordered = activeInstallments(loan);
  const preferred = selectedSet.size ? ordered.filter((item) => selectedSet.has(String(item._id))) : ordered;
  const fallback = ordered.filter((item) => !selectedSet.has(String(item._id)));
  const allocations = [];

  [...preferred, ...fallback].forEach((item) => {
    if (remaining <= 0) return;
    const due = installmentRemaining(item);
    if (due <= 0) return;
    const applied = Math.min(due, remaining);
    item.paidAmount = roundMoney(Number(item.paidAmount || 0) + applied);
    remaining = roundMoney(remaining - applied);
    allocations.push({ type: 'installment', installmentId: item._id, amount: applied });
    updateInstallmentStatus(item);
  });

  if (!allocations.length) {
    const error = new Error('No pending installment amount found');
    error.statusCode = 400;
    throw error;
  }
  if (remaining > 0) {
    const error = new Error('Receipt amount is greater than pending installment amount');
    error.statusCode = 400;
    throw error;
  }
  return allocations;
}

function allocatePenaltyPayment(loan, selectedIds, amount) {
  let remaining = roundMoney(amount);
  const selectedSet = new Set((selectedIds || []).map(String));
  const ordered = activeInstallments(loan).filter((item) => penaltyRemaining(item) > 0);
  const targets = selectedSet.size ? ordered.filter((item) => selectedSet.has(String(item._id))) : ordered;
  const allocations = [];

  targets.forEach((item) => {
    if (remaining <= 0) return;
    const due = penaltyRemaining(item);
    const applied = Math.min(due, remaining);
    item.penaltyPaidAmount = roundMoney(Number(item.penaltyPaidAmount || 0) + applied);
    remaining = roundMoney(remaining - applied);
    allocations.push({ type: 'penalty', installmentId: item._id, amount: applied });
    updateInstallmentStatus(item);
  });

  if (!allocations.length) {
    const error = new Error('No pending penalty amount found');
    error.statusCode = 400;
    throw error;
  }
  if (remaining > 0) {
    const error = new Error('Receipt amount is greater than pending penalty amount');
    error.statusCode = 400;
    throw error;
  }
  return allocations;
}

export const createPayment = asyncHandler(async (req, res) => {
  const { loanId, installmentIds = [], mode, notes, chequeNumber, paymentCategory = 'installment' } = req.body;
  const amount = roundMoney(req.body.amount);
  if (!amount || amount <= 0) return res.status(400).json({ message: 'Receipt amount is required' });
  if (mode === 'cheque' && !String(chequeNumber || '').trim()) return res.status(400).json({ message: 'Cheque number is required' });
  const loan = await Loan.findById(loanId).populate('borrower');
  if (!loan) return res.status(404).json({ message: 'Loan not found' });

  await applyPenaltyToLoan(loan);
  let allocations = [];
  if (paymentCategory === 'installment') {
    allocations = allocateInstallmentPayment(loan, installmentIds, amount);
  } else if (paymentCategory === 'processingFee') {
    if (loan.processingFeeMode !== 'separate') return res.status(400).json({ message: 'Processing fee is already deducted at loan creation' });
    const pending = Math.max(roundMoney(Number(loan.processingCharges || 0) - Number(loan.processingFeePaidAmount || 0) - Number(loan.processingFeeWaivedAmount || 0)), 0);
    if (pending <= 0) return res.status(400).json({ message: 'No pending processing fee found' });
    if (amount > pending) return res.status(400).json({ message: 'Receipt amount is greater than pending processing fee' });
    loan.processingFeePaidAmount = roundMoney(Number(loan.processingFeePaidAmount || 0) + amount);
    loan.processingFeeWaivedAmount = roundMoney(Number(loan.processingFeeWaivedAmount || 0) + Math.max(pending - amount, 0));
    allocations = [{ type: 'processingFee', amount }];
  } else if (paymentCategory === 'penalty') {
    allocations = allocatePenaltyPayment(loan, installmentIds, amount);
  } else {
    return res.status(400).json({ message: 'Payment category is required' });
  }
  refreshLoanTotals(loan);
  await loan.save();

  const payment = await Payment.create({
    borrower: loan.borrower._id,
    loan: loan._id,
    amount,
    paymentCategory,
    mode,
    chequeNumber: mode === 'cheque' ? chequeNumber : undefined,
    installmentIds,
    allocations,
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
  const statsQuery = { ...query };
  if (req.query.from || req.query.to) {
    query.createdAt = {};
    if (req.query.from) query.createdAt.$gte = new Date(req.query.from);
    if (req.query.to) query.createdAt.$lte = new Date(req.query.to);
  }
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const nextMonthStart = new Date(monthStart);
  nextMonthStart.setMonth(nextMonthStart.getMonth() + 1);
  const [payments, statPayments] = await Promise.all([
    Payment.find(query)
      .populate('borrower')
      .populate('loan')
      .populate('collectedBy', 'name username')
      .sort({ createdAt: -1 }),
    Payment.find(statsQuery).select('amount createdAt')
  ]);
  const stats = statPayments.reduce((summary, payment) => {
    summary.totalCollected += Number(payment.amount || 0);
    if (payment.createdAt >= monthStart && payment.createdAt < nextMonthStart) summary.collectionThisMonth += Number(payment.amount || 0);
    return summary;
  }, { totalCollected: 0, collectionThisMonth: 0 });
  const filtered = req.query.borrowerName
    ? payments.filter((payment) => payment.borrower?.name?.toLowerCase().includes(String(req.query.borrowerName).toLowerCase()))
    : payments;
  res.json({ payments: filtered, stats });
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
  res.setHeader('Content-Disposition', `inline; filename="receipt-${payment._id}.pdf"`);
  res.setHeader('Content-Length', pdf.length);
  res.send(pdf);
});

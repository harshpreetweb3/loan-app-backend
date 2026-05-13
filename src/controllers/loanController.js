import Loan from '../models/Loan.js';
import Borrower from '../models/Borrower.js';
import { buildChanges, writeAudit } from '../utils/audit.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { calculateLoanSchedule } from '../utils/loanCalculator.js';
import { generateLoanReceiptBuffer, generateNocPdf } from '../services/pdfService.js';
import { nextSequence } from '../utils/sequence.js';

function numberValue(value) {
  return Number(value);
}

function validateLoanPayload(payload) {
  const errors = [];
  if (!payload.borrower) errors.push('Borrower is required');
  if (!numberValue(payload.loanAmount) || numberValue(payload.loanAmount) <= 0) errors.push('Loan amount is required');
  if (payload.interestPercent === undefined || payload.interestPercent === '' || numberValue(payload.interestPercent) < 0) errors.push('Interest percentage is required');
  if (!numberValue(payload.duration) || numberValue(payload.duration) <= 0) errors.push('Number of installments is required');
  if (!['daily', 'monthly'].includes(payload.installmentType)) errors.push('Installment type is required');
  if (!payload.startDate && !payload.dateOfFinance) errors.push('Finance date is required');
  if (payload.installmentType === 'monthly' && (numberValue(payload.dueDayOfMonth) < 1 || numberValue(payload.dueDayOfMonth) > 31)) errors.push('Due day must be between 1 and 31');
  return errors;
}

export const createLoan = asyncHandler(async (req, res) => {
  const borrower = await Borrower.findById(req.body.borrower);
  if (!borrower) return res.status(404).json({ message: 'Borrower not found' });
  const payload = { ...req.body, loanCategory: borrower.loanCategory, installmentCountMode: 'manual' };
  const errors = validateLoanPayload(payload);
  if (errors.length) return res.status(400).json({ message: errors[0], errors });
  const schedule = calculateLoanSchedule(payload);
  const receiptNumber = await nextSequence('loanReceipt', 'LR-');
  const loan = await Loan.create({
    ...payload,
    ...schedule,
    dateOfFinance: payload.dateOfFinance || payload.startDate || new Date(),
    receipt: { receiptNumber, generatedAt: new Date() },
    createdBy: req.user._id
  });
  res.status(201).json({ loan });
});

export const listLoans = asyncHandler(async (req, res) => {
  const query = {};
  if (req.query.scope === 'mine') query.createdBy = req.user._id;
  if (req.query.status && req.query.status !== 'overdue') query.status = req.query.status;
  if (req.query.status === 'overdue') query['installments.status'] = 'overdue';
  if (req.query.installmentType) query.installmentType = req.query.installmentType;
  if (req.query.agent) query.createdBy = req.query.agent;
  if (req.query.from || req.query.to) {
    query.createdAt = {};
    if (req.query.from) query.createdAt.$gte = new Date(req.query.from);
    if (req.query.to) query.createdAt.$lte = new Date(req.query.to);
  }
  const loans = await Loan.find(query)
    .populate('borrower')
    .populate('createdBy', 'name username')
    .sort({ createdAt: -1 });
  const filtered = req.query.borrowerName
    ? loans.filter((loan) => loan.borrower?.name?.toLowerCase().includes(String(req.query.borrowerName).toLowerCase()))
    : loans;
  res.json({ loans: filtered });
});

export const getLoan = asyncHandler(async (req, res) => {
  const loan = await Loan.findById(req.params.id).populate('borrower').populate('createdBy', 'name username');
  if (!loan) return res.status(404).json({ message: 'Loan not found' });
  res.json({ loan });
});

export const updateLoan = asyncHandler(async (req, res) => {
  const loan = await Loan.findById(req.params.id);
  if (!loan) return res.status(404).json({ message: 'Loan not found' });
  const nextPayload = { ...loan.toObject(), ...req.body, installmentCountMode: 'manual' };
  const errors = validateLoanPayload(nextPayload);
  if (errors.length) return res.status(400).json({ message: errors[0], errors });
  const fields = ['loanAmount', 'interestPercent', 'interestAmount', 'duration', 'installmentType', 'processingCharges', 'startDate', 'dateOfFinance', 'dueDayOfMonth'];
  const changes = buildChanges(loan, req.body, fields);
  if (changes.length) {
    const schedule = calculateLoanSchedule(nextPayload);
    Object.assign(loan, req.body, { installmentCountMode: 'manual' }, schedule);
  }
  await loan.save();
  await writeAudit({ entity: 'Loan', entityId: loan._id, action: 'admin_update', changes, admin: req.user._id });
  res.json({ loan });
});

export const generateLoanReceipt = asyncHandler(async (req, res) => {
  const loan = await Loan.findById(req.params.id).populate('borrower').populate('createdBy', 'name username');
  if (!loan) return res.status(404).json({ message: 'Loan not found' });
  if (!loan.receipt?.receiptNumber) loan.receipt.receiptNumber = await nextSequence('loanReceipt', 'LR-');
  loan.receipt.generatedAt = new Date();
  await loan.save();
  const pdf = await generateLoanReceiptBuffer({ loan, borrower: loan.borrower, agent: loan.createdBy });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="loan-receipt-${loan.receipt.receiptNumber}.pdf"`);
  res.setHeader('Content-Length', pdf.length);
  res.send(pdf);
});

export const switchInstallmentType = asyncHandler(async (req, res) => {
  const loan = await Loan.findById(req.params.id);
  if (!loan) return res.status(404).json({ message: 'Loan not found' });
  const installmentType = req.body.installmentType || (loan.installmentType === 'daily' ? 'monthly' : 'daily');
  const duration = numberValue(req.body.duration);
  if (!['daily', 'monthly'].includes(installmentType)) return res.status(400).json({ message: 'Installment type is required' });
  if (!duration || duration <= 0) return res.status(400).json({ message: 'Redefine the number of installments before switching loan type' });
  if (installmentType === loan.installmentType) return res.status(400).json({ message: 'Choose a different loan type' });
  const next = { ...loan.toObject(), installmentType, duration };
  const schedule = calculateLoanSchedule(next);
  Object.assign(loan, { installmentType, duration, installmentCountMode: 'manual' }, schedule);
  await loan.save();
  res.json({ loan });
});

export const requestNoc = asyncHandler(async (req, res) => {
  const loan = await Loan.findById(req.params.id);
  if (!loan) return res.status(404).json({ message: 'Loan not found' });
  if (loan.status !== 'completed') return res.status(400).json({ message: 'Loan must be completed before NOC request' });
  loan.noc = { ...loan.noc, status: 'requested', requestedBy: req.user._id, requestedAt: new Date() };
  await loan.save();
  res.json({ loan });
});

export const reviewNoc = asyncHandler(async (req, res) => {
  const loan = await Loan.findById(req.params.id).populate('borrower');
  if (!loan) return res.status(404).json({ message: 'Loan not found' });
  const { status, rejectionReason } = req.body;
  if (!['approved', 'rejected'].includes(status)) return res.status(400).json({ message: 'Invalid NOC status' });
  loan.noc.status = status;
  loan.noc.reviewedBy = req.user._id;
  loan.noc.reviewedAt = new Date();
  loan.noc.rejectionReason = status === 'rejected' ? rejectionReason : undefined;
  await loan.save();
  res.json({ loan });
});

export const generateNoc = asyncHandler(async (req, res) => {
  const loan = await Loan.findById(req.params.id).populate('borrower');
  if (!loan) return res.status(404).json({ message: 'Loan not found' });
  if (loan.noc.status !== 'approved') return res.status(400).json({ message: 'NOC is not approved' });
  const filePath = await generateNocPdf({ loan, borrower: loan.borrower });
  loan.noc.filePath = filePath;
  await loan.save();
  res.json({ filePath, loan });
});

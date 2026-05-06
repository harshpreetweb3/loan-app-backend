import Loan from '../models/Loan.js';
import { buildChanges, writeAudit } from '../utils/audit.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { calculateLoanSchedule } from '../utils/loanCalculator.js';
import { generateLoanReceiptPdf, generateNocPdf } from '../services/pdfService.js';
import { nextSequence } from '../utils/sequence.js';

export const createLoan = asyncHandler(async (req, res) => {
  const schedule = calculateLoanSchedule(req.body);
  const receiptNumber = await nextSequence('loanReceipt', 'LR-');
  const loan = await Loan.create({
    ...req.body,
    ...schedule,
    dateOfFinance: req.body.dateOfFinance || req.body.startDate || new Date(),
    receipt: { receiptNumber, generatedAt: new Date() },
    createdBy: req.user._id
  });
  await loan.populate('borrower');
  loan.receipt.filePath = await generateLoanReceiptPdf({ loan, borrower: loan.borrower });
  await loan.save();
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
  const fields = ['loanAmount', 'interestPercent', 'interestAmount', 'duration', 'installmentType', 'processingCharges', 'startDate', 'dateOfFinance', 'dueDayOfMonth', 'loanCategory'];
  const changes = buildChanges(loan, req.body, fields);
  if (changes.length) {
    const next = { ...loan.toObject(), ...req.body };
    const schedule = calculateLoanSchedule(next);
    Object.assign(loan, req.body, schedule);
  }
  await loan.save();
  await writeAudit({ entity: 'Loan', entityId: loan._id, action: 'admin_update', changes, admin: req.user._id });
  res.json({ loan });
});

export const generateLoanReceipt = asyncHandler(async (req, res) => {
  const loan = await Loan.findById(req.params.id).populate('borrower');
  if (!loan) return res.status(404).json({ message: 'Loan not found' });
  if (!loan.receipt?.receiptNumber) loan.receipt.receiptNumber = await nextSequence('loanReceipt', 'LR-');
  loan.receipt.filePath = await generateLoanReceiptPdf({ loan, borrower: loan.borrower });
  loan.receipt.generatedAt = new Date();
  await loan.save();
  res.json({ filePath: loan.receipt.filePath, loan });
});

export const switchInstallmentType = asyncHandler(async (req, res) => {
  const loan = await Loan.findById(req.params.id);
  if (!loan) return res.status(404).json({ message: 'Loan not found' });
  const installmentType = req.body.installmentType || (loan.installmentType === 'daily' ? 'monthly' : 'daily');
  const next = { ...loan.toObject(), installmentType };
  const schedule = calculateLoanSchedule(next);
  Object.assign(loan, { installmentType }, schedule);
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

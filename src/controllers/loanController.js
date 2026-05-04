import Loan from '../models/Loan.js';
import { buildChanges, writeAudit } from '../utils/audit.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { calculateLoanSchedule } from '../utils/loanCalculator.js';
import { generateNocPdf } from '../services/pdfService.js';

export const createLoan = asyncHandler(async (req, res) => {
  const schedule = calculateLoanSchedule(req.body);
  const loan = await Loan.create({ ...req.body, ...schedule, createdBy: req.user._id });
  res.status(201).json({ loan });
});

export const listLoans = asyncHandler(async (req, res) => {
  const query = {};
  if (req.query.scope === 'mine') query.createdBy = req.user._id;
  if (req.query.status) query.status = req.query.status;
  const loans = await Loan.find(query)
    .populate('borrower')
    .populate('createdBy', 'name username')
    .sort({ createdAt: -1 });
  res.json({ loans });
});

export const getLoan = asyncHandler(async (req, res) => {
  const loan = await Loan.findById(req.params.id).populate('borrower').populate('createdBy', 'name username');
  if (!loan) return res.status(404).json({ message: 'Loan not found' });
  res.json({ loan });
});

export const updateLoan = asyncHandler(async (req, res) => {
  const loan = await Loan.findById(req.params.id);
  if (!loan) return res.status(404).json({ message: 'Loan not found' });
  const fields = ['loanAmount', 'interestPercent', 'duration', 'installmentType', 'processingCharges', 'startDate'];
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

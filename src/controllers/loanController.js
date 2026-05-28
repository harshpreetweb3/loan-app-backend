import Loan from '../models/Loan.js';
import Borrower from '../models/Borrower.js';
import { buildChanges, writeAudit } from '../utils/audit.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { buildInstallmentSchedule, calculateLoanSchedule, refreshLoanTotals } from '../utils/loanCalculator.js';
import { generateLoanReceiptBuffer, generateNocPdf } from '../services/pdfService.js';
import { nextSequence } from '../utils/sequence.js';
import { persistUploadedFile } from '../utils/cloudStorage.js';

function numberValue(value) {
  return Number(value);
}

function validateLoanPayload(payload) {
  const errors = [];
  if (!payload.borrower) errors.push('Borrower is required');
  if (!['personal', 'vehicle'].includes(payload.loanCategory)) errors.push('Loan type is required');
  if (!numberValue(payload.loanAmount) || numberValue(payload.loanAmount) <= 0) errors.push('Loan amount is required');
  if (payload.interestPercent === undefined || payload.interestPercent === '' || numberValue(payload.interestPercent) < 0) errors.push('Interest percentage is required');
  if (!numberValue(payload.duration) || numberValue(payload.duration) <= 0) errors.push('Duration is required');
  if (!['daily', 'monthly'].includes(payload.installmentType)) errors.push('Installment type is required');
  if (!payload.startDate && !payload.dateOfFinance) errors.push('Finance date is required');
  if (payload.installmentType === 'monthly' && (numberValue(payload.dueDayOfMonth) < 1 || numberValue(payload.dueDayOfMonth) > 31)) errors.push('Due day must be between 1 and 31');
  if (!payload.guarantor?.name) errors.push('Guarantor name is required');
  if (!payload.guarantor?.fatherName) errors.push('Guarantor father name is required');
  if (!/^[6-9]\d{9}$/.test(String(payload.guarantor?.phone || ''))) errors.push('Please enter a valid mobile number');
  if (!payload.guarantor?.address) errors.push('Guarantor address is required');
  if (!payload.guarantor?.proof1Path) errors.push('Guarantor proof 1 is required');
  if (payload.loanCategory === 'vehicle') {
    if (!payload.vehicle?.rcPhotoPath) errors.push('Vehicle RC photo is required');
    if (!payload.vehicle?.nameOnRc) errors.push('Name on RC is required');
    if (!payload.vehicle?.rcRegisteredNumber) errors.push('RC registered number is required');
    if (!payload.vehicle?.modelNumber) errors.push('Vehicle model number is required');
  }
  return errors;
}

function parseJsonField(value, fallback) {
  if (value === undefined) return fallback;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch (_error) {
    return fallback;
  }
}

async function normalizeLoanPayload(req, existing = {}) {
  const payload = { ...req.body };
  payload.guarantor = { ...(existing.guarantor || {}), ...parseJsonField(payload.guarantor, {}) };
  payload.vehicle = { ...(existing.vehicle || {}), ...parseJsonField(payload.vehicle, {}) };
  if (req.files?.guarantorProof1?.[0]) payload.guarantor.proof1Path = await persistUploadedFile(req.files.guarantorProof1[0]);
  if (req.files?.guarantorProof2?.[0]) payload.guarantor.proof2Path = await persistUploadedFile(req.files.guarantorProof2[0]);
  if (req.files?.rcPhoto?.[0]) payload.vehicle.rcPhotoPath = await persistUploadedFile(req.files.rcPhoto[0]);
  return payload;
}

export const createLoan = asyncHandler(async (req, res) => {
  const payload = await normalizeLoanPayload(req);
  const borrower = await Borrower.findById(payload.borrower);
  if (!borrower) return res.status(404).json({ message: 'Borrower not found' });
  payload.installmentCountMode = 'manual';
  const errors = validateLoanPayload(payload);
  if (errors.length) return res.status(400).json({ message: errors[0], errors });
  const schedule = calculateLoanSchedule(payload);
  const receiptNumber = await nextSequence('loanReceipt', 'RCPT-', 3);
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
    .populate('conversionHistory.convertedBy', 'name username role')
    .sort({ createdAt: -1 });
  const filtered = req.query.borrowerName
    ? loans.filter((loan) => loan.borrower?.name?.toLowerCase().includes(String(req.query.borrowerName).toLowerCase()))
    : loans;
  res.json({ loans: filtered });
});

export const getLoan = asyncHandler(async (req, res) => {
  const loan = await Loan.findById(req.params.id)
    .populate('borrower')
    .populate('createdBy', 'name username')
    .populate('conversionHistory.convertedBy', 'name username role');
  if (!loan) return res.status(404).json({ message: 'Loan not found' });
  res.json({ loan });
});

export const updateLoan = asyncHandler(async (req, res) => {
  const loan = await Loan.findById(req.params.id);
  if (!loan) return res.status(404).json({ message: 'Loan not found' });
  const payload = await normalizeLoanPayload(req, loan);
  const nextPayload = { ...loan.toObject(), ...payload, installmentCountMode: 'manual' };
  const errors = validateLoanPayload(nextPayload);
  if (errors.length) return res.status(400).json({ message: errors[0], errors });
  const fields = ['loanAmount', 'interestPercent', 'interestAmount', 'duration', 'installmentType', 'processingCharges', 'startDate', 'dateOfFinance', 'dueDayOfMonth', 'loanCategory', 'guarantor', 'vehicle'];
  const changes = buildChanges(loan, payload, fields);
  if (changes.length) {
    const schedule = calculateLoanSchedule(nextPayload);
    Object.assign(loan, payload, { installmentCountMode: 'manual' }, schedule);
  }
  await loan.save();
  await writeAudit({ entity: 'Loan', entityId: loan._id, action: 'admin_update', changes, admin: req.user._id });
  res.json({ loan });
});

export const generateLoanReceipt = asyncHandler(async (req, res) => {
  const loan = await Loan.findById(req.params.id).populate('borrower').populate('createdBy', 'name username');
  if (!loan) return res.status(404).json({ message: 'Loan not found' });
  if (!loan.receipt?.receiptNumber) loan.receipt.receiptNumber = await nextSequence('loanReceipt', 'RCPT-', 3);
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
  if (!['daily', 'monthly'].includes(installmentType)) return res.status(400).json({ message: 'Installment type is required' });
  if (installmentType === loan.installmentType) return res.status(400).json({ message: 'Choose a different loan type' });

  const convertedAt = new Date();
  const oldType = loan.installmentType;
  const oldInstallments = loan.totalInstallments;
  const paidAmount = Math.round(loan.installments.reduce((sum, item) => sum + (item.paidAmount || 0), 0) * 100) / 100;
  const remainingAmount = Math.max(Math.round((loan.totalPayable - paidAmount) * 100) / 100, 0);
  if (remainingAmount <= 0) return res.status(400).json({ message: 'Loan has no remaining amount to convert' });
  const unpaidActive = loan.installments.filter((item) => item.status !== 'paid' && !item.convertedAt).length;
  const remainingMonths = loan.installmentType === 'daily' ? unpaidActive / 30 : unpaidActive;
  const duration = installmentType === 'daily' ? remainingMonths : Math.max(1, Math.ceil(remainingMonths));
  if (!duration || duration <= 0) return res.status(400).json({ message: 'Loan has no remaining duration to convert' });

  const retainedInstallments = loan.installments
    .filter((item) => item.status === 'paid' || (item.paidAmount || 0) > 0)
    .map((item) => {
      if (item.status !== 'paid') item.convertedAt = convertedAt;
      return item;
    });
  const sequenceStart = retainedInstallments.length
    ? Math.max(...retainedInstallments.map((item) => Number(item.sequence || 0))) + 1
    : 1;
  const schedule = buildInstallmentSchedule({
    totalPayable: remainingAmount,
    duration,
    installmentType,
    startDate: req.body.startDate || convertedAt,
    dueDayOfMonth: req.body.dueDayOfMonth || loan.dueDayOfMonth,
    sequenceStart
  });

  loan.installmentType = installmentType;
  loan.duration = duration;
  loan.installmentCountMode = 'manual';
  loan.installmentAmount = schedule.installmentAmount;
  loan.totalInstallments = retainedInstallments.filter((item) => !item.convertedAt).length + schedule.installments.length;
  loan.remainingInstallments = schedule.installments.length;
  loan.installments = [...retainedInstallments, ...schedule.installments];
  if (req.body.dueDayOfMonth !== undefined) loan.dueDayOfMonth = req.body.dueDayOfMonth;
  loan.conversionHistory.push({
    oldType,
    newType: installmentType,
    oldInstallments,
    newInstallments: duration,
    conversionDate: convertedAt,
    remainingAmount,
    convertedBy: req.user._id
  });
  refreshLoanTotals(loan);
  await loan.save();
  await writeAudit({
    entity: 'Loan',
    entityId: loan._id,
    action: 'loan_conversion',
    admin: req.user._id,
    changes: [
      { field: 'installmentType', oldValue: oldType, newValue: installmentType },
      { field: 'remainingAmount', oldValue: loan.totalPayable, newValue: remainingAmount },
      { field: 'duration', oldValue: oldInstallments, newValue: duration }
    ]
  });
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

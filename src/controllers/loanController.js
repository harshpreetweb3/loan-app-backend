import Loan from '../models/Loan.js';
import Borrower from '../models/Borrower.js';
import { buildChanges, writeAudit } from '../utils/audit.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { buildInstallmentSchedule, calculateLoanSchedule, refreshLoanTotals } from '../utils/loanCalculator.js';
import { generateLoanReceiptBuffer, generateNocPdfBuffer } from '../services/pdfService.js';
import { nextSequence } from '../utils/sequence.js';
import { persistUploadedFile } from '../utils/cloudStorage.js';
import { ROLES } from '../constants.js';

function numberValue(value) {
  return Number(value);
}

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function startOfDay(date = new Date()) {
  const value = new Date(date);
  value.setHours(0, 0, 0, 0);
  return value;
}

function principalRemaining(installment) {
  return Math.max(roundMoney(Number(installment.amount || 0) - Number(installment.paidAmount || 0)), 0);
}

function isUnpaidOverdueInstallment(installment, todayStart) {
  return !installment.convertedAt && installment.dueDate < todayStart && principalRemaining(installment) > 0;
}

function loanOutstanding(loan) {
  if (loan.status === 'settled') {
    return {
      remainingInstallments: 0,
      pendingPenalties: 0,
      pendingProcessingFees: 0,
      remainingDueAmount: 0
    };
  }
  const activeInstallments = loan.installments.filter((item) => !item.convertedAt);
  const remainingInstallments = activeInstallments.reduce((sum, item) => sum + Math.max(Number(item.amount || 0) - Number(item.paidAmount || 0), 0), 0);
  const pendingPenalties = activeInstallments.reduce((sum, item) => sum + Math.max(Number(item.penaltyAmount || 0) - Number(item.penaltyPaidAmount || 0) - Number(item.penaltyWaivedAmount || 0), 0), 0);
  const pendingProcessingFees = loan.processingFeeMode === 'separate' ? Math.max(Number(loan.processingCharges || 0) - Number(loan.processingFeePaidAmount || 0) - Number(loan.processingFeeWaivedAmount || 0), 0) : 0;
  return {
    remainingInstallments: roundMoney(remainingInstallments),
    pendingPenalties: roundMoney(pendingPenalties),
    pendingProcessingFees: roundMoney(pendingProcessingFees),
    remainingDueAmount: roundMoney(remainingInstallments + pendingPenalties + pendingProcessingFees)
  };
}

function validateLoanPayload(payload) {
  const errors = [];
  if (!payload.borrower) errors.push('Borrower is required');
  if (!['personal', 'vehicle'].includes(payload.loanCategory)) errors.push('Loan type is required');
  if (!numberValue(payload.loanAmount) || numberValue(payload.loanAmount) <= 0) errors.push('Loan amount is required');
  if (payload.interestPercent === undefined || payload.interestPercent === '' || numberValue(payload.interestPercent) < 0) errors.push('Interest percentage is required');
  if (!payload.chequeNumber) errors.push('Cheque number is required');
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
  if (req.files?.guarantorProof3?.[0]) payload.guarantor.proof3Path = await persistUploadedFile(req.files.guarantorProof3[0]);
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
  const todayStart = startOfDay();
  if (req.query.scope === 'mine') query.createdBy = req.user._id;
  if (req.query.status && req.query.status !== 'overdue') query.status = req.query.status;
  if (req.query.status === 'overdue') {
    query.status = 'active';
    query.installments = {
      $elemMatch: {
        convertedAt: null,
        dueDate: { $lt: todayStart },
        status: { $in: ['pending', 'partial', 'overdue'] }
      }
    };
  }
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
  const filteredByStatus = req.query.status === 'overdue'
    ? loans.filter((loan) => loan.installments?.some((item) => isUnpaidOverdueInstallment(item, todayStart)))
    : loans;
  const filtered = req.query.borrowerName
    ? filteredByStatus.filter((loan) => loan.borrower?.name?.toLowerCase().includes(String(req.query.borrowerName).toLowerCase()))
    : filteredByStatus;
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const statsQuery = req.query.scope === 'mine' ? { createdBy: req.user._id } : {};
  const [totalLoansGiven, loansGivenThisMonth] = await Promise.all([
    Loan.countDocuments(statsQuery),
    Loan.countDocuments({ ...statsQuery, createdAt: { $gte: monthStart } })
  ]);
  res.json({ loans: filtered, stats: { totalLoansGiven, loansGivenThisMonth } });
});

export const getLoan = asyncHandler(async (req, res) => {
  const loan = await Loan.findById(req.params.id)
    .populate('borrower')
    .populate('createdBy', 'name username')
    .populate('conversionHistory.convertedBy', 'name username role');
  if (!loan) return res.status(404).json({ message: 'Loan not found' });
  res.json({ loan });
});

export const getLatestGuarantor = asyncHandler(async (req, res) => {
  const borrower = await Borrower.findById(req.params.borrowerId).select('_id');
  if (!borrower) return res.status(404).json({ message: 'Borrower not found' });
  const loan = await Loan.findOne({ borrower: borrower._id, 'guarantor.name': { $exists: true, $ne: '' } })
    .sort({ createdAt: -1 })
    .select('guarantor');
  res.json({ guarantor: loan?.guarantor || null });
});

export const updateLoan = asyncHandler(async (req, res) => {
  const loan = await Loan.findById(req.params.id);
  if (!loan) return res.status(404).json({ message: 'Loan not found' });
  const payload = await normalizeLoanPayload(req, loan);
  const nextPayload = { ...loan.toObject(), ...payload, installmentCountMode: 'manual' };
  const errors = validateLoanPayload(nextPayload);
  if (errors.length) return res.status(400).json({ message: errors[0], errors });
  const fields = ['loanAmount', 'interestPercent', 'interestAmount', 'chequeNumber', 'duration', 'installmentType', 'processingCharges', 'startDate', 'dateOfFinance', 'dueDayOfMonth', 'loanCategory', 'guarantor', 'vehicle'];
  const changes = buildChanges(loan, payload, fields);
  if (changes.length) {
    const scheduleFields = new Set(['loanAmount', 'interestPercent', 'interestAmount', 'duration', 'installmentType', 'processingCharges', 'startDate', 'dateOfFinance', 'dueDayOfMonth']);
    if (changes.some((change) => scheduleFields.has(change.field))) {
      const schedule = calculateLoanSchedule(nextPayload);
      Object.assign(loan, payload, { installmentCountMode: 'manual' }, schedule);
    } else {
      Object.assign(loan, payload, { installmentCountMode: 'manual' });
    }
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
  if (!['completed', 'settled'].includes(loan.status)) return res.status(400).json({ message: 'Loan must be completed or settled before NOC request' });
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
  const pdf = await generateNocPdfBuffer({ loan, borrower: loan.borrower });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="noc-${loan._id}.pdf"`);
  res.setHeader('Content-Length', pdf.length);
  res.send(pdf);
});

export const closeLoan = asyncHandler(async (req, res) => {
  const loan = await Loan.findById(req.params.id);
  if (!loan) return res.status(404).json({ message: 'Loan not found' });
  const outstanding = loanOutstanding(loan);
  if (outstanding.remainingDueAmount > 0) {
    return res.status(400).json({ message: 'Loan cannot be closed while amounts are pending', outstanding });
  }
  if (loan.status !== 'settled') loan.status = 'completed';
  loan.closure = { closedAt: new Date(), closedBy: req.user._id };
  if (loan.noc.status === 'none') {
    loan.noc.status = 'approved';
    loan.noc.reviewedBy = req.user._id;
    loan.noc.reviewedAt = new Date();
  }
  await loan.save();
  res.json({ loan, outstanding, canGenerateNoc: true });
});

export const getLoanClosureStatus = asyncHandler(async (req, res) => {
  const loan = await Loan.findById(req.params.id);
  if (!loan) return res.status(404).json({ message: 'Loan not found' });
  const outstanding = loanOutstanding(loan);
  res.json({ outstanding, canClose: outstanding.remainingDueAmount <= 0, canGenerateNoc: outstanding.remainingDueAmount <= 0 });
});

export const waivePenalty = asyncHandler(async (req, res) => {
  if (req.user.role !== ROLES.ADMIN) return res.status(403).json({ message: 'Admin access required' });
  const loan = await Loan.findById(req.params.id);
  if (!loan) return res.status(404).json({ message: 'Loan not found' });
  const { installmentId, amount, reason } = req.body;
  const installment = loan.installments.id(installmentId);
  if (!installment) return res.status(404).json({ message: 'Installment not found' });
  const pending = Math.max(Number(installment.penaltyAmount || 0) - Number(installment.penaltyPaidAmount || 0) - Number(installment.penaltyWaivedAmount || 0), 0);
  const waiverAmount = roundMoney(amount === 'full' ? pending : Number(amount));
  if (!waiverAmount || waiverAmount <= 0 || waiverAmount > pending) return res.status(400).json({ message: 'Valid waiver amount is required' });
  installment.penaltyWaivedAmount = roundMoney(Number(installment.penaltyWaivedAmount || 0) + waiverAmount);
  loan.penaltyWaivers.push({ installmentId, amount: waiverAmount, reason, waivedBy: req.user._id });
  refreshLoanTotals(loan);
  await loan.save();
  res.json({ loan, waivedAmount: waiverAmount, outstanding: loanOutstanding(loan) });
});

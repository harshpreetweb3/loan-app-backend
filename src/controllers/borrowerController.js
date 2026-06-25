import Borrower from '../models/Borrower.js';
import Loan from '../models/Loan.js';
import Payment from '../models/Payment.js';
import CallNote from '../models/CallNote.js';
import { buildChanges, writeAudit } from '../utils/audit.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { persistUploadedFile } from '../utils/cloudStorage.js';
import { nextSequence } from '../utils/sequence.js';

function parseJsonField(value, fallback) {
  if (value === undefined) return fallback;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch (_error) {
    return fallback;
  }
}

async function normalizeBorrowerPayload(req) {
  const payload = { ...req.body };
  payload.mobileNumbers = parseJsonField(payload.mobileNumbers, payload.phone ? [payload.phone] : []);
  payload.guarantor = parseJsonField(payload.guarantor, {});
  payload.vehicle = parseJsonField(payload.vehicle, {});
  payload.bank = parseJsonField(payload.bank, {});
  if (req.files?.photo?.[0]) payload.photoPath = await persistUploadedFile(req.files.photo[0]);
  if (req.files?.proof1?.[0]) payload.proof1Path = await persistUploadedFile(req.files.proof1[0]);
  if (req.files?.proof2?.[0]) payload.proof2Path = await persistUploadedFile(req.files.proof2[0]);
  if (req.files?.proof3?.[0]) payload.proof3Path = await persistUploadedFile(req.files.proof3[0]);
  if (req.files?.rcPhoto?.[0]) payload.vehicle = { ...payload.vehicle, rcPhotoPath: await persistUploadedFile(req.files.rcPhoto[0]) };
  if (!payload.phone && payload.mobileNumbers?.[0]) payload.phone = payload.mobileNumbers[0];
  return payload;
}

function isBlank(value) {
  return value === undefined || value === null || String(value).trim() === '';
}

function validateBorrowerPayload(payload, { requirePhoto = false } = {}) {
  const errors = [];
  const mobileNumbers = (payload.mobileNumbers || []).filter(Boolean);

  if (isBlank(payload.name)) errors.push('Borrower name is required');
  if (isBlank(payload.fatherOrCareOf)) errors.push('Father name or care of is required');
  if (isBlank(payload.address)) errors.push('Borrower address is required');
  if (!mobileNumbers.length) errors.push('At least one mobile number is required');
  if (mobileNumbers.some((number) => !/^[6-9]\d{9}$/.test(String(number)))) errors.push('Please enter a valid mobile number');
  if (requirePhoto && isBlank(payload.photoPath)) errors.push('Borrower photo is required. Capture a photo or upload a passport size image');
  if (requirePhoto && isBlank(payload.proof1Path)) errors.push('Borrower proof 1 is required');
  if (isBlank(payload.bank?.bankName)) errors.push('Bank name is required');
  if (isBlank(payload.bank?.accountNumber)) errors.push('Account number is required');

  return errors;
}

export const createBorrower = asyncHandler(async (req, res) => {
  const payload = await normalizeBorrowerPayload(req);
  const errors = validateBorrowerPayload(payload, { requirePhoto: true });
  if (errors.length) return res.status(400).json({ message: errors[0], errors });
  const borrower = await Borrower.create({ ...payload, customerId: await nextSequence('customer', 'CUST-'), createdBy: req.user._id });
  res.status(201).json({ borrower });
});

export const listBorrowers = asyncHandler(async (req, res) => {
  const query = {};
  if (req.query.scope === 'mine') query.createdBy = req.user._id;
  if (req.query.search) query.$text = { $search: req.query.search };
  if (req.query.mobile) query.mobileNumbers = { $regex: req.query.mobile, $options: 'i' };
  if (req.query.createdFrom || req.query.createdTo) {
    query.createdAt = {};
    if (req.query.createdFrom) query.createdAt.$gte = new Date(req.query.createdFrom);
    if (req.query.createdTo) query.createdAt.$lte = new Date(req.query.createdTo);
  }
  if (req.query.loanCategory) {
    const loans = await Loan.find({ loanCategory: req.query.loanCategory }).distinct('borrower');
    query.$or = [{ loanCategory: req.query.loanCategory }, { _id: { $in: loans } }];
  }
  const borrowers = await Borrower.find(query).populate('createdBy', 'name username').sort({ createdAt: -1 });
  const borrowerIds = borrowers.map((borrower) => borrower._id);
  const activeLoanBorrowerIds = await Loan.find({ borrower: { $in: borrowerIds }, status: 'active' }).distinct('borrower');
  const activeSet = new Set(activeLoanBorrowerIds.map(String));
  const withStatus = borrowers
    .map((borrower) => ({ ...borrower.toObject(), loanStatus: activeSet.has(String(borrower._id)) ? 'active' : 'inactive' }))
    .filter((borrower) => !req.query.loanStatus || req.query.loanStatus === 'all' || borrower.loanStatus === req.query.loanStatus);
  res.json({ borrowers: withStatus });
});

export const getBorrower = asyncHandler(async (req, res) => {
  const borrower = await Borrower.findById(req.params.id).populate('createdBy', 'name username');
  if (!borrower) return res.status(404).json({ message: 'Borrower not found' });
  const [loans, payments, notes] = await Promise.all([
    Loan.find({ borrower: borrower._id }).populate('createdBy', 'name username').sort({ createdAt: -1 }),
    Payment.find({ borrower: borrower._id }).populate('collectedBy', 'name username').sort({ createdAt: -1 }),
    CallNote.find({ borrower: borrower._id }).populate('createdBy', 'name username').sort({ callDate: -1 })
  ]);
  res.json({ borrower, loans, payments, notes });
});

export const updateBorrower = asyncHandler(async (req, res) => {
  const borrower = await Borrower.findById(req.params.id);
  if (!borrower) return res.status(404).json({ message: 'Borrower not found' });
  const payload = await normalizeBorrowerPayload(req);
  const nextPayload = { ...borrower.toObject(), ...payload };
  const errors = validateBorrowerPayload(nextPayload);
  if (errors.length) return res.status(400).json({ message: errors[0], errors });
  const fields = ['name', 'fatherOrCareOf', 'address', 'phone', 'mobileNumbers', 'photoPath', 'proof1Path', 'proof2Path', 'proof3Path', 'vehicle', 'bank'];
  const changes = buildChanges(borrower, payload, fields);
  fields.forEach((field) => {
    if (payload[field] !== undefined) borrower[field] = payload[field];
  });
  await borrower.save();
  await writeAudit({ entity: 'Borrower', entityId: borrower._id, action: 'admin_update', changes, admin: req.user._id });
  res.json({ borrower });
});

export const deleteBorrower = asyncHandler(async (req, res) => {
  const borrower = await Borrower.findById(req.params.id);
  if (!borrower) return res.status(404).json({ message: 'Borrower not found' });

  const [loansDeleted, paymentsDeleted, notesDeleted] = await Promise.all([
    Loan.deleteMany({ borrower: borrower._id }),
    Payment.deleteMany({ borrower: borrower._id }),
    CallNote.deleteMany({ borrower: borrower._id })
  ]);

  await borrower.deleteOne();
  await writeAudit({
    entity: 'Borrower',
    entityId: borrower._id,
    action: 'admin_delete',
    changes: [
      { field: 'borrower', from: borrower.name, to: 'deleted' },
      { field: 'relatedRecords', from: '', to: `loans:${loansDeleted.deletedCount}, payments:${paymentsDeleted.deletedCount}, notes:${notesDeleted.deletedCount}` }
    ],
    admin: req.user._id
  });
  res.json({ message: 'Borrower deleted' });
});

import Borrower from '../models/Borrower.js';
import Loan from '../models/Loan.js';
import Payment from '../models/Payment.js';
import CallNote from '../models/CallNote.js';
import { buildChanges, writeAudit } from '../utils/audit.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { publicPath } from '../utils/storage.js';
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

function normalizeBorrowerPayload(req) {
  const payload = { ...req.body };
  payload.mobileNumbers = parseJsonField(payload.mobileNumbers, payload.phone ? [payload.phone] : []);
  payload.guarantor = parseJsonField(payload.guarantor, {});
  payload.vehicle = parseJsonField(payload.vehicle, {});
  payload.bank = parseJsonField(payload.bank, {});
  if (req.files?.photo?.[0]) payload.photoPath = publicPath(req.files.photo[0].path);
  if (req.files?.rcPhoto?.[0]) payload.vehicle = { ...payload.vehicle, rcPhotoPath: publicPath(req.files.rcPhoto[0].path) };
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
  if (isBlank(payload.address)) errors.push('Borrower address is required');
  if (!mobileNumbers.length) errors.push('At least one mobile number is required');
  if (mobileNumbers.some((number) => !/^[6-9]\d{9}$/.test(String(number)))) errors.push('Enter valid 10 digit mobile numbers');
  if (requirePhoto && isBlank(payload.photoPath)) errors.push('Borrower photo is required. Capture a photo or upload a passport size image');
  if (isBlank(payload.guarantor?.name)) errors.push('Guarantor name is required');
  if (isBlank(payload.guarantor?.phone)) errors.push('Guarantor phone number is required');
  if (payload.guarantor?.phone && !/^[6-9]\d{9}$/.test(String(payload.guarantor.phone))) errors.push('Enter a valid 10 digit guarantor phone number');
  if (isBlank(payload.guarantor?.address)) errors.push('Guarantor address is required');
  if (isBlank(payload.bank?.bankName)) errors.push('Bank name is required');
  if (isBlank(payload.bank?.accountNumber)) errors.push('Account number is required');
  if (isBlank(payload.bank?.chequeNumber)) errors.push('Cheque number is required');

  if (payload.loanCategory === 'vehicle') {
    if (isBlank(payload.vehicle?.nameOnRc)) errors.push('Name on RC is required for vehicle loans');
    if (isBlank(payload.vehicle?.rcRegisteredNumber)) errors.push('RC registered number is required for vehicle loans');
    if (isBlank(payload.vehicle?.modelNumber)) errors.push('Vehicle model number is required for vehicle loans');
  }

  return errors;
}

export const createBorrower = asyncHandler(async (req, res) => {
  const payload = normalizeBorrowerPayload(req);
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
  res.json({ borrowers });
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
  const payload = normalizeBorrowerPayload(req);
  const nextPayload = { ...borrower.toObject(), ...payload };
  const errors = validateBorrowerPayload(nextPayload);
  if (errors.length) return res.status(400).json({ message: errors[0], errors });
  const fields = ['name', 'fatherOrCareOf', 'address', 'phone', 'mobileNumbers', 'photoPath', 'loanCategory', 'guarantor', 'vehicle', 'bank'];
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

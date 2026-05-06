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

export const createBorrower = asyncHandler(async (req, res) => {
  const payload = normalizeBorrowerPayload(req);
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
  const fields = ['name', 'fatherOrCareOf', 'address', 'phone', 'mobileNumbers', 'photoPath', 'loanCategory', 'guarantor', 'vehicle', 'bank'];
  const changes = buildChanges(borrower, payload, fields);
  fields.forEach((field) => {
    if (payload[field] !== undefined) borrower[field] = payload[field];
  });
  await borrower.save();
  await writeAudit({ entity: 'Borrower', entityId: borrower._id, action: 'admin_update', changes, admin: req.user._id });
  res.json({ borrower });
});

import Borrower from '../models/Borrower.js';
import { buildChanges, writeAudit } from '../utils/audit.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const createBorrower = asyncHandler(async (req, res) => {
  const borrower = await Borrower.create({ ...req.body, createdBy: req.user._id });
  res.status(201).json({ borrower });
});

export const listBorrowers = asyncHandler(async (req, res) => {
  const query = {};
  if (req.query.scope === 'mine') query.createdBy = req.user._id;
  if (req.query.search) query.$text = { $search: req.query.search };
  const borrowers = await Borrower.find(query).populate('createdBy', 'name username').sort({ createdAt: -1 });
  res.json({ borrowers });
});

export const getBorrower = asyncHandler(async (req, res) => {
  const borrower = await Borrower.findById(req.params.id).populate('createdBy', 'name username');
  if (!borrower) return res.status(404).json({ message: 'Borrower not found' });
  res.json({ borrower });
});

export const updateBorrower = asyncHandler(async (req, res) => {
  const borrower = await Borrower.findById(req.params.id);
  if (!borrower) return res.status(404).json({ message: 'Borrower not found' });
  const fields = ['name', 'fatherOrCareOf', 'address', 'phone', 'guarantor', 'vehicle'];
  const changes = buildChanges(borrower, req.body, fields);
  fields.forEach((field) => {
    if (req.body[field] !== undefined) borrower[field] = req.body[field];
  });
  await borrower.save();
  await writeAudit({ entity: 'Borrower', entityId: borrower._id, action: 'admin_update', changes, admin: req.user._id });
  res.json({ borrower });
});

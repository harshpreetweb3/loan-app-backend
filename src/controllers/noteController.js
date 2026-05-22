import CallNote from '../models/CallNote.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const createNote = asyncHandler(async (req, res) => {
  const note = await CallNote.create({ ...req.body, callDate: req.body.callDate || new Date(), createdBy: req.user._id });
  res.status(201).json({ note });
});

export const listNotes = asyncHandler(async (req, res) => {
  const query = {};
  if (req.query.loan) query.loan = req.query.loan;
  if (req.query.borrower) query.borrower = req.query.borrower;
  if (req.query.agent) query.createdBy = req.query.agent;
  if (req.query.from || req.query.to) {
    query.callDate = {};
    if (req.query.from) query.callDate.$gte = new Date(req.query.from);
    if (req.query.to) query.callDate.$lte = new Date(req.query.to);
  }
  const notes = await CallNote.find(query).populate('borrower').populate('createdBy', 'name username').sort({ callDate: -1 });
  res.json({ notes });
});

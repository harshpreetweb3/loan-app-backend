import CallNote from '../models/CallNote.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const createNote = asyncHandler(async (req, res) => {
  const note = await CallNote.create({ ...req.body, createdBy: req.user._id });
  res.status(201).json({ note });
});

export const listNotes = asyncHandler(async (req, res) => {
  const query = {};
  if (req.query.borrower) query.borrower = req.query.borrower;
  const notes = await CallNote.find(query).populate('borrower').populate('createdBy', 'name username').sort({ callDate: -1 });
  res.json({ notes });
});

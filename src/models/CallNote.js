import mongoose from 'mongoose';

const callNoteSchema = new mongoose.Schema(
  {
    borrower: { type: mongoose.Schema.Types.ObjectId, ref: 'Borrower', required: true },
    loan: { type: mongoose.Schema.Types.ObjectId, ref: 'Loan' },
    callDate: { type: Date, required: true },
    note: { type: String, required: true, trim: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
  },
  { timestamps: true }
);

export default mongoose.model('CallNote', callNoteSchema);

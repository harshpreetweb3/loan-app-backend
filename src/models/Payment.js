import mongoose from 'mongoose';
import { PAYMENT_MODES } from '../constants.js';

const paymentSchema = new mongoose.Schema(
  {
    borrower: { type: mongoose.Schema.Types.ObjectId, ref: 'Borrower', required: true },
    loan: { type: mongoose.Schema.Types.ObjectId, ref: 'Loan', required: true },
    amount: { type: Number, required: true, min: 1 },
    paymentCategory: { type: String, enum: ['installment', 'processingFee', 'penalty', 'settlement'], default: 'installment' },
    mode: { type: String, enum: PAYMENT_MODES, required: true },
    chequeNumber: String,
    installmentIds: [{ type: mongoose.Schema.Types.ObjectId }],
    allocations: [{
      type: { type: String, enum: ['installment', 'processingFee', 'penalty', 'settlement'] },
      installmentId: mongoose.Schema.Types.ObjectId,
      amount: Number
    }],
    collectedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    notes: String,
  },
  { timestamps: true }
);

export default mongoose.model('Payment', paymentSchema);

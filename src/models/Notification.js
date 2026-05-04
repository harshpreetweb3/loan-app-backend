import mongoose from 'mongoose';

const notificationSchema = new mongoose.Schema(
  {
    recipient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true },
    message: { type: String, required: true },
    type: { type: String, enum: ['before_due', 'after_due', 'system'], default: 'system' },
    loan: { type: mongoose.Schema.Types.ObjectId, ref: 'Loan' },
    borrower: { type: mongoose.Schema.Types.ObjectId, ref: 'Borrower' },
    readAt: Date
  },
  { timestamps: true }
);

notificationSchema.index({ recipient: 1, readAt: 1, createdAt: -1 });

export default mongoose.model('Notification', notificationSchema);

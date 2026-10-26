import mongoose from 'mongoose';

const whatsAppMessageSchema = new mongoose.Schema(
  {
    borrower: { type: mongoose.Schema.Types.ObjectId, ref: 'Borrower', required: true, index: true },
    loan: { type: mongoose.Schema.Types.ObjectId, ref: 'Loan' },
    installmentId: mongoose.Schema.Types.ObjectId,
    sentBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    recipient: { type: String, required: true },
    kind: { type: String, enum: ['due_reminder', 'overdue_reminder', 'template', 'text'], required: true },
    templateName: String,
    templateLanguage: String,
    body: String,
    scheduledFor: Date,
    providerMessageId: { type: String, unique: true, sparse: true },
    status: { type: String, enum: ['queued', 'sent', 'delivered', 'read', 'failed'], default: 'queued', index: true },
    providerResponse: mongoose.Schema.Types.Mixed,
    failureReason: String,
    deliveredAt: Date,
    readAt: Date,
    failedAt: Date
  },
  { timestamps: true }
);

// Repeated Cron runs must not issue duplicate reminders for the same installment and day.
whatsAppMessageSchema.index(
  { loan: 1, installmentId: 1, kind: 1, scheduledFor: 1 },
  { unique: true, partialFilterExpression: { scheduledFor: { $exists: true } } }
);

export default mongoose.model('WhatsAppMessage', whatsAppMessageSchema);

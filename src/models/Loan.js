import mongoose from 'mongoose';
import { INSTALLMENT_TYPES, LOAN_CATEGORIES, NOC_STATUS } from '../constants.js';

const installmentSchema = new mongoose.Schema(
  {
    sequence: Number,
    dueDate: Date,
    amount: Number,
    paidAmount: { type: Number, default: 0 },
    penaltyAmount: { type: Number, default: 0 },
    status: { type: String, enum: ['pending', 'paid', 'partial', 'overdue'], default: 'pending' },
    paidAt: Date
  },
  { _id: true }
);

const loanSchema = new mongoose.Schema(
  {
    borrower: { type: mongoose.Schema.Types.ObjectId, ref: 'Borrower', required: true },
    loanCategory: { type: String, enum: LOAN_CATEGORIES, default: 'personal' },
    loanAmount: { type: Number, required: true, min: 1 },
    interestPercent: { type: Number, required: true, min: 0 },
    interestAmount: { type: Number, default: 0 },
    duration: { type: Number, required: true, min: 1 },
    installmentType: { type: String, enum: INSTALLMENT_TYPES, required: true },
    installmentAmount: { type: Number, required: true },
    processingCharges: { type: Number, default: 0 },
    startDate: { type: Date, required: true },
    dateOfFinance: { type: Date, default: Date.now },
    dueDayOfMonth: { type: Number, min: 1, max: 31 },
    installmentCountMode: { type: String, enum: ['manual'], default: 'manual' },
    totalPayable: { type: Number, required: true },
    totalPaid: { type: Number, default: 0 },
    totalInstallments: { type: Number, required: true },
    paidInstallments: { type: Number, default: 0 },
    remainingInstallments: { type: Number, required: true },
    status: { type: String, enum: ['active', 'completed', 'defaulted'], default: 'active' },
    receipt: {
      receiptNumber: { type: String, unique: true, sparse: true },
      generatedAt: Date
    },
    installments: [installmentSchema],
    noc: {
      status: { type: String, enum: NOC_STATUS, default: 'none' },
      requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      requestedAt: Date,
      reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      reviewedAt: Date,
      rejectionReason: String,
      filePath: String
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
  },
  { timestamps: true }
);

loanSchema.index({ borrower: 1, createdBy: 1, status: 1 });

export default mongoose.model('Loan', loanSchema);

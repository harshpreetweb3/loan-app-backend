import mongoose from 'mongoose';
import { LOAN_CATEGORIES } from '../constants.js';

const borrowerSchema = new mongoose.Schema(
  {
    customerId: { type: String, unique: true, index: true },
    name: { type: String, required: true, trim: true },
    fatherOrCareOf: { type: String, trim: true },
    address: { type: String, required: true, trim: true },
    phone: { type: String, trim: true },
    mobileNumbers: {
      type: [String],
      validate: {
        validator(numbers) {
          return numbers.length > 0 && numbers.length <= 3 && numbers.every((number) => /^[6-9]\d{9}$/.test(number));
        },
        message: 'Provide 1 to 3 valid 10 digit mobile numbers'
      }
    },
    photoPath: String,
    loanCategory: { type: String, enum: LOAN_CATEGORIES, default: 'personal' },
    guarantor: {
      name: String,
      fatherName: String,
      phone: String,
      address: String
    },
    bank: {
      bankName: String,
      accountNumber: String,
      chequeNumber: String
    },
    vehicle: {
      rcPhotoPath: String,
      nameOnRc: String,
      rcRegisteredNumber: String,
      modelNumber: String,
      model: String,
      registrationNumber: String,
      chassisNumber: String
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
  },
  { timestamps: true }
);

borrowerSchema.index({ name: 'text', phone: 'text', mobileNumbers: 'text', customerId: 'text' });

export default mongoose.model('Borrower', borrowerSchema);

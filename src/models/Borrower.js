import mongoose from 'mongoose';

const borrowerSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    fatherOrCareOf: { type: String, required: true, trim: true },
    address: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    guarantor: {
      name: String,
      phone: String,
      address: String
    },
    vehicle: {
      model: String,
      registrationNumber: String,
      chassisNumber: String
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
  },
  { timestamps: true }
);

borrowerSchema.index({ name: 'text', phone: 'text' });

export default mongoose.model('Borrower', borrowerSchema);

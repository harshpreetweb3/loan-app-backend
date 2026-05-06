import mongoose from 'mongoose';

const counterSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    value: { type: Number, default: 0 }
  },
  { timestamps: true }
);

export default mongoose.model('Counter', counterSchema);

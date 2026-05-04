import mongoose from 'mongoose';

const settingSchema = new mongoose.Schema(
  {
    penaltyPercent: { type: Number, default: Number(process.env.PENALTY_PERCENT || 4) },
    gracePeriodDays: { type: Number, default: Number(process.env.GRACE_PERIOD_DAYS || 10) }
  },
  { timestamps: true }
);

export default mongoose.model('Setting', settingSchema);

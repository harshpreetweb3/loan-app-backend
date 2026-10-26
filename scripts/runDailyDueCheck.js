import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { connectDB } from '../src/config/db.js';
import { runDailyDueCheck } from '../src/jobs/index.js';

dotenv.config();

try {
  await connectDB();
  await runDailyDueCheck();
  console.log('Daily due check completed');
} catch (error) {
  console.error('Daily due check failed', error);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}

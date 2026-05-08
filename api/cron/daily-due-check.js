import dotenv from 'dotenv';
import { connectDB } from '../../src/config/db.js';
import { runDailyDueCheck } from '../../src/jobs/index.js';
import { ensureStorage } from '../../src/utils/storage.js';

dotenv.config();

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  if (process.env.CRON_SECRET && req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  await ensureStorage();
  await connectDB();
  await runDailyDueCheck();
  res.json({ status: 'ok' });
}

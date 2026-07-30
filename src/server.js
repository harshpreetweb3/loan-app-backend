import dotenv from 'dotenv';
import app from './app.js';
import { connectDB } from './config/db.js';
import { ensureStorage } from './utils/storage.js';
import { startCronJobs } from './jobs/index.js';

dotenv.config();

const port = process.env.PORT || 5000;

await ensureStorage();
await connectDB();

// Vercel invokes the serverless handler per request. Its Cron service calls the
// protected HTTP endpoint instead of starting an in-process scheduler.
if (!process.env.VERCEL) startCronJobs();

app.listen(port, () => {
  console.log(`Loan API running on port ${port}`);
});

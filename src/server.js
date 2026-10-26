import dotenv from 'dotenv';
import app from './app.js';
import { connectDB } from './config/db.js';
import { ensureStorage } from './utils/storage.js';
import { startCronJobs } from './jobs/index.js';

dotenv.config();

const port = process.env.PORT || 5000;

await ensureStorage();
await connectDB();

// Managed hosts invoke scheduled work separately. Keeping the scheduler out of
// web instances avoids duplicate reminders when a service scales or restarts.
if (!process.env.VERCEL && !process.env.RENDER) startCronJobs();

app.listen(port, () => {
  console.log(`Loan API running on port ${port}`);
});

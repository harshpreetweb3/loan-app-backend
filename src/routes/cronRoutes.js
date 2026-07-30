import express from 'express';
import { runDailyDueCheck } from '../jobs/index.js';

const router = express.Router();

function isAuthorized(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const authorization = req.get('authorization');
  return authorization === `Bearer ${secret}` || req.get('x-cron-secret') === secret;
}

router.get('/daily-due-check', async (req, res, next) => {
  if (!isAuthorized(req)) return res.status(401).json({ message: 'Unauthorized' });

  try {
    await runDailyDueCheck();
    return res.json({ status: 'ok' });
  } catch (error) {
    return next(error);
  }
});

export default router;

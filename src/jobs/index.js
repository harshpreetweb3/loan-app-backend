import { execFile } from 'child_process';
import cron from 'node-cron';
import fs from 'fs/promises';
import path from 'path';
import { promisify } from 'util';
import Borrower from '../models/Borrower.js';
import Loan from '../models/Loan.js';
import Notification from '../models/Notification.js';
import Setting from '../models/Setting.js';
import User from '../models/User.js';
import { ROLES } from '../constants.js';

const execFileAsync = promisify(execFile);

async function getSetting() {
  return (await Setting.findOne()) || (await Setting.create({}));
}

function addDays(date, days) {
  const value = new Date(date);
  value.setDate(value.getDate() + days);
  return value;
}

async function createNotificationOnce(payload) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const exists = await Notification.exists({
    recipient: payload.recipient,
    loan: payload.loan,
    borrower: payload.borrower,
    type: payload.type,
    createdAt: { $gte: start }
  });
  if (!exists) await Notification.create(payload);
}

export async function runDailyDueCheck() {
  const setting = await getSetting();
  const admins = await User.find({ role: ROLES.ADMIN, isActive: true });
  const loans = await Loan.find({ status: 'active' }).populate('borrower');
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (const loan of loans) {
    let changed = false;
    const recipients = [...admins.map((admin) => admin._id), loan.createdBy];
    for (const installment of loan.installments) {
      if (installment.status === 'paid') continue;
      const due = new Date(installment.dueDate);
      due.setHours(0, 0, 0, 0);
      const graceEnds = addDays(due, setting.gracePeriodDays);

      if (due.getTime() === today.getTime()) {
        await Promise.all(recipients.map((recipient) => createNotificationOnce({
          recipient,
          loan: loan._id,
          borrower: loan.borrower._id,
          type: 'before_due',
          title: 'Installment due today',
          message: `${loan.borrower.name} has installment #${installment.sequence} due today.`
        })));
      }

      if (today > due) {
        await Promise.all(recipients.map((recipient) => createNotificationOnce({
          recipient,
          loan: loan._id,
          borrower: loan.borrower._id,
          type: 'after_due',
          title: 'Installment overdue',
          message: `${loan.borrower.name} has overdue installment #${installment.sequence}.`
        })));
      }

      if (today > graceEnds && installment.status !== 'overdue') {
        installment.status = 'overdue';
        installment.penaltyAmount = Math.round(((installment.amount * setting.penaltyPercent) / 100) * 100) / 100;
        changed = true;
      }
    }
    if (changed) await loan.save();
  }
}

export async function runWeeklyBackup() {
  const backupDir = process.env.BACKUP_DIR || './backups';
  await fs.mkdir(backupDir, { recursive: true });
  const out = path.join(backupDir, `backup-${new Date().toISOString().slice(0, 10)}`);
  await execFileAsync('mongodump', ['--uri', process.env.MONGODB_URI, '--out', out]);
}

export function startCronJobs() {
  cron.schedule('5 0 * * *', runDailyDueCheck);
  cron.schedule('15 1 * * 0', () => runWeeklyBackup().catch((error) => console.error('Backup failed', error.message)));
}

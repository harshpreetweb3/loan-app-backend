import { execFile } from 'child_process';
import cron from 'node-cron';
import { createWriteStream } from 'fs';
import fs from 'fs/promises';
import path from 'path';
import { promisify } from 'util';
import zlib from 'zlib';
import Borrower from '../models/Borrower.js';
import Loan from '../models/Loan.js';
import Notification from '../models/Notification.js';
import Setting from '../models/Setting.js';
import User from '../models/User.js';
import { ROLES } from '../constants.js';

const execFileAsync = promisify(execFile);
const deflateRawAsync = promisify(zlib.deflateRaw);
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function backupDateName(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, dosDate };
}

function writeUInt16(value) {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value);
  return buffer;
}

function writeUInt32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value);
  return buffer;
}

async function listFiles(rootDir, currentDir = rootDir) {
  const entries = await fs.readdir(currentDir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFiles(rootDir, fullPath));
    } else if (entry.isFile()) {
      files.push({
        fullPath,
        zipPath: path.relative(rootDir, fullPath).split(path.sep).join('/')
      });
    }
  }
  return files;
}

async function zipDirectory(sourceDir, zipPath) {
  const files = await listFiles(sourceDir);
  const output = createWriteStream(zipPath);
  const centralDirectory = [];
  let offset = 0;

  for (const file of files) {
    const content = await fs.readFile(file.fullPath);
    const compressed = await deflateRawAsync(content);
    const name = Buffer.from(file.zipPath);
    const stats = await fs.stat(file.fullPath);
    const { time, dosDate } = dosDateTime(stats.mtime);
    const checksum = crc32(content);

    const localHeader = Buffer.concat([
      writeUInt32(0x04034b50),
      writeUInt16(20),
      writeUInt16(0),
      writeUInt16(8),
      writeUInt16(time),
      writeUInt16(dosDate),
      writeUInt32(checksum),
      writeUInt32(compressed.length),
      writeUInt32(content.length),
      writeUInt16(name.length),
      writeUInt16(0),
      name
    ]);

    output.write(localHeader);
    output.write(compressed);

    centralDirectory.push({ name, time, dosDate, checksum, compressedSize: compressed.length, size: content.length, offset });
    offset += localHeader.length + compressed.length;
  }

  const centralStart = offset;
  for (const entry of centralDirectory) {
    const header = Buffer.concat([
      writeUInt32(0x02014b50),
      writeUInt16(20),
      writeUInt16(20),
      writeUInt16(0),
      writeUInt16(8),
      writeUInt16(entry.time),
      writeUInt16(entry.dosDate),
      writeUInt32(entry.checksum),
      writeUInt32(entry.compressedSize),
      writeUInt32(entry.size),
      writeUInt16(entry.name.length),
      writeUInt16(0),
      writeUInt16(0),
      writeUInt16(0),
      writeUInt16(0),
      writeUInt32(0),
      writeUInt32(entry.offset),
      entry.name
    ]);
    output.write(header);
    offset += header.length;
  }

  output.end(Buffer.concat([
    writeUInt32(0x06054b50),
    writeUInt16(0),
    writeUInt16(0),
    writeUInt16(centralDirectory.length),
    writeUInt16(centralDirectory.length),
    writeUInt32(offset - centralStart),
    writeUInt32(centralStart),
    writeUInt16(0)
  ]));

  await new Promise((resolve, reject) => {
    output.on('finish', resolve);
    output.on('error', reject);
  });
}

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
      if (installment.convertedAt) continue;
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
  console.log('backup started');
  try {
    if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not configured');

    const backupRoot = path.resolve(process.env.BACKUP_DIR || './backups');
    const today = backupDateName();
    const backupDir = path.join(backupRoot, today);
    const dumpDir = path.join(backupDir, 'dump');
    const zipPath = path.join(backupDir, `${today}.zip`);

    await fs.mkdir(dumpDir, { recursive: true });
    await execFileAsync('mongodump', ['--uri', process.env.MONGODB_URI, '--out', dumpDir]);
    await zipDirectory(dumpDir, zipPath);
    await fs.rm(dumpDir, { recursive: true, force: true });
    await pruneOldBackups(backupRoot);
    console.log('backup completed');
  } catch (error) {
    console.error('backup failed', error.message);
    throw error;
  }
}

export async function pruneOldBackups(backupRoot) {
  await fs.mkdir(backupRoot, { recursive: true });
  const cutoff = Date.now() - 30 * MS_PER_DAY;
  const entries = await fs.readdir(backupRoot, { withFileTypes: true });
  await Promise.all(entries.map(async (entry) => {
    if (!entry.isDirectory() || !/^\d{4}-\d{2}-\d{2}$/.test(entry.name)) return;
    const backupTime = new Date(`${entry.name}T00:00:00.000Z`).getTime();
    if (Number.isNaN(backupTime) || backupTime >= cutoff) return;
    await fs.rm(path.join(backupRoot, entry.name), { recursive: true, force: true });
  }));
}

export function startCronJobs() {
  cron.schedule('5 0 * * *', runDailyDueCheck);
  cron.schedule('0 2 * * 0', () => runWeeklyBackup().catch(() => {}));
}

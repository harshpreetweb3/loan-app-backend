import AuditLog from '../models/AuditLog.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const listAuditLogs = asyncHandler(async (_req, res) => {
  const logs = await AuditLog.find().populate('admin', 'name username').sort({ createdAt: -1 }).limit(200);
  res.json({ logs });
});

import express from 'express';
import { listAuditLogs } from '../controllers/auditController.js';
import { adminOnly, protect } from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/', protect, adminOnly, listAuditLogs);

export default router;

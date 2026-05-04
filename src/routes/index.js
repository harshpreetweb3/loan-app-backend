import express from 'express';
import auditRoutes from './auditRoutes.js';
import authRoutes from './authRoutes.js';
import borrowerRoutes from './borrowerRoutes.js';
import dashboardRoutes from './dashboardRoutes.js';
import loanRoutes from './loanRoutes.js';
import noteRoutes from './noteRoutes.js';
import notificationRoutes from './notificationRoutes.js';
import paymentRoutes from './paymentRoutes.js';
import settingsRoutes from './settingsRoutes.js';

const router = express.Router();

router.use('/auth', authRoutes);
router.use('/borrowers', borrowerRoutes);
router.use('/loans', loanRoutes);
router.use('/payments', paymentRoutes);
router.use('/notes', noteRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/settings', settingsRoutes);
router.use('/notifications', notificationRoutes);
router.use('/audit-logs', auditRoutes);

export default router;

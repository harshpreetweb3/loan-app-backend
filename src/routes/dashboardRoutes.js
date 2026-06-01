import express from 'express';
import { getDashboard, getDueInstallments } from '../controllers/dashboardController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/', protect, getDashboard);
router.get('/installments-due', protect, getDueInstallments);

export default router;

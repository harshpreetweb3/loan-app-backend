import express from 'express';
import { createPayment, generateReceipt, listPayments, updatePayment } from '../controllers/paymentController.js';
import { adminOnly, protect } from '../middleware/authMiddleware.js';

const router = express.Router();

router.use(protect);
router.route('/').get(listPayments).post(createPayment);
router.put('/:id', adminOnly, updatePayment);
router.post('/:id/receipt', generateReceipt);

export default router;

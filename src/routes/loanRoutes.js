import express from 'express';
import {
  createLoan,
  generateLoanReceipt,
  generateNoc,
  getLoan,
  listLoans,
  requestNoc,
  reviewNoc,
  switchInstallmentType,
  updateLoan
} from '../controllers/loanController.js';
import { adminOnly, protect } from '../middleware/authMiddleware.js';
import { uploadLoanFiles, validateProofFileSizes } from '../middleware/uploadMiddleware.js';

const router = express.Router();

router.use(protect);
router.route('/').get(listLoans).post(uploadLoanFiles, validateProofFileSizes, createLoan);
router.route('/:id').get(getLoan).put(adminOnly, uploadLoanFiles, validateProofFileSizes, updateLoan);
router.patch('/:id/installment-type', adminOnly, switchInstallmentType);
router.post('/:id/receipt', generateLoanReceipt);
router.post('/:id/noc/request', requestNoc);
router.post('/:id/noc/review', adminOnly, reviewNoc);
router.post('/:id/noc/generate', generateNoc);

export default router;

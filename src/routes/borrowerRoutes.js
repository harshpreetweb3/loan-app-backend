import express from 'express';
import { createBorrower, getBorrower, listBorrowers, updateBorrower } from '../controllers/borrowerController.js';
import { adminOnly, protect } from '../middleware/authMiddleware.js';

const router = express.Router();

router.use(protect);
router.route('/').get(listBorrowers).post(createBorrower);
router.route('/:id').get(getBorrower).put(adminOnly, updateBorrower);

export default router;

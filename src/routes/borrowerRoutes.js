import express from 'express';
import { createBorrower, deleteBorrower, getBorrower, listBorrowers, updateBorrower } from '../controllers/borrowerController.js';
import { adminOnly, protect } from '../middleware/authMiddleware.js';
import { uploadBorrowerFiles } from '../middleware/uploadMiddleware.js';

const router = express.Router();

router.use(protect);
router.route('/').get(listBorrowers).post(uploadBorrowerFiles, createBorrower);
router.route('/:id').get(getBorrower).put(adminOnly, uploadBorrowerFiles, updateBorrower).delete(adminOnly, deleteBorrower);

export default router;

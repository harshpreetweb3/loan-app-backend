import express from 'express';
import { createNote, listNotes } from '../controllers/noteController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

router.use(protect);
router.route('/').get(listNotes).post(createNote);

export default router;

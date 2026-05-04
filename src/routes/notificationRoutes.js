import express from 'express';
import { listNotifications, markNotificationRead } from '../controllers/notificationController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/', protect, listNotifications);
router.patch('/:id/read', protect, markNotificationRead);

export default router;

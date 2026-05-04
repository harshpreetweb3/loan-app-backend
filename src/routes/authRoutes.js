import express from 'express';
import { createAgent, listAgents, login, me } from '../controllers/authController.js';
import { adminOnly, protect } from '../middleware/authMiddleware.js';

const router = express.Router();

router.post('/login', login);
router.get('/me', protect, me);
router.post('/agents', protect, adminOnly, createAgent);
router.get('/agents', protect, adminOnly, listAgents);

export default router;

import express from 'express';
import { createAgent, deleteAgent, listAgents, login, me, recoverAgent } from '../controllers/authController.js';
import { adminOnly, protect } from '../middleware/authMiddleware.js';
import { uploadAgentFiles } from '../middleware/uploadMiddleware.js';

const router = express.Router();

router.post('/login', login);
router.get('/me', protect, me);
router.post('/agents', protect, adminOnly, uploadAgentFiles, createAgent);
router.get('/agents', protect, adminOnly, listAgents);
router.delete('/agents/:id', protect, adminOnly, deleteAgent);
router.post('/agents/:id/recover', protect, adminOnly, recoverAgent);

export default router;

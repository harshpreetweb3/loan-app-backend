import express from 'express';
import { changePassword, createAgent, deleteAgent, getAgent, listAgents, login, me, recoverAgent } from '../controllers/authController.js';
import { adminOnly, protect } from '../middleware/authMiddleware.js';
import { uploadAgentFiles, validateProofFileSizes } from '../middleware/uploadMiddleware.js';

const router = express.Router();

router.post('/login', login);
router.get('/me', protect, me);
router.post('/change-password', protect, changePassword);
router.post('/agents', protect, adminOnly, uploadAgentFiles, validateProofFileSizes, createAgent);
router.get('/agents', protect, adminOnly, listAgents);
router.get('/agents/:id', protect, adminOnly, getAgent);
router.delete('/agents/:id', protect, adminOnly, deleteAgent);
router.post('/agents/:id/recover', protect, adminOnly, recoverAgent);

export default router;

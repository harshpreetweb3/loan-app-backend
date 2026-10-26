import express from 'express';
import {
  getWhatsAppStatus,
  listWhatsAppMessages,
  receiveWebhook,
  sendBorrowerTemplate,
  sendBorrowerText,
  updateBorrowerWhatsAppOptIn,
  verifyWebhook
} from '../controllers/whatsAppController.js';
import { adminOnly, protect } from '../middleware/authMiddleware.js';

const router = express.Router();

// Meta must access these public routes to verify the subscription and report status changes.
router.get('/webhook', verifyWebhook);
router.post('/webhook', receiveWebhook);

router.use(protect);
router.get('/status', getWhatsAppStatus);
router.get('/messages', listWhatsAppMessages);
router.patch('/borrowers/:borrowerId/opt-in', adminOnly, updateBorrowerWhatsAppOptIn);
router.post('/borrowers/:borrowerId/template', sendBorrowerTemplate);
router.post('/borrowers/:borrowerId/text', sendBorrowerText);

export default router;

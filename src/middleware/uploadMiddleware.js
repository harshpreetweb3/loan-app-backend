import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';
import { agentProofDir, borrowerPhotoDir, proofDir, rcPhotoDir } from '../utils/storage.js';

export const MAX_PROOF_FILE_SIZE = 100 * 1024;

const storage = multer.diskStorage({
  destination(req, file, cb) {
    if (file.fieldname === 'rcPhoto') return cb(null, rcPhotoDir);
    if (file.fieldname.startsWith('agentProof')) return cb(null, agentProofDir);
    if (file.fieldname.toLowerCase().includes('proof')) return cb(null, proofDir);
    cb(null, borrowerPhotoDir);
  },
  filename(req, file, cb) {
    const ext = path.extname(file.originalname || '.jpg');
    cb(null, `${file.fieldname}-${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
  }
});

function proofSizeGuard(req, _res, next) {
  const files = Object.values(req.files || {}).flat();
  const oversized = files.filter((file) => file.fieldname !== 'photo' && file.size > MAX_PROOF_FILE_SIZE);
  if (!oversized.length) return next();

  Promise.all(files.map((file) => fs.unlink(file.path).catch(() => {}))).finally(() => {
    const error = new Error('Uploaded proofs must be 100 KB or smaller');
    error.statusCode = 400;
    next(error);
  });
}

export const uploadBorrowerFiles = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    if (!file.mimetype.startsWith('image/') && file.mimetype !== 'application/pdf') return cb(new Error('Only image or PDF uploads are allowed'));
    cb(null, true);
  }
}).fields([
  { name: 'photo', maxCount: 1 },
  { name: 'rcPhoto', maxCount: 1 },
  { name: 'proof1', maxCount: 1 },
  { name: 'proof2', maxCount: 1 }
]);

export const uploadAgentFiles = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    if (!file.mimetype.startsWith('image/') && file.mimetype !== 'application/pdf') return cb(new Error('Only image or PDF uploads are allowed'));
    cb(null, true);
  }
}).fields([
  { name: 'agentProof1', maxCount: 1 },
  { name: 'agentProof2', maxCount: 1 }
]);

export const uploadLoanFiles = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    if (!file.mimetype.startsWith('image/') && file.mimetype !== 'application/pdf') return cb(new Error('Only image or PDF uploads are allowed'));
    cb(null, true);
  }
}).fields([
  { name: 'rcPhoto', maxCount: 1 },
  { name: 'guarantorProof1', maxCount: 1 },
  { name: 'guarantorProof2', maxCount: 1 }
]);

export const validateProofFileSizes = proofSizeGuard;

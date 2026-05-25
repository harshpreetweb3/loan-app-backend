import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';
import { agentProofDir, borrowerPhotoDir, proofDir, rcPhotoDir } from '../utils/storage.js';

export const MAX_BORROWER_PHOTO_SIZE = 100 * 1024;
export const MAX_PROOF_FILE_SIZE = 300 * 1024;
export const MAX_UPLOAD_FILE_SIZE = MAX_PROOF_FILE_SIZE;
const UPLOAD_SIZE_MESSAGE = 'Uploads must be 300 KB or smaller';

const FIELD_SIZE_LIMITS = {
  photo: MAX_BORROWER_PHOTO_SIZE,
  rcPhoto: MAX_PROOF_FILE_SIZE,
  proof1: MAX_PROOF_FILE_SIZE,
  proof2: MAX_PROOF_FILE_SIZE,
  guarantorProof1: MAX_PROOF_FILE_SIZE,
  guarantorProof2: MAX_PROOF_FILE_SIZE,
  agentProof1: MAX_PROOF_FILE_SIZE,
  agentProof2: MAX_PROOF_FILE_SIZE
};

function sizeMessage(file) {
  const limit = FIELD_SIZE_LIMITS[file.fieldname] || MAX_PROOF_FILE_SIZE;
  const label = file.fieldname === 'photo' ? 'Borrower photo' : 'Upload';
  return `${label} must be ${Math.round(limit / 1024)} KB or smaller`;
}

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

function uploadSizeGuard(req, _res, next) {
  const files = Object.values(req.files || {}).flat();
  const oversized = files.filter((file) => file.size > (FIELD_SIZE_LIMITS[file.fieldname] || MAX_PROOF_FILE_SIZE));
  if (!oversized.length) return next();

  Promise.all(files.map((file) => fs.unlink(file.path).catch(() => {}))).finally(() => {
    const error = new Error(sizeMessage(oversized[0]));
    error.statusCode = 400;
    next(error);
  });
}

function uploadOptions() {
  return {
    storage,
    limits: { fileSize: MAX_UPLOAD_FILE_SIZE },
    fileFilter(_req, file, cb) {
      if (!file.mimetype.startsWith('image/') && file.mimetype !== 'application/pdf') return cb(new Error('Only image or PDF uploads are allowed'));
      cb(null, true);
    }
  };
}

export const uploadBorrowerFiles = multer(uploadOptions()).fields([
  { name: 'photo', maxCount: 1 },
  { name: 'rcPhoto', maxCount: 1 },
  { name: 'proof1', maxCount: 1 },
  { name: 'proof2', maxCount: 1 }
]);

export const uploadAgentFiles = multer(uploadOptions()).fields([
  { name: 'agentProof1', maxCount: 1 },
  { name: 'agentProof2', maxCount: 1 }
]);

export const uploadLoanFiles = multer(uploadOptions()).fields([
  { name: 'rcPhoto', maxCount: 1 },
  { name: 'guarantorProof1', maxCount: 1 },
  { name: 'guarantorProof2', maxCount: 1 }
]);

export const validateProofFileSizes = uploadSizeGuard;
export { UPLOAD_SIZE_MESSAGE };

import multer from 'multer';
import path from 'path';
import { borrowerPhotoDir, rcPhotoDir } from '../utils/storage.js';

const storage = multer.diskStorage({
  destination(req, file, cb) {
    cb(null, file.fieldname === 'rcPhoto' ? rcPhotoDir : borrowerPhotoDir);
  },
  filename(req, file, cb) {
    const ext = path.extname(file.originalname || '.jpg');
    cb(null, `${file.fieldname}-${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
  }
});

export const uploadBorrowerFiles = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    if (!file.mimetype.startsWith('image/')) return cb(new Error('Only image uploads are allowed'));
    cb(null, true);
  }
}).fields([
  { name: 'photo', maxCount: 1 },
  { name: 'rcPhoto', maxCount: 1 }
]);

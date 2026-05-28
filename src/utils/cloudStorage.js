import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { agentProofDir, borrowerPhotoDir, proofDir, publicPath, rcPhotoDir } from './storage.js';

function cloudinaryConfigured() {
  return Boolean(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET);
}

function uploadFolder(fieldname) {
  if (fieldname === 'rcPhoto') return 'loan-app/rc';
  if (fieldname.startsWith('agentProof')) return 'loan-app/agent-proofs';
  if (fieldname.toLowerCase().includes('proof')) return 'loan-app/proofs';
  return 'loan-app/borrowers';
}

function localDirectory(fieldname) {
  if (fieldname === 'rcPhoto') return rcPhotoDir;
  if (fieldname.startsWith('agentProof')) return agentProofDir;
  if (fieldname.toLowerCase().includes('proof')) return proofDir;
  return borrowerPhotoDir;
}

function signedParams(params) {
  const source = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== '')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
  return crypto.createHash('sha1').update(`${source}${process.env.CLOUDINARY_API_SECRET}`).digest('hex');
}

async function uploadToCloudinary(file) {
  const timestamp = Math.floor(Date.now() / 1000);
  const folder = uploadFolder(file.fieldname);
  const params = { folder, timestamp };
  const formData = new FormData();
  formData.append('file', new Blob([file.buffer], { type: file.mimetype }), file.originalname || `${file.fieldname}.jpg`);
  formData.append('api_key', process.env.CLOUDINARY_API_KEY);
  formData.append('timestamp', String(timestamp));
  formData.append('folder', folder);
  formData.append('signature', signedParams(params));

  const response = await fetch(`https://api.cloudinary.com/v1_1/${process.env.CLOUDINARY_CLOUD_NAME}/auto/upload`, {
    method: 'POST',
    body: formData
  });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data?.error?.message || 'Cloud upload failed');
    error.statusCode = 502;
    throw error;
  }
  return data.secure_url || data.url;
}

async function saveLocalFallback(file) {
  const directory = localDirectory(file.fieldname);
  await fs.mkdir(directory, { recursive: true });
  const ext = path.extname(file.originalname || '.jpg');
  const filename = `${file.fieldname}-${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
  const destination = path.join(directory, filename);
  await fs.writeFile(destination, file.buffer);
  return publicPath(destination);
}

export async function persistUploadedFile(file) {
  if (!file) return undefined;
  if (cloudinaryConfigured()) return uploadToCloudinary(file);
  return saveLocalFallback(file);
}

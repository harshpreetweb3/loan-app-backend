import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const uploadRoot = path.join(__dirname, '..', 'uploads');
export const receiptDir = path.join(uploadRoot, 'receipts');
export const borrowerPhotoDir = path.join(uploadRoot, 'borrowers');
export const proofDir = path.join(uploadRoot, 'proofs');
export const agentProofDir = path.join(uploadRoot, 'agent-proofs');
export const rcPhotoDir = path.join(uploadRoot, 'rc');

export async function ensureStorage() {
  await fs.mkdir(receiptDir, { recursive: true });
  await fs.mkdir(borrowerPhotoDir, { recursive: true });
  await fs.mkdir(proofDir, { recursive: true });
  await fs.mkdir(agentProofDir, { recursive: true });
  await fs.mkdir(rcPhotoDir, { recursive: true });
}

export function publicPath(filePath) {
  const relative = path.relative(uploadRoot, filePath).replaceAll(path.sep, '/');
  return `/uploads/${relative}`;
}

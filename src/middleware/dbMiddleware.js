import { connectDB } from '../config/db.js';
import { ensureStorage } from '../utils/storage.js';

let readyPromise;

export function withDatabase(req, res, next) {
  if (!readyPromise) {
    readyPromise = Promise.all([ensureStorage(), connectDB()]);
  }

  readyPromise.then(() => next()).catch(next);
}

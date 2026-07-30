import dotenv from 'dotenv';
import app from '../src/app.js';
import { connectDB } from '../src/config/db.js';

dotenv.config();

export default async function handler(req, res) {
  try {
    await connectDB();
    return app(req, res);
  } catch (error) {
    console.error('Unable to initialize API', error);
    return res.status(503).json({ message: 'Service is temporarily unavailable' });
  }
}

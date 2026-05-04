import dotenv from 'dotenv';
import { connectDB } from './config/db.js';
import { ROLES } from './constants.js';
import User from './models/User.js';

dotenv.config();
await connectDB();

const username = process.env.ADMIN_USERNAME || 'admin';
const password = process.env.ADMIN_PASSWORD || 'admin123';

const exists = await User.findOne({ username });
if (!exists) {
  await User.create({ name: 'System Admin', username, password, role: ROLES.ADMIN });
  console.log(`Admin created: ${username}`);
} else {
  console.log(`Admin already exists: ${username}`);
}

process.exit(0);

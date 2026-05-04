import { ROLES } from '../constants.js';
import User from '../models/User.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { signToken } from '../utils/token.js';

function userPayload(user) {
  return { id: user._id, name: user.name, username: user.username, role: user.role };
}

export const login = asyncHandler(async (req, res) => {
  const { username, password } = req.body;
  const user = await User.findOne({ username: String(username || '').toLowerCase() });
  if (!user || !(await user.matchPassword(password))) {
    return res.status(401).json({ message: 'Invalid username or password' });
  }
  res.json({ token: signToken(user), user: userPayload(user) });
});

export const me = asyncHandler(async (req, res) => {
  res.json({ user: userPayload(req.user) });
});

export const createAgent = asyncHandler(async (req, res) => {
  const { name, username, password } = req.body;
  const agent = await User.create({ name, username, password, role: ROLES.AGENT, createdBy: req.user._id });
  res.status(201).json({ agent: userPayload(agent) });
});

export const listAgents = asyncHandler(async (_req, res) => {
  const agents = await User.find({ role: ROLES.AGENT }).select('-password').sort({ createdAt: -1 });
  res.json({ agents });
});

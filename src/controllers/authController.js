import { ROLES } from '../constants.js';
import Loan from '../models/Loan.js';
import Payment from '../models/Payment.js';
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

export const listAgents = asyncHandler(async (req, res) => {
  const query = { role: ROLES.AGENT };
  if (req.query.name) query.name = { $regex: req.query.name, $options: 'i' };
  const agents = await User.find(query).select('-password').sort({ createdAt: -1 });
  const withActivity = await Promise.all(
    agents.map(async (agent) => {
      const [loansCreated, collections] = await Promise.all([
        Loan.countDocuments({ createdBy: agent._id }),
        Payment.aggregate([{ $match: { collectedBy: agent._id } }, { $group: { _id: null, amount: { $sum: '$amount' }, count: { $sum: 1 } } }])
      ]);
      return { ...agent.toObject(), loansCreated, collectionCount: collections[0]?.count || 0, collectionAmount: collections[0]?.amount || 0 };
    })
  );
  res.json({ agents: withActivity });
});

import { ROLES } from '../constants.js';
import Loan from '../models/Loan.js';
import Payment from '../models/Payment.js';
import User from '../models/User.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { publicPath } from '../utils/storage.js';
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
  const { name, username, password, address, mobileNumber } = req.body;
  const agent = await User.create({
    name,
    username,
    password,
    address,
    mobileNumber,
    proof1Path: req.files?.agentProof1?.[0] ? publicPath(req.files.agentProof1[0].path) : undefined,
    proof2Path: req.files?.agentProof2?.[0] ? publicPath(req.files.agentProof2[0].path) : undefined,
    role: ROLES.AGENT,
    createdBy: req.user._id
  });
  res.status(201).json({ agent: userPayload(agent) });
});

export const listAgents = asyncHandler(async (req, res) => {
  const query = { role: ROLES.AGENT };
  if (req.query.name) query.name = { $regex: req.query.name, $options: 'i' };
  const agents = await User.find(query).select('-password').sort({ createdAt: -1 });
  const withActivity = await Promise.all(
    agents.map(async (agent) => {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const todayEnd = new Date();
      todayEnd.setHours(23, 59, 59, 999);
      const [loansCreated, collections] = await Promise.all([
        Loan.countDocuments({ createdBy: agent._id }),
        Payment.aggregate([
          { $match: { collectedBy: agent._id } },
          {
            $group: {
              _id: null,
              amount: { $sum: '$amount' },
              count: { $sum: 1 },
              dailyAmount: { $sum: { $cond: [{ $and: [{ $gte: ['$createdAt', todayStart] }, { $lte: ['$createdAt', todayEnd] }] }, '$amount', 0] } }
            }
          }
        ])
      ]);
      return { ...agent.toObject(), loansCreated, collectionCount: collections[0]?.count || 0, collectionAmount: collections[0]?.amount || 0, dailyCollectionAmount: collections[0]?.dailyAmount || 0 };
    })
  );
  res.json({ agents: withActivity });
});

export const deleteAgent = asyncHandler(async (req, res) => {
  const agent = await User.findOne({ _id: req.params.id, role: ROLES.AGENT });
  if (!agent) return res.status(404).json({ message: 'Agent not found' });
  await agent.deleteOne();
  res.json({ message: 'Agent deleted' });
});

function tempPassword() {
  return `NSF-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

export const recoverAgent = asyncHandler(async (req, res) => {
  const agent = await User.findOne({ _id: req.params.id, role: ROLES.AGENT });
  if (!agent) return res.status(404).json({ message: 'Agent not found' });
  const temporaryPassword = tempPassword();
  agent.password = temporaryPassword;
  agent.tempPasswordIssuedAt = new Date();
  await agent.save();
  res.json({
    username: agent.username,
    temporaryPassword,
    message: 'Temporary password generated. Share it securely with the agent.'
  });
});

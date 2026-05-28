import { ROLES } from '../constants.js';
import Loan from '../models/Loan.js';
import Payment from '../models/Payment.js';
import User from '../models/User.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { persistUploadedFile } from '../utils/cloudStorage.js';
import { signToken } from '../utils/token.js';

function userPayload(user) {
  return {
    id: user._id,
    name: user.name,
    username: user.username,
    role: user.role,
    mustChangePassword: Boolean(user.tempPasswordIssuedAt)
  };
}

function tempPassword() {
  return `NSF-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

async function uniqueUsername(name) {
  const base = String(name || 'agent')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 14) || 'agent';
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const digits = Math.floor(1000 + Math.random() * 9000);
    const username = `${base}${digits}`;
    // eslint-disable-next-line no-await-in-loop
    const exists = await User.exists({ username });
    if (!exists) return username;
  }
  return `${base}${Date.now().toString().slice(-6)}`;
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
  const { name, address, mobileNumber } = req.body;
  const errors = [];
  if (!String(name || '').trim()) errors.push('Agent name is required');
  if (!String(address || '').trim()) errors.push('Agent address is required');
  if (!/^[6-9]\d{9}$/.test(String(mobileNumber || ''))) errors.push('Please enter a valid mobile number');
  if (!req.files?.agentProof1?.[0]) errors.push('Agent proof 1 is required');
  if (errors.length) return res.status(400).json({ message: errors[0], errors });
  const username = await uniqueUsername(name);
  const password = tempPassword();
  const agent = await User.create({
    name,
    username,
    password,
    address,
    mobileNumber,
    proof1Path: req.files?.agentProof1?.[0] ? await persistUploadedFile(req.files.agentProof1[0]) : undefined,
    proof2Path: req.files?.agentProof2?.[0] ? await persistUploadedFile(req.files.agentProof2[0]) : undefined,
    tempPasswordIssuedAt: new Date(),
    role: ROLES.AGENT,
    createdBy: req.user._id
  });
  res.status(201).json({ agent: userPayload(agent), username, temporaryPassword: password });
});

export const listAgents = asyncHandler(async (req, res) => {
  const query = { role: ROLES.AGENT };
  if (req.query.name) query.name = { $regex: req.query.name, $options: 'i' };
  const collectionDate = req.query.collectionDate ? new Date(req.query.collectionDate) : new Date();
  const dateStart = new Date(collectionDate);
  dateStart.setHours(0, 0, 0, 0);
  const dateEnd = new Date(collectionDate);
  dateEnd.setHours(23, 59, 59, 999);
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);
  const agents = await User.find(query).select('-password').sort({ createdAt: -1 });
  const withActivity = await Promise.all(
    agents.map(async (agent) => {
      const [loansCreated, collections] = await Promise.all([
        Loan.countDocuments({ createdBy: agent._id }),
        Payment.aggregate([
          { $match: { collectedBy: agent._id } },
          {
            $group: {
              _id: null,
              amount: { $sum: '$amount' },
              count: { $sum: 1 },
              todayAmount: { $sum: { $cond: [{ $and: [{ $gte: ['$createdAt', todayStart] }, { $lte: ['$createdAt', todayEnd] }] }, '$amount', 0] } },
              selectedDateAmount: { $sum: { $cond: [{ $and: [{ $gte: ['$createdAt', dateStart] }, { $lte: ['$createdAt', dateEnd] }] }, '$amount', 0] } },
              selectedDateCount: { $sum: { $cond: [{ $and: [{ $gte: ['$createdAt', dateStart] }, { $lte: ['$createdAt', dateEnd] }] }, 1, 0] } }
            }
          }
        ])
      ]);
      return {
        ...agent.toObject(),
        loansCreated,
        collectionCount: collections[0]?.count || 0,
        collectionAmount: collections[0]?.amount || 0,
        todayCollectionAmount: collections[0]?.todayAmount || 0,
        selectedDateCollectionAmount: collections[0]?.selectedDateAmount || 0,
        selectedDateCollectionCount: collections[0]?.selectedDateCount || 0
      };
    })
  );
  res.json({
    agents: withActivity,
    stats: {
      loansCreated: withActivity.reduce((sum, agent) => sum + (agent.loansCreated || 0), 0),
      collections: withActivity.reduce((sum, agent) => sum + (agent.collectionCount || 0), 0),
      todayCollection: withActivity.reduce((sum, agent) => sum + (agent.todayCollectionAmount || 0), 0),
      overallCollection: withActivity.reduce((sum, agent) => sum + (agent.collectionAmount || 0), 0),
      selectedDateCollection: withActivity.reduce((sum, agent) => sum + (agent.selectedDateCollectionAmount || 0), 0)
    }
  });
});

export const getAgent = asyncHandler(async (req, res) => {
  const agent = await User.findOne({ _id: req.params.id, role: ROLES.AGENT }).select('-password').populate('createdBy', 'name username');
  if (!agent) return res.status(404).json({ message: 'Agent not found' });
  const [loans, payments, collectionTotals] = await Promise.all([
    Loan.find({ createdBy: agent._id }).populate('borrower', 'name customerId mobileNumbers phone').sort({ createdAt: -1 }),
    Payment.find({ collectedBy: agent._id }).populate('borrower', 'name customerId mobileNumbers phone').sort({ createdAt: -1 }).limit(25),
    Payment.aggregate([
      { $match: { collectedBy: agent._id } },
      { $group: { _id: null, amount: { $sum: '$amount' }, count: { $sum: 1 } } }
    ])
  ]);
  res.json({
    agent,
    loans,
    payments,
    stats: {
      loansCreated: loans.length,
      collectionCount: collectionTotals[0]?.count || 0,
      collectionAmount: collectionTotals[0]?.amount || 0
    }
  });
});

export const deleteAgent = asyncHandler(async (req, res) => {
  const agent = await User.findOne({ _id: req.params.id, role: ROLES.AGENT });
  if (!agent) return res.status(404).json({ message: 'Agent not found' });
  await agent.deleteOne();
  res.json({ message: 'Agent deleted' });
});

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

export const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const user = await User.findById(req.user._id);
  if (!user || !(await user.matchPassword(currentPassword))) {
    return res.status(400).json({ message: 'Current password is incorrect' });
  }
  if (!newPassword || String(newPassword).length < 6) {
    return res.status(400).json({ message: 'New password must be at least 6 characters' });
  }
  user.password = newPassword;
  user.tempPasswordIssuedAt = undefined;
  await user.save();
  res.json({ token: signToken(user), user: userPayload(user) });
});

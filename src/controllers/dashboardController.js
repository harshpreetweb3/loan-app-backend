import Borrower from '../models/Borrower.js';
import Loan from '../models/Loan.js';
import Payment from '../models/Payment.js';
import { asyncHandler } from '../utils/asyncHandler.js';

function startOfDay(date = new Date()) {
  const value = new Date(date);
  value.setHours(0, 0, 0, 0);
  return value;
}

function endOfDay(date = new Date()) {
  const value = new Date(date);
  value.setHours(23, 59, 59, 999);
  return value;
}

export const getDashboard = asyncHandler(async (req, res) => {
  const todayStart = startOfDay();
  const todayEnd = endOfDay();
  const now = new Date();
  const isAdmin = req.user.role === 'admin';
  const owned = isAdmin ? {} : { createdBy: req.user._id };

  const [totalBorrowers, totalLoans, overdueLoans, todaysDue, myCollections, dailyDueLoans, recentPayments] = await Promise.all([
    Borrower.countDocuments(owned),
    Loan.countDocuments(owned),
    Loan.countDocuments({ ...owned, 'installments.dueDate': { $lt: now }, 'installments.status': { $in: ['pending', 'partial', 'overdue'] } }),
    Loan.countDocuments({ ...owned, 'installments.dueDate': { $gte: todayStart, $lte: todayEnd }, 'installments.status': { $in: ['pending', 'partial'] } }),
    Payment.aggregate([
      { $match: { collectedBy: req.user._id, createdAt: { $gte: todayStart, $lte: todayEnd } } },
      { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } }
    ]),
    Loan.find({ ...owned, 'installments.dueDate': { $gte: todayStart, $lte: todayEnd }, 'installments.status': { $in: ['pending', 'partial'] } })
      .populate('borrower')
      .populate('createdBy', 'name username')
      .limit(20)
      .sort({ createdAt: -1 }),
    Payment.find(isAdmin ? {} : { collectedBy: req.user._id }).populate('borrower').populate('collectedBy', 'name username').sort({ createdAt: -1 }).limit(10)
  ]);

  res.json({
    stats: {
      totalBorrowers,
      totalLoans,
      overdueLoans,
      todaysDue,
      myCollections: myCollections[0]?.total || 0,
      myCollectionCount: myCollections[0]?.count || 0
    },
    dailyDues: dailyDueLoans.map((loan) => ({
      loan,
      dueInstallments: loan.installments.filter((item) => item.dueDate >= todayStart && item.dueDate <= todayEnd && ['pending', 'partial'].includes(item.status))
    })),
    recentPayments
  });
});

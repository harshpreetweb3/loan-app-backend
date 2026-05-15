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
  const unpaidStatuses = ['pending', 'partial', 'overdue'];
  const overdueInstallment = {
    $elemMatch: {
      convertedAt: null,
      dueDate: { $lt: todayStart },
      status: { $in: unpaidStatuses }
    }
  };
  const todayInstallment = {
    $elemMatch: {
      convertedAt: null,
      dueDate: { $gte: todayStart, $lte: todayEnd },
      status: { $in: ['pending', 'partial'] }
    }
  };

  const [totalBorrowers, totalLoans, overdueLoans, todaysDue, myCollections, dailyDueLoans, recentPayments] = await Promise.all([
    Borrower.countDocuments({}),
    Loan.countDocuments({}),
    Loan.countDocuments({ installments: overdueInstallment }),
    Loan.countDocuments({ installments: todayInstallment }),
    Payment.aggregate([
      { $match: { collectedBy: req.user._id, createdAt: { $gte: todayStart, $lte: todayEnd } } },
      { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } }
    ]),
    Loan.find({ installments: todayInstallment })
      .populate('borrower')
      .populate('createdBy', 'name username')
      .limit(20)
      .sort({ createdAt: -1 }),
    Payment.find({}).populate('borrower').populate('collectedBy', 'name username').sort({ createdAt: -1 }).limit(10)
  ]);

  const dailyDues = dailyDueLoans
    .map((loan) => ({
      loan,
      dueInstallments: loan.installments.filter((item) => !item.convertedAt && item.dueDate >= todayStart && item.dueDate <= todayEnd && ['pending', 'partial'].includes(item.status))
    }))
    .filter(({ dueInstallments }) => dueInstallments.length > 0);

  res.json({
    stats: {
      totalBorrowers,
      totalLoans,
      overdueLoans,
      todaysDue,
      myCollections: myCollections[0]?.total || 0,
      myCollectionCount: myCollections[0]?.count || 0
    },
    dailyDues,
    recentPayments
  });
});

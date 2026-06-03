import Borrower from '../models/Borrower.js';
import Loan from '../models/Loan.js';
import Payment from '../models/Payment.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { applyPenaltiesToLoans } from '../utils/penalty.js';
import { ROLES } from '../constants.js';

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

function rangeFromQuery(query) {
  const now = new Date();
  if (query.range === 'overall') return { start: new Date(0), end: endOfDay(now) };
  if (query.range === 'today') return { start: startOfDay(now), end: endOfDay(now) };
  if (query.range === 'week') {
    const start = startOfDay(now);
    start.setDate(start.getDate() - start.getDay());
    return { start, end: endOfDay(now) };
  }
  if (query.range === 'month') return { start: new Date(now.getFullYear(), now.getMonth(), 1), end: endOfDay(now) };
  if (query.range === 'year') return { start: new Date(now.getFullYear(), 0, 1), end: endOfDay(now) };
  if (query.range === 'custom') {
    return {
      start: query.from ? startOfDay(new Date(query.from)) : new Date(0),
      end: query.to ? endOfDay(new Date(query.to)) : endOfDay(now)
    };
  }
  return { start: startOfDay(now), end: endOfDay(now) };
}

export const getDashboard = asyncHandler(async (req, res) => {
  const todayStart = startOfDay();
  const todayEnd = endOfDay();
  const { start: rangeStart, end: rangeEnd } = rangeFromQuery(req.query);
  const isAgent = req.user.role === ROLES.AGENT;
  const ownerQuery = isAgent ? { createdBy: req.user._id } : {};
  const collectionOwnerQuery = isAgent ? { collectedBy: req.user._id } : {};
  const dueOwnerQuery = {};
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

  const [totalBorrowers, totalLoans, totalActiveLoans, totalClosedLoans, overdueLoans, todaysDue, myCollections, dailyDueLoans, overdueInstallmentLoans, recentPayments, allPayments, loanTotals] = await Promise.all([
    Borrower.countDocuments(isAgent ? { createdBy: req.user._id } : { createdAt: { $gte: rangeStart, $lte: rangeEnd } }),
    Loan.countDocuments({ ...ownerQuery, createdAt: { $gte: rangeStart, $lte: rangeEnd } }),
    Loan.countDocuments({ ...ownerQuery, status: 'active', createdAt: { $gte: rangeStart, $lte: rangeEnd } }),
    Loan.countDocuments({ ...ownerQuery, status: 'completed', createdAt: { $gte: rangeStart, $lte: rangeEnd } }),
    Loan.countDocuments({ ...dueOwnerQuery, installments: overdueInstallment }),
    Loan.countDocuments({ ...dueOwnerQuery, installments: todayInstallment }),
    Payment.aggregate([
      { $match: { collectedBy: req.user._id, createdAt: { $gte: todayStart, $lte: todayEnd } } },
      { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } }
    ]),
    Loan.find({ ...dueOwnerQuery, installments: todayInstallment })
      .populate('borrower')
      .populate('createdBy', 'name username')
      .limit(20)
      .sort({ createdAt: -1 }),
    Loan.find({ ...dueOwnerQuery, installments: overdueInstallment }).populate('borrower').populate('createdBy', 'name username').limit(20).sort({ createdAt: -1 }),
    Payment.find({ ...collectionOwnerQuery, createdAt: { $gte: rangeStart, $lte: rangeEnd } }).populate('borrower').populate('collectedBy', 'name username').sort({ createdAt: -1 }).limit(8),
    Payment.aggregate([
      { $match: { ...collectionOwnerQuery, createdAt: { $gte: rangeStart, $lte: rangeEnd } } },
      {
        $group: {
          _id: null,
          totalCollected: { $sum: '$amount' },
          todayCollected: { $sum: { $cond: [{ $and: [{ $gte: ['$createdAt', todayStart] }, { $lte: ['$createdAt', todayEnd] }] }, '$amount', 0] } }
        }
      }
    ]),
    Loan.aggregate([{ $match: { ...ownerQuery, createdAt: { $gte: rangeStart, $lte: rangeEnd } } }, { $group: { _id: null, totalDistributed: { $sum: '$loanAmount' } } }])
  ]);

  await applyPenaltiesToLoans([...dailyDueLoans, ...overdueInstallmentLoans]);

  const dailyDues = dailyDueLoans
    .map((loan) => ({
      loan,
      dueInstallments: loan.installments.filter((item) => !item.convertedAt && item.dueDate >= todayStart && item.dueDate <= todayEnd && ['pending', 'partial'].includes(item.status))
    }))
    .filter(({ dueInstallments }) => dueInstallments.length > 0);

  const overdueInstallments = overdueInstallmentLoans
    .map((loan) => ({
      loan,
      dueInstallments: loan.installments.filter((item) => !item.convertedAt && item.dueDate < todayStart && unpaidStatuses.includes(item.status))
    }))
    .filter(({ dueInstallments }) => dueInstallments.length > 0);

  const todaysDueAmount = dailyDues.reduce((sum, { dueInstallments }) => sum + dueInstallments.reduce((inner, item) => inner + Math.max(item.amount + (item.penaltyAmount || 0) - (item.paidAmount || 0), 0), 0), 0);
  const totalOverdueLoanAmount = overdueInstallments.reduce((sum, { dueInstallments }) => sum + dueInstallments.reduce((inner, item) => inner + Math.max(item.amount + (item.penaltyAmount || 0) - (item.paidAmount || 0), 0), 0), 0);
  const overdueInstallmentCount = overdueInstallments.reduce((sum, item) => sum + item.dueInstallments.length, 0);
  const todaysInstallmentCount = dailyDues.reduce((sum, item) => sum + item.dueInstallments.length, 0);

  res.json({
    stats: {
      totalBorrowers,
      totalLoans,
      totalActiveLoans,
      totalClosedLoans,
      overdueLoans,
      todaysDue,
      totalCollectedAmount: allPayments[0]?.totalCollected || 0,
      todaysCollectionAmount: allPayments[0]?.todayCollected || 0,
      todaysDueAmount,
      totalOverdueLoanAmount,
      overdueInstallmentCount,
      todaysInstallmentCount,
      totalLoanAmountDistributed: loanTotals[0]?.totalDistributed || 0,
      myCollections: myCollections[0]?.total || 0,
      myCollectionCount: myCollections[0]?.count || 0
    },
    dailyDues,
    overdueInstallments,
    recentPayments
  });
});

function flattenDueInstallments(groups) {
  return groups.flatMap(({ loan, dueInstallments }) => dueInstallments.map((installment) => ({
    installment,
    loan: {
      _id: loan._id,
      loanCategory: loan.loanCategory,
      installmentType: loan.installmentType,
      createdBy: loan.createdBy
    },
    borrower: loan.borrower
  })));
}

export const getDueInstallments = asyncHandler(async (_req, res) => {
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

  const [dailyDueLoans, overdueInstallmentLoans] = await Promise.all([
    Loan.find({ installments: todayInstallment }).populate('borrower').populate('createdBy', 'name username').sort({ createdAt: -1 }),
    Loan.find({ installments: overdueInstallment }).populate('borrower').populate('createdBy', 'name username').sort({ createdAt: -1 })
  ]);
  await applyPenaltiesToLoans([...dailyDueLoans, ...overdueInstallmentLoans]);

  const dailyDues = dailyDueLoans
    .map((loan) => ({
      loan,
      dueInstallments: loan.installments.filter((item) => !item.convertedAt && item.dueDate >= todayStart && item.dueDate <= todayEnd && ['pending', 'partial'].includes(item.status))
    }))
    .filter(({ dueInstallments }) => dueInstallments.length > 0);

  const overdueInstallments = overdueInstallmentLoans
    .map((loan) => ({
      loan,
      dueInstallments: loan.installments.filter((item) => !item.convertedAt && item.dueDate < todayStart && unpaidStatuses.includes(item.status))
    }))
    .filter(({ dueInstallments }) => dueInstallments.length > 0);

  res.json({
    today: flattenDueInstallments(dailyDues),
    overdue: flattenDueInstallments(overdueInstallments)
  });
});

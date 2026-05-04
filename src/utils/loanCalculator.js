export function addDays(date, days) {
  const value = new Date(date);
  value.setDate(value.getDate() + days);
  return value;
}

export function addMonths(date, months) {
  const value = new Date(date);
  value.setMonth(value.getMonth() + months);
  return value;
}

export function calculateLoanSchedule({ loanAmount, interestPercent, duration, installmentType, startDate }) {
  const totalPayable = Math.round((Number(loanAmount) + (Number(loanAmount) * Number(interestPercent)) / 100) * 100) / 100;
  const installmentAmount = Math.ceil((totalPayable / Number(duration)) * 100) / 100;

  const installments = Array.from({ length: Number(duration) }, (_, index) => {
    const dueDate = installmentType === 'daily' ? addDays(startDate, index + 1) : addMonths(startDate, index + 1);
    const isLast = index === Number(duration) - 1;
    const amount = isLast ? Math.round((totalPayable - installmentAmount * (duration - 1)) * 100) / 100 : installmentAmount;
    return { sequence: index + 1, dueDate, amount };
  });

  return {
    totalPayable,
    installmentAmount,
    totalInstallments: Number(duration),
    remainingInstallments: Number(duration),
    installments
  };
}

export function refreshLoanTotals(loan) {
  loan.paidInstallments = loan.installments.filter((item) => item.status === 'paid').length;
  loan.remainingInstallments = Math.max(loan.totalInstallments - loan.paidInstallments, 0);
  loan.totalPaid = Math.round(loan.installments.reduce((sum, item) => sum + (item.paidAmount || 0), 0) * 100) / 100;
  loan.status = loan.remainingInstallments === 0 ? 'completed' : 'active';
}

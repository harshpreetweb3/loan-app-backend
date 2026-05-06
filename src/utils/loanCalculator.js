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

function clampDueDay(year, month, dueDay) {
  const lastDay = new Date(year, month + 1, 0).getDate();
  return Math.min(Number(dueDay || 1), lastDay);
}

function monthlyDueDate(startDate, index, dueDayOfMonth) {
  const base = addMonths(startDate, index + 1);
  base.setDate(clampDueDay(base.getFullYear(), base.getMonth(), dueDayOfMonth || new Date(startDate).getDate()));
  return base;
}

export function calculateLoanSchedule({ loanAmount, interestPercent, interestAmount, duration, installmentType, startDate, dateOfFinance, processingCharges = 0, dueDayOfMonth }) {
  const principal = Number(loanAmount);
  const interest = interestAmount !== undefined && interestAmount !== '' ? Number(interestAmount) : (principal * Number(interestPercent || 0)) / 100;
  const percent = principal > 0 ? (interest / principal) * 100 : Number(interestPercent || 0);
  const totalPayable = Math.round((principal + interest + Number(processingCharges || 0)) * 100) / 100;
  const installmentAmount = Math.ceil((totalPayable / Number(duration)) * 100) / 100;
  const scheduleStart = new Date(startDate || dateOfFinance || new Date());

  const installments = Array.from({ length: Number(duration) }, (_, index) => {
    const dueDate = installmentType === 'daily' ? addDays(scheduleStart, index + 1) : monthlyDueDate(scheduleStart, index, dueDayOfMonth);
    const isLast = index === Number(duration) - 1;
    const amount = isLast ? Math.round((totalPayable - installmentAmount * (duration - 1)) * 100) / 100 : installmentAmount;
    return { sequence: index + 1, dueDate, amount };
  });

  return {
    totalPayable,
    interestAmount: Math.round(interest * 100) / 100,
    interestPercent: Math.round(percent * 100) / 100,
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

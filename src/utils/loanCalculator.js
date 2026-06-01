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

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

export function buildInstallmentSchedule({ totalPayable, duration, installmentType, startDate, dateOfFinance, dueDayOfMonth, sequenceStart = 1 }) {
  const count = installmentType === 'daily' ? Math.round(Number(duration) * 30) : Math.ceil(Number(duration));
  const installmentAmount = Math.ceil((Number(totalPayable) / count) * 100) / 100;
  const scheduleStart = new Date(startDate || dateOfFinance || new Date());

  const installments = Array.from({ length: count }, (_, index) => {
    const dueDate = installmentType === 'daily' ? addDays(scheduleStart, index + 1) : monthlyDueDate(scheduleStart, index, dueDayOfMonth);
    const isLast = index === count - 1;
    const amount = isLast ? roundMoney(Number(totalPayable) - installmentAmount * (count - 1)) : installmentAmount;
    return { sequence: sequenceStart + index, dueDate, amount };
  });

  return { installmentAmount, installments };
}

export function calculateLoanSchedule({ loanAmount, interestPercent, interestAmount, duration, installmentType, startDate, dateOfFinance, processingCharges = 0, processingFeeMode = 'separate', dueDayOfMonth }) {
  const principal = Number(loanAmount);
  const interest = (principal * Number(interestPercent || 0) * Number(duration || 0)) / 100;
  const percent = Number(interestPercent || 0);
  const includedProcessingCharges = processingFeeMode === 'separate' ? 0 : Number(processingCharges || 0);
  const totalPayable = roundMoney(principal + interest + includedProcessingCharges);
  const { installmentAmount, installments } = buildInstallmentSchedule({
    totalPayable,
    duration,
    installmentType,
    startDate,
    dateOfFinance,
    dueDayOfMonth
  });

  return {
    totalPayable,
    interestAmount: roundMoney(interest),
    interestPercent: roundMoney(percent),
    installmentAmount,
    totalInstallments: installments.length,
    remainingInstallments: installments.length,
    installments
  };
}

export function refreshLoanTotals(loan) {
  const activeInstallments = loan.installments.filter((item) => !item.convertedAt);
  loan.paidInstallments = activeInstallments.filter((item) => item.status === 'paid').length;
  loan.remainingInstallments = activeInstallments.filter((item) => item.status !== 'paid').length;
  loan.totalPaid = roundMoney(loan.installments.reduce((sum, item) => sum + (item.paidAmount || 0) + (item.penaltyPaidAmount || 0), 0) + (loan.processingFeePaidAmount || 0));
  const pendingProcessingFee = loan.processingFeeMode === 'separate' ? Math.max(Number(loan.processingCharges || 0) - Number(loan.processingFeePaidAmount || 0) - Number(loan.processingFeeWaivedAmount || 0), 0) : 0;
  const pendingPenalty = activeInstallments.reduce((sum, item) => sum + Math.max(Number(item.penaltyAmount || 0) - Number(item.penaltyPaidAmount || 0) - Number(item.penaltyWaivedAmount || 0), 0), 0);
  loan.status = loan.remainingInstallments === 0 && pendingProcessingFee <= 0 && pendingPenalty <= 0 ? 'completed' : 'active';
}

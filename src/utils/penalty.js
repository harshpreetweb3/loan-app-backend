import Setting from '../models/Setting.js';

function startOfDay(date = new Date()) {
  const value = new Date(date);
  value.setHours(0, 0, 0, 0);
  return value;
}

function addDays(date, days) {
  const value = new Date(date);
  value.setDate(value.getDate() + Number(days || 0));
  return value;
}

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

async function currentSetting() {
  return (await Setting.findOne()) || (await Setting.create({}));
}

export async function applyPenaltyToLoan(loan, referenceDate = new Date()) {
  const setting = await currentSetting();
  const today = startOfDay(referenceDate);
  let changed = false;

  loan.installments.forEach((installment) => {
    if (installment.convertedAt || installment.status === 'paid') return;
    const due = startOfDay(installment.dueDate);
    const graceEnds = addDays(due, setting.gracePeriodDays);
    if (today > graceEnds) {
      const penaltyAmount = roundMoney((Number(installment.amount || 0) * Number(setting.penaltyPercent || 0)) / 100);
      if (installment.status !== 'overdue' || Number(installment.penaltyAmount || 0) !== penaltyAmount) {
        installment.status = 'overdue';
        installment.penaltyAmount = penaltyAmount;
        changed = true;
      }
    }
  });

  if (changed) await loan.save();
  return loan;
}

export async function applyPenaltiesToLoans(loans, referenceDate = new Date()) {
  await Promise.all(loans.map((loan) => applyPenaltyToLoan(loan, referenceDate)));
  return loans;
}

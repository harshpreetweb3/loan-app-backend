import Setting from '../models/Setting.js';
import { asyncHandler } from '../utils/asyncHandler.js';

async function currentSetting() {
  let setting = await Setting.findOne();
  if (!setting) setting = await Setting.create({});
  return setting;
}

export const getSettings = asyncHandler(async (_req, res) => {
  res.json({ settings: await currentSetting() });
});

export const updateSettings = asyncHandler(async (req, res) => {
  const setting = await currentSetting();
  if (req.body.penaltyPercent !== undefined) setting.penaltyPercent = req.body.penaltyPercent;
  if (req.body.gracePeriodDays !== undefined) setting.gracePeriodDays = req.body.gracePeriodDays;
  await setting.save();
  res.json({ settings: setting });
});

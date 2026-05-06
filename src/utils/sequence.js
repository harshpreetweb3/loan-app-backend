import Counter from '../models/Counter.js';

export async function nextSequence(key, prefix) {
  const counter = await Counter.findOneAndUpdate({ key }, { $inc: { value: 1 } }, { upsert: true, new: true });
  return `${prefix}${String(counter.value).padStart(5, '0')}`;
}

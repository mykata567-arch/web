const DAY = 24 * 60 * 60 * 1000;

// 所有设备统一按北京时间划分学习日，避免 UTC/设备时区差异。
function today(now) {
  const time = now === undefined ? Date.now() : now;
  return new Date(time + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(value + 'T00:00:00.000Z');
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

function addDays(date, days) {
  if (!validDate(date) || !Number.isInteger(days)) throw new Error('日期或间隔无效');
  return new Date(Date.parse(date + 'T00:00:00.000Z') + days * DAY).toISOString().slice(0, 10);
}

module.exports = { today, validDate, addDays };

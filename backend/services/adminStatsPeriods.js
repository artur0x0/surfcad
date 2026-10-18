// services/adminStatsPeriods.js — pure date-bucket helpers (no Mongo imports)

const DAY_MS = 24 * 60 * 60 * 1000;

export function utcDayKey(date) {
  const d = date instanceof Date ? date : new Date(date);
  return d.toISOString().slice(0, 10);
}

/** ISO-8601 week key YYYY-Www (UTC, Monday-based). */
export function isoWeekKey(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

export function utcMonthKey(date) {
  const d = date instanceof Date ? date : new Date(date);
  return d.toISOString().slice(0, 7);
}

export function startOfUtcDay(date) {
  const d = date instanceof Date ? date : new Date(date);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function periodKeysDays(count, now = new Date()) {
  const end = startOfUtcDay(now);
  const keys = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const d = new Date(end.getTime() - i * DAY_MS);
    keys.push(utcDayKey(d));
  }
  return keys;
}

export function periodKeysWeeks(count, now = new Date()) {
  const keys = [];
  let cursor = startOfUtcDay(now);
  const dayNum = cursor.getUTCDay() || 7;
  cursor = new Date(cursor.getTime() - (dayNum - 1) * DAY_MS);
  for (let i = 0; i < count; i += 1) {
    keys.unshift(isoWeekKey(cursor));
    cursor = new Date(cursor.getTime() - 7 * DAY_MS);
  }
  return keys;
}

export function periodKeysMonths(count, now = new Date()) {
  const keys = [];
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  for (let i = count - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(y, m - i, 1));
    keys.push(utcMonthKey(d));
  }
  return keys;
}

export function fillCountSeries(keys, countMap) {
  return keys.map((period) => ({
    period,
    count: countMap.get(period) ?? 0,
  }));
}

/** Daily buckets keyed as `date` (UTC YYYY-MM-DD). */
export function fillDateCountSeries(keys, countMap) {
  return keys.map((date) => ({
    date,
    count: countMap.get(date) ?? 0,
  }));
}

export function fillLoginSeries(keys, loginMap, distinctMap) {
  return keys.map((period) => ({
    period,
    logins: loginMap.get(period) ?? 0,
    distinctUsers: distinctMap.get(period) ?? 0,
  }));
}

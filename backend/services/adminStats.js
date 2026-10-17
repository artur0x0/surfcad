// services/adminStats.js — sign-up and login aggregates from MongoDB
import User from '../db/models/User.js';
import LoginEvent from '../db/models/LoginEvent.js';
import { SESSION_MAX_AGE_MS } from '../../src/utils/sessionPolicy.js';
import {
  periodKeysDays,
  periodKeysWeeks,
  periodKeysMonths,
  fillCountSeries,
  fillLoginSeries,
  startOfUtcDay,
} from './adminStatsPeriods.js';

export {
  utcDayKey,
  isoWeekKey,
  utcMonthKey,
  startOfUtcDay,
  periodKeysDays,
  periodKeysWeeks,
  periodKeysMonths,
  fillCountSeries,
  fillLoginSeries,
} from './adminStatsPeriods.js';

const DAY_MS = 24 * 60 * 60 * 1000;

function mapFromAggregation(rows, valueField = 'count') {
  const map = new Map();
  for (const row of rows) {
    map.set(row._id, row[valueField] ?? 0);
  }
  return map;
}

async function signupCountsSince(since, dateFormat) {
  const rows = await User.aggregate([
    { $match: { createdAt: { $gte: since } } },
    {
      $group: {
        _id: {
          $dateToString: { format: dateFormat, date: '$createdAt', timezone: 'UTC' },
        },
        count: { $sum: 1 },
      },
    },
  ]);
  return mapFromAggregation(rows);
}

async function loginCountsSince(since, dateFormat) {
  const rows = await LoginEvent.aggregate([
    { $match: { at: { $gte: since } } },
    {
      $group: {
        _id: {
          period: {
            $dateToString: { format: dateFormat, date: '$at', timezone: 'UTC' },
          },
          userId: '$userId',
        },
        logins: { $sum: 1 },
      },
    },
    {
      $group: {
        _id: '$_id.period',
        logins: { $sum: '$logins' },
        distinctUsers: { $sum: 1 },
      },
    },
  ]);
  const loginMap = new Map();
  const distinctMap = new Map();
  for (const row of rows) {
    loginMap.set(row._id, row.logins);
    distinctMap.set(row._id, row.distinctUsers);
  }
  return { loginMap, distinctMap };
}

/**
 * @param {Date} [now]
 */
export async function fetchAdminStats(now = new Date()) {
  const dayKeys = periodKeysDays(30, now);
  const weekKeys = periodKeysWeeks(12, now);
  const monthKeys = periodKeysMonths(12, now);

  const dayStart = new Date(`${dayKeys[0]}T00:00:00.000Z`);
  const weekStart = new Date(startOfUtcDay(now).getTime() - (12 - 1) * 7 * DAY_MS);
  const monthStart = new Date(`${monthKeys[0]}-01T00:00:00.000Z`);

  const [
    signupDayMap,
    signupWeekMap,
    signupMonthMap,
    loginDay,
    loginWeek,
    loginMonth,
    totalUsers,
    activeSignedInUsers,
  ] = await Promise.all([
    signupCountsSince(dayStart, '%Y-%m-%d'),
    signupCountsSince(weekStart, '%G-W%V'),
    signupCountsSince(monthStart, '%Y-%m'),
    loginCountsSince(dayStart, '%Y-%m-%d'),
    loginCountsSince(weekStart, '%G-W%V'),
    loginCountsSince(monthStart, '%Y-%m'),
    User.countDocuments(),
    User.countDocuments({
      lastLoginAt: { $gte: new Date(now.getTime() - SESSION_MAX_AGE_MS) },
    }),
  ]);

  return {
    generatedAt: now.toISOString(),
    totalUsers,
    activeSignedInUsers,
    signups: {
      perDay: fillCountSeries(dayKeys, signupDayMap),
      perWeek: fillCountSeries(weekKeys, signupWeekMap),
      perMonth: fillCountSeries(monthKeys, signupMonthMap),
    },
    logins: {
      perDay: fillLoginSeries(dayKeys, loginDay.loginMap, loginDay.distinctMap),
      perWeek: fillLoginSeries(weekKeys, loginWeek.loginMap, loginWeek.distinctMap),
      perMonth: fillLoginSeries(monthKeys, loginMonth.loginMap, loginMonth.distinctMap),
    },
  };
}

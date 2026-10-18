// services/adminStats.js — daily operator counts from MongoDB (no PostHog, no PII)
import User from '../db/models/User.js';
import LoginEvent from '../db/models/LoginEvent.js';
import Quote from '../db/models/Quote.js';
import Order from '../db/models/Order.js';
import PartnerLead from '../db/models/PartnerLead.js';
import {
  periodKeysDays,
  fillDateCountSeries,
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
  fillDateCountSeries,
} from './adminStatsPeriods.js';

export const ADMIN_STATS_DAY_WINDOWS = Object.freeze([7, 30, 120]);

/**
 * @param {unknown} raw
 * @returns {7 | 30 | 120 | null}
 */
export function parseAdminStatsDays(raw) {
  if (raw == null) return null;
  const text = String(raw).trim();
  if (!/^(7|30|120)$/.test(text)) return null;
  return Number(text);
}

function mapFromAggregation(rows, valueField = 'count') {
  const map = new Map();
  for (const row of rows) {
    map.set(row._id, row[valueField] ?? 0);
  }
  return map;
}

function sumCounts(series) {
  return series.reduce((total, row) => total + (row.count || 0), 0);
}

async function countByUtcDay(model, dateField, since) {
  if (!model?.aggregate) return new Map();
  const rows = await model.aggregate([
    { $match: { [dateField]: { $gte: since } } },
    {
      $group: {
        _id: {
          $dateToString: { format: '%Y-%m-%d', date: `$${dateField}`, timezone: 'UTC' },
        },
        count: { $sum: 1 },
      },
    },
  ]);
  return mapFromAggregation(rows);
}

async function loginCountsSince(model, since) {
  if (!model?.aggregate) return { loginMap: new Map(), distinctMap: new Map() };
  const rows = await model.aggregate([
    { $match: { at: { $gte: since } } },
    {
      $group: {
        _id: {
          period: {
            $dateToString: { format: '%Y-%m-%d', date: '$at', timezone: 'UTC' },
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

async function distinctLoginUsersSince(model, since) {
  if (!model?.aggregate) return 0;
  const rows = await model.aggregate([
    { $match: { at: { $gte: since } } },
    { $group: { _id: '$userId' } },
    { $count: 'n' },
  ]);
  return rows[0]?.n ?? 0;
}

/**
 * Daily buckets for a 7 / 30 / 120 day UTC window. Counts only collections
 * the app actually stores (users, login_events, quotes, orders, partners).
 * Assemblies/parts live in GitHub; STEP conversions are files on disk — omitted.
 *
 * @param {{
 *   days: 7 | 30 | 120,
 *   now?: Date,
 *   models?: {
 *     User?: { aggregate: Function },
 *     LoginEvent?: { aggregate: Function },
 *     Quote?: { aggregate: Function },
 *     Order?: { aggregate: Function },
 *     PartnerLead?: { aggregate: Function },
 *   },
 * }} opts
 */
export async function fetchAdminStats({
  days,
  now = new Date(),
  models = {},
} = {}) {
  const windowDays = parseAdminStatsDays(days);
  if (windowDays == null) {
    throw new Error('days must be 7, 30, or 120');
  }

  const UserModel = models.User ?? User;
  const LoginEventModel = models.LoginEvent ?? LoginEvent;
  const QuoteModel = models.Quote ?? Quote;
  const OrderModel = models.Order ?? Order;
  const PartnerLeadModel = models.PartnerLead ?? PartnerLead;

  const keys = periodKeysDays(windowDays, now);
  const since = new Date(`${keys[0]}T00:00:00.000Z`);

  const [
    signupMap,
    loginDay,
    quoteMap,
    orderMap,
    partnerMap,
    activeUsers,
  ] = await Promise.all([
    countByUtcDay(UserModel, 'createdAt', since),
    loginCountsSince(LoginEventModel, since),
    countByUtcDay(QuoteModel, 'quotedAt', since),
    countByUtcDay(OrderModel, 'created-at', since),
    countByUtcDay(PartnerLeadModel, 'createdAt', since),
    distinctLoginUsersSince(LoginEventModel, since),
  ]);

  const signups = fillDateCountSeries(keys, signupMap);
  const logins = fillDateCountSeries(keys, loginDay.loginMap);
  const activeUsersSeries = fillDateCountSeries(keys, loginDay.distinctMap);
  const quotes = fillDateCountSeries(keys, quoteMap);
  const orders = fillDateCountSeries(keys, orderMap);
  const partnerSubmissions = fillDateCountSeries(keys, partnerMap);

  return {
    days: windowDays,
    generatedAt: now.toISOString(),
    totals: {
      signups: sumCounts(signups),
      logins: sumCounts(logins),
      activeUsers,
      quotes: sumCounts(quotes),
      orders: sumCounts(orders),
      partnerSubmissions: sumCounts(partnerSubmissions),
    },
    series: {
      signups,
      logins,
      activeUsers: activeUsersSeries,
      quotes,
      orders,
      partnerSubmissions,
    },
  };
}

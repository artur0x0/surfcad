/**
 * Monitoring slice A — period helpers and admin gate.
 * Run via root `node --test` (CI).
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  utcDayKey,
  isoWeekKey,
  utcMonthKey,
  periodKeysDays,
  periodKeysWeeks,
  periodKeysMonths,
  fillCountSeries,
  fillDateCountSeries,
  fillLoginSeries,
} from '../backend/services/adminStatsPeriods.js';
import { parseAdminGithubLogins, isAdmin } from '../backend/services/adminAllowlist.js';
import {
  parseAdminStatsDays,
  fetchAdminStats,
} from '../backend/services/adminStats.js';
import { parseArgs } from '../backend/scripts/statsArgs.js';

describe('adminStats period helpers', () => {
  const now = new Date('2026-10-17T15:30:00.000Z');

  test('day and month keys are UTC', () => {
    assert.equal(utcDayKey(now), '2026-10-17');
    assert.equal(utcMonthKey(now), '2026-10');
  });

  test('periodKeysDays returns consecutive UTC days ending today', () => {
    const keys = periodKeysDays(3, now);
    assert.deepEqual(keys, ['2026-10-15', '2026-10-16', '2026-10-17']);
  });

  test('periodKeysMonths returns trailing calendar months', () => {
    const keys = periodKeysMonths(3, now);
    assert.deepEqual(keys, ['2026-08', '2026-09', '2026-10']);
  });

  test('fillCountSeries zero-fills missing buckets', () => {
    const keys = ['2026-10-15', '2026-10-16'];
    const map = new Map([['2026-10-16', 2]]);
    assert.deepEqual(fillCountSeries(keys, map), [
      { period: '2026-10-15', count: 0 },
      { period: '2026-10-16', count: 2 },
    ]);
  });

  test('fillDateCountSeries zero-fills missing days', () => {
    const keys = ['2026-10-15', '2026-10-16'];
    const map = new Map([['2026-10-16', 2]]);
    assert.deepEqual(fillDateCountSeries(keys, map), [
      { date: '2026-10-15', count: 0 },
      { date: '2026-10-16', count: 2 },
    ]);
  });

  test('fillLoginSeries includes distinct users', () => {
    const keys = ['2026-W41'];
    const logins = new Map([['2026-W41', 5]]);
    const distinct = new Map([['2026-W41', 3]]);
    assert.deepEqual(fillLoginSeries(keys, logins, distinct), [
      { period: '2026-W41', logins: 5, distinctUsers: 3 },
    ]);
  });

  test('isoWeekKey matches a known ISO week', () => {
    assert.equal(isoWeekKey(new Date('2026-01-01T12:00:00.000Z')), '2026-W01');
    const weeks = periodKeysWeeks(2, new Date('2026-10-17T00:00:00.000Z'));
    assert.equal(weeks.length, 2);
    assert.match(weeks[1], /^\d{4}-W\d{2}$/);
  });
});

describe('isAdmin GitHub login allowlist', () => {
  test('parseAdminGithubLogins trims, lowercases, and drops empties', () => {
    const logins = parseAdminGithubLogins(' OctoCat , ,ArtUr ');
    assert.deepEqual([...logins], ['octocat', 'artur']);
  });

  test('empty env means no admins', () => {
    assert.equal(parseAdminGithubLogins('').size, 0);
    assert.equal(parseAdminGithubLogins(undefined).size, 0);
    assert.equal(isAdmin({ githubLogin: 'octo' }, new Set()), false);
  });

  test('isAdmin matches githubLogin case-insensitively', () => {
    const allow = parseAdminGithubLogins('Octo');
    assert.equal(isAdmin({ githubLogin: 'octo' }, allow), true);
    assert.equal(isAdmin({ githubLogin: 'OCTO' }, allow), true);
    assert.equal(isAdmin({ githubLogin: 'other' }, allow), false);
    assert.equal(isAdmin({ githubLogin: '' }, allow), false);
    assert.equal(isAdmin({ _id: 'user-1' }, allow), false);
    assert.equal(isAdmin(null, allow), false);
  });
});

describe('parseAdminStatsDays', () => {
  test('accepts 7, 30, and 120 only', () => {
    assert.equal(parseAdminStatsDays('7'), 7);
    assert.equal(parseAdminStatsDays('30'), 30);
    assert.equal(parseAdminStatsDays('120'), 120);
    assert.equal(parseAdminStatsDays(7), 7);
  });

  test('rejects anything else', () => {
    assert.equal(parseAdminStatsDays(undefined), null);
    assert.equal(parseAdminStatsDays(''), null);
    assert.equal(parseAdminStatsDays('14'), null);
    assert.equal(parseAdminStatsDays('07'), null);
    assert.equal(parseAdminStatsDays('7d'), null);
  });
});

describe('fetchAdminStats buckets', () => {
  const now = new Date('2026-10-18T12:00:00.000Z');

  function countModel(rows) {
    return { aggregate: async () => rows };
  }

  test('zero-fills days and sums totals without PII fields', async () => {
    const stats = await fetchAdminStats({
      days: 7,
      now,
      models: {
        User: countModel([{ _id: '2026-10-18', count: 2 }]),
        LoginEvent: {
          aggregate: async (pipeline) => {
            if (pipeline.some((stage) => stage.$count === 'n')) return [{ n: 3 }];
            return [
              { _id: '2026-10-17', logins: 4, distinctUsers: 2 },
              { _id: '2026-10-18', logins: 1, distinctUsers: 1 },
            ];
          },
        },
        Quote: countModel([{ _id: '2026-10-16', count: 1 }]),
        Order: countModel([]),
        PartnerLead: countModel([{ _id: '2026-10-12', count: 5 }]),
      },
    });

    assert.equal(stats.days, 7);
    assert.equal(stats.series.signups.length, 7);
    assert.deepEqual(stats.series.signups.map((row) => row.date), [
      '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15',
      '2026-10-16', '2026-10-17', '2026-10-18',
    ]);
    assert.equal(stats.series.signups[0].count, 0);
    assert.equal(stats.series.signups[6].count, 2);
    assert.equal(stats.totals.signups, 2);
    assert.equal(stats.totals.logins, 5);
    assert.equal(stats.totals.activeUsers, 3);
    assert.equal(stats.totals.quotes, 1);
    assert.equal(stats.totals.orders, 0);
    assert.equal(stats.totals.partnerSubmissions, 5);
    assert.equal(stats.series.partnerSubmissions[0].count, 5);

    const keys = collectKeys(stats);
    for (const forbidden of [
      'email', 'emails', 'address', 'addresses', 'name', 'firstName', 'lastName',
      'phone', 'street', 'userId', 'githubLogin', 'guest-email', 'ip', 'userAgent',
    ]) {
      assert.equal(keys.has(forbidden), false, forbidden);
    }
  });
});

function collectKeys(value, keys = new Set()) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectKeys(item, keys));
    return keys;
  }
  if (value && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      keys.add(key);
      collectKeys(nested, keys);
    }
  }
  return keys;
}

describe('stats.js CLI', () => {
  test('parseArgs defaults to json and 30 days', () => {
    const opts = parseArgs(['node', 'stats.js']);
    assert.equal(opts.format, 'json');
    assert.equal(opts.days, 30);
  });

  test('parseArgs accepts table format and days', () => {
    const opts = parseArgs(['node', 'stats.js', '--format', 'table', '--days', '7']);
    assert.equal(opts.format, 'table');
    assert.equal(opts.days, 7);
  });
});

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
  fillLoginSeries,
} from '../backend/services/adminStatsPeriods.js';
import { parseAdminUserIds, isUserInAdminAllowlist } from '../backend/services/adminAllowlist.js';
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

describe('requireAdmin allowlist', () => {
  test('parseAdminUserIds trims and drops empties', () => {
    const ids = parseAdminUserIds(' aaa , ,bbb ');
    assert.deepEqual([...ids], ['aaa', 'bbb']);
  });

  test('isUserInAdminAllowlist checks the allow set', () => {
    const allow = new Set(['user-1']);
    assert.equal(isUserInAdminAllowlist({ _id: 'user-1' }, allow), true);
    assert.equal(isUserInAdminAllowlist({ _id: 'user-2' }, allow), false);
    assert.equal(isUserInAdminAllowlist({ _id: 'user-1' }, new Set()), false);
  });
});

describe('stats.js CLI', () => {
  test('parseArgs defaults to json', () => {
    const opts = parseArgs(['node', 'stats.js']);
    assert.equal(opts.format, 'json');
  });

  test('parseArgs accepts table format', () => {
    const opts = parseArgs(['node', 'stats.js', '--format', 'table']);
    assert.equal(opts.format, 'table');
  });
});

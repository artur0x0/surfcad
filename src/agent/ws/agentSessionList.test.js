import test from 'node:test';
import assert from 'node:assert/strict';
import { formatAgentLastUsed, visibleAgentTokens } from './agentSessionList.js';

test('last used is a stable stamp and revoked rows are hidden', () => {
  assert.equal(formatAgentLastUsed(null), 'Not used yet');
  assert.equal(formatAgentLastUsed('2026-10-31T13:05:00.000Z'), '2026-10-31 13:05 UTC');
  const rows = visibleAgentTokens([
    { id: 'a', label: 'Cursor on laptop', machine: 'laptop', city: 'Lisbon', lastUsedAt: null, revokedAt: null },
    { id: 'b', label: 'Old', machine: 'phone', city: null, lastUsedAt: null, revokedAt: '2026-01-01T00:00:00.000Z' },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].city, 'Lisbon');
  assert.equal(rows[0].machine, 'laptop');
});

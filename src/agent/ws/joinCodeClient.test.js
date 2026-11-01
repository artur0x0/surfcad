import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clearStoredJoin,
  JOIN_CODE_STORAGE_KEY,
  loadStoredJoin,
  resumeJoinAction,
  saveStoredJoin,
} from './joinCodeClient.js';
import { serverJoinLoginCommand, serverJoinPrompt } from './pairingPrompt.js';

/**
 * @param {Record<string, string>} [seed]
 */
function memoryStorage(seed = {}) {
  const data = { ...seed };
  return {
    getItem(key) { return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null; },
    setItem(key, value) { data[key] = String(value); },
    removeItem(key) { delete data[key]; },
    dump() { return data; },
  };
}

const PENDING = {
  id: 'join-1',
  code: 'ABCD-EFGH',
  expiresAt: '2026-10-31T23:00:00.000Z',
};

test('the join code screen copies the full login command', () => {
  const prod = serverJoinPrompt({ protocol: 'https:', host: 'surfcad.com' }, 'ABCD-EFGH');
  assert.equal(
    serverJoinLoginCommand({ protocol: 'https:', host: 'surfcad.com' }, 'ABCD-EFGH'),
    'npx -y surfcad-mcp login --code ABCD-EFGH',
  );
  assert.match(prod, /npx -y surfcad-mcp login --code ABCD-EFGH/);
  assert.doesNotMatch(prod, /--server/);
  assert.doesNotMatch(prod, /Enter the device code/);
  assert.doesNotMatch(prod, /\bEdge\b/);
  const www = serverJoinLoginCommand({ protocol: 'https:', host: 'www.surfcad.com' }, 'WXYZ-2345');
  assert.equal(www, 'npx -y surfcad-mcp login --server https://www.surfcad.com --code WXYZ-2345');
  const loopback = serverJoinLoginCommand({ protocol: 'http:', host: '127.0.0.1:5173' }, 'ABCD-EFGH');
  assert.equal(loopback, 'npx -y surfcad-mcp login --server http://127.0.0.1:5173 --code ABCD-EFGH');
  assert.doesNotMatch(serverJoinPrompt({ protocol: 'http:', host: '127.0.0.1:5173' }, 'ABCD-EFGH'), /machine serving this page/);
  const staging = { protocol: 'http:', host: '100.106.101.1:5173' };
  assert.equal(
    serverJoinLoginCommand(staging, 'ABCD-EFGH'),
    'npx -y surfcad-mcp login --server http://localhost:5173 --code ABCD-EFGH',
  );
  const prompt = serverJoinPrompt(staging, 'ABCD-EFGH');
  assert.match(prompt, /--code ABCD-EFGH/);
  assert.match(prompt, /machine serving this page/);
  assert.doesNotMatch(prompt, /100\.106\.101\.1:5173/);
});

test('a reload restores a still-pending join code', () => {
  const storage = memoryStorage();
  saveStoredJoin(storage, PENDING);
  const stored = loadStoredJoin(storage);
  assert.deepEqual(stored, PENDING);
  assert.equal(storage.dump()[JOIN_CODE_STORAGE_KEY].includes('hash'), false);
  const action = resumeJoinAction({
    stored,
    httpStatus: 200,
    body: { status: 'pending', id: PENDING.id, expiresAt: PENDING.expiresAt },
    now: Date.parse('2026-10-31T22:50:00.000Z'),
  });
  assert.equal(action, 'restore');
});

test('an expired join code is cleared after reload', () => {
  const storage = memoryStorage();
  saveStoredJoin(storage, PENDING);
  const stored = loadStoredJoin(storage);
  assert.equal(resumeJoinAction({
    stored,
    httpStatus: 200,
    body: { status: 'expired', id: PENDING.id },
    now: Date.parse('2026-10-31T22:50:00.000Z'),
  }), 'clear');
  assert.equal(resumeJoinAction({
    stored,
    httpStatus: 200,
    body: { status: 'pending', id: PENDING.id, expiresAt: PENDING.expiresAt },
    now: Date.parse('2026-10-31T23:00:00.000Z'),
  }), 'clear');
  clearStoredJoin(storage);
  assert.equal(loadStoredJoin(storage), null);
});

test('a used join code is cleared after reload', () => {
  const storage = memoryStorage();
  saveStoredJoin(storage, PENDING);
  const stored = loadStoredJoin(storage);
  assert.equal(resumeJoinAction({
    stored,
    httpStatus: 200,
    body: { status: 'used', id: PENDING.id },
    now: Date.parse('2026-10-31T22:50:00.000Z'),
  }), 'clear');
  assert.equal(resumeJoinAction({
    stored,
    httpStatus: 401,
    body: null,
    now: Date.parse('2026-10-31T22:50:00.000Z'),
  }), 'clear');
  assert.equal(resumeJoinAction({
    stored,
    httpStatus: 200,
    body: { status: 'pending', id: 'other-join', expiresAt: PENDING.expiresAt },
    now: Date.parse('2026-10-31T22:50:00.000Z'),
  }), 'clear');
});

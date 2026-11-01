/**
 * Remote stdio exit diagnostics. Lines go to stderr. A token, a bearer,
 * and a join code must not appear.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createRemoteExitHandlers,
  formatProcessExitLine,
  handleRemoteStdinEnd,
  installRemoteProcessExitLogs,
  logProcessExit,
} from '../src/remote/processExit.mjs';

test('process exit lines name the cause and stay on stderr without secrets', () => {
  const token = 'raw-token-value-raw-token-value-raw1';
  /** @type {{ fd: number, line: string }[]} */
  const writes = [];
  logProcessExit('stdin end', undefined, (fd, line) => writes.push({ fd, line }));
  logProcessExit(
    'uncaughtException',
    `boom ${token} Bearer ${token} ABCD-EFGH`,
    (fd, line) => writes.push({ fd, line }),
  );
  assert.equal(writes[0].fd, 2);
  assert.match(writes[0].line, /\[surfcad-mcp\] process exit: stdin end/);
  assert.equal(writes[0].line.endsWith('\n'), true);
  assert.match(writes[1].line, /process exit: uncaughtException/);
  assert.match(writes[1].line, /boom/);
  assert.equal(writes[1].line.includes(token), false);
  assert.equal(writes[1].line.includes('ABCD-EFGH'), false);
  assert.equal(writes[1].line.includes('Bearer'), false);
  assert.equal(writes[1].fd, 2);
});

test('stdin end logs, disconnects, then exits 0', () => {
  /** @type {string[]} */
  const calls = [];
  handleRemoteStdinEnd(
    { disconnect() { calls.push('disconnect'); } },
    {
      log: (cause) => calls.push(cause),
      exit: (code) => calls.push(`exit ${code}`),
    },
  );
  assert.deepEqual(calls, ['stdin end', 'disconnect', 'exit 0']);
});

test('signal and uncaught handlers name the cause', () => {
  const token = 'raw-token-value-raw-token-value-raw1';
  /** @type {string[]} */
  const lines = [];
  /** @type {{ pid: number, signal: NodeJS.Signals }[]} */
  const kills = [];
  /** @type {number[]} */
  const exits = [];
  const handlers = createRemoteExitHandlers({
    log: (cause, detail) => lines.push(formatProcessExitLine(cause, detail)),
    kill: (pid, signal) => kills.push({ pid, signal }),
    exit: (code) => exits.push(code),
  });
  handlers.onSignal('SIGTERM');
  handlers.onSignal('SIGINT');
  handlers.onUncaught(new Error(`boom ${token} ABCD-EFGH`));
  assert.match(lines[0], /process exit: SIGTERM/);
  assert.match(lines[1], /process exit: SIGINT/);
  assert.match(lines[2], /process exit: uncaughtException boom/);
  assert.equal(lines.join('').includes(token), false);
  assert.equal(lines.join('').includes('ABCD-EFGH'), false);
  assert.deepEqual(kills, [
    { pid: process.pid, signal: 'SIGTERM' },
    { pid: process.pid, signal: 'SIGINT' },
  ]);
  assert.deepEqual(exits, [1]);
});

test('installed signal listeners log and re-raise', () => {
  /** @type {string[]} */
  const lines = [];
  /** @type {{ pid: number, signal: NodeJS.Signals }[]} */
  const kills = [];
  const uninstall = installRemoteProcessExitLogs({
    log: (cause) => lines.push(cause),
    kill: (pid, signal) => kills.push({ pid, signal }),
    exit: () => {
      throw new Error('uncaught handler should not run');
    },
  });
  try {
    process.emit('SIGTERM');
    process.emit('SIGINT');
    assert.deepEqual(lines, ['SIGTERM', 'SIGINT']);
    assert.deepEqual(kills, [
      { pid: process.pid, signal: 'SIGTERM' },
      { pid: process.pid, signal: 'SIGINT' },
    ]);
  } finally {
    uninstall();
  }
});

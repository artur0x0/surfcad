/**
 * Login CLI failures: unknown commands, bad flags, rate limits, and a
 * code that expires before anyone approves it.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { runCli } from '../src/cli.mjs';
import { loginDevice, loginWithCode } from '../src/remote/login.mjs';

const bin = join(import.meta.dirname, '..', 'bin', 'surfcad-mcp.js');

/**
 * @param {string[]} args
 */
function spawnCli(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bin, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('exit', (code) => resolve({ code, stdout, stderr }));
  });
}

/**
 * @param {number} status
 * @param {object} json
 */
function jsonResponse(status, json) {
  return {
    status,
    json: async () => json,
  };
}

test('an unknown command prints an error and usage, then exits non-zero', async () => {
  const outcome = await spawnCli(['nope']);
  assert.equal(outcome.code, 1);
  assert.equal(outcome.stdout, '');
  assert.match(outcome.stderr, /Unknown argument: nope/);
  assert.match(outcome.stderr, /npx surfcad-mcp login/);
  assert.match(outcome.stderr, /--code CODE/);
});

test('a bad flag on login prints an error and usage, then exits non-zero', async () => {
  const remote = await spawnCli(['login', '--remote']);
  assert.equal(remote.code, 1);
  assert.equal(remote.stdout, '');
  assert.match(remote.stderr, /do not take --remote or --local/);
  assert.match(remote.stderr, /npx surfcad-mcp login/);
  const flag = [];
  const outcome = await runCli(['login', '--server'], {
    io: { stdout: () => {}, stderr: (text) => flag.push(text) },
  });
  assert.equal(outcome.code, 1);
  assert.match(flag.join(''), /--server needs a value/);
  assert.match(flag.join(''), /npx surfcad-mcp login/);
});

test('cleartext login still refuses a non-loopback server', async () => {
  const stderr = [];
  const outcome = await runCli(['login', '--server', 'http://100.106.101.1:5173'], {
    io: { stdout: () => {}, stderr: (text) => stderr.push(text) },
  });
  assert.equal(outcome.code, 1);
  assert.match(stderr.join(''), /Cleartext is only allowed for localhost, 127\.0\.0\.1, and ::1/);
  assert.match(stderr.join(''), /npx surfcad-mcp login/);
  assert.doesNotMatch(stderr.join(''), /Logged in/);
});

test('a 429 names the server retry wait', async () => {
  const home = await mkdtemp(join(tmpdir(), 'surfcad-login-'));
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  try {
    const device = [];
    const started = await runCli(['login', '--server', 'http://127.0.0.1:9'], {
      env,
      fetch: async () => jsonResponse(429, { error: 'rate_limited', retryAfterSec: 7 }),
      io: { stdout: () => {}, stderr: (text) => device.push(text) },
    });
    assert.equal(started.code, 1);
    assert.match(device.join(''), /Too many login attempts\./);
    assert.match(device.join(''), /try again in 7 s/);
    const coded = [];
    const redeemed = await runCli(
      ['login', '--code', 'ABCD-EFGH', '--server', 'http://127.0.0.1:9'],
      {
        env,
        fetch: async () => jsonResponse(429, { error: 'rate_limited', retryAfterSec: 12 }),
        io: { stdout: () => {}, stderr: (text) => coded.push(text) },
      },
    );
    assert.equal(redeemed.code, 1);
    assert.match(coded.join(''), /try again in 12 s/);
    assert.match(coded.join(''), /login --code/);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('a login that is never approved ends when the code expires', async () => {
  const home = await mkdtemp(join(tmpdir(), 'surfcad-login-'));
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  const expiresAt = new Date(Date.now() + 80).toISOString();
  let polls = 0;
  const fetchImpl = async (url, init) => {
    if (String(url).endsWith('/agent/pair')) {
      return jsonResponse(201, {
        userCode: 'ABCD-EFGH',
        interval: 30,
        expiresAt,
      });
    }
    polls += 1;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, 30_000);
      const abort = () => {
        clearTimeout(timer);
        const err = new Error('aborted');
        err.name = 'AbortError';
        reject(err);
      };
      if (init?.signal?.aborted) abort();
      else init?.signal?.addEventListener('abort', abort, { once: true });
    });
    return jsonResponse(200, { status: 'pending' });
  };
  const stderr = [];
  const started = Date.now();
  try {
    const outcome = await runCli(['login', '--server', 'http://127.0.0.1:9'], {
      env,
      fetch: fetchImpl,
      io: {
        stdout: () => {},
        stderr: (text) => stderr.push(text),
      },
    });
    assert.equal(outcome.code, 1);
    assert.match(stderr.join(''), /That login code is stale/);
    assert.match(stderr.join(''), /npx surfcad-mcp login again/);
    assert.ok(Date.now() - started < 2000, 'hung poll must not outlive the code');
    assert.ok(polls >= 1);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('loginDevice and loginWithCode surface retryAfterSec on their own', async () => {
  await assert.rejects(
    () => loginDevice({
      serverUrl: 'http://127.0.0.1:9',
      fetch: async () => jsonResponse(429, { error: 'rate_limited', retryAfterSec: 3 }),
    }),
    (err) => {
      assert.equal(err.code, 'rate_limited');
      assert.match(err.message, /try again in 3 s/);
      return true;
    },
  );
  await assert.rejects(
    () => loginWithCode({
      serverUrl: 'http://127.0.0.1:9',
      code: 'ABCD-EFGH',
      fetch: async () => jsonResponse(429, { error: 'rate_limited', retryAfterSec: 9 }),
    }),
    (err) => {
      assert.match(err.message, /try again in 9 s/);
      return true;
    },
  );
});

/**
 * Remote surfcad-mcp client against the in-process server relay.
 * Nothing in here contacts surfcad.com. Logs and stdout must not contain
 * the device secret or the bearer token.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import express from 'express';
import { commandResponse } from '../src/commandProtocol.mjs';
import { runCli } from '../src/cli.mjs';
import { configDir, normalizeServer, resolveAgentName, selectRelayMode, tokenPath } from '../src/remote/config.mjs';
import { loginStatusError } from '../src/remote/login.mjs';
import { agentHelloFrame, RemoteSession } from '../src/remote/session.mjs';
import { createAgentRelay } from '../../../backend/agent/createRelay.js';
import { attachAgentWebSocket } from '../../../backend/agent/wsServer.js';

/** @type {import('node:http').Server[]} */
const servers = [];
/** @type {RemoteSession[]} */
const sessions = [];
/** @type {string[]} */
const dirs = [];

afterEach(async () => {
  for (const session of sessions.splice(0)) {
    try { session.disconnect(); } catch { /* already closed */ }
  }
  while (servers.length) {
    const server = servers.pop();
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
  while (dirs.length) {
    await rm(dirs.pop(), { recursive: true, force: true });
  }
});

async function tempEnv() {
  const dir = await mkdtemp(join(tmpdir(), 'surfcad-mcp-remote-'));
  dirs.push(dir);
  return { SURFCAD_MCP_CONFIG_DIR: dir };
}

/**
 * @param {ReturnType<typeof createAgentRelay>} relay
 * @param {{ upgrade?: 'attach' | 'reject', failSse?: boolean }} [options]
 */
async function listen(relay, options = {}) {
  const hits = { events: 0, poll: 0, post: 0 };
  /** @type {Array<() => void>} */
  const followUpWaiters = [];
  const noteFollowUp = () => {
    if (hits.events < 1 || hits.poll < 1) return;
    for (const wake of followUpWaiters.splice(0)) wake();
  };
  /**
   * Resolves when the SSE GET and the long-poll GET have both reached this
   * server. The POST can deliver the command before either GET is registered,
   * so tests wait on this instead of sampling the counters.
   */
  function followUps() {
    if (hits.events >= 1 && hits.poll >= 1) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(
          `SSE and long-poll were not both registered (events=${hits.events}, poll=${hits.poll})`,
        ));
      }, 2000);
      followUpWaiters.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    const path = req.originalUrl || req.url || '';
    if (req.method === 'GET' && path.includes('/events')) {
      hits.events += 1;
      noteFollowUp();
      if (options.failSse) return res.status(500).end();
    } else if (req.method === 'GET' && path.startsWith('/agent/commands/')) {
      hits.poll += 1;
      noteFollowUp();
    } else if (req.method === 'POST' && path.startsWith('/agent/commands')) {
      hits.post += 1;
    }
    return next();
  });
  app.use('/agent', relay.router);
  const server = http.createServer(app);
  if (options.upgrade === 'reject') {
    server.on('upgrade', (_req, socket) => {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      socket.destroy();
    });
  } else {
    attachAgentWebSocket(server, relay, {
      authenticateUpgrade: async (req) => {
        const id = req.headers['x-test-user'];
        return typeof id === 'string' ? { id } : null;
      },
    });
  }
  servers.push(server);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = /** @type {import('node:net').AddressInfo} */ (server.address()).port;
  return { origin: `http://127.0.0.1:${port}`, hits, followUps };
}

/**
 * @param {ReturnType<typeof createAgentRelay>} relay
 * @param {string} userId
 * @param {(frame: { id?: string | number, command: string }, finish: () => void) => void} [hold]
 */
function answerTab(relay, userId, hold) {
  relay.registry.registerTab({
    userId,
    tabId: 'tab-a',
    send(frame) {
      const finish = () => {
        relay.registry.complete(userId, frame.id, commandResponse({
          id: frame.id,
          ok: true,
          result: { command: frame.command },
        }));
      };
      if (hold) hold(frame, finish);
      else finish();
    },
  });
}

/**
 * @param {string} origin
 * @param {ReturnType<typeof createAgentRelay>} relay
 * @param {(userCode: string) => Promise<void> | void} decide
 */
function fetching(decide) {
  /** @type {string[]} */
  const secrets = [];
  /** @type {typeof fetch} */
  const fetchImpl = async (url, init) => {
    if (init?.body && String(url).endsWith('/pair/poll')) {
      const parsed = JSON.parse(String(init.body));
      if (typeof parsed.deviceSecret === 'string') secrets.push(parsed.deviceSecret);
    }
    const res = await fetch(url, init);
    if (init?.method === 'POST' && String(url).endsWith('/agent/pair') && !String(url).endsWith('/pair/poll')) {
      const sent = JSON.parse(String(init.body || '{}'));
      assert.equal(sent.deviceSecret, undefined);
      assert.match(String(sent.deviceSecretHash), /^[0-9a-f]{64}$/);
      const json = await res.clone().json();
      assert.equal(json.deviceSecret, undefined);
      if (typeof json.userCode === 'string') await decide(json.userCode);
    }
    return res;
  };
  return { fetchImpl, secrets };
}

function assertHidden(text, secrets) {
  for (const secret of secrets) {
    assert.ok(secret.length > 8, 'secret should be high entropy');
    assert.equal(text.includes(secret), false);
  }
}

test('name, address, and relay selection', () => {
  assert.equal(resolveAgentName({ name: 'Desk', clientInfo: { name: 'claude-code' }, env: {} }), 'Desk');
  assert.equal(resolveAgentName({ clientInfo: { name: 'claude-code' }, env: { SURFCAD_AGENT_NAME: 'FromEnv' } }), 'FromEnv');
  assert.equal(resolveAgentName({ savedName: 'Saved', clientInfo: { name: 'claude-code' }, env: {} }), 'Saved');
  assert.equal(resolveAgentName({ clientInfo: { name: 'claude-code' }, env: {} }), 'claude-code');
  assert.equal(resolveAgentName({ env: {} }), '');
  assert.deepEqual(agentHelloFrame({ name: 'claude-code' }), { type: 'hello', v: 1, name: 'claude-code' });
  assert.deepEqual(agentHelloFrame({}), { type: 'hello', v: 1 });
  assert.equal(configDir({ SURFCAD_MCP_CONFIG_DIR: '/tmp/custom' }), '/tmp/custom');
  assert.equal(configDir({ XDG_CONFIG_HOME: '/tmp/xdg', HOME: '/tmp/home' }), '/tmp/xdg/surfcad-mcp');
  assert.equal(configDir({ HOME: '/tmp/home' }), join('/tmp/home', '.config', 'surfcad-mcp'));
  assert.deepEqual(selectRelayMode({ env: {} }), { ok: true, mode: 'local' });
  assert.deepEqual(selectRelayMode({ loggedIn: true, env: {} }), { ok: true, mode: 'remote' });
  assert.deepEqual(selectRelayMode({ loggedIn: true, local: true, env: {} }), { ok: true, mode: 'local' });
  assert.deepEqual(selectRelayMode({ remote: true, env: { SURFCAD_PAIRING_CODE: 'ABCDEF' } }), { ok: true, mode: 'remote' });
  assert.deepEqual(
    selectRelayMode({ loggedIn: true, env: { SURFCAD_AGENT_BRIDGE_WS_URL: 'ws://127.0.0.1:9' } }),
    { ok: true, mode: 'local' },
  );
  assert.equal(selectRelayMode({ remote: true, local: true, env: {} }).ok, false);
  assert.match(loginStatusError('denied'), /denied/);
  assert.match(loginStatusError('expired'), /login again/);
});

test('cleartext server URLs are only allowed on loopback', () => {
  assert.equal(normalizeServer('http://127.0.0.1:9'), 'http://127.0.0.1:9');
  assert.equal(normalizeServer('ws://localhost:9/agent'), 'http://localhost:9');
  assert.equal(normalizeServer('http://[::1]:9'), 'http://[::1]:9');
  assert.equal(normalizeServer('ws://[::1]/agent'), 'http://[::1]');
  assert.equal(normalizeServer('https://staging.example/agent'), 'https://staging.example');
  assert.equal(normalizeServer('wss://surfcad.com'), 'https://surfcad.com');
  for (const input of ['http://staging.example', 'ws://example.com/agent', 'http://127.0.0.2:9']) {
    assert.throws(() => normalizeServer(input), (err) => {
      assert.equal(err.code, 'bad_server');
      assert.match(err.message, /Cleartext is only allowed for localhost, 127\.0\.0\.1, and ::1/);
      assert.match(err.message, /https/);
      return true;
    });
  }
});

test('login stores a 0600 token, status and logout omit it, and logs never contain it', async () => {
  const env = await tempEnv();
  const relay = createAgentRelay();
  const { origin } = await listen(relay);
  const { fetchImpl, secrets } = fetching(async (userCode) => {
    const approved = await relay.pairing.approve({ userCode, userId: 'user-a' });
    assert.equal(approved.ok, true);
    assert.match(userCode, /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/);
  });
  /** @type {string[]} */
  const stdout = [];
  /** @type {string[]} */
  const stderr = [];
  /** @type {string[]} */
  const consoleLines = [];
  const origErr = console.error;
  const origLog = console.log;
  console.error = (...args) => { consoleLines.push(args.map(String).join(' ')); };
  console.log = (...args) => { consoleLines.push(args.map(String).join(' ')); };
  try {
    const outcome = await runCli(['login', '--name', 'Cursor', '--server', origin], {
      env,
      fetch: fetchImpl,
      machine: 'laptop',
      io: {
        stdout: (text) => stdout.push(text),
        stderr: (text) => stderr.push(text),
      },
    });
    assert.equal(outcome.action, 'exit');
    assert.equal(outcome.code, 0);
  } finally {
    console.error = origErr;
    console.log = origLog;
  }
  const printed = stdout.join('');
  assert.match(printed, /Code: [ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}/);
  assert.match(printed, new RegExp(`Approve at: ${origin}/agent`));
  assert.match(printed, /Logged in/);
  assert.equal(stderr.join(''), '');
  const file = await stat(tokenPath(env));
  assert.equal(file.mode & 0o777, 0o600);
  const directory = await stat(configDir(env));
  assert.equal(directory.mode & 0o777, 0o700);
  const { readSavedLogin } = await import('../src/remote/tokenStore.mjs');
  const saved = await readSavedLogin(env);
  assert.ok(saved?.token);
  assert.equal(saved.name, 'Cursor');
  assert.equal(saved.machine, 'laptop');
  assert.equal(saved.server, origin);
  secrets.push(saved.token);
  assertHidden(`${printed}\n${stderr.join('')}\n${consoleLines.join('\n')}`, secrets);

  const statusOut = [];
  await runCli(['status'], {
    env,
    io: { stdout: (text) => statusOut.push(text), stderr: () => {} },
  });
  const status = statusOut.join('');
  assert.match(status, /logged in/);
  assert.match(status, /Cursor/);
  assert.match(status, new RegExp(origin.replace(/[.]/g, '\\.')));
  assert.equal(status.includes(saved.token), false);

  const serve = await runCli([], { env });
  assert.equal(serve.action, 'serve');
  assert.equal(serve.mode, 'remote');
  const forced = await runCli(['--local'], { env });
  assert.equal(forced.mode, 'local');
  const paired = await runCli([], { env: { ...env, SURFCAD_PAIRING_CODE: 'ABCDEF' } });
  assert.equal(paired.mode, 'local');

  const logoutOut = [];
  await runCli(['logout'], {
    env,
    io: { stdout: (text) => logoutOut.push(text), stderr: () => {} },
  });
  assert.equal(logoutOut.join(''), 'Logged out.\n');
  assert.equal(logoutOut.join('').includes(saved.token), false);
  assert.equal(await relay.tokens.authenticate(saved.token), null);
  assert.equal(await readSavedLogin(env), null);
  const missing = [];
  await runCli(['--remote'], {
    env,
    io: { stdout: () => {}, stderr: (text) => missing.push(text) },
  });
  assert.match(missing.join(''), /npx surfcad-mcp login/);
});

test('logout still deletes the file when the server cannot be reached', async () => {
  const env = await tempEnv();
  const relay = createAgentRelay();
  const { origin } = await listen(relay);
  const issued = await relay.tokens.issue({ userId: 'user-a', label: 'laptop' });
  const { saveLogin, readSavedLogin } = await import('../src/remote/tokenStore.mjs');
  await saveLogin({
    token: issued.token,
    server: origin,
    name: 'Cursor',
    machine: 'laptop',
  }, env);
  const stdout = [];
  const outcome = await runCli(['logout'], {
    env,
    fetch: async () => {
      throw new Error('down');
    },
    io: { stdout: (text) => stdout.push(text), stderr: () => {} },
  });
  assert.equal(outcome.code, 0);
  const printed = stdout.join('');
  assert.match(printed, /may stay valid until it expires/);
  assert.equal(printed.includes(issued.token), false);
  assert.equal(await readSavedLogin(env), null);
  assert.ok(await relay.tokens.authenticate(issued.token));
});

test('a denied login does not write a token', async () => {
  const env = await tempEnv();
  const relay = createAgentRelay();
  const { origin } = await listen(relay);
  const { fetchImpl, secrets } = fetching((userCode) => {
    const denied = relay.pairing.deny({ userCode, userId: 'user-a' });
    assert.equal(denied.ok, true);
  });
  const stderr = [];
  const outcome = await runCli(['login', '--server', origin], {
    env,
    fetch: fetchImpl,
    machine: 'laptop',
    io: { stdout: () => {}, stderr: (text) => stderr.push(text) },
  });
  assert.equal(outcome.code, 1);
  assert.match(stderr.join(''), /denied/);
  assertHidden(stderr.join(''), secrets);
  const { readSavedLogin } = await import('../src/remote/tokenStore.mjs');
  assert.equal(await readSavedLogin(env), null);
});

test('websocket command, prompt, old client, and revoked token', async () => {
  const relay = createAgentRelay();
  const { origin } = await listen(relay);
  const issued = await relay.tokens.issue({ userId: 'user-a', label: 'Cursor on laptop' });
  answerTab(relay, 'user-a');
  /** @type {string[]} */
  const logs = [];
  const session = new RemoteSession({
    serverUrl: origin,
    token: issued.token,
    name: 'Cursor',
    onLog: (line) => logs.push(line),
  });
  sessions.push(session);
  const result = await session.call('list_faces', {});
  assert.deepEqual(result, { command: 'list_faces' });
  assert.equal(session.status().transport, 'ws');
  const paired = await session.pair('IGNORED');
  assert.equal(paired.remote, true);
  assert.equal(JSON.stringify(paired).includes(issued.token), false);

  const promptId = randomUUID();
  relay.registry.forwardToAgents('user-a', {
    type: 'agent.prompt',
    v: 1,
    id: promptId,
    text: 'draw a box',
  });
  const started = Date.now();
  let text = '';
  while (!text && Date.now() - started < 1000) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    text = session.prompts.readMessages().messages[0]?.text || '';
  }
  assert.equal(text, 'draw a box');
  assert.equal(logs.join('\n').includes(issued.token), false);

  const old = new RemoteSession({
    serverUrl: origin,
    token: issued.token,
    protocolVersion: 0,
    onLog: (line) => logs.push(line),
  });
  sessions.push(old);
  await assert.rejects(old.connect(), (err) => {
    assert.equal(err.code, 'client_update_required');
    assert.equal(err.message, 'please update surfcad-mcp');
    return true;
  });

  const auth = await relay.tokens.authenticate(issued.token);
  assert.ok(auth);
  await relay.tokens.revoke(auth.userId, auth.id);
  await assert.rejects(session.call('status', {}), (err) => {
    assert.equal(err.code, 'token_revoked');
    assert.match(err.message, /npx surfcad-mcp login/);
    return true;
  });
  assert.equal(logs.join('\n').includes(issued.token), false);
});

test('set_status on a websocket session reports the connected state', async () => {
  const relay = createAgentRelay();
  const { origin } = await listen(relay);
  const issued = await relay.tokens.issue({ userId: 'user-a', label: 'status-ws' });
  /** @type {object[]} */
  const seen = [];
  answerTab(relay, 'user-a', (frame, finish) => {
    seen.push(frame);
    finish();
  });
  const session = new RemoteSession({
    serverUrl: origin,
    token: issued.token,
    onLog: () => {},
  });
  sessions.push(session);
  const status = await session.prompts.setStatus({ state: 'building' });
  assert.deepEqual(status, { working: true, state: 'working' });
  assert.equal(session.status().state, 'paired');
  assert.equal(session.status().transport, 'ws');
  const started = Date.now();
  let frame = seen.find((row) => row.type === 'agent.status');
  while (!frame && Date.now() - started < 1000) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    frame = seen.find((row) => row.type === 'agent.status');
  }
  assert.ok(frame, 'tab received agent.status');
  assert.equal(frame.state, 'working');
  assert.equal(frame.working, true);
});

test('set_status on the HTTPS fallback reports the connected state', async () => {
  const relay = createAgentRelay();
  const { origin } = await listen(relay, { upgrade: 'reject' });
  const issued = await relay.tokens.issue({ userId: 'user-a', label: 'status-http' });
  /** @type {object[]} */
  const seen = [];
  answerTab(relay, 'user-a', (frame, finish) => {
    seen.push(frame);
    finish();
  });
  const session = new RemoteSession({
    serverUrl: origin,
    token: issued.token,
    onLog: () => {},
  });
  sessions.push(session);
  const status = await session.prompts.setStatus({ state: 'building' });
  assert.deepEqual(status, { working: true, state: 'working' });
  assert.equal(session.status().transport, 'http');
  assert.equal(session.status().state, 'paired');
  const frame = seen.find((row) => row.type === 'agent.status');
  assert.ok(frame, 'tab received agent.status over HTTPS');
  assert.equal(frame.state, 'working');
  assert.equal(frame.working, true);
});

test('blocked websocket falls back to HTTPS POST and SSE', async () => {
  const relay = createAgentRelay({ asleepMs: 200 });
  const { origin, hits } = await listen(relay, { upgrade: 'reject' });
  const issued = await relay.tokens.issue({ userId: 'user-a', label: 'fallback' });
  answerTab(relay, 'user-a');
  /** @type {string[]} */
  const logs = [];
  const session = new RemoteSession({
    serverUrl: origin,
    token: issued.token,
    onLog: (line) => logs.push(line),
  });
  sessions.push(session);
  const result = await session.call('parts', {});
  assert.deepEqual(result, { command: 'parts' });
  assert.equal(session.status().transport, 'http');
  assert.ok(hits.events >= 1);
  assert.equal(hits.poll, 0);
  assert.match(logs.join('\n'), /https fallback/);
  assert.equal(logs.join('\n').includes(issued.token), false);
});

test('SSE failure uses long-poll, and asleep and too_many_pending stay clear', async () => {
  const relay = createAgentRelay({ asleepMs: 200, maxPending: 1 });
  const { origin, hits, followUps } = await listen(relay, { upgrade: 'reject', failSse: true });
  const issued = await relay.tokens.issue({ userId: 'user-a', label: 'poll' });
  let release = () => {};
  const gate = new Promise((resolve) => { release = resolve; });
  let saw = false;
  answerTab(relay, 'user-a', (_frame, finish) => {
    saw = true;
    gate.then(finish);
  });
  const session = new RemoteSession({ serverUrl: origin, token: issued.token, onLog: () => {} });
  sessions.push(session);
  const first = session.call('status', {});
  // The POST delivers the command before the client opens SSE, then long-poll.
  // Wait until both GETs have reached the server, then assert.
  await followUps();
  assert.equal(saw, true);
  assert.ok(hits.events >= 1);
  assert.ok(hits.poll >= 1);
  await assert.rejects(session.call('parts', {}), (err) => {
    assert.equal(err.code, 'too_many_pending');
    assert.equal(err.message, 'Too many commands are waiting');
    return true;
  });
  release();
  assert.deepEqual(await first, { command: 'status' });

  session.disconnect();
  const asleepRelay = createAgentRelay({ asleepMs: 150 });
  const asleep = await listen(asleepRelay, { upgrade: 'reject' });
  const asleepToken = await asleepRelay.tokens.issue({ userId: 'user-b', label: 'asleep' });
  const sleeper = new RemoteSession({
    serverUrl: asleep.origin,
    token: asleepToken.token,
    onLog: () => {},
  });
  sessions.push(sleeper);
  await assert.rejects(sleeper.call('status', {}), (err) => {
    assert.equal(err.code, 'tab_asleep');
    assert.equal(err.message, 'SurfCAD tab is asleep');
    return true;
  });
});

test('a websocket command times out the same way as the https wait', async () => {
  const relay = createAgentRelay();
  const { origin } = await listen(relay);
  const issued = await relay.tokens.issue({ userId: 'user-a', label: 'ws-timeout' });
  answerTab(relay, 'user-a', () => {});
  const session = new RemoteSession({
    serverUrl: origin,
    token: issued.token,
    commandTimeoutMs: 40,
    onLog: () => {},
  });
  sessions.push(session);
  const started = Date.now();
  await assert.rejects(session.call('status', {}), (err) => {
    assert.equal(err.code, 'bridge_error');
    assert.equal(err.message, 'Timed out waiting for the SurfCAD tab.');
    assert.equal(err.retryable, true);
    return true;
  });
  assert.ok(Date.now() - started < 2000);
});

test('login --code redeems a join code, stores the token, and does not print it', async () => {
  const env = await tempEnv();
  const relay = createAgentRelay();
  const created = relay.joinCodes.create({ userId: 'user-a' });
  assert.equal(created.ok, true);
  const { origin } = await listen(relay);
  const stdout = [];
  const stderr = [];
  const cleartext = await runCli(
    ['login', '--code', created.code, '--server', 'http://192.0.2.10:9'],
    { env, io: { stdout: (text) => stdout.push(text), stderr: (text) => stderr.push(text) } },
  );
  assert.equal(cleartext.code, 1);
  assert.match(stderr.join(''), /Cleartext is only allowed/);
  assert.equal(stdout.join('').includes(created.code), false);
  assert.equal(stderr.join('').includes(created.code), false);
  stdout.length = 0;
  stderr.length = 0;
  const outcome = await runCli(
    ['login', '--code', created.code, '--name', 'Cursor', '--server', origin],
    {
      env,
      machine: 'laptop',
      io: { stdout: (text) => stdout.push(text), stderr: (text) => stderr.push(text) },
    },
  );
  assert.equal(outcome.code, 0);
  const printed = stdout.join('');
  assert.match(printed, /Logged in/);
  assert.equal(stderr.join(''), '');
  const { readSavedLogin } = await import('../src/remote/tokenStore.mjs');
  const saved = await readSavedLogin(env);
  assert.ok(saved?.token);
  assert.equal(printed.includes(saved.token), false);
  assert.equal(saved.name, 'Cursor');
  assert.equal(saved.machine, 'laptop');
  assert.equal(saved.server, origin);
  const listed = await relay.tokens.list('user-a');
  assert.equal(listed.length, 1);
  assert.equal(listed[0].machine, 'laptop');
  const again = [];
  const reused = await runCli(
    ['login', '--code', created.code, '--server', origin],
    { env, io: { stdout: () => {}, stderr: (text) => again.push(text) } },
  );
  assert.equal(reused.code, 1);
  assert.match(again.join(''), /not valid/);
  assert.equal(again.join('').includes(created.code), false);
  assert.equal(again.join('').includes(saved.token), false);
});

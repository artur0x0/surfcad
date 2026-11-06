/**
 * Pair → greeting, through the real binary over stdio.
 *
 * The host provides its wake in the MCP server's environment. The user pairs
 * once and pastes nothing. The server fires the wake with reason "greet";
 * the session that wake starts says hello in the SurfCAD chat. Here the wake
 * is a command that records what it was given, and the same MCP client
 * stands in for the session it would start.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { startAgentBridgeRelay, stopAgentBridgeRelay } from '../src/bridge/relayServer.mjs';
import { WAKE_GREETING } from '../src/listen/wake.mjs';
import { PAIR_MSG } from '../src/relayMessages.mjs';
import { createPairingToken } from '../../../src/agent/ws/pairingToken.js';

const SERVER_BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin/surfcad-mcp.js');

const texts = (out) => (out?.content || []).filter((block) => block.type === 'text').map((block) => block.text || '');

async function waitFor(check, what, timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const found = check();
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`timed out waiting for ${what}`);
}

async function session(env) {
  const relay = await startAgentBridgeRelay({ port: 0, onLog() {} });
  const token = createPairingToken(6);
  const tab = new WebSocket(relay.url);
  const inbound = [];
  await new Promise((resolve, reject) => { tab.once('open', resolve); tab.once('error', reject); });
  tab.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(String(raw)); } catch { return; }
    inbound.push(msg);
    if (msg && msg.command === 'status') {
      tab.send(JSON.stringify({ id: msg.id, ok: true, result: { volume: 1, runState: 'ok' } }));
    }
  });
  tab.send(JSON.stringify({ type: PAIR_MSG.REGISTER_TAB, token }));
  let stderr = '';
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER_BIN],
    env: {
      ...process.env,
      SURFCAD_MCP_START_RELAY: '0',
      SURFCAD_AGENT_BRIDGE_WS_URL: relay.url,
      SURFCAD_PAIRING_CODE: '',
      NODE_ENV: 'test',
      ...env,
    },
    stderr: 'pipe',
  });
  transport.stderr?.on('data', (chunk) => { stderr += String(chunk); });
  const client = new Client({ name: 'some-host', version: '0.0.0' });
  await client.connect(transport);
  const pair = async () => {
    const before = inbound.length;
    const pending = client.callTool({ name: 'pair', arguments: { code: token } });
    // The first pair asks the tab; a later one is already paired.
    const asked = await Promise.race([
      waitFor(() => inbound.slice(before).find((msg) => msg.type === PAIR_MSG.PAIR_REQUEST), 'the pair request', 1500).catch(() => null),
      pending.then(() => null),
    ]);
    if (asked) tab.send(JSON.stringify({ type: PAIR_MSG.PAIR_APPROVE }));
    return pending;
  };
  return {
    client,
    inbound,
    pair,
    stderr: () => stderr,
    async close() {
      await client.close().catch(() => {});
      tab.close();
      await stopAgentBridgeRelay(relay);
    },
  };
}

test('a host that provides a wake: one pair, no paste, the wake greets, and the greeting reaches the SurfCAD chat', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'surfcad-wake-e2e-'));
  const woken = join(dir, 'woken.jsonl');
  const s = await session({
    SURFCAD_MCP_CONFIG_DIR: dir,
    // On: a test run is otherwise never allowed to start a wake.
    SURFCAD_WAKE_BOOTSTRAP: '1',
    SURFCAD_WAKE_EXEC: `cat >> ${JSON.stringify(woken)}`,
  });
  try {
    const paired = await s.pair();
    assert.equal(paired.isError, false);
    const text = texts(paired).join('\n');
    assert.match(text, /Idle wake: ready \(exec\)\. This process fires it/);
    assert.match(text, /A new session of you was started to greet the user in the SurfCAD chat/);
    assert.match(text, /Do not greet again/);
    assert.doesNotMatch(text, /webhook URL and key/);
    assert.match(text, /"coldWake": "ready"/);
    assert.match(text, /"source": "env"/);

    // The wake fired once, with the greeting and what to do with it.
    await waitFor(() => existsSync(woken) && readFileSync(woken, 'utf8').trim(), 'the wake');
    const lines = readFileSync(woken, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    assert.equal(lines.length, 1);
    assert.equal(lines[0].type, 'surfcad.wake');
    assert.equal(lines[0].reason, 'greet');
    assert.equal(lines[0].greeting, WAKE_GREETING);
    assert.match(lines[0].instruction, /reply_to_user \{ text: "Hi, what can I help you design\?" \} with no in_reply_to/);

    // The session that wake starts follows the instruction: the greeting shows in the tab.
    const greeted = await s.client.callTool({ name: 'reply_to_user', arguments: { text: WAKE_GREETING } });
    assert.equal(greeted.isError, false, texts(greeted).join('\n'));
    const shown = await waitFor(() => s.inbound.find((msg) => msg.type === PAIR_MSG.AGENT_MESSAGE), 'the greeting in the tab');
    assert.equal(shown.text, WAKE_GREETING);

    // Status says the same, and neither it nor a second pair greets again.
    const status = JSON.parse(texts(await s.client.callTool({ name: 'status', arguments: {} }))[0]);
    assert.equal(status.wake.coldWake, 'ready');
    assert.deepEqual(status.wake.forms, ['exec']);
    assert.equal(status.wake.source, 'env');
    const again = await s.pair();
    assert.doesNotMatch(texts(again).join('\n'), /was started to greet/);
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(readFileSync(woken, 'utf8').trim().split('\n').length, 1, 'one greeting per login');
  } finally {
    await s.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a host that provides nothing: pair says cold wake is unavailable, asks for no webhook, and the pairing session greets', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'surfcad-wake-e2e-'));
  const s = await session({ SURFCAD_MCP_CONFIG_DIR: dir, SURFCAD_WAKE_BOOTSTRAP: '1' });
  try {
    const paired = await s.pair();
    const text = texts(paired).join('\n');
    assert.match(text, /Idle wake: unavailable on this host/);
    assert.match(text, /only while you are in a turn and long-polling read_messages \{ wait_ms: 10000 \}/);
    assert.match(text, /Do not ask the user for a webhook URL/);
    assert.match(text, /Greet the user now: reply_to_user \{ text: "Hi, what can I help you design\?" \} with no in_reply_to/);
    assert.doesNotMatch(text, /Idle wake: ready/);
    assert.doesNotMatch(text, /send me your webhook/);
    const status = JSON.parse(texts(await s.client.callTool({ name: 'status', arguments: {} }))[0]);
    assert.equal(status.wake.coldWake, 'unavailable');
    assert.deepEqual(status.wake.forms, []);
    assert.equal(status.wake.listenerRunning, false);
    // What the host calls itself, so wording can be keyed to it later.
    assert.deepEqual(status.host, { name: 'some-host', version: '0.0.0' });
    assert.match(text, /provide the wake yourself, now, in this turn, without asking the user/);
  } finally {
    await s.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

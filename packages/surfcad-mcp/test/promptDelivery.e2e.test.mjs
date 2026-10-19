/**
 * Stdio e2e the way Claude Code launches the server:
 * `claude mcp add surfcad -- npx surfcad-mcp` speaks MCP over stdio to this bin.
 * Does not run the claude CLI.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { startAgentBridgeRelay, stopAgentBridgeRelay } from '../src/bridge/relayServer.mjs';
import { PAIR_MSG } from '../src/relayMessages.mjs';
import { createPairingToken } from '../../../src/agent/ws/pairingToken.js';

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SERVER_BIN = join(PKG_ROOT, 'bin/surfcad-mcp.js');
const ASK = 'To get SurfCAD messages instantly, send me your webhook URL and key. This only needs to be done once. Otherwise I\'ll check for SurfCAD messages between steps, so replies may lag.';
const INSTRUCTIONS = 'call register_webhook { url, bearer? } if you can receive https webhooks, otherwise poll read_messages.';
const PROMPT_ID = '11111111-1111-4111-8111-111111111111';
const SECOND_ID = '22222222-2222-4222-8222-222222222222';
const CANCEL_ID = '33333333-3333-4333-8333-333333333333';

function waitOpen(ws) {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.OPEN) {
      resolve();
      return;
    }
    ws.once('open', resolve);
    ws.once('error', reject);
  });
}

function texts(out) {
  return (out?.content || []).filter((block) => block.type === 'text').map((block) => block.text || '');
}

function parseFirst(out) {
  return JSON.parse(texts(out)[0] || '{}');
}

async function waitFor(list, pred, timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const found = list.find(pred);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('timed out waiting for a relay frame');
}

test('stdio pair note, queued status, and bearer webhook POST', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'surfcad-stdio-hook-'));
  const keyPath = join(dir, 'key.pem');
  const certPath = join(dir, 'cert.pem');
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048',
    '-keyout', keyPath,
    '-out', certPath,
    '-days', '1',
    '-nodes',
    '-subj', '/CN=127.0.0.1',
    '-addext', 'subjectAltName=IP:127.0.0.1',
  ], { stdio: 'ignore' });

  const hits = [];
  const hook = https.createServer({
    key: readFileSync(keyPath),
    cert: readFileSync(certPath),
  }, (req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      hits.push({
        authorization: req.headers.authorization ?? null,
        path: req.url,
        body: JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'),
      });
      res.writeHead(204);
      res.end();
    });
  });

  const relay = await startAgentBridgeRelay({ port: 0, onLog() {} });
  const token = createPairingToken(6);
  const tab = new WebSocket(relay.url);
  const inbound = [];
  let client;
  let stderr = '';
  try {
    await new Promise((resolve) => hook.listen(0, '127.0.0.1', resolve));
    const hookPort = hook.address().port;
    const hookUrl = `https://127.0.0.1:${hookPort}/hook/s3cret-path`;

    await waitOpen(tab);
    tab.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      inbound.push(msg);
      if (msg && msg.command === 'status') {
        tab.send(JSON.stringify({
          id: msg.id,
          ok: true,
          result: { volume: 1, runState: 'not_run_yet' },
        }));
      }
    });
    tab.send(JSON.stringify({ type: PAIR_MSG.REGISTER_TAB, token }));

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [SERVER_BIN],
      env: {
        ...process.env,
        SURFCAD_MCP_START_RELAY: '0',
        SURFCAD_AGENT_BRIDGE_WS_URL: relay.url,
        SURFCAD_PAIRING_CODE: '',
        SURFCAD_WEBHOOK_TLS_INSECURE: '1',
        NODE_ENV: 'test',
      },
      stderr: 'pipe',
    });
    transport.stderr?.on('data', (chunk) => { stderr += String(chunk); });
    client = new Client({ name: 'claude-code-stdio', version: '0.0.0' });
    await client.connect(transport);

    assert.equal(client.getInstructions(), INSTRUCTIONS);

    const pairPromise = client.callTool({ name: 'pair', arguments: { code: token } });
    await waitFor(inbound, (msg) => msg.type === PAIR_MSG.PAIR_REQUEST);
    tab.send(JSON.stringify({ type: PAIR_MSG.PAIR_APPROVE }));
    const paired = await pairPromise;
    const pairedText = texts(paired).join('\n');
    assert.equal(paired.isError, false);
    assert.equal(paired.structuredContent, undefined);
    assert.ok((paired.content || []).every((block) => block.type === 'text'));
    assert.ok(pairedText.includes(ASK), pairedText.slice(0, 400));
    assert.match(pairedText, /key is the bearer argument/);
    assert.match(pairedText, /Save the URL and key in your own config or memory/);
    assert.match(pairedText, /call register_webhook again after every pair/);
    assert.match(pairedText, /If the user declines, poll read_messages/);
    assert.equal(parseFirst(paired).webhookRegistered, false);

    const fresh = await client.callTool({ name: 'status', arguments: {} });
    const freshBody = parseFirst(fresh);
    assert.equal(fresh.isError, false);
    assert.equal(freshBody.webhookRegistered, false);
    assert.equal(freshBody.queued, 0);
    assert.equal(freshBody.volume, 1);

    tab.send(JSON.stringify({
      type: PAIR_MSG.AGENT_PROMPT,
      v: 1,
      id: PROMPT_ID,
      text: 'from the page',
      ts: '2026-10-19T00:00:00.000Z',
    }));
    const ack = await waitFor(inbound, (msg) => msg.type === PAIR_MSG.AGENT_PROMPT_ACK && msg.id === PROMPT_ID);
    assert.equal(ack.delivery, 'queued');

    const queued = await client.callTool({ name: 'status', arguments: {} });
    const queuedBody = parseFirst(queued);
    assert.equal(queuedBody.webhookRegistered, false);
    assert.equal(queuedBody.queued, 1);
    assert.equal(texts(queued).join('\n').includes('test-bearer'), false);
    assert.equal(texts(queued).join('\n').includes('s3cret-path'), false);

    const read = await client.callTool({ name: 'read_messages', arguments: {} });
    const readText = texts(read).join('\n');
    assert.equal(read.isError, false);
    assert.match(readText, /from the page/);
    assert.match(readText, new RegExp(PROMPT_ID));

    const registered = await client.callTool({
      name: 'register_webhook',
      arguments: { url: hookUrl, bearer: 'test-bearer' },
    });
    const registeredText = texts(registered).join('\n');
    assert.equal(registered.isError, false);
    assert.equal(parseFirst(registered).registered, true);
    assert.equal(registeredText.includes('test-bearer'), false);
    assert.equal(registeredText.includes('s3cret-path'), false);
    assert.equal(registeredText.includes(hookUrl), false);

    const again = await client.callTool({ name: 'pair', arguments: { code: token } });
    const againText = texts(again).join('\n');
    assert.equal(again.isError, false);
    assert.match(againText, /Webhook is active/);
    assert.equal(againText.includes(ASK), false);
    assert.equal(parseFirst(again).webhookRegistered, true);
    assert.equal(againText.includes('test-bearer'), false);
    assert.equal(againText.includes('s3cret-path'), false);

    await new Promise((resolve) => setTimeout(resolve, 1100));
    tab.send(JSON.stringify({
      type: PAIR_MSG.AGENT_PROMPT,
      v: 1,
      id: SECOND_ID,
      text: 'posted prompt',
      ts: '2026-10-19T00:00:02.000Z',
    }));
    const postedAck = await waitFor(
      inbound,
      (msg) => msg.type === PAIR_MSG.AGENT_PROMPT_ACK && msg.id === SECOND_ID,
      8000,
    );
    assert.equal(postedAck.delivery, 'webhook');
    const deadline = Date.now() + 4000;
    while (hits.length === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    assert.equal(hits.length, 1);
    assert.equal(hits[0].authorization, 'Bearer test-bearer');
    assert.equal(hits[0].path, '/hook/s3cret-path');
    assert.equal(hits[0].body.text, 'posted prompt');
    assert.equal(JSON.stringify(hits[0].body).includes('test-bearer'), false);

    const after = await client.callTool({ name: 'status', arguments: {} });
    const afterBody = parseFirst(after);
    assert.equal(afterBody.webhookRegistered, true);
    assert.equal(afterBody.queued, 0);
    assert.equal(texts(after).join('\n').includes('test-bearer'), false);

    const empty = await client.callTool({ name: 'read_messages', arguments: {} });
    assert.equal(parseFirst(empty).messages.length, 0);

    const bad = await client.callTool({
      name: 'register_webhook',
      arguments: { url: 'https://8.8.8.8/hook', bearer: 'test-bearer\r\n' },
    });
    assert.equal(bad.isError, true);
    assert.equal(texts(bad).join('\n').includes('test-bearer'), false);

    await client.callTool({ name: 'unregister_webhook', arguments: {} });
    await new Promise((resolve) => setTimeout(resolve, 1100));
    tab.send(JSON.stringify({
      type: PAIR_MSG.AGENT_PROMPT,
      v: 1,
      id: CANCEL_ID,
      text: 'stop this one',
      ts: '2026-10-19T00:00:04.000Z',
    }));
    const cancelAck = await waitFor(inbound, (msg) => msg.type === PAIR_MSG.AGENT_PROMPT_ACK && msg.id === CANCEL_ID);
    assert.equal(cancelAck.delivery, 'queued');
    tab.send(JSON.stringify({ type: PAIR_MSG.AGENT_PROMPT_CANCEL, v: 1, id: CANCEL_ID }));
    const cancelResult = await waitFor(
      inbound,
      (msg) => msg.type === PAIR_MSG.AGENT_PROMPT_CANCEL_RESULT && msg.id === CANCEL_ID,
    );
    assert.equal(cancelResult.state, 'cancelled');
    assert.equal(cancelResult.v, 1);
    const cancelled = await client.callTool({ name: 'status', arguments: {} });
    const cancelledBody = parseFirst(cancelled);
    assert.equal(cancelled.isError, false);
    assert.equal(cancelledBody.queued, 0);
    assert.equal(cancelledBody.webhookRegistered, false);
    assert.deepEqual(cancelledBody.last, { id: CANCEL_ID, state: 'cancelled' });
    assert.equal(cancelledBody.counts.cancelled >= 1, true);
    assert.equal(texts(cancelled).join('\n').includes('test-bearer'), false);
    const afterCancel = await client.callTool({ name: 'read_messages', arguments: {} });
    const afterCancelText = texts(afterCancel).join('\n');
    assert.equal(afterCancelText.includes('stop this one'), false);
    assert.equal(afterCancelText.includes('"type": "cancel"'), false);
    const late = await client.callTool({
      name: 'reply_to_user',
      arguments: { in_reply_to: CANCEL_ID, text: 'too late', final: true },
    });
    assert.equal(late.isError, false);
    assert.deepEqual(parseFirst(late), { ok: false, error: 'cancelled' });
    assert.equal(inbound.some((msg) => msg.type === PAIR_MSG.AGENT_REPLY && msg.id === CANCEL_ID), false);

    assert.equal(stderr.includes('test-bearer'), false);
    assert.equal(stderr.includes('s3cret-path'), false);
  } finally {
    if (client) await client.close().catch(() => {});
    tab.close();
    await stopAgentBridgeRelay(relay);
    await new Promise((resolve) => hook.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

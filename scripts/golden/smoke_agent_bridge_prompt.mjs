#!/usr/bin/env node
/**
 * Agent bridge prompt plumbing, end to end.
 *
 * Production preview (`npm run build`, no playtest auto-approve) plus the
 * packaged surfcad-mcp process and its loopback relay. The page sends a
 * prompt with a screenshot through createAgentPromptTransport. With no
 * webhook, read_messages returns the text and an image content block.
 * reply_to_user reaches the page adapter. A read does not mark the agent
 * working; set_status building does, and the final reply goes idle.
 * A second prompt is POSTed to a local https server after register_webhook.
 * The self-signed certificate is accepted only because this test sets
 * SURFCAD_WEBHOOK_TLS_INSECURE=1 with NODE_ENV=test. Production ignores that flag.
 *
 * Chrome is the system binary (CHROME_PATH). Skip line matches the other
 * agent-bridge goldens: "no system Chrome found".
 */
/* global document, window, indexedDB, localStorage */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import https from 'node:https';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { chromium } from 'playwright-core';
import { PAIRING_TOKEN_LENGTH } from '../../src/agent/ws/pairingToken.js';
import { findChrome, startPreviewServer, waitForServer } from '../playtest/lib/harness.mjs';
import { pickFreePort } from '../playtest/lib/pickFreePort.mjs';
import { attachConsentPresetToBrowser } from './lib/presetConsentInit.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const SERVER_BIN = join(ROOT, 'packages/surfcad-mcp/bin/surfcad-mcp.js');
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PROMPT_TEXT = 'Describe the highlighted corner of this part.';
const REPLY_TEXT = 'The corner is a sharp 90 degree edge.';
const PART_ID = 'local:part1';
const ASSEMBLY_ID = 'asm-prompt-golden';

const ASSEMBLY = {
  format: 'surfcad.assembly',
  v: 1,
  name: 'agent-prompt',
  activeId: PART_ID,
  source: 'local',
  parts: [{ id: PART_ID, name: 'Part (1)', visible: true }],
  joints: [],
};

let failed = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed += 1;
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const exe = findChrome();
if (!exe) {
  console.log('agent bridge prompt: no system Chrome found — set CHROME_PATH. Skipping.');
  process.exit(0);
}

const previewPort = await pickFreePort();
const relayPort = await pickFreePort();
const appUrl = `http://127.0.0.1:${previewPort}/?agent=1&agentBridgeWs=ws://127.0.0.1:${relayPort}`;

const preview = startPreviewServer(previewPort);
process.on('exit', () => preview.stop());
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { preview.stop(); process.exit(1); });
}

let browser;
let client;
let httpsServer;
let certDir;

function toolTexts(out) {
  return (out?.content || []).filter((block) => block.type === 'text').map((block) => block.text || '');
}

function parseTool(out) {
  const text = toolTexts(out)[0];
  return text ? JSON.parse(text) : {};
}

async function mcp(name, args = {}) {
  return client.callTool({ name, arguments: args }, undefined, { timeout: 30_000 });
}

async function waitWatch(page, pred, timeoutMs = 10000) {
  const start = Date.now();
  let snap = null;
  while (Date.now() - start < timeoutMs) {
    snap = await page.evaluate(() => window.__promptWatch);
    if (pred(snap)) return snap;
    await new Promise((r) => setTimeout(r, 40));
  }
  return snap;
}

async function seedAssembly(page) {
  await page.evaluate(async ({ doc }) => {
    localStorage.setItem('surfcadAgent', '1');
    localStorage.setItem('surfcad.lastAssembly', JSON.stringify({
      'user-agent-prompt': {
        name: doc.name,
        activeId: doc.activeId,
        source: 'local',
        savedAt: Date.now(),
      },
    }));
    await new Promise((resolve, reject) => {
      const req = indexedDB.deleteDatabase('surfcad-assembly');
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
      req.onblocked = () => resolve();
    });
    await new Promise((resolve, reject) => {
      const req = indexedDB.open('surfcad-assembly', 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('assembly')) db.createObjectStore('assembly');
        if (!db.objectStoreNames.contains('parts')) db.createObjectStore('parts');
      };
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction(['assembly', 'parts'], 'readwrite');
        tx.objectStore('assembly').put(doc, 'current');
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
    });
  }, { doc: ASSEMBLY });
}

function startHookServer() {
  certDir = mkdtempSync(join(tmpdir(), 'surfcad-prompt-hook-'));
  const keyPath = join(certDir, 'key.pem');
  const certPath = join(certDir, 'cert.pem');
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048',
    '-keyout', keyPath,
    '-out', certPath,
    '-days', '1',
    '-nodes',
    '-subj', '/CN=127.0.0.1',
    '-addext', 'subjectAltName=IP:127.0.0.1',
  ], { stdio: 'ignore' });
  const posts = [];
  const server = https.createServer({
    key: readFileSync(keyPath),
    cert: readFileSync(certPath),
  }, (req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      let body = null;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { body = null; }
      posts.push({ path: req.url, body });
      res.writeHead(204);
      res.end();
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = addr && typeof addr === 'object' ? addr.port : 0;
      resolve({ server, posts, port });
    });
  });
}

console.log('agent bridge prompt golden');

try {
  if (!(await waitForServer(`http://127.0.0.1:${previewPort}/`))) {
    throw new Error('preview server did not start');
  }

  let serverStderr = '';
  const env = { ...process.env };
  delete env.SURFCAD_AGENT_BRIDGE_WS_VERBOSE;
  delete env.SURFCAD_MCP_START_RELAY;
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER_BIN],
    env: {
      ...env,
      SURFCAD_AGENT_BRIDGE_WS_PORT: String(relayPort),
      SURFCAD_AGENT_BRIDGE_WS_URL: `ws://127.0.0.1:${relayPort}`,
      SURFCAD_PAIRING_CODE: '',
      NODE_ENV: 'test',
      SURFCAD_WEBHOOK_TLS_INSECURE: '1',
    },
    stderr: 'pipe',
  });
  transport.stderr?.on('data', (chunk) => { serverStderr += String(chunk); });
  client = new Client({ name: 'agent-prompt-golden', version: '1.0.0' });
  await client.connect(transport);
  check(
    'server instructions nudge register_webhook or read_messages',
    // The webhook line comes first; the build guidance follows it (buildGuidance.e2e.test.mjs).
    String(client.getInstructions() || '').startsWith('call register_webhook { url, bearer? } if you can receive https webhooks, otherwise poll read_messages.'),
    String(client.getInstructions() || ''),
  );

  const relayUp = await (async () => {
    const start = Date.now();
    while (Date.now() - start < 20000) {
      try {
        const res = await fetch(`http://127.0.0.1:${relayPort}/bridge`);
        if (res.ok) return true;
      } catch { /* not yet */ }
      await new Promise((r) => setTimeout(r, 200));
    }
    return false;
  })();
  check('relay is up', relayUp);

  browser = await chromium.launch({
    executablePath: exe,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  attachConsentPresetToBrowser(browser);
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.route('**/api/auth/me', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      authenticated: true,
      user: { _id: 'user-agent-prompt', email: 'agent@test.local' },
    }),
  }));
  await page.route('**/api/config', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({}),
  }));

  await page.goto(`http://127.0.0.1:${previewPort}/`, { waitUntil: 'domcontentloaded' });
  await seedAssembly(page);
  await page.goto(appUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => typeof window.surfcad?.call === 'function' && !document.querySelector('[data-app-loading]'),
    { timeout: 120000 },
  );
  await page.waitForSelector('[data-cad-run]', { state: 'attached', timeout: 120000 });

  await page.locator('[data-profile-chip]').first().click();
  await page.click('[data-ui-action="data-agent-bridge-connect"]');
  await page.waitForSelector('[data-agent-bridge-waiting-relay]', { state: 'hidden', timeout: 15000 }).catch(() => {});
  await page.waitForSelector('[data-agent-bridge-code]', { state: 'visible', timeout: 15000 });
  const code = (await page.locator('[data-agent-bridge-code]').innerText()).trim();
  check('pairing code length', code.length === PAIRING_TOKEN_LENGTH, code);

  await page.waitForFunction(() => typeof window.surfcadAgentPrompt?.createTransport === 'function', { timeout: 10000 });
  await page.evaluate(() => {
    const transport = window.surfcadAgentPrompt.createTransport();
    window.__promptWatch = { acks: [], replies: [], working: [] };
    transport.onAck((event) => { window.__promptWatch.acks.push(event); });
    transport.onReply((event) => { window.__promptWatch.replies.push(event); });
    transport.onWorking((working) => { window.__promptWatch.working.push(working); });
    window.__promptSend = (text, opts) => transport.send(text, opts);
    window.__promptCancel = (id) => transport.cancel(id);
  });

  let pairSettled = false;
  const pairPromise = mcp('pair', { code }).finally(() => { pairSettled = true; });
  const approve = page.locator('[data-ui-action="data-agent-bridge-approve"]');
  await approve.waitFor({ state: 'visible', timeout: 20000 });
  check('nothing pairs before Allow', pairSettled === false);
  await approve.click();
  const paired = await pairPromise;
  check('MCP pair succeeds after Allow', paired.isError !== true, toolTexts(paired).join(' ').slice(0, 240));
  check(
    'pair onboarding note is text content',
    toolTexts(paired).join('\n').includes('To get SurfCAD messages instantly, send me your webhook URL and key. This only needs to be done once. Otherwise I\'ll check for SurfCAD messages between steps, so replies may lag.'),
  );
  await page.waitForFunction(
    () => window.surfcadAgentPrompt?.getBridge?.().getState?.() === 'paired',
    { timeout: 10000 },
  );
  await page.waitForSelector('[data-agent-prompt]', { timeout: 10000 });
  check('prompt card visible after pairing', await page.locator('[data-agent-prompt]').count() > 0);

  const promptId = await page.evaluate(({ text, png, partId, assemblyId }) => window.__promptSend(text, {
    context: { part_id: partId, assembly_id: assemblyId },
    screenshot: { mime: 'image/png', data: png, width: 1, height: 1 },
  }), { text: PROMPT_TEXT, png: PNG, partId: PART_ID, assemblyId: ASSEMBLY_ID });
  check('page minted a prompt id', typeof promptId === 'string' && promptId.length > 10, String(promptId));

  const queued = await waitWatch(page, (snap) => snap?.acks?.some((ack) => ack.id === promptId && ack.delivery === 'queued'));
  const queuedAck = queued?.acks?.find((ack) => ack.id === promptId);
  check('ack delivery queued', queuedAck?.delivery === 'queued' && queuedAck.error == null, JSON.stringify(queuedAck));

  const beforeRead = await mcp('status', {});
  const beforeBody = parseTool(beforeRead);
  check(
    'status shows 1 queued prompt and no webhook',
    beforeRead.isError !== true && beforeBody.queued === 1 && beforeBody.webhookRegistered === false,
    toolTexts(beforeRead).join(' ').slice(0, 240),
  );

  const read = await mcp('read_messages', {});
  const blocks = read.content || [];
  const image = blocks.find((block) => block.type === 'image');
  const messageText = toolTexts(read).join('\n');
  let message = {};
  try { message = JSON.parse(toolTexts(read)[0] || '{}'); } catch { message = {}; }
  check('read_messages is not an error', read.isError !== true, messageText.slice(0, 240));
  check('read_messages text is the prompt', message.text === PROMPT_TEXT && message.id === promptId, messageText.slice(0, 240));
  check('read_messages keeps context', message.context?.part_id === PART_ID && message.context?.assembly_id === ASSEMBLY_ID);
  check('read_messages image content', image?.mimeType === 'image/png' && image?.data === PNG, image ? image.mimeType : 'missing');
  check('screenshot bytes are not in the text block', !messageText.includes(PNG));
  await new Promise((r) => setTimeout(r, 400));
  const afterRead = await page.evaluate(() => window.__promptWatch);
  check('read_messages does not mark the agent working', afterRead?.working?.includes(true) !== true, JSON.stringify(afterRead?.working));

  const building = await mcp('set_status', { state: 'building', id: promptId });
  check('set_status building ok', building.isError !== true, toolTexts(building).join(' ').slice(0, 240));
  const built = await waitWatch(page, (snap) => snap?.working?.includes(true));
  check('building marks the agent working', built?.working?.includes(true) === true, JSON.stringify(built?.working));

  const reply = await mcp('reply_to_user', { in_reply_to: promptId, text: REPLY_TEXT, final: true });
  check('reply_to_user ok', reply.isError !== true, toolTexts(reply).join(' ').slice(0, 240));
  const afterReply = await waitWatch(
    page,
    (snap) => snap?.replies?.some((row) => row.id === promptId && row.final === true)
      && snap.working?.[snap.working.length - 1] === false,
  );
  const pageReply = afterReply?.replies?.find((row) => row.id === promptId);
  check('adapter received the reply', pageReply?.text === REPLY_TEXT && pageReply?.final === true, JSON.stringify(pageReply));
  check('status idle after the final reply', afterReply?.working?.[afterReply.working.length - 1] === false, JSON.stringify(afterReply?.working));
  const replyBody = page.locator('[data-agent-reply-body]');
  await replyBody.waitFor({ state: 'visible', timeout: 10000 });
  const shownReply = (await replyBody.innerText()).trim();
  check('prompt card shows the reply as text', shownReply.includes(REPLY_TEXT), shownReply.slice(0, 240));
  const replyChildElements = await replyBody.evaluate((el) => el.childElementCount);
  check('prompt card reply is plain text, not HTML', replyChildElements === 0, `children=${replyChildElements}`);
  const replyClass = await replyBody.getAttribute('class');
  check(
    'agent reply is a left-aligned bubble',
    (replyClass || '').includes('agent-prompt-msg--agent') && (replyClass || '').includes('surface-dark'),
    replyClass || '',
  );

  const hook = await startHookServer();
  httpsServer = hook.server;
  const hookUrl = `https://127.0.0.1:${hook.port}/hook`;
  await new Promise((r) => setTimeout(r, 1200));
  const registered = await mcp('register_webhook', { url: hookUrl });
  const registeredBody = parseTool(registered);
  check('register_webhook', registered.isError !== true && registeredBody.registered === true, toolTexts(registered).join(' ').slice(0, 240));
  check('register_webhook does not echo the URL', !toolTexts(registered).join('\n').includes(hookUrl));

  const secondText = 'Second prompt should be posted.';
  const secondId = await page.evaluate((text) => window.__promptSend(text, {
    context: { part_id: 'local:part1' },
  }), secondText);
  const postedAck = await waitWatch(
    page,
    (snap) => snap?.acks?.some((ack) => ack.id === secondId && (ack.delivery === 'webhook' || ack.delivery === 'failed' || ack.delivery === 'queued')),
    25000,
  );
  const secondAck = postedAck?.acks?.find((ack) => ack.id === secondId);
  check('ack delivery webhook', secondAck?.delivery === 'webhook', JSON.stringify(secondAck));

  const postDeadline = Date.now() + 5000;
  while (hook.posts.length === 0 && Date.now() < postDeadline) {
    await new Promise((r) => setTimeout(r, 50));
  }
  const post = hook.posts[0]?.body;
  check('webhook POST arrived', hook.posts.length === 1 && hook.posts[0].path === '/hook', `count=${hook.posts.length}`);
  check('webhook payload type', post?.type === 'surfcad.prompt' && post?.v === 1 && post?.id === secondId && post?.text === secondText, JSON.stringify(post && { type: post.type, v: post.v, id: post.id }));
  check('webhook payload context', post?.context?.part_id === PART_ID);
  check('webhook payload has no screenshot', post?.screenshot == null);

  const empty = await mcp('read_messages', {});
  const emptyBody = parseTool(empty);
  check('queue empty after webhook delivery', empty.isError !== true && Array.isArray(emptyBody.messages) && emptyBody.messages.length === 0, toolTexts(empty).join(' ').slice(0, 240));

  await new Promise((r) => setTimeout(r, 1200));
  const thirdText = 'Please stop.';
  const thirdId = await page.evaluate((text) => window.__promptSend(text), thirdText);
  const thirdAck = await waitWatch(
    page,
    (snap) => snap?.acks?.some((ack) => ack.id === thirdId && ack.delivery === 'webhook'),
    25000,
  );
  check(
    'third prompt acked before stop',
    thirdAck?.acks?.some((ack) => ack.id === thirdId && ack.delivery === 'webhook') === true,
    JSON.stringify(thirdAck?.acks?.filter((ack) => ack.id === thirdId)),
  );
  const cancelResult = await page.evaluate((id) => window.__promptCancel(id), thirdId);
  check(
    'page cancel resolves cancelled',
    cancelResult?.state === 'cancelled' && cancelResult?.id === thirdId,
    JSON.stringify(cancelResult),
  );
  const stopped = await mcp('status', {});
  const stoppedBody = parseTool(stopped);
  check(
    'status shows the prompt cancelled',
    stopped.isError !== true
      && stoppedBody.queued === 0
      && stoppedBody.last?.id === thirdId
      && stoppedBody.last?.state === 'cancelled',
    toolTexts(stopped).join(' ').slice(0, 400),
  );
  const cancelDeadline = Date.now() + 8000;
  let cancelPost = hook.posts.find((row) => row.body?.type === 'cancel');
  while (!cancelPost && Date.now() < cancelDeadline) {
    await new Promise((r) => setTimeout(r, 50));
    cancelPost = hook.posts.find((row) => row.body?.type === 'cancel');
  }
  check(
    'webhook cancel event',
    cancelPost?.body?.type === 'cancel' && cancelPost.body.id === thirdId,
    JSON.stringify(cancelPost?.body),
  );

  check('MCP stderr does not contain the prompt', !serverStderr.includes(PROMPT_TEXT) && !serverStderr.includes(secondText) && !serverStderr.includes(thirdText));
  check('MCP stderr does not contain the webhook URL', !serverStderr.includes(hookUrl));
} catch (err) {
  failed += 1;
  console.log(`  ❌ golden threw — ${err?.stack || err}`);
} finally {
  if (browser) await browser.close().catch(() => {});
  if (client) await client.close().catch(() => {});
  if (httpsServer) await new Promise((resolve) => httpsServer.close(resolve));
  if (certDir) rmSync(certDir, { recursive: true, force: true });
  preview.stop();
}

if (failed) {
  console.log(`agent bridge prompt: ${failed} failed`);
  process.exit(1);
}
console.log('agent bridge prompt: all checks passed');
process.exit(0);

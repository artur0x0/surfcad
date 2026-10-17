#!/usr/bin/env node
/**
 * Safari pairing via the loopback popup bridge, end to end.
 *
 * The production `dist/` is served as https://surfcad.com through Playwright
 * routing, with the CSP from `docs/nginx-snippets/surfcad-security.conf`, so
 * the page has the real origin and the real mixed-content rules. Nothing
 * leaves the machine: the only network peer is the loopback relay that the
 * packaged `surfcad-mcp` starts.
 *
 * Runs, when the browser is available:
 *   webkit          — Safari stand-in: Connect Agent opens the bridge window
 *                     before the relay runs (35 s of Waiting for the local
 *                     agent, code hidden, no give-up),
 *                     the window detects the relay and the code appears,
 *                     Allow, connected ring on, restart the relay
 *                     on the same port (still one window, pairing recovers),
 *                     create/edit/undo over MCP, close the window →
 *                     Disconnected (dialog re-opens), ring off → Reconnect,
 *                     ring on.
 *   chromium        — direct socket, no popup (path unchanged).
 *   chromium-popup  — popup path in Chromium (Safari desktop UA; the
 *                     `?agentBridgeTransport=` override is production-inert).
 * Each run also opens the bridge from an evil https origin and checks it
 * never connects.
 *
 * Env: CHROME_PATH (Chromium runs), PLAYWRIGHT_WEBKIT_EXECUTABLE_PATH
 * (optional), BRIDGE_E2E_RUNS=webkit,chromium,chromium-popup,
 * GOLDEN_SHOT_DIR (screenshots), GOLDEN_TRACE_DIR (Playwright trace per
 * browser run that had a failed check).
 *
 * Needs `npm run build` (production, no playtest auto-approve) and, for
 * WebKit, `npx playwright-core install --with-deps webkit`.
 */
/* global window, document */
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from 'playwright-core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { findChrome, installApiMocks, seedAssembly, waitForBridge } from '../playtest/lib/harness.mjs';
import { pickFreePort } from '../playtest/lib/pickFreePort.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const DIST = join(ROOT, 'dist');
const SERVER_BIN = join(ROOT, 'packages/surfcad-mcp/bin/surfcad-mcp.js');
const SHOT_DIR = process.env.GOLDEN_SHOT_DIR || join(tmpdir(), 'surfcad-bridge-e2e');
const PROD_ORIGIN = 'https://surfcad.com';
const EVIL_ORIGIN = 'https://evil.example';
const NGINX_SNIPPET = join(ROOT, 'docs/nginx-snippets/surfcad-security.conf');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
};

let failed = 0;
function check(label, ok, detail = '') {
  if (ok) {
    console.log(`  ✅ ${label}`);
  } else {
    failed += 1;
    console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`);
  }
  return ok;
}

/** Prod CSP from the nginx snippet, with the relay port swapped in. */
function prodCsp(relayPort) {
  const text = readFileSync(NGINX_SNIPPET, 'utf8');
  const m = text.match(/add_header Content-Security-Policy "([^"]+)"/);
  if (!m) throw new Error('CSP line not found in nginx snippet');
  return m[1].replace(/:17341\b/g, `:${relayPort}`);
}

function distFile(pathname) {
  const rel = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');
  const candidate = join(DIST, rel);
  if (candidate.startsWith(DIST) && existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  return join(DIST, 'index.html');
}

async function routeProdOrigin(context, relayPort) {
  const csp = prodCsp(relayPort);
  await context.route(`${PROD_ORIGIN}/**`, (route) => {
    const url = new URL(route.request().url());
    const file = distFile(url.pathname);
    const type = MIME[extname(file)] || 'application/octet-stream';
    const headers = {
      'content-type': type,
      'x-frame-options': 'SAMEORIGIN',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'strict-origin-when-cross-origin',
    };
    if (type.startsWith('text/html')) headers['content-security-policy'] = csp;
    return route.fulfill({ status: 200, headers, body: readFileSync(file) });
  });
  await context.route(`${EVIL_ORIGIN}/**`, (route) => route.fulfill({
    status: 200,
    contentType: 'text/html',
    body: '<!doctype html><title>evil</title><button id="go">go</button>',
  }));
}

function parseToolResult(out) {
  const text = out?.content?.[0]?.text;
  const parsed = text ? JSON.parse(text) : {};
  if (out?.isError) {
    throw Object.assign(new Error(parsed.message || parsed.code || 'tool error'), { code: parsed.code });
  }
  return parsed;
}

async function mcp(client, name, args = {}) {
  return parseToolResult(await client.callTool({ name, arguments: args }));
}

async function waitForRelay(port, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/bridge`);
      if (res.ok) return true;
    } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

async function startMcp(relayPort) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER_BIN],
    env: {
      ...process.env,
      SURFCAD_AGENT_BRIDGE_WS_PORT: String(relayPort),
      SURFCAD_AGENT_BRIDGE_WS_URL: `ws://127.0.0.1:${relayPort}`,
      SURFCAD_PAIRING_CODE: '',
    },
    stderr: 'pipe',
  });
  const client = new Client({ name: 'bridge-e2e', version: '1.0.0' });
  await client.connect(transport);
  return client;
}

const CONNECT = '[data-ui-action="data-agent-bridge-connect"]';
const RING = '[data-agent-bridge-connection-ring]';
/** Production ignores `?agentBridgeTransport=`; Chromium-popup uses this UA. */
const SAFARI_DESKTOP_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';

function liveBridgeWindows(context, mainPage) {
  return context.pages().filter((p) => p !== mainPage && !p.isClosed());
}

async function openProfile(page) {
  const chip = page.locator('[data-profile-chip]').first();
  if (await chip.count()) await chip.click();
  await page.waitForSelector(CONNECT, { state: 'visible', timeout: 15000 });
}

/** Click Connect Agent / Reconnect; returns the bridge popup if one opened. */
async function clickAndMaybePopup(page, selector, expectPopup) {
  if (!expectPopup) {
    let popped = null;
    const onPopup = (p) => { popped = p; };
    page.on('popup', onPopup);
    await page.click(selector);
    await page.waitForTimeout(1000);
    page.off('popup', onPopup);
    return popped;
  }
  const [popup] = await Promise.all([page.waitForEvent('popup', { timeout: 15000 }), page.click(selector)]);
  return popup;
}

async function pairWithAllow(page, client, code) {
  let settled = false;
  const pairPromise = client.callTool({ name: 'pair', arguments: { code } }).finally(() => { settled = true; });
  const approve = page.locator('[data-ui-action="data-agent-bridge-approve"]');
  await approve.waitFor({ state: 'visible', timeout: 20000 });
  await page.waitForTimeout(300);
  check('nothing pairs before Allow', settled === false);
  await approve.click();
  const out = await pairPromise;
  check('MCP pair succeeds after Allow', !out.isError, out.content?.[0]?.text);
  // The 5 s connected toast can still be up from an earlier Allow, so it is
  // not a durable paired signal. The profile ring is.
  await page.waitForSelector('[data-agent-bridge-connection-ring="connected"]', { timeout: 15000 });
}

async function evilOpenerCheck(context, relayPort) {
  const evil = await context.newPage();
  await evil.goto(`${EVIL_ORIGIN}/`);
  await evil.evaluate(() => {
    window.got = [];
    window.addEventListener('message', (e) => window.got.push([e.origin, e.data]));
  });
  const results = [];
  for (const claimed of [PROD_ORIGIN, EVIL_ORIGIN]) {
    const url = `http://127.0.0.1:${relayPort}/bridge?s=evil#nonce=evilevilevilevilevilevil0&origin=${encodeURIComponent(claimed)}`;
    await evil.evaluate((u) => {
      document.getElementById('go').onclick = () => { window.pop = window.open(u, '_blank', 'popup,width=400,height=300'); };
    }, url);
    const [popup] = await Promise.all([evil.waitForEvent('popup'), evil.click('#go')]);
    await popup.waitForLoadState('domcontentloaded');
    await evil.evaluate(() => {
      for (let i = 0; i < 5; i += 1) {
        const base = { channel: 'surfcad-agent-bridge', nonce: 'evilevilevilevilevilevil0' };
        window.pop.postMessage({ ...base, type: 'bridge_hello' }, '*');
        window.pop.postMessage({ ...base, type: 'bridge_frame', data: '{"type":"register_tab","token":"EVIL01"}' }, '*');
      }
    });
    await evil.waitForTimeout(1200);
    const status = await popup.evaluate(() => document.documentElement.dataset.status);
    results.push({ claimed, status });
    await popup.close();
  }
  const got = await evil.evaluate(() => window.got);
  check('evil opener claiming surfcad.com: bridge never connects', results[0].status === 'waiting', JSON.stringify(results[0]));
  check('evil opener with its own origin: bridge refuses', results[1].status === 'forbidden', JSON.stringify(results[1]));
  check('evil opener receives no bridge messages', got.length === 0, JSON.stringify(got));
  await evil.close();
}

async function runOne(name, { browserType, launchOptions, expectPopup, forcePopup, userAgent, restartRelay }) {
  console.log(`\n${name}`);
  mkdirSync(SHOT_DIR, { recursive: true });
  const relayPort = await pickFreePort();
  let client;
  let browser;
  try {
    // Popup runs open the bridge before the relay exists; the window must
    // detect it on its own once surfcad-mcp starts.
    if (!expectPopup) {
      client = await startMcp(relayPort);
      check('surfcad-mcp relay serves /bridge', await waitForRelay(relayPort));
    }

    browser = await browserType.launch({ headless: true, ...launchOptions });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      ...(userAgent ? { userAgent } : {}),
    });
    if (browserType === chromium) {
      await context.grantPermissions(['local-network-access'], { origin: PROD_ORIGIN });
    }
    await routeProdOrigin(context, relayPort);
    const page = await context.newPage();
    await installApiMocks(page);
    await page.goto(`${PROD_ORIGIN}/`, { waitUntil: 'domcontentloaded' });
    await seedAssembly(page, {
      userId: 'user-playtest',
      assembly: {
        format: 'surfcad.assembly',
        v: 1,
        name: 'bridge-e2e',
        activeId: 'local:part1',
        source: 'local',
        parts: [{ id: 'local:part1', name: 'Part (1)', visible: true, order: 0 }],
        joints: [],
      },
      parts: [{ id: 'local:part1', script: 'let part = Manifold.cube([1, 1, 1], true);\nreturn part;\n' }],
    });
    const query = new URLSearchParams({ agent: '1', agentBridgeWs: `ws://127.0.0.1:${relayPort}` });
    if (forcePopup) query.set('agentBridgeTransport', 'popup');
    await page.goto(`${PROD_ORIGIN}/?${query}`, { waitUntil: 'domcontentloaded' });
    await waitForBridge(page);

    await openProfile(page);
    check('no "Chrome for now" preempt', await page.locator('[data-agent-bridge-unsupported]').count() === 0);
    await page.screenshot({ path: join(SHOT_DIR, `${name}-profile.png`) });

    const popup = await clickAndMaybePopup(page, CONNECT, expectPopup);
    await page.waitForSelector('[data-agent-bridge-panel]', { state: 'visible', timeout: 15000 });
    const transport = await page.locator('[data-agent-bridge-panel]').getAttribute('data-agent-bridge-transport');
    check(`panel transport is ${expectPopup ? 'popup' : 'direct'}`, transport === (expectPopup ? 'popup' : 'direct'), transport);
    if (expectPopup) {
      check('Connect Agent opens the bridge window', !!popup);
      check('panel explains the bridge window', await page.locator('[data-agent-bridge-popup-intro]').isVisible());
      // The bridge retries with no give-up: well past 30 s it is still waiting.
      await page.waitForTimeout(35000);
      const waiting = page.locator('[data-agent-bridge-waiting-relay]');
      check('relay not running: still Waiting for the local agent after 35 s',
        await waiting.isVisible() && /Waiting for the local agent/.test(await waiting.innerText()));
      check('relay not running: pairing code hidden', await page.locator('[data-agent-bridge-code]').count() === 0);
      check('relay not running: no error shown', await page.locator('[data-agent-bridge-error]').count() === 0);
      check('relay not running: bridge window left open', !popup.isClosed());
      await page.screenshot({ path: join(SHOT_DIR, `${name}-waiting.png`) });
      client = await startMcp(relayPort);
      check('surfcad-mcp relay serves /bridge', await waitForRelay(relayPort));
      const relayUpAt = Date.now();
      await popup.waitForFunction(() => document.documentElement.dataset.status === 'connected', null, { timeout: 20000 });
      check('bridge window detects the relay without another click', true);
      await page.waitForSelector('[data-agent-bridge-code]', { state: 'visible', timeout: 10000 });
      check('code revealed within the 3 s retry cap', Date.now() - relayUpAt < 6000, `${Date.now() - relayUpAt} ms`);
      check('code revealed once the bridge detects the relay', await page.locator('[data-agent-bridge-waiting-relay]').count() === 0);
      check('bridge window is labelled', (await popup.title()) === 'SurfCAD local agent bridge', await popup.title());
      check('bridge window says keep it open', /Keep it open/.test(await popup.locator('main').innerText()));
      await popup.screenshot({ path: join(SHOT_DIR, `${name}-bridge-window.png`) });
    } else {
      check('direct path opens no popup', popup == null);
    }
    check('no ring before pairing', await page.locator(RING).count() === 0);

    await page.waitForSelector('[data-agent-bridge-code]', { state: 'visible', timeout: 15000 });
    const code = (await page.locator('[data-agent-bridge-code]').innerText()).trim();
    await pairWithAllow(page, client, code);
    await page.waitForSelector(RING, { timeout: 5000 }).catch(() => {});
    check('green ring while paired', await page.locator(RING).count() === 1);
    await page.screenshot({ path: join(SHOT_DIR, `${name}-paired.png`) });

    if (restartRelay && expectPopup) {
      const before = liveBridgeWindows(context, page);
      check('one bridge window before relay restart', before.length === 1 && before[0] === popup);
      await client.close();
      client = await startMcp(relayPort);
      check('relay restarted on the same port', await waitForRelay(relayPort));
      await popup.waitForFunction(() => document.documentElement.dataset.status === 'connected', null, { timeout: 20000 });
      const after = liveBridgeWindows(context, page);
      check('relay restart reused the same window', after.length === 1 && after[0] === popup);
      await pairWithAllow(page, client, code);
      check('pairing recovers after relay restart', await page.locator(RING).count() === 1);
      check('still one bridge window after recover', liveBridgeWindows(context, page).length === 1);
    }

    await mcp(client, 'insert_cube', { width: 20, depth: 20, height: 20 });
    await mcp(client, 'run', {});
    const st = await mcp(client, 'status', {});
    check('create: cube via MCP', Math.abs((st.volume ?? 0) - 8000) < 1, JSON.stringify({ volume: st.volume }));

    const tree = await mcp(client, 'feature_tree', {});
    const cube = (tree.features || []).find((f) => f.kind === 'cube');
    await mcp(client, 'open_feature', { id: cube?.id });
    await page.waitForTimeout(300);
    await mcp(client, 'edit_feature', { params: { x: 15, center: false } });
    await mcp(client, 'confirm_feature', {});
    const edited = (await mcp(client, 'get_script', {})).source || '';
    check('edit: cube moved via MCP', /\.translate\(\[15, 0, 0\]\)/.test(edited), edited.slice(0, 200));

    // Same as focusPartHistoryForUndo: undo follows the highlighted part.
    const parts = await mcp(client, 'parts', {});
    await mcp(client, 'select_parts', { part_id: parts.activeId || parts.parts?.[0]?.id });
    await mcp(client, 'undo', {});
    const undone = (await mcp(client, 'get_script', {})).source || '';
    check('undo via MCP', undone !== edited && !/\.translate\(\[15, 0, 0\]\)/.test(undone), undone.slice(0, 200));

    if (expectPopup) {
      await popup.close();
      await page.waitForSelector('[data-agent-bridge-error="bridge_closed"]', { timeout: 10000 });
      check('closing the bridge window shows Disconnected', await page.locator('[data-agent-bridge-error="bridge_closed"]').isVisible());
      check('closing the window re-opens the pairing dialog', await page.locator('[data-agent-bridge-dialog]').isVisible());
      check('ring clears when the bridge window closes', await page.locator(RING).count() === 0);
      check('no Waiting for relay spinner after close', await page.locator('[data-agent-bridge-waiting-relay]').count() === 0);
      const blocked = await client.callTool({ name: 'status', arguments: {} });
      check('agent cannot drive the tab while disconnected', blocked.isError === true);
      await page.screenshot({ path: join(SHOT_DIR, `${name}-disconnected.png`) });

      const popup2 = await clickAndMaybePopup(page, '[data-ui-action="data-agent-bridge-reconnect"]', true);
      await popup2.waitForFunction(() => document.documentElement.dataset.status === 'connected', null, { timeout: 15000 });
      await page.waitForSelector('[data-agent-bridge-code]', { state: 'visible', timeout: 10000 });
      const code2 = (await page.locator('[data-agent-bridge-code]').innerText()).trim();
      check('reconnect keeps the pairing code', code2 === code, `${code} → ${code2}`);
      await pairWithAllow(page, client, code2);
      const st2 = await mcp(client, 'status', {});
      check('agent drives the tab after Reconnect', typeof st2 === 'object' && st2.volume != null);
      await page.waitForSelector(RING, { timeout: 5000 }).catch(() => {});
      check('ring returns after Reconnect', await page.locator(RING).count() === 1);
    }

    await evilOpenerCheck(context, relayPort);
  } catch (err) {
    check(`${name} completed`, false, err?.stack || String(err));
  } finally {
    if (client) await client.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }
}

if (!existsSync(join(DIST, 'index.html'))) {
  console.log('  ❌ dist/ missing — run `npm run build` first');
  process.exit(1);
}

const wanted = (process.env.BRIDGE_E2E_RUNS || 'webkit,chromium,chromium-popup').split(',').map((s) => s.trim());
const chromePath = findChrome();
const webkitPath = process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE_PATH || webkit.executablePath();

console.log('agent bridge safari popup golden');
const ran = [];
for (const name of wanted) {
  if (name === 'webkit') {
    if (!webkitPath || !existsSync(webkitPath)) {
      console.log('\nwebkit: no WebKit (npx playwright-core install --with-deps webkit). Skipping.');
      continue;
    }
    await runOne('webkit', {
      browserType: webkit,
      launchOptions: process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE_PATH ? { executablePath: webkitPath } : {},
      expectPopup: true,
      restartRelay: true,
    });
  } else if (name === 'chromium' || name === 'chromium-popup') {
    if (!chromePath) {
      console.log(`\n${name}: no system Chrome found — set CHROME_PATH. Skipping.`);
      continue;
    }
    await runOne(name, {
      browserType: chromium,
      launchOptions: { executablePath: chromePath, args: ['--no-sandbox', '--disable-dev-shm-usage'] },
      expectPopup: name === 'chromium-popup',
      forcePopup: name === 'chromium-popup',
      userAgent: name === 'chromium-popup' ? SAFARI_DESKTOP_UA : undefined,
    });
  } else {
    continue;
  }
  ran.push(name);
}

console.log(`\nscreenshots: ${SHOT_DIR}`);
if (failed) {
  console.log(`agent bridge safari popup golden: ${failed} failed`);
  process.exit(1);
}
console.log(`agent bridge safari popup golden: ok (${ran.join(', ') || 'nothing ran'})`);

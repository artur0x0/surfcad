/**
 * Relay auto-retry: page open before relay starts should pair without reload.
 * Closes the profile panel before dropping the relay, then checks pairing_lost
 * fails fast and reconnect works.
 * Run: npm run build && node scripts/playtest/scenarios/agent-bridge-relay-retry.mjs
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertLocalhost,
  findChrome,
  installApiMocks,
  startPreviewServer,
  waitForServer,
} from '../lib/harness.mjs';
import { pickFreePort } from '../lib/pickFreePort.mjs';
import { RelaySession } from '../../../packages/surfcad-mcp/src/relay.mjs';
import { probeRelayAtUrl } from '../../../packages/surfcad-mcp/src/bridge/relayServer.mjs';
import {
  APPROVAL_POPUP_WIDE_MIN_PX,
  rectsOverlap,
} from '../../../src/agent/ws/agentBridgeChrome.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const SERVER_BIN = join(ROOT, 'packages/surfcad-mcp/bin/surfcad-mcp.js');
const FAST_FAIL_MS = 2000;

function spawnMcpRelay(port) {
  // MCP stdio servers exit (and stop the owned relay) when stdin ends. Keep
  // the pipe open for the life of this process; do not use stdio: 'ignore'.
  const proc = spawn(process.execPath, [SERVER_BIN], {
    env: {
      ...process.env,
      SURFCAD_MCP_START_RELAY: '1',
      SURFCAD_AGENT_BRIDGE_WS_PORT: String(port),
    },
    stdio: ['pipe', 'ignore', 'pipe'],
  });
  proc.stdin?.on?.('error', () => {});
  proc.stderr?.resume();
  return proc;
}

function stopMcpRelay(proc) {
  if (!proc) return Promise.resolve();
  const exited = new Promise((resolve) => {
    if (proc.exitCode != null || proc.signalCode != null) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch { /* gone */ }
    }, 400);
    proc.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
  try { proc.stdin?.end(); } catch { /* gone */ }
  try { proc.kill('SIGTERM'); } catch { /* gone */ }
  return exited;
}

async function waitUntilRelayDown(url, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await probeRelayAtUrl(url, 200))) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`relay still listening on ${url}`);
}

async function waitUntilRelayUp(url, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probeRelayAtUrl(url, 400)) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`relay did not listen on ${url}`);
}

async function timed(promise) {
  const start = Date.now();
  try {
    const value = await promise;
    return { ms: Date.now() - start, value, error: null };
  } catch (error) {
    return { ms: Date.now() - start, value: null, error };
  }
}

async function assertApprovalClearsProfileChrome(page, { width } = {}) {
  const popup = await page.locator('[data-agent-bridge-approval]').boundingBox();
  const chip = await page.locator('[data-profile-chip]').first().boundingBox();
  const panel = await page.locator('[data-profile-panel]').boundingBox();
  const privacy = await page.locator('[data-profile-privacy-choices]').boundingBox();
  assert.ok(popup, 'Allow/Deny popup should be visible');
  assert.ok(chip, 'profile chip should be visible');
  assert.ok(privacy, 'Privacy choices should be visible');
  assert.equal(
    rectsOverlap(popup, chip),
    false,
    `Allow/Deny covers the profile chip popup=${JSON.stringify(popup)} chip=${JSON.stringify(chip)}`,
  );
  assert.equal(
    rectsOverlap(popup, privacy),
    false,
    `Allow/Deny covers Privacy choices popup=${JSON.stringify(popup)} privacy=${JSON.stringify(privacy)}`,
  );
  // 768+ has gutter beside the panel. 390 cannot fit a ~220px portal beside w-64,
  // so it parks under the chip and may clip the panel header — never Privacy.
  if (width == null || width >= 768) {
    assert.ok(panel, 'profile menu should be visible');
    assert.equal(
      rectsOverlap(popup, panel),
      false,
      `Allow/Deny covers the profile menu popup=${JSON.stringify(popup)} panel=${JSON.stringify(panel)}`,
    );
  }
  const portal = await page.locator('[data-agent-bridge-approval-portal]').count();
  assert.ok(portal > 0, 'Allow/Deny must render as the body portal, not inside the menu');
  const promptColor = await page.locator('[data-agent-bridge-approval] p').evaluate(
    /* eslint-disable no-undef */
    (el) => getComputedStyle(el).color,
    /* eslint-enable no-undef */
  );
  // text-on-dark / --chrome-text: gray-100 rgb(243, 244, 246) — never inherit black on dark blue.
  assert.equal(
    promptColor,
    'rgb(243, 244, 246)',
    `Allow/Deny prompt must use text-on-dark, got ${promptColor}`,
  );
  const shotDir = process.env.WALKTHROUGH_SHOT_DIR;
  if (shotDir) {
    await mkdir(shotDir, { recursive: true });
    await page.screenshot({ path: join(shotDir, 'allow-deny-chrome-text.png') });
  }
}

async function ensureProfilePanelOpen(page) {
  if (await page.locator('[data-profile-panel]').isVisible()) return;
  await page.locator('[data-profile-chip]').filter({ visible: true }).first().click();
  await page.waitForSelector('[data-profile-panel]', { timeout: 10000 });
}

async function assertApprovalLayoutAtWidths(page, widths = [1280, 768, 390]) {
  const original = page.viewportSize() || { width: 1280, height: 800 };
  try {
    for (const width of widths) {
      await page.setViewportSize({ width, height: original.height });
      const expected = width < APPROVAL_POPUP_WIDE_MIN_PX ? 'under-chip' : 'bottom-center';
      const deadline = Date.now() + 8000;
      let got = { inner: 0, anchor: null };
      while (Date.now() < deadline) {
        got = await page.evaluate(
          /* eslint-disable no-undef */
          () => ({ inner: window.innerWidth, anchor: null }),
          /* eslint-enable no-undef */
        );
        if (got.inner === width) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      assert.equal(got.inner, width, `viewport innerWidth at ${width}: ${JSON.stringify(got)}`);
      await ensureProfilePanelOpen(page);
      while (Date.now() < deadline) {
        got = await page.evaluate(
          /* eslint-disable no-undef */
          () => {
            const el = document.querySelector('[data-agent-bridge-approval]');
            return {
              inner: window.innerWidth,
              anchor: el ? el.getAttribute('data-agent-bridge-approval-anchor') : null,
            };
          },
          /* eslint-enable no-undef */
        );
        if (got.inner === width && got.anchor === expected) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      assert.equal(got.anchor, expected, `Allow/Deny anchor at ${width}: ${JSON.stringify(got)}`);
      await assertApprovalClearsProfileChrome(page, { width });
    }
  } finally {
    await page.setViewportSize(original);
  }
}

export const id = 'agent-bridge-relay-retry';
export const title = 'Agent bridge relay auto-retry';

/**
 * @param {{ chromium: import('playwright-core').Chromium, outDir: string, port: number }} ctx
 */
export async function run(ctx) {
  const chrome = findChrome();
  if (!chrome) {
    return { skipped: true, reason: 'CHROME_PATH not set' };
  }
  const relayPort = await pickFreePort();
  const relayUrl = `ws://127.0.0.1:${relayPort}`;
  const baseUrl = `http://127.0.0.1:${ctx.port}/?agent=1&agentBridgeWs=${encodeURIComponent(relayUrl)}`;
  assertLocalhost(baseUrl);

  const { stop } = startPreviewServer(ctx.port, {
    SURFCAD_AGENT_BRIDGE_WS_PORT: String(relayPort),
    // Preview must not bind this port; the MCP child owns the relay.
    SURFCAD_MCP_START_RELAY: '0',
  });
  if (!(await waitForServer(baseUrl))) {
    stop();
    throw new Error('preview did not start');
  }

  const browser = await ctx.chromium.launch({
    executablePath: chrome,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await installApiMocks(page);
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    /* eslint-disable no-undef */
    () => typeof window.surfcad?.call === 'function',
    /* eslint-enable no-undef */
    { timeout: 120000 },
  );

  await page.locator('[data-profile-chip]').first().click();
  await page.waitForSelector('[data-ui-action="data-agent-bridge-connect"]', { timeout: 10000 });
  await page.click('[data-ui-action="data-agent-bridge-connect"]');
  // Preview may already have bound the relay; the missing-relay spinner is racy.
  await page.waitForSelector('[data-agent-bridge-waiting-relay], [data-agent-bridge-code]', { timeout: 15000 });
  await page.keyboard.press('Escape');
  await page.waitForSelector('[data-profile-panel]', { state: 'hidden', timeout: 5000 });
  const wrapBox = await page.locator('[data-profile-chip-wrap]').first().boundingBox();
  assert.ok(wrapBox, 'profile chip wrap should be visible');
  assert.equal(Math.round(wrapBox.width), 36, `wrap width ${wrapBox.width}`);
  assert.equal(Math.round(wrapBox.height), 36, `wrap height ${wrapBox.height}`);
  assert.ok(wrapBox.y >= 12 && wrapBox.y <= 20, `wrap top ${wrapBox.y}`);
  assert.ok(
    wrapBox.x + wrapBox.width >= 1280 - 24,
    `wrap should sit at top-right (x=${wrapBox.x})`,
  );

  let relayProc = spawnMcpRelay(relayPort);
  await waitUntilRelayUp(relayUrl);
  const session = new RelaySession({
    url: relayUrl,
    onLog: () => {},
    reconnectDelaysMs: [250, 500, 1000, 2000],
  });

  try {
    await page.locator('[data-profile-chip]').first().click();
    const connect = page.locator('[data-ui-action="data-agent-bridge-connect"]');
    if (await connect.count()) await connect.click();
    await page.waitForSelector('[data-agent-bridge-waiting-relay], [data-agent-bridge-code]', { timeout: 15000 });
    await page.waitForSelector('[data-agent-bridge-code]', { timeout: 30000 });
    const token = (await page.locator('[data-agent-bridge-code]').innerText()).trim();
    const peerPromise = session.pair(token);
    peerPromise.catch(() => {});
    await page.waitForSelector('[data-agent-bridge-approval]', { timeout: 15000 });
    await assertApprovalLayoutAtWidths(page, [1280, 768, 390]);
    await page.click('[data-ui-action="data-agent-bridge-approve"]');
    await peerPromise;
    await session.call('status');
    await page.waitForSelector('[data-agent-bridge-connection-ring="connected"]', { timeout: 15000 });
    await page.keyboard.press('Escape');
    await page.waitForFunction(
      /* eslint-disable no-undef */
      () => !document.querySelector('[data-profile-panel]'),
      /* eslint-enable no-undef */
      { timeout: 5000 },
    );

    await stopMcpRelay(relayProc);
    relayProc = null;
    await waitUntilRelayDown(relayUrl);
    const dropDeadline = Date.now() + 5000;
    while (session.state !== 'lost' && Date.now() < dropDeadline) {
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.equal(session.state, 'lost', `session.state after relay exit: ${session.state}`);
    const lost = await timed(session.call('status'));
    assert.equal(lost.error?.code, 'pairing_lost', lost.error?.message);
    assert.ok(lost.ms < FAST_FAIL_MS, `pairing_lost took ${lost.ms}ms`);
    assert.match(String(lost.error?.hint || ''), /Chrome/);
    assert.doesNotMatch(`${lost.error?.message}\n${lost.error?.hint || ''}`, /\bEdge\b/);
    await page.waitForSelector('[data-agent-bridge-connection-ring="reconnecting"]', { timeout: 15000 });

    relayProc = spawnMcpRelay(relayPort);
    await waitUntilRelayUp(relayUrl);
    const approval = page.locator('[data-agent-bridge-approval]');
    const prompted = await approval.waitFor({ timeout: 8000 }).then(() => true).catch(() => false);
    if (prompted) {
      const menuClosed = await page.evaluate(
        /* eslint-disable no-undef */
        () => !document.querySelector('[data-profile-panel]'),
        /* eslint-enable no-undef */
      );
      if (!menuClosed) {
        throw new Error('Allow/Deny must show while the profile menu stays closed');
      }
      const chip = await page.locator('[data-profile-chip]').first().boundingBox();
      const popup = await page.locator('[data-agent-bridge-approval]').boundingBox();
      assert.equal(
        rectsOverlap(popup, chip),
        false,
        'Allow/Deny must not cover the chip while the menu is closed',
      );
      await page.click('[data-ui-action="data-agent-bridge-approve"]');
    }
    await page.waitForSelector('[data-agent-bridge-connection-ring="connected"]', { timeout: 30000 });
    const deadline = Date.now() + 15000;
    let recovered = false;
    while (Date.now() < deadline) {
      try {
        await session.call('status');
        recovered = true;
        break;
      } catch (err) {
        if (err?.code !== 'pairing_lost' && err?.code !== 'pair_pending' && err?.code !== 'not_paired') {
          throw err;
        }
        await new Promise((r) => setTimeout(r, 200));
      }
    }
    assert.ok(recovered, 'session.call should succeed after the relay returns');
  } finally {
    try { session.disconnect(); } catch { /* gone */ }
    await stopMcpRelay(relayProc);
    await browser.close();
    stop();
  }

  return { ok: true };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const { chromium } = await import('playwright-core');
  const port = await pickFreePort();
  run({ chromium, port, outDir: '/tmp' }).then((result) => {
    if (result.skipped) {
      console.log(`agent-bridge-relay-retry skipped: ${result.reason}`);
      process.exit(0);
    }
    console.log('agent-bridge-relay-retry: ok');
  }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

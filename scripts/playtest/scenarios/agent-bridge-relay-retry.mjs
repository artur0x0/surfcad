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
  waitForSignedInChip,
} from '../lib/harness.mjs';
import { pickFreePort } from '../lib/pickFreePort.mjs';
import { RelaySession } from '../../../packages/surfcad-mcp/src/relay.mjs';
import { probeRelayAtUrl } from '../../../packages/surfcad-mcp/src/bridge/relayServer.mjs';
import { rectsOverlap } from '../../../src/agent/ws/agentBridgeChrome.js';

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

async function shot(page, shotDir, name) {
  if (!shotDir) return;
  await mkdir(shotDir, { recursive: true });
  await page.screenshot({ path: join(shotDir, name) });
}

async function assertPairingClearsFooterPrivacy(page, { menuOpen = false } = {}) {
  await page.waitForSelector('[data-privacy-choices-link]', { timeout: 5000 });
  const dialog = await page.locator('[data-agent-bridge-dialog-card]').boundingBox();
  const approval = await page.locator('[data-agent-bridge-approval]').boundingBox();
  const footer = await page.locator('[data-privacy-choices-link]').boundingBox();
  const chip = await page.locator('[data-profile-chip]').first().boundingBox();
  assert.ok(dialog, 'pairing dialog card should be visible');
  assert.ok(footer, 'page-footer Privacy choices should be visible');
  assert.ok(chip, 'profile chip should be visible');
  assert.equal(
    rectsOverlap(dialog, footer),
    false,
    `pairing dialog covers footer Privacy choices dialog=${JSON.stringify(dialog)} footer=${JSON.stringify(footer)}`,
  );
  if (approval) {
    assert.equal(
      rectsOverlap(approval, footer),
      false,
      `Allow/Deny covers footer Privacy choices approval=${JSON.stringify(approval)} footer=${JSON.stringify(footer)}`,
    );
    assert.equal(rectsOverlap(approval, chip), false, 'Allow/Deny covers the profile chip');
  }
  const portal = await page.locator('[data-agent-bridge-dialog]').count();
  assert.ok(portal > 0, 'pairing dialog must render as a body portal, not inside the menu');
  if (await page.locator('[data-agent-bridge-approval] p').count()) {
    const promptColor = await page.locator('[data-agent-bridge-approval] p').evaluate(
      /* eslint-disable no-undef */
      (el) => getComputedStyle(el).color,
      /* eslint-enable no-undef */
    );
    assert.equal(
      promptColor,
      'rgb(243, 244, 246)',
      `Allow/Deny prompt must use text-on-dark, got ${promptColor}`,
    );
  }
  if (menuOpen) {
    assert.ok(
      await page.locator('[data-profile-panel]').isVisible(),
      'profile menu should stay open for the footer overlap check',
    );
    const menuPrivacy = await page.locator('[data-profile-privacy-choices]').boundingBox();
    assert.ok(menuPrivacy, 'in-menu Privacy choices should be visible when the menu is open');
  }
}

async function clickProfileChip(page) {
  // Dispatch on the node. A hit-tested click would land on the pairing scrim
  // (z-130 vs chip z-50) and Deny the pending pair.
  await page.locator('[data-profile-chip]').filter({ visible: true }).first().evaluate((el) => el.click());
}

async function ensureProfilePanelOpen(page) {
  if (await page.locator('[data-profile-panel]').isVisible()) return;
  await clickProfileChip(page);
  await page.waitForSelector('[data-profile-panel]', { timeout: 10000 });
}

async function ensureProfilePanelClosed(page) {
  if (!(await page.locator('[data-profile-panel]').isVisible().catch(() => false))) return;
  await clickProfileChip(page);
  await page.waitForSelector('[data-profile-panel]', { state: 'hidden', timeout: 5000 });
}

async function waitForInnerWidth(page, width) {
  const deadline = Date.now() + 8000;
  let inner = 0;
  while (Date.now() < deadline) {
    // eslint-disable-next-line no-undef -- page.evaluate runs in the browser
    inner = await page.evaluate(() => window.innerWidth);
    if (inner === width) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.equal(inner, width, `viewport innerWidth at ${width}: ${inner}`);
}

async function dismissPairingDialog(page) {
  if (!(await page.locator('[data-agent-bridge-dialog]').isVisible().catch(() => false))) return;
  await page.keyboard.press('Escape');
  await page.waitForSelector('[data-agent-bridge-dialog]', { state: 'hidden', timeout: 5000 });
}

async function assertConnectAgentClosesMenuAt(page, { width, height }) {
  await page.setViewportSize({ width, height });
  await waitForInnerWidth(page, width);
  await dismissPairingDialog(page);
  await ensureProfilePanelClosed(page);
  await page.locator('[data-profile-chip]').filter({ visible: true }).first().click();
  await page.waitForSelector('[data-ui-action="data-agent-bridge-connect"]', { timeout: 10000 });
  await page.click('[data-ui-action="data-agent-bridge-connect"]');
  await page.waitForSelector('[data-agent-bridge-dialog]', { timeout: 10000 });
  await page.waitForFunction(
    /* eslint-disable no-undef */
    () => !document.querySelector('[data-profile-panel]'),
    /* eslint-enable no-undef */
    { timeout: 5000 },
  );
  const openMenus = await page.locator('[data-profile-panel]').filter({ visible: true }).count();
  assert.equal(
    openMenus,
    0,
    `Connect Agent must close the profile menu at ${width} (open menus=${openMenus})`,
  );
}

async function assertApprovalLayoutAtWidths(page, widths = [1280, 768, 390]) {
  const original = page.viewportSize() || { width: 1280, height: 800 };
  try {
    for (const width of widths) {
      const height = width <= 390 ? 844 : original.height;
      await page.setViewportSize({ width, height });
      await waitForInnerWidth(page, width);
      await page.waitForSelector('[data-agent-bridge-dialog]', { timeout: 8000 });
      await ensureProfilePanelClosed(page);
      await assertPairingClearsFooterPrivacy(page, { menuOpen: false });
      await ensureProfilePanelOpen(page);
      await assertPairingClearsFooterPrivacy(page, { menuOpen: true });
      await ensureProfilePanelClosed(page);
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
  await installApiMocks(page, { seedGithub: true });
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    /* eslint-disable no-undef */
    () => typeof window.surfcad?.call === 'function',
    /* eslint-enable no-undef */
    { timeout: 120000 },
  );
  await waitForSignedInChip(page);
  const chipState = await page.locator('[data-profile-chip]').first().getAttribute('data-profile-chip-state');
  assert.equal(chipState, 'signed-in', `Connect Agent needs a signed-in chip, got ${chipState}`);

  const shotDir = process.env.WALKTHROUGH_SHOT_DIR
    || join(ctx.outDir || '/opt/cursor/artifacts', 'connect-agent-pairing');

  for (const size of [
    { width: 1280, height: 800 },
    { width: 768, height: 800 },
    { width: 390, height: 844 },
  ]) {
    await assertConnectAgentClosesMenuAt(page, size);
    await dismissPairingDialog(page);
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await waitForInnerWidth(page, 1280);

  await page.locator('[data-profile-chip]').first().click();
  await page.waitForSelector('[data-ui-action="data-agent-bridge-connect"]', { timeout: 10000 });
  await page.click('[data-ui-action="data-agent-bridge-connect"]');
  await page.waitForSelector('[data-agent-bridge-dialog]', { timeout: 10000 });
  await page.waitForSelector('[data-profile-panel]', { state: 'hidden', timeout: 5000 });
  await page.waitForSelector('[data-agent-bridge-prompt], [data-agent-bridge-code]', { timeout: 15000 });
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
    if (await page.locator('[data-agent-bridge-prompt]').count()) {
      await shot(page, shotDir, 'pairing-no-relay-1280.png');
      await page.setViewportSize({ width: 390, height: 844 });
      await shot(page, shotDir, 'pairing-no-relay-390.png');
      await page.setViewportSize({ width: 1280, height: 800 });
    }
    await page.waitForSelector('[data-agent-bridge-code]', { timeout: 30000 });
    assert.equal(await page.locator('[data-agent-bridge-prompt]').count(), 0, 'prompt must hide once a relay is up');
    assert.equal(await page.locator('[data-agent-bridge-code]').count(), 1);
    await shot(page, shotDir, 'pairing-code-1280.png');
    await page.setViewportSize({ width: 390, height: 844 });
    await shot(page, shotDir, 'pairing-code-390.png');
    await page.setViewportSize({ width: 1280, height: 800 });
    const token = (await page.locator('[data-agent-bridge-code]').innerText()).trim();
    const peerPromise = session.pair(token);
    peerPromise.catch(() => {});
    await page.waitForSelector('[data-agent-bridge-approval]', { timeout: 15000 });
    assert.equal(await page.locator('[data-agent-bridge-code]').count(), 0, 'approval must replace the pairing code');
    await shot(page, shotDir, 'pairing-approval-1280.png');
    await assertApprovalLayoutAtWidths(page, [1280, 768, 390]);
    await page.setViewportSize({ width: 390, height: 844 });
    await shot(page, shotDir, 'pairing-approval-390.png');
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.click('[data-ui-action="data-agent-bridge-approve"]');
    await peerPromise;
    await session.call('status');
    await page.waitForSelector('[data-agent-bridge-dialog]', { state: 'hidden', timeout: 15000 });
    await page.waitForSelector('[data-agent-bridge-connected-toast]', { timeout: 15000 });
    await page.waitForSelector('[data-agent-bridge-connection-ring="connected"]', { timeout: 15000 });
    const ringCount = await page.locator('[data-agent-bridge-connection-ring="connected"]').count();
    assert.ok(ringCount >= 1, `expected at least one connected ring, got ${ringCount}`);
    await shot(page, shotDir, 'pairing-toast-1280.png');
    await shot(page, shotDir, 'pairing-ring-1280.png');
    await page.setViewportSize({ width: 390, height: 844 });
    await shot(page, shotDir, 'pairing-toast-390.png');
    await shot(page, shotDir, 'pairing-ring-390.png');
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.locator('[data-agent-bridge-connected-toast] [data-error-dismiss]').click();
    await page.waitForSelector('[data-agent-bridge-connected-toast]', { state: 'hidden', timeout: 5000 });
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
    // Resume lives only in relay memory. A process restart must prompt Allow again.
    await page.waitForSelector('[data-agent-bridge-approval]', { timeout: 15000 });
    const menuClosed = await page.evaluate(
      /* eslint-disable no-undef */
      () => !document.querySelector('[data-profile-panel]'),
      /* eslint-enable no-undef */
    );
    if (!menuClosed) {
      throw new Error('Allow/Deny must show while the profile menu stays closed');
    }
    assert.equal(await page.locator('[data-agent-bridge-code]').count(), 0);
    const chip = await page.locator('[data-profile-chip]').first().boundingBox();
    const popup = await page.locator('[data-agent-bridge-approval]').boundingBox();
    assert.equal(
      rectsOverlap(popup, chip),
      false,
      'Allow/Deny must not cover the chip while the menu is closed',
    );
    await page.click('[data-ui-action="data-agent-bridge-approve"]');
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

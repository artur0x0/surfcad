/**
 * Relay auto-retry: page open before relay starts should pair without reload.
 * Closes the profile panel before dropping the relay, then checks pairing_lost
 * fails fast and reconnect works.
 * Run: npm run build && node scripts/playtest/run.mjs --scenario agent-bridge-relay-retry
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
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
    stdio: ['pipe', 'ignore', 'ignore'],
    detached: true,
  });
  proc.stdin?.on?.('error', () => {});
  return proc;
}

function stopMcpRelay(proc) {
  if (!proc) return;
  try { proc.stdin?.end(); } catch { /* gone */ }
  try { process.kill(-proc.pid, 'SIGTERM'); } catch {
    try { proc.kill('SIGTERM'); } catch { /* gone */ }
  }
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

async function waitForLostCall(session, timeoutMs) {
  const start = Date.now();
  for (;;) {
    const outcome = await timed(session.call('status'));
    if (outcome.error?.code === 'pairing_lost') {
      assert.match(String(outcome.error.hint || ''), /Chrome/);
      assert.doesNotMatch(`${outcome.error.message}\n${outcome.error.hint || ''}`, /\bEdge\b/);
      return Date.now() - start;
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error(`pairing_lost did not arrive (${outcome.error?.code || 'ok'})`);
    }
    await new Promise((r) => setTimeout(r, 50));
  }
}

async function assertApprovalClearsProfileChrome(page) {
  const popup = await page.locator('[data-agent-bridge-approval]').boundingBox();
  const chip = await page.locator('[data-profile-chip]').first().boundingBox();
  const panel = await page.locator('[data-profile-panel]').boundingBox();
  const privacy = await page.locator('[data-profile-privacy-choices]').boundingBox();
  assert.ok(popup, 'Allow/Deny popup should be visible');
  assert.ok(chip, 'profile chip should be visible');
  assert.equal(
    rectsOverlap(popup, chip),
    false,
    `Allow/Deny covers the profile chip popup=${JSON.stringify(popup)} chip=${JSON.stringify(chip)}`,
  );
  if (panel) {
    assert.equal(
      rectsOverlap(popup, panel),
      false,
      `Allow/Deny covers the profile menu popup=${JSON.stringify(popup)} panel=${JSON.stringify(panel)}`,
    );
  }
  if (privacy) {
    assert.equal(
      rectsOverlap(popup, privacy),
      false,
      `Allow/Deny covers Privacy choices popup=${JSON.stringify(popup)} privacy=${JSON.stringify(privacy)}`,
    );
  }
  const portal = await page.locator('[data-agent-bridge-approval-portal]').count();
  assert.ok(portal > 0, 'Allow/Deny must render as the body portal, not inside the menu');
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
    await page.waitForSelector('[data-agent-bridge-approval]', { timeout: 15000 });
    await assertApprovalClearsProfileChrome(page);
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

    stopMcpRelay(relayProc);
    relayProc = null;
    const lostMs = await waitForLostCall(session, FAST_FAIL_MS);
    assert.ok(lostMs < FAST_FAIL_MS, `pairing_lost took ${lostMs}ms`);
    await page.waitForSelector('[data-agent-bridge-connection-ring="reconnecting"]', { timeout: 15000 });

    relayProc = spawnMcpRelay(relayPort);
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
    stopMcpRelay(relayProc);
    await browser.close();
    stop();
  }

  return { ok: true };
}

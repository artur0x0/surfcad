/**
 * Relay auto-retry: page open before relay starts should pair without reload.
 * Closes the profile panel before dropping the relay, then checks pairing_lost
 * fails fast and reconnect works.
 * Run: npm run build && node scripts/playtest/run.mjs --scenario agent-bridge-relay-retry
 */
import assert from 'node:assert/strict';
import {
  assertLocalhost,
  findChrome,
  installApiMocks,
  startPreviewServer,
  waitForServer,
} from '../lib/harness.mjs';
import { pickFreePort } from '../lib/pickFreePort.mjs';
import {
  startAgentBridgeRelay,
  stopAgentBridgeRelay,
} from '../../../packages/surfcad-mcp/src/bridge/relayServer.mjs';
import { RelaySession } from '../../../packages/surfcad-mcp/src/relay.mjs';

const FAST_FAIL_MS = 2000;

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

  let relay = await startAgentBridgeRelay({ port: relayPort, onLog: () => {} });
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

    const closing = relay;
    relay = null;
    await stopAgentBridgeRelay(closing);
    const lostMs = await waitForLostCall(session, FAST_FAIL_MS);
    assert.ok(lostMs < FAST_FAIL_MS, `pairing_lost took ${lostMs}ms`);
    await page.waitForSelector('[data-agent-bridge-connection-ring="reconnecting"]', { timeout: 15000 });

    relay = await startAgentBridgeRelay({ port: relayPort, onLog: () => {} });
    const approval = page.locator('[data-agent-bridge-approval]');
    const prompted = await approval.waitFor({ timeout: 4000 }).then(() => true).catch(() => false);
    if (prompted) {
      const menuClosed = await page.evaluate(
        /* eslint-disable no-undef */
        () => !document.querySelector('[data-profile-panel]'),
        /* eslint-enable no-undef */
      );
      if (!menuClosed) {
        throw new Error('Allow/Deny must show while the profile menu stays closed');
      }
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
    if (relay) {
      try { await stopAgentBridgeRelay(relay); } catch { /* gone */ }
    }
    await browser.close();
    stop();
  }

  return { ok: true };
}

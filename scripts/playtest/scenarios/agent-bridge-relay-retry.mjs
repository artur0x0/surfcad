/**
 * Relay auto-retry: page open before relay starts should pair without reload.
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
import { connectPeer } from '../../../src/agent/ws/nodeClient.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const SERVER_BIN = join(ROOT, 'packages/surfcad-mcp/bin/surfcad-mcp.js');

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
  await page.click('[data-ui-action="data-agent-bridge-connect"]');
  await page.waitForSelector('[data-agent-bridge-waiting-relay]', { timeout: 10000 });
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

  const relayProc = spawn(process.execPath, [SERVER_BIN], {
    env: {
      ...process.env,
      SURFCAD_MCP_START_RELAY: '1',
      SURFCAD_AGENT_BRIDGE_WS_PORT: String(relayPort),
    },
    stdio: 'ignore',
    detached: true,
  });

  try {
    await page.locator('[data-profile-chip]').first().click();
    await page.click('[data-ui-action="data-agent-bridge-connect"]');
    await page.waitForSelector('[data-agent-bridge-waiting-relay]', { timeout: 10000 });
    await page.waitForSelector('[data-agent-bridge-code]', { timeout: 30000 });
    const token = (await page.locator('[data-agent-bridge-code]').innerText()).trim();
    const peerPromise = connectPeer(relayUrl, token);
    await page.waitForSelector('[data-agent-bridge-approval]', { timeout: 15000 });
    await page.click('[data-ui-action="data-agent-bridge-approve"]');
    const peer = await peerPromise;
    await page.waitForSelector('[data-agent-bridge-connection-ring="connected"]', { timeout: 15000 });
    await page.keyboard.press('Escape');
    await page.waitForFunction(
      /* eslint-disable no-undef */
      () => !document.querySelector('[data-profile-panel]'),
      /* eslint-enable no-undef */
      { timeout: 5000 },
    );

    try { peer.close(); } catch { /* gone */ }
    await page.waitForSelector('[data-agent-bridge-connection-ring="reconnecting"]', { timeout: 15000 });

    const stopRelay = () => {
      try { process.kill(-relayProc.pid, 'SIGTERM'); } catch { /* gone */ }
    };
    stopRelay();
    await page.waitForSelector('[data-agent-bridge-connection-ring="reconnecting"]', { timeout: 15000 });

    const relayProc2 = spawn(process.execPath, [SERVER_BIN], {
      env: {
        ...process.env,
        SURFCAD_MCP_START_RELAY: '1',
        SURFCAD_AGENT_BRIDGE_WS_PORT: String(relayPort),
      },
      stdio: 'ignore',
      detached: true,
    });
    try {
      // The tab re-registers on its own; until it does the relay answers unknown_token.
      const peer2Promise = (async () => {
        const deadline = Date.now() + 30000;
        for (;;) {
          try {
            return await connectPeer(relayUrl, token);
          } catch (err) {
            if (Date.now() > deadline) throw err;
            await new Promise((r) => setTimeout(r, 250));
          }
        }
      })();
      await page.waitForSelector('[data-agent-bridge-approval]', { timeout: 30000 });
      const menuClosed = await page.evaluate(
        /* eslint-disable no-undef */
        () => !document.querySelector('[data-profile-panel]'),
        /* eslint-enable no-undef */
      );
      if (!menuClosed) {
        throw new Error('Allow/Deny must show while the profile menu stays closed');
      }
      await page.click('[data-ui-action="data-agent-bridge-approve"]');
      const peer2 = await peer2Promise;
      await page.waitForSelector('[data-agent-bridge-connection-ring="connected"]', { timeout: 15000 });
      try { peer2.close(); } catch { /* gone */ }
    } finally {
      try { process.kill(-relayProc2.pid, 'SIGTERM'); } catch { /* gone */ }
    }
  } finally {
    try { process.kill(-relayProc.pid, 'SIGTERM'); } catch { /* gone */ }
    await browser.close();
    stop();
  }

  return { ok: true };
}

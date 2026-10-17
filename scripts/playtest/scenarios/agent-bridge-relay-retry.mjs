/**
 * Relay auto-retry: page open before relay starts should pair without reload.
 * Run: npm run build && node scripts/playtest/run.mjs --scenario agent-bridge-relay-retry
 */
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
    () => typeof window.surfcad?.call === 'function',
    { timeout: 120000 },
  );

  await page.locator('[data-profile-chip]').first().click();
  await page.click('[data-ui-action="data-agent-bridge-connect"]');
  await page.waitForSelector('[data-agent-bridge-waiting-relay]', { timeout: 10000 });

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
    await page.waitForSelector('[data-agent-bridge-code]', { timeout: 30000 });
    const stopRelay = () => {
      try { process.kill(-relayProc.pid, 'SIGTERM'); } catch { /* gone */ }
    };
    stopRelay();
    await page.waitForSelector('[data-agent-bridge-waiting-relay]', { timeout: 30000 });

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
      await page.waitForSelector('[data-agent-bridge-code]', { timeout: 30000 });
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

/* eslint-env node */
/**
 * E2E: production dist + surfcad-mcp-packaged relay pairs and runs a bridge command.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { chromium, webkit } from 'playwright-core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { pickFreePort } from '../scripts/playtest/lib/pickFreePort.mjs';
import {
  installApiMocks,
  startPreviewServer,
  waitForServer,
} from '../scripts/playtest/lib/harness.mjs';
import {
  ensureAgentBridgeRelay,
  resetAgentBridgeRelayCache,
  stopAgentBridgeRelay,
} from '../packages/surfcad-mcp/src/bridge/relayServer.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PKG_ROOT = join(ROOT, 'packages/surfcad-mcp');
const SERVER_BIN = join(PKG_ROOT, 'bin/surfcad-mcp.js');

function npmPackInstall() {
  const pack = spawnSync('npm', ['pack', '--loglevel=error', '--pack-destination', PKG_ROOT], {
    cwd: PKG_ROOT,
    encoding: 'utf8',
  });
  assert.equal(pack.status, 0, pack.stderr || pack.stdout);
  const tgzLine = pack.stdout.trim().split('\n').pop();
  const tgzPath = join(PKG_ROOT, tgzLine);
  return tgzPath;
}

async function runBrowserE2E(t, browserType, executablePath) {
  const prodBuild = spawnSync('npm', ['run', 'build'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(prodBuild.status, 0, prodBuild.stderr || prodBuild.stdout);

  const httpPort = Number(process.env.SMOKE_PORT || 4194);
  const relayPort = await pickFreePort();
  const relayUrl = `ws://127.0.0.1:${relayPort}`;
  const pageOrigin = `http://127.0.0.1:${httpPort}`;
  const baseUrl = `${pageOrigin}/?agent=1&agentBridgeWs=${encodeURIComponent(relayUrl)}`;

  process.env.SURFCAD_AGENT_BRIDGE_EXTRA_ORIGINS = pageOrigin;
  const relay = await ensureAgentBridgeRelay({ port: relayPort });

  const { stop } = startPreviewServer(httpPort, {
    SURFCAD_AGENT_BRIDGE_WS_PORT: String(relayPort),
    SURFCAD_MCP_START_RELAY: '0',
  });

  let browser;
  let client;
  try {
    if (!(await waitForServer(`${pageOrigin}/`))) {
      throw new Error('preview did not start');
    }

    browser = await browserType.launch({
      executablePath,
      headless: true,
      args: browserType === chromium ? ['--no-sandbox', '--disable-dev-shm-usage'] : [],
    });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await installApiMocks(page);
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      /* eslint-disable no-undef */
      () => typeof window.surfcad?.call === 'function' && !document.querySelector('[data-app-loading]'),
      /* eslint-enable no-undef */
      { timeout: 120000 },
    );

    await page.locator('[data-profile-chip]').first().click();
    await page.click('[data-ui-action="data-agent-bridge-connect"]');
    await page.waitForSelector('[data-agent-bridge-waiting-relay]', { state: 'hidden', timeout: 15000 }).catch(() => {});
    await page.waitForSelector('[data-agent-bridge-code]', { state: 'visible', timeout: 15000 });
    const token = (await page.locator('[data-agent-bridge-code]').innerText()).trim();

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [SERVER_BIN],
      env: {
        ...process.env,
        SURFCAD_MCP_START_RELAY: '0',
        SURFCAD_AGENT_BRIDGE_WS_URL: relayUrl,
        SURFCAD_PAIRING_CODE: token,
      },
    });
    client = new Client({ name: 'prod-relay-e2e', version: '1.0.0' });
    await client.connect(transport);

    await page.waitForSelector('[data-ui-action="data-agent-bridge-approve"]', { timeout: 15000 });
    await page.click('[data-ui-action="data-agent-bridge-approve"]');
    await page.waitForSelector('[data-agent-bridge-paired]', { timeout: 15000 });

    const out = await client.callTool({ name: 'status', arguments: {} });
    assert.equal(out.isError, false, out.content?.[0]?.text);
    const parsed = JSON.parse(out.content[0].text);
    assert.equal(typeof parsed, 'object');

    await client.close();
    client = null;
  } finally {
    if (client) await client.close().catch(() => {});
    if (browser) await browser.close();
    stop();
    await stopAgentBridgeRelay(relay);
    if (relay?.port != null) resetAgentBridgeRelayCache(relay.port);
  }
}

test('production build pairs through packaged relay (Chromium)', { timeout: 300_000 }, async (t) => {
  const exe = process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)
    ? process.env.CHROME_PATH
    : null;
  if (!exe) {
    t.skip('CHROME_PATH not set');
    return;
  }
  npmPackInstall();
  await runBrowserE2E(t, chromium, exe);
});

test('production build pairs through packaged relay (WebKit)', { timeout: 300_000 }, async (t) => {
  const exe = process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE_PATH
    || '/usr/bin/playwright-webkit';
  if (!existsSync(exe)) {
    t.skip('WebKit executable not available');
    return;
  }
  npmPackInstall();
  await runBrowserE2E(t, webkit, exe);
});

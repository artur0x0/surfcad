/* eslint-env node */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright-core';
import { attachConsentPresetToBrowser } from '../scripts/golden/lib/presetConsentInit.mjs';
import { WebSocket } from 'ws';
import { PAIR_MSG } from '../src/agent/ws/relayHub.js';
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
import { withViteDistLock } from './lib/viteDistLock.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST_ASSETS = join(ROOT, 'dist/assets');
const FORBIDDEN = 'surfcadAgentBridgeAutoApprove';

function distJsFiles() {
  if (!existsSync(DIST_ASSETS)) return [];
  return readdirSync(DIST_ASSETS).filter((name) => name.endsWith('.js'));
}

function distContainsForbiddenKey() {
  return distJsFiles().some((name) => readFileSync(join(DIST_ASSETS, name), 'utf8').includes(FORBIDDEN));
}

function npmRun(script) {
  return spawnSync('npm', ['run', script], {
    cwd: ROOT,
    env: process.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

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

test('production dist bundle must not contain playtest auto-approve storage key', async () => {
  await withViteDistLock(async () => {
    const result = npmRun('build');
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const hits = distJsFiles().filter((name) => readFileSync(join(DIST_ASSETS, name), 'utf8').includes(FORBIDDEN));
    assert.deepEqual(
      hits,
      [],
      `forbidden string "${FORBIDDEN}" found in: ${hits.join(', ') || '(none)'}`,
    );
  });
});

test('playtest build includes auto-approve storage key', async () => {
  await withViteDistLock(async () => {
    const result = npmRun('build:playtest');
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(distContainsForbiddenKey(), true, 'expected playtest dist to retain auto-approve hook');
  });
});

test('localStorage auto-approve flag is ignored in production build', { timeout: 180_000 }, async (t) => {
  const exe = process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)
    ? process.env.CHROME_PATH
    : null;
  if (!exe) {
    t.skip('CHROME_PATH not set (smoke job only)');
    return;
  }

  await withViteDistLock(async () => {
  const prodBuild = npmRun('build');
  assert.equal(prodBuild.status, 0, prodBuild.stderr || prodBuild.stdout);
  assert.equal(distContainsForbiddenKey(), false, 'production build must not ship auto-approve key');

  const port = process.env.SMOKE_PORT
    ? Number(process.env.SMOKE_PORT)
    : await pickFreePort();
  const relayPort = await pickFreePort();
  const relayUrl = `ws://127.0.0.1:${relayPort}`;
  const baseUrl = `http://127.0.0.1:${port}/?agent=1&agentBridgeWs=${encodeURIComponent(relayUrl)}`;

  process.env.SURFCAD_AGENT_BRIDGE_EXTRA_ORIGINS = `http://127.0.0.1:${port}`;
  const relay = await ensureAgentBridgeRelay({ port: relayPort });

  const { stop } = startPreviewServer(port, {
    SURFCAD_AGENT_BRIDGE_WS_PORT: String(relayPort),
    SURFCAD_MCP_START_RELAY: '0',
  });

  let browser;
  let peerWs;
  try {
    if (!(await waitForServer(`http://127.0.0.1:${port}/`))) {
      throw new Error('preview did not start');
    }

    browser = await chromium.launch({
      executablePath: exe,
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
    attachConsentPresetToBrowser(browser);
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await installApiMocks(page);
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      () => typeof window.surfcad?.call === 'function' && !document.querySelector('[data-app-loading]'),
      { timeout: 120000 },
    );

    await page.evaluate(() => {
      localStorage.setItem('surfcadAgent', '1');
      localStorage.setItem('surfcadAgentBridgeAutoApprove', '1');
    });

    await page.locator('[data-profile-chip]').first().click();
    await page.click('[data-ui-action="data-agent-bridge-connect"]');
    await page.waitForSelector('[data-agent-bridge-waiting-relay]', { state: 'hidden', timeout: 15000 }).catch(() => {});
    await page.waitForSelector('[data-agent-bridge-code]', { state: 'visible', timeout: 15000 });
    const token = (await page.locator('[data-agent-bridge-code]').innerText()).trim();

    peerWs = new WebSocket(relayUrl);
    await waitOpen(peerWs);
    peerWs.send(JSON.stringify({ type: PAIR_MSG.PAIR, token }));

    await page.waitForSelector('[data-ui-action="data-agent-bridge-approve"]', {
      state: 'visible',
      timeout: 10000,
    });

    let pairedEarly = false;
    try {
      await page.waitForSelector('[data-agent-bridge-paired]', { state: 'visible', timeout: 1500 });
      pairedEarly = true;
    } catch {
      pairedEarly = false;
    }
    assert.equal(pairedEarly, false, 'production build must not auto-approve from localStorage');
  } finally {
    if (peerWs) {
      try { peerWs.close(); } catch { /* noop */ }
    }
    if (browser) await browser.close();
    stop();
    try { await stopAgentBridgeRelay(relay); } catch { /* noop */ }
    resetAgentBridgeRelayCache(relayPort);
  }
  });
});

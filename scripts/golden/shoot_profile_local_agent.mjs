#!/usr/bin/env node
/* global document */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { attachConsentPresetToBrowser } from './lib/presetConsentInit.mjs';

const PORT = Number(process.env.SMOKE_PORT || 4332);
const APP_URL = `http://localhost:${PORT}/?agent=1`;
const OUT = process.env.GOLDEN_SHOT_DIR || join('/opt/cursor/artifacts', 'desktop-layout-tweaks');
const CHROME = [
  process.env.CHROME_PATH,
  '/usr/local/bin/google-chrome',
  '/usr/bin/google-chrome',
].filter(Boolean).find((p) => existsSync(p));

if (!CHROME || !existsSync(new URL('../../dist/index.html', import.meta.url))) {
  console.log('profile local agent shot: skip (chrome or dist missing)');
  process.exit(0);
}

mkdirSync(OUT, { recursive: true });

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
  cwd: new URL('../../', import.meta.url).pathname,
  stdio: 'ignore',
  detached: true,
});
const stop = () => {
  try { process.kill(-server.pid, 'SIGTERM'); } catch { /* gone */ }
};
process.on('exit', stop);

async function waitForServer() {
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(APP_URL)).ok) return true;
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

try {
  if (!(await waitForServer())) throw new Error('server timeout');
  const browser = await chromium.launch({
    executablePath: CHROME,
    args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
  });
attachConsentPresetToBrowser(browser);
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.route('**/api/auth/me', (r) => r.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ authenticated: false }),
  }));
  await page.route('**/api/config', (r) => r.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({}),
  }));
  await page.goto(APP_URL, { waitUntil: 'load', timeout: 45000 });
  await page.waitForFunction(() => document.querySelector('#root')?.children.length > 0, null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(5000);
  await page.locator('[data-profile-chip]').first().click();
  await page.click('[data-ui-action="data-agent-bridge-toggle"]');
  await page.waitForSelector('[data-agent-bridge-panel]', { state: 'visible', timeout: 10000 });
  const panel = page.locator('[data-agent-bridge-panel]');
  await panel.screenshot({ path: join(OUT, 'profile-local-agent-section.png') });
  await browser.close();
  console.log(`wrote ${join(OUT, 'profile-local-agent-section.png')}`);
} finally {
  stop();
}

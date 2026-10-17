#!/usr/bin/env node
/**
 * Privacy choices dialog at 1280 and 375. Requires dist/ and system Chrome.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { attachConsentPresetToBrowser } from './lib/presetConsentInit.mjs';

const SHOT_DIR = process.env.GOLDEN_SHOT_DIR || join(tmpdir(), 'privacy-choices-shots');
const PORT = Number(process.env.SMOKE_PORT || 4321);
const APP_URL = `http://localhost:${PORT}/partners`;

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].filter(Boolean);

const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!exe) {
  console.log('privacy choices: no system Chrome — set CHROME_PATH. Skipping.');
  process.exit(0);
}

if (!existsSync(new URL('../../dist/index.html', import.meta.url))) {
  console.error('dist/ missing — run npm run build first');
  process.exit(1);
}

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
  cwd: new URL('../../', import.meta.url).pathname,
  stdio: 'ignore',
  detached: true,
});

let stopped = false;
const stop = () => {
  if (stopped) return;
  stopped = true;
  try {
    process.kill(-server.pid, 'SIGTERM');
  } catch {
    server.kill('SIGTERM');
  }
};

async function waitForServer() {
  for (let i = 0; i < 40; i += 1) {
    try {
      const res = await fetch(APP_URL);
      if (res.ok) return true;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

let failed = 0;
try {
  if (!await waitForServer()) {
    console.error('preview server did not start');
    process.exit(1);
  }

  mkdirSync(SHOT_DIR, { recursive: true });
  const browser = await chromium.launch({
    executablePath: exe,
    args: ['--no-sandbox', '--use-gl=swiftshader'],
  });
attachConsentPresetToBrowser(browser);

  for (const { label, width, height } of [
    { label: 'desktop', width: 1280, height: 900 },
    { label: 'mobile', width: 375, height: 812 },
  ]) {
    const page = await browser.newPage({ viewport: { width, height } });
    await page.route('**/api/auth/me', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ authenticated: false }),
    }));
    await page.goto(APP_URL, { waitUntil: 'load', timeout: 45000 });
    await page.locator('[data-privacy-choices-link]').click();
    await page.waitForSelector('[data-git-dialog="privacy-choices"]', { timeout: 10000 });
    await page.screenshot({ path: join(SHOT_DIR, `privacy-choices-${label}-${width}.png`) });
    await page.close();
    console.log(`wrote ${join(SHOT_DIR, `privacy-choices-${label}-${width}.png`)}`);
  }

  await browser.close();
} catch (err) {
  failed = 1;
  console.error(err);
} finally {
  stop();
}

process.exit(failed);

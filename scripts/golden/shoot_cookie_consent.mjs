#!/usr/bin/env node
/**
 * Cookie consent banner screenshots (desktop + mobile).
 */
/* global localStorage */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const SHOT_DIR = process.env.GOLDEN_SHOT_DIR || join(tmpdir(), 'surfcad-cookie-consent');
const PORT = Number(process.env.SMOKE_PORT || 4321);
const APP_URL = `http://localhost:${PORT}/`;

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].filter(Boolean);

const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!exe) {
  console.log('cookie consent shots: no Chrome — set CHROME_PATH');
  process.exit(0);
}

if (!existsSync(new URL('../../dist/index.html', import.meta.url))) {
  console.error('dist/ missing — run npm run build');
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
  try { process.kill(-server.pid, 'SIGTERM'); } catch { /* gone */ }
};
process.on('exit', stop);

async function waitForServer() {
  const started = Date.now();
  while (Date.now() - started < 30000) {
    try {
      const res = await fetch(APP_URL);
      if (res.ok) return;
    } catch { /* wait */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('preview server timeout');
}

async function shoot(page, name) {
  await page.waitForSelector('[data-cookie-consent-banner]', { timeout: 20000 });
  mkdirSync(SHOT_DIR, { recursive: true });
  const path = join(SHOT_DIR, name);
  await page.screenshot({ path, fullPage: false });
  console.log('wrote', path);
}

try {
  await waitForServer();
  const browser = await chromium.launch({
    executablePath: exe,
    args: ['--no-sandbox', '--use-gl=swiftshader'],
  });

  const init = async (page) => {
    await page.route('**/api/auth/me', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ authenticated: false }),
    }));
    await page.route('**/api/config', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({}),
    }));
    await page.addInitScript(() => {
      try {
        localStorage.removeItem('surfcad.consent.v1');
      } catch { /* private */ }
    });
  };

  const desktop = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await init(desktop);
  await desktop.goto(APP_URL, { waitUntil: 'load', timeout: 45000 });
  await shoot(desktop, 'cookie-consent-desktop-1280.png');

  const phone = await browser.newPage({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  await init(phone);
  await phone.goto(APP_URL, { waitUntil: 'load', timeout: 45000 });
  await shoot(phone, 'cookie-consent-mobile-390.png');

  await browser.close();
} finally {
  stop();
}

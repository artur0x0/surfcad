#!/usr/bin/env node
/**
 * First-visit privacy consent popup at 1280 and 390.
 * Appears with no stored choice, does not cover the CAD toolbar, Accept all
 * hides it and persists. Requires dist/ and system Chrome.
 */
/* global localStorage, sessionStorage */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { SURFCAD_CONSENT_STORAGE_KEY } from './lib/presetConsentInit.mjs';

const SHOT_DIR = process.env.GOLDEN_SHOT_DIR || join(tmpdir(), 'privacy-consent-shots');
const PORT = Number(process.env.SMOKE_PORT || 4331);
const APP_URL = `http://localhost:${PORT}/`;

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].filter(Boolean);

const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!exe) {
  console.log('privacy consent: no system Chrome — set CHROME_PATH. Skipping.');
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

function rectsOverlap(a, b) {
  if (!a || !b) return false;
  return a.x < b.x + b.width
    && a.x + a.width > b.x
    && a.y < b.y + b.height
    && a.y + a.height > b.y;
}

async function mockBootApis(page) {
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
}

async function clearConsentOnce(page) {
  await page.addInitScript((key) => {
    try {
      if (sessionStorage.getItem('surfcad.consent.clearOnce')) return;
      sessionStorage.setItem('surfcad.consent.clearOnce', '1');
      localStorage.removeItem(key);
    } catch {
      /* private mode */
    }
  }, SURFCAD_CONSENT_STORAGE_KEY);
}

async function visibleBox(locator) {
  const count = await locator.count();
  if (!count) return null;
  const first = locator.first();
  if (!await first.isVisible().catch(() => false)) return null;
  return first.boundingBox();
}

async function assertPopupClearsToolbar(page, label) {
  const popup = await page.locator('[data-privacy-consent-popup]').boundingBox();
  assert.ok(popup, `${label}: popup should be visible`);
  const toolbars = [
    page.locator('[data-toolbar-variant="strip"]').first(),
    page.locator('[data-cad-feature-strip]').first(),
    page.locator('[data-feature-bar-row]').first(),
    page.locator('[data-mobile-stage-toggle]').first(),
    page.locator('[data-home-indicator]').first(),
  ];
  for (const loc of toolbars) {
    const box = await visibleBox(loc);
    if (!box) continue;
    assert.equal(
      rectsOverlap(popup, box),
      false,
      `${label}: popup covers toolbar ${JSON.stringify({ popup, box })}`,
    );
  }
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

  for (const { label, width, height, isMobile } of [
    { label: 'desktop', width: 1280, height: 900, isMobile: false },
    { label: 'mobile', width: 390, height: 844, isMobile: true },
  ]) {
    const page = await browser.newPage({
      viewport: { width, height },
      hasTouch: isMobile,
      isMobile,
    });
    await mockBootApis(page);
    await clearConsentOnce(page);
    await page.goto(APP_URL, { waitUntil: 'load', timeout: 45000 });
    await page.waitForSelector('[data-privacy-consent-popup]', { timeout: 20000 });
    await page.waitForSelector('[data-app-loading]', { state: 'detached', timeout: 60000 }).catch(() => {});
    await page.waitForSelector(
      '[data-toolbar-variant="strip"], [data-mobile-stage-toggle], [data-cad-feature-strip]',
      { timeout: 30000 },
    ).catch(() => {});
    const copy = await page.locator('[data-privacy-consent-copy]').innerText();
    assert.match(
      copy,
      /SurfCAD uses required cookies to sign you in and save your work\.\s+Optional cookies help us improve the app, so please consider allowing all\./,
    );
    assert.match(copy, /Privacy page/);
    assert.doesNotMatch(copy, /Optional analytics start only if you accept/);
    await assertPopupClearsToolbar(page, label);
    await page.screenshot({ path: join(SHOT_DIR, `privacy-consent-${label}-${width}.png`) });
    console.log(`wrote ${join(SHOT_DIR, `privacy-consent-${label}-${width}.png`)}`);

    await page.locator('[data-privacy-consent-accept-all]').click();
    await page.waitForSelector('[data-privacy-consent-popup]', { state: 'detached', timeout: 10000 });
    const stored = await page.evaluate((key) => localStorage.getItem(key), SURFCAD_CONSENT_STORAGE_KEY);
    assert.ok(stored, `${label}: consent should persist after Accept all`);
    const parsed = JSON.parse(stored);
    assert.equal(parsed.analytics, true, `${label}: Accept all should store analytics true`);

    await page.reload({ waitUntil: 'load', timeout: 45000 });
    await page.waitForSelector('[data-app-loading]', { state: 'detached', timeout: 60000 }).catch(() => {});
    const stillOpen = await page.locator('[data-privacy-consent-popup]').count();
    assert.equal(stillOpen, 0, `${label}: popup must stay hidden after reload`);
    await page.close();
  }

  const privacy = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await mockBootApis(privacy);
  await privacy.addInitScript((key) => {
    try {
      localStorage.setItem(key, JSON.stringify({
        analytics: false,
        updatedAt: new Date().toISOString(),
        source: 'user',
      }));
    } catch {
      /* private */
    }
  }, SURFCAD_CONSENT_STORAGE_KEY);
  await privacy.goto(`http://localhost:${PORT}/privacy`, { waitUntil: 'load', timeout: 45000 });
  await privacy.waitForSelector('[data-privacy-page]', { timeout: 10000 });
  const gpcCopy = await privacy.locator('[data-privacy-gpc-honored]').innerText();
  assert.match(gpcCopy, /Your browser's Global Privacy Control signal is honored/);
  await privacy.locator('[data-privacy-change-choices]').click();
  await privacy.waitForSelector('[data-privacy-consent-popup]', { timeout: 10000 });
  await privacy.screenshot({ path: join(SHOT_DIR, 'privacy-page-change-choices-1280.png') });
  console.log(`wrote ${join(SHOT_DIR, 'privacy-page-change-choices-1280.png')}`);
  await privacy.close();

  await browser.close();
} catch (err) {
  failed = 1;
  console.error(err);
} finally {
  stop();
}

process.exit(failed);

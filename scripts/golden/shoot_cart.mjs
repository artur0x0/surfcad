#!/usr/bin/env node
/**
 * Cart screenshots at 390 and 1440. Writes PNGs under GOLDEN_SHOT_DIR or
 * os.tmpdir(). Not a CI golden — smoke_cart.mjs is the source check.
 *
 * Needs a production build (`npm run build`) and system Chrome.
 */
/* global document, indexedDB, localStorage */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { attachConsentPresetToBrowser } from './lib/presetConsentInit.mjs';
import { serializeAssembly } from '../../src/utils/assembly.js';
import { scriptHash } from '../../src/utils/cart.js';

const PORT = Number(process.env.SMOKE_PORT || 4318);
const APP_URL = `http://127.0.0.1:${PORT}/`;
const OUT = process.env.GOLDEN_SHOT_DIR || join(tmpdir(), 'surfcad-cart-shots');
const CHROME = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].filter(Boolean).find((path) => existsSync(path));

const USER = {
  _id: 'user-cart-demo',
  email: 'ada@example.com',
  firstName: 'Ada',
  lastName: 'Lovelace',
};
const SCRIPT_A = 'let part = Manifold.cube([40, 30, 20], true);\nreturn part;\n';
const SCRIPT_B = 'let part = Manifold.cube([24, 24, 10], true);\nreturn part;\n';
const DOC = serializeAssembly({
  version: 1,
  source: 'local',
  name: 'Bracket Box',
  activeId: 'part-bracket',
  parts: [
    { id: 'part-bracket', name: 'Bracket', visible: true, order: 0 },
    { id: 'part-plate', name: 'Plate', visible: true, order: 1 },
  ],
});
const SEEDED = {
  version: 0,
  lines: [{
    lineId: '00000000-0000-4000-8000-000000000001',
    source: 'local',
    assemblyName: 'Bracket Box',
    partId: 'part-bracket',
    surfId: null,
    partName: 'Bracket',
    scriptHash: scriptHash(SCRIPT_A),
    thumbDataUrl: null,
    qty: 1,
    options: null,
    addedAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  }],
  tombstones: [],
};

if (!CHROME) {
  console.log('cart shots: no system Chrome — set CHROME_PATH. Skipping.');
  process.exit(0);
}
if (!existsSync(new URL('../../dist/index.html', import.meta.url))) {
  console.log('cart shots: dist/ missing — run npm run build first');
  process.exit(1);
}

mkdirSync(OUT, { recursive: true });

const server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], {
  cwd: new URL('../../', import.meta.url).pathname,
  stdio: 'ignore',
  detached: true,
});
let stopped = false;
const stop = () => {
  if (stopped) return;
  stopped = true;
  try { process.kill(-server.pid, 'SIGTERM'); } catch { /* already gone */ }
  try { server.kill('SIGKILL'); } catch { /* already gone */ }
};
process.on('exit', stop);

async function waitForServer() {
  const started = Date.now();
  while (Date.now() - started < 30000) {
    try {
      const res = await fetch(APP_URL);
      if (res.ok) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

async function seedAssembly(page) {
  await page.evaluate(async ({ doc, scriptA, scriptB }) => {
    await new Promise((resolve, reject) => {
      const open = indexedDB.open('surfcad-assembly', 1);
      open.onupgradeneeded = () => {
        const db = open.result;
        if (!db.objectStoreNames.contains('assembly')) db.createObjectStore('assembly');
        if (!db.objectStoreNames.contains('parts')) db.createObjectStore('parts');
      };
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction(['assembly', 'parts'], 'readwrite');
        tx.objectStore('assembly').put(doc, 'current');
        tx.objectStore('parts').put({ id: 'part-bracket', script: scriptA, savedAt: Date.now() }, 'part-bracket');
        tx.objectStore('parts').put({ id: 'part-plate', script: scriptB, savedAt: Date.now() }, 'part-plate');
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
    });
  }, { doc: DOC, scriptA: SCRIPT_A, scriptB: SCRIPT_B });
}

async function shot(page, name) {
  const file = join(OUT, name);
  await page.screenshot({ path: file, fullPage: false });
  console.log(`  wrote ${file}`);
}

async function showParts(page, width) {
  if (width > 768) return;
  const parts = page.locator('[data-stage-btn="parts"]');
  if (await parts.count()) await parts.click();
  await page.waitForSelector('[data-parts-feed]', { timeout: 10000 });
}

async function capture(browser, width, height) {
  const page = await browser.newPage({ viewport: { width, height } });
  page.on('pageerror', (err) => console.log(`  pageerror ${width}: ${err.message}`));
  await page.addInitScript((seeded) => {
    localStorage.setItem('surfcad_cart:user-cart-demo', JSON.stringify(seeded));
  }, SEEDED);
  await page.route('**/api/**', (route) => {
    const url = route.request().url();
    if (url.includes('/api/auth/me')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ authenticated: true, user: USER }),
      });
    }
    if (url.includes('/api/config')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: '{}',
      });
    }
    if (url.includes('/api/quotes') && route.request().method() === 'POST') {
      const sent = route.request().postDataJSON() || {};
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          quoteId: 'quote-shot',
          quotedAt: new Date().toISOString(),
          quotedUnitPrice: 6.5,
          scriptHash: sent.scriptHash,
          process: sent.process || 'FDM',
          material: sent.material || 'PLA',
          infill: sent.infill ?? 20,
        }),
      });
    }
    return route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: '{}',
    });
  });

  await page.goto(APP_URL, { waitUntil: 'load', timeout: 45000 });
  await seedAssembly(page);
  await page.reload({ waitUntil: 'load', timeout: 45000 });
  // Phone parts pane stays mounted but `invisible` until the stage pill.
  await page.waitForSelector('[data-part-order="part-plate"]', { state: 'attached', timeout: 40000 });
  await showParts(page, width);
  await page.waitForSelector('[data-part-order="part-bracket"]', { state: 'visible', timeout: 10000 });
  // Viewport, parts, and script chips all mount. Only the on-screen one is visible.
  await page.locator('[data-cart-badge]:visible').first().waitFor({ timeout: 10000 });
  await shot(page, `cart-${width}-row.png`);

  await page.locator('[data-part-order="part-plate"]').click();
  const add = page.locator('[data-quote-add]');
  await add.waitFor({ timeout: 90000 });
  await add.click();
  await page.waitForSelector('[data-cart-flight]', { timeout: 90000 });
  await page.waitForTimeout(260);
  await page.evaluate(() => {
    for (const anim of document.getAnimations()) anim.pause();
  });
  await shot(page, `cart-${width}-flight.png`);
  await page.evaluate(() => {
    for (const anim of document.getAnimations()) anim.finish();
  });

  await page.waitForFunction(
    () => document.querySelector('[data-cart-badge]')?.getAttribute('data-cart-count') === '2',
    null,
    { timeout: 5000 },
  );
  await page.locator('[data-cart-badge]:visible').first().click();
  await page.waitForSelector('[data-cart-sheet]', { timeout: 5000 });
  await page.waitForFunction(
    () => document.querySelectorAll('[data-cart-line]').length >= 2,
    null,
    { timeout: 5000 },
  );
  await shot(page, `cart-${width}-sheet.png`);
  await page.close();
}

if (!await waitForServer()) {
  console.log(`cart shots: preview did not start on ${APP_URL}`);
  stop();
  process.exit(1);
}

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
attachConsentPresetToBrowser(browser);
try {
  await capture(browser, 390, 844);
  await capture(browser, 1440, 900);
  console.log(`cart shots in ${OUT}`);
} finally {
  await browser.close();
  stop();
}

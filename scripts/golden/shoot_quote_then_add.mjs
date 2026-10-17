#!/usr/bin/env node
/**
 * Quote-then-add screenshots at 390 and 1440: the quote modal ending in
 * Add to cart, the thumbnail flight, and a stale cart line.
 * Writes PNGs under GOLDEN_SHOT_DIR or os.tmpdir().
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

const PORT = Number(process.env.SMOKE_PORT || 4324);
const APP_URL = `http://127.0.0.1:${PORT}/`;
const OUT = process.env.GOLDEN_SHOT_DIR || join(tmpdir(), 'surfcad-quote-then-add-shots');
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
const QUOTED_AT = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
const SEEDED = {
  version: 0,
  lines: [{
    lineId: '00000000-0000-4000-8000-000000000001',
    source: 'local',
    assemblyName: 'Bracket Box',
    partId: 'part-bracket',
    surfId: null,
    partName: 'Bracket',
    scriptHash: 'not-the-live-script',
    thumbDataUrl: null,
    qty: 1,
    options: { process: 'FDM', material: 'PLA', infill: 20 },
    quotedUnitPrice: 4.5,
    quoteId: 'quote-old',
    quotedAt: QUOTED_AT,
    addedAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  }],
  tombstones: [],
};

if (!CHROME) {
  console.log('quote-then-add shots: no system Chrome — set CHROME_PATH. Skipping.');
  process.exit(0);
}
if (!existsSync(new URL('../../dist/index.html', import.meta.url))) {
  console.log('quote-then-add shots: dist/ missing — run npm run build first');
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

function fulfill(route, status, body) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
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
      return fulfill(route, 200, { authenticated: true, user: USER });
    }
    if (url.includes('/api/config')) {
      return fulfill(route, 200, {});
    }
    if (url.includes('/api/quotes') && route.request().method() === 'POST') {
      const sent = route.request().postDataJSON() || {};
      return fulfill(route, 201, {
        success: true,
        quoteId: 'quote-shot',
        quotedAt: new Date().toISOString(),
        quotedUnitPrice: 6.5,
        scriptHash: sent.scriptHash,
        process: sent.process || 'FDM',
        material: sent.material || 'PLA',
        infill: sent.infill ?? 20,
      });
    }
    return fulfill(route, 404, {});
  });

  await page.goto(APP_URL, { waitUntil: 'load', timeout: 45000 });
  await seedAssembly(page);
  await page.reload({ waitUntil: 'load', timeout: 45000 });
  await page.waitForSelector('[data-part-order="part-bracket"]', { state: 'attached', timeout: 40000 });
  await showParts(page, width);
  await page.waitForSelector('[data-part-order="part-bracket"]', { state: 'visible', timeout: 10000 });
  await page.locator('[data-part-order="part-bracket"]').click();
  const add = page.locator('[data-quote-add]');
  await add.waitFor({ timeout: 90000 });
  await add.evaluate((node) => {
    const scroller = node.closest('.overflow-y-auto');
    if (!scroller) {
      node.scrollIntoView({ block: 'center', inline: 'nearest' });
      return;
    }
    const rect = node.getBoundingClientRect();
    const box = scroller.getBoundingClientRect();
    scroller.scrollTop += rect.bottom - box.bottom + 24;
  });
  await page.waitForSelector('[data-quote-mode="add"]', { timeout: 5000 });
  await shot(page, `quote-then-add-${width}-modal.png`);

  await add.click();
  await page.waitForSelector('[data-cart-flight]', { timeout: 90000 });
  await page.waitForTimeout(260);
  await page.evaluate(() => {
    for (const anim of document.getAnimations()) anim.pause();
  });
  await shot(page, `quote-then-add-${width}-flight.png`);
  await page.evaluate(() => {
    for (const anim of document.getAnimations()) anim.finish();
  });

  await page.locator('[data-cart-badge]:visible').first().click();
  await page.waitForSelector('[data-cart-sheet]', { timeout: 5000 });
  await page.waitForSelector('[data-cart-stale]', { timeout: 5000 });
  await shot(page, `quote-then-add-${width}-stale.png`);
  await page.close();
}

if (!await waitForServer()) {
  console.log(`quote-then-add shots: preview did not start on ${APP_URL}`);
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
  console.log(`quote-then-add shots in ${OUT}`);
} finally {
  await browser.close();
  stop();
}

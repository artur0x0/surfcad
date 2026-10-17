#!/usr/bin/env node
/**
 * Checkout stepper screenshots at 390 and 1440. Writes PNGs under
 * GOLDEN_SHOT_DIR or os.tmpdir(). Not a CI golden — smoke_cart_checkout.mjs
 * is the source check.
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

const PORT = Number(process.env.SMOKE_PORT || 4321);
const APP_URL = `http://127.0.0.1:${PORT}/`;
const OUT = process.env.GOLDEN_SHOT_DIR || join(tmpdir(), 'surfcad-cart-checkout-shots');
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
  addresses: [{
    name: 'Ada Lovelace',
    street: '1 Analytical Engine',
    city: 'London',
    state: 'CA',
    zip: '94105',
    country: 'US',
    isDefault: true,
  }],
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

function line(id, partId, partName, script, qty) {
  return {
    lineId: id,
    source: 'local',
    assemblyName: 'Bracket Box',
    partId,
    surfId: null,
    partName,
    scriptHash: scriptHash(script),
    thumbDataUrl: null,
    qty,
    options: null,
    addedAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  };
}

const SEEDED = {
  version: 0,
  lines: [
    line('00000000-0000-4000-8000-000000000001', 'part-bracket', 'Bracket', SCRIPT_A, 3),
    line('00000000-0000-4000-8000-000000000002', 'part-plate', 'Plate', SCRIPT_B, 1),
  ],
  tombstones: [],
};

if (!CHROME) {
  console.log('cart checkout shots: no system Chrome — set CHROME_PATH. Skipping.');
  process.exit(0);
}
if (!existsSync(new URL('../../dist/index.html', import.meta.url))) {
  console.log('cart checkout shots: dist/ missing — run npm run build first');
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
    if (url.includes('/api/shipping/calculate-package')) {
      return fulfill(route, 200, {
        success: true,
        packageInfo: {
          dimensions: { length: 4, width: 3, height: 2 },
          weight: 1.2,
        },
      });
    }
    if (url.includes('/api/shipping/quote')) {
      return fulfill(route, 200, {
        success: true,
        rates: [{
          code: 'ground',
          name: 'Ground',
          price: 8.5,
          estimatedDays: '5-7 business days',
          carrier: 'UPS',
        }],
      });
    }
    if (url.includes('/api/orders/create')) {
      return fulfill(route, 201, {
        success: true,
        priceUpdated: false,
        order: {
          id: 'order-1',
          orderNumber: 'SC-1001',
          subtotal: 5.49,
          shipping: 8.5,
          tax: 0,
          total: 13.99,
          quantity: 3,
        },
        clientSecret: 'pi_test_secret_checkout',
        publishableKey: 'pk_test_checkout_stepper',
      });
    }
    return fulfill(route, 404, {});
  });

  await page.goto(APP_URL, { waitUntil: 'load', timeout: 45000 });
  await seedAssembly(page);
  await page.reload({ waitUntil: 'load', timeout: 45000 });
  await page.waitForSelector('[data-part-order="part-plate"]', { state: 'attached', timeout: 40000 });
  await showParts(page, width);
  await page.locator('[data-cart-badge]:visible').first().waitFor({ timeout: 15000 });
  await page.locator('[data-cart-badge]:visible').first().click();
  await page.waitForSelector('[data-cart-sheet]', { timeout: 5000 });
  await page.waitForFunction(
    () => document.querySelectorAll('[data-cart-line]').length >= 2,
    null,
    { timeout: 5000 },
  );
  const checkout = page.locator('[data-cart-checkout]');
  if (await checkout.isDisabled()) {
    const note = await page.locator('[data-cart-checkout-skip]').textContent().catch(() => '');
    throw new Error(`checkout disabled ${width}: ${note}`);
  }
  await checkout.click();
  await page.waitForSelector('[data-checkout-stepper]', { timeout: 10000 });
  await page.waitForFunction(
    () => document.querySelector('[data-checkout-progress]')?.textContent?.includes('Line 1 of 2'),
    null,
    { timeout: 5000 },
  );
  await page.waitForSelector('[data-quote-qty]', { timeout: 90000 });
  await page.locator('[data-quote-total]').scrollIntoViewIfNeeded();
  await shot(page, `cart-checkout-${width}-quote.png`);

  await page.getByRole('button', { name: 'Order', exact: true }).click();
  const pay = page.getByRole('button', { name: 'Continue to Payment' });
  await pay.waitFor({ timeout: 20000 });
  await pay.click();
  await page.waitForSelector('[data-payment-qty]', { timeout: 20000 });
  await page.waitForFunction(
    () => document.querySelector('[data-checkout-progress]')?.textContent?.includes('Line 1 of 2'),
    null,
    { timeout: 5000 },
  );
  await shot(page, `cart-checkout-${width}-payment.png`);
  await page.close();
}

if (!await waitForServer()) {
  console.log(`cart checkout shots: preview did not start on ${APP_URL}`);
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
  console.log(`cart checkout shots in ${OUT}`);
} finally {
  await browser.close();
  stop();
}

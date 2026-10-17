#!/usr/bin/env node
/**
 * One-page checkout. Source checks, then a browser pass at 390 and 1440:
 * two lines, a qty edit, a remove, an address choice, a multi-box shipping
 * quote, the price-updated confirm, and a single pay call.
 *
 * Shots go to GOLDEN_SHOT_DIR or os.tmpdir(). Needs a production build and
 * system Chrome.
 */
/* global document, indexedDB, localStorage, window */
import { readFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';
import { attachConsentPresetToBrowser } from './lib/presetConsentInit.mjs';
import { serializeAssembly } from '../../src/utils/assembly.js';
import { scriptHash } from '../../src/utils/cart.js';
import {
  planCheckout,
  checkoutPageNote,
} from '../../src/utils/checkoutPage.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(join(root, rel), 'utf8');

let failed = 0;
let passed = 0;
function ok(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${extra ? ` — ${extra}` : ''}`); }
}

console.log('checkout page — one pay, not the per-line stepper');
{
  const page = read('src/components/checkout/CheckoutPage.jsx');
  const pay = read('src/components/checkout/CheckoutPay.jsx');
  const payUtil = read('src/utils/checkoutPay.js');
  const app = read('src/App.jsx');
  const hook = read('src/hooks/useCart.jsx');
  const account = read('src/components/AccountModal.jsx');
  const picker = read('src/components/checkout/AddressPicker.jsx');
  const orders = read('backend/routes/orders.js');
  const ui = read('docs/UI_MAP.md');
  const arch = read('docs/architecture.md');

  ok('cart checkout opens the page and does not start the stepper',
    /setShowCheckoutPage\(true\)/.test(app)
    && !/onCartCheckoutRef\.current = \(queue\)/.test(app));
  ok('singular create and the in-flight order modal stay',
    /modelData:\s*\{/.test(read('src/components/order/PaymentStep.jsx'))
    && /setShowOrderModal\(true\)/.test(app)
    && /requireGuestOrAuth/.test(orders));
  ok('one confirmPayment, not a loop over lines',
    (payUtil.match(/confirmPayment\(/g) || []).length === 1
    && !/for\s*\([^)]*lines[^)]*\)\s*\{[^}]*confirmPayment/.test(payUtil)
    && /data-checkout-pay/.test(pay)
    && /data-price-updated/.test(pay));
  ok('create sends lines once from the page',
    /\/api\/orders\/create/.test(page)
    && /buildCheckoutCreateBody/.test(page)
    && /Idempotency-Key/.test(page));
  ok('stale lines re-quote, then the paid lines are tombstoned',
    /\/api\/quotes/.test(page)
    && /noteQuote/.test(page)
    && /onPaid\?\.\(ids\)/.test(page)
    && /noteQuote/.test(hook));
  ok('address picker chooses, adds, and sets the default',
    /data-address-choice/.test(picker)
    && /data-address-add/.test(picker)
    && /data-address-make-default/.test(picker)
    && /\/api\/auth\/address/.test(picker));
  ok('shipping shows the box count',
    /data-shipping-boxes/.test(page)
    && /data-shipping-quote/.test(page));
  ok('account orders list lines, with a model-data fallback',
    /displayOrderLines/.test(account)
    && /data-order-line/.test(account));
  ok('guests still open LoginModal',
    /onNeedLogin:\s*\(\)\s*=>\s*setShowLoginModal\(true\)/.test(app)
    && /intent === 'login'/.test(hook));
  ok('docs name the one-page checkout and the 20-line cap',
    /data-checkout-page/.test(ui)
    && /one page/.test(arch)
    && /expand in future/.test(arch));
  const freshPlan = planCheckout(null, {}, {
    lines: [{
      lineId: '00000000-0000-4000-8000-000000000001',
      source: 'local',
      assemblyName: 'Box',
      partId: 'part-1',
      partName: 'Bracket',
      scriptHash: scriptHash('return 1;'),
      qty: 1,
      options: { process: 'FDM', material: 'PLA', infill: 20 },
      quotedUnitPrice: 4,
      quoteId: 'q',
      quotedAt: new Date().toISOString(),
      addedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }],
    tombstones: [],
  });
  const expiredPlan = planCheckout(null, {}, {
    lines: [{
      lineId: '00000000-0000-4000-8000-000000000002',
      source: 'local',
      assemblyName: 'Box',
      partId: 'part-1',
      partName: 'Bracket',
      scriptHash: 'abc',
      qty: 1,
      options: null,
      quotedUnitPrice: null,
      quoteId: null,
      quotedAt: null,
      addedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }],
    tombstones: [],
  });
  ok('a closed fresh quote is payable and an expired one is not',
    freshPlan.payable.length === 1
    && expiredPlan.payable.length === 0
    && checkoutPageNote(expiredPlan) === 'Open an assembly to check out.');
}

if (failed) {
  console.log(`\n❌ FAIL (${failed} failed, ${passed} passed)`);
  process.exit(1);
}

const PORT = Number(process.env.SMOKE_PORT || 4377);
const APP_URL = `http://127.0.0.1:${PORT}/`;
const OUT = process.env.GOLDEN_SHOT_DIR || join(tmpdir(), 'surfcad-checkout-page-shots');
const ARTIFACTS = '/opt/cursor/artifacts';
const CHROME = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].filter(Boolean).find((path) => existsSync(path));

const SCRIPT_A = 'let part = Manifold.cube([40, 30, 20], true);\nreturn part;\n';
const SCRIPT_B = 'let part = Manifold.cube([24, 24, 10], true);\nreturn part;\n';
const QUOTED_AT = new Date().toISOString();

function cartLine(lineId, partId, partName, script, qty) {
  return {
    lineId,
    source: 'local',
    assemblyName: 'Bracket Box',
    partId,
    surfId: null,
    partName,
    scriptHash: scriptHash(script),
    thumbDataUrl: null,
    qty,
    options: { process: 'FDM', material: 'PLA', infill: 20 },
    quotedUnitPrice: 4.5,
    quoteId: `quote-${partId}`,
    quotedAt: QUOTED_AT,
    addedAt: QUOTED_AT,
    updatedAt: QUOTED_AT,
  };
}

const USER = {
  _id: 'user-checkout-page',
  email: 'ada@example.com',
  firstName: 'Ada',
  lastName: 'Lovelace',
  addresses: [
    {
      _id: 'addr-home',
      name: 'Ada Lovelace',
      street: '1 Analytical Engine',
      city: 'Oakland',
      state: 'CA',
      zip: '94607',
      country: 'US',
      isDefault: true,
    },
    {
      _id: 'addr-lab',
      name: 'Ada Lovelace',
      street: '9 Difference Court',
      city: 'Berkeley',
      state: 'CA',
      zip: '94704',
      country: 'US',
      isDefault: false,
    },
  ],
};

const SEEDED = {
  version: 1,
  lines: [
    cartLine('00000000-0000-4000-8000-000000000001', 'part-bracket', 'Bracket', SCRIPT_A, 2),
    cartLine('00000000-0000-4000-8000-000000000002', 'part-plate', 'Plate', SCRIPT_B, 1),
  ],
  tombstones: [],
};

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

if (!CHROME) {
  console.log('\n❌ checkout page golden: no system Chrome');
  process.exit(1);
}
if (!existsSync(new URL('../../dist/index.html', import.meta.url))) {
  console.log('\n❌ checkout page golden: dist/ missing — run npm run build first');
  process.exit(1);
}

mkdirSync(OUT, { recursive: true });
mkdirSync(ARTIFACTS, { recursive: true });

const server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], {
  cwd: root,
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

function fulfill(route, status, body) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
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

async function showParts(page, width) {
  if (width > 768) return;
  const parts = page.locator('[data-stage-btn="parts"]');
  if (await parts.count()) await parts.click();
  await page.waitForSelector('[data-parts-feed]', { timeout: 10000 });
}

async function capture(browser, width, height) {
  const counts = { create: 0, pay: 0, quote: 0 };
  const page = await browser.newPage({ viewport: { width, height } });
  page.on('pageerror', (err) => console.log(`  pageerror ${width}: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log(`  console ${width}: ${msg.text()}`);
  });
  await page.addInitScript((seeded) => {
    localStorage.setItem('surfcad_cart:user-checkout-page', JSON.stringify(seeded));
    window.__surfcadPayCalls = 0;
    const element = () => ({
      mount() {},
      unmount() {},
      on() { return this; },
      off() { return this; },
      update() {},
      destroy() {},
      collapse() {},
    });
    window.Stripe = function stripeFactory() {
      const stripe = {
        elements() {
          return {
            create() { return element(); },
            getElement() { return element(); },
            update() {},
            fetchUpdates() { return Promise.resolve({}); },
            submit() { return Promise.resolve({}); },
          };
        },
        createToken() { return Promise.resolve({}); },
        createPaymentMethod() { return Promise.resolve({}); },
        confirmCardPayment() { return Promise.resolve({}); },
        confirmPayment() {
          window.__surfcadPayCalls += 1;
          return Promise.resolve({
            paymentIntent: { id: 'pi_checkout_test', status: 'succeeded' },
          });
        },
      };
      return stripe;
    };
  }, SEEDED);
  await page.route('**/api/**', (route) => {
    const url = route.request().url();
    const method = route.request().method();
    if (url.includes('/api/auth/me')) {
      return fulfill(route, 200, { authenticated: true, user: USER });
    }
    if (url.includes('/api/config')) return fulfill(route, 200, {});
    if (url.includes('/api/cart')) return fulfill(route, 404, {});
    if (url.includes('/api/shipping/calculate-package')) {
      return fulfill(route, 200, {
        success: true,
        packageInfo: {
          boxCount: 2,
          boxes: [
            { dimensions: { length: 10, width: 8, height: 6 }, weight: 4 },
            { dimensions: { length: 12, width: 8, height: 6 }, weight: 5 },
          ],
        },
      });
    }
    if (url.includes('/api/shipping/quote')) {
      return fulfill(route, 200, {
        success: true,
        rates: [
          { code: 'ground', name: 'UPS Ground', price: 8.5, estimatedDays: '5-7 business days', carrier: 'UPS' },
          { code: '2day', name: 'UPS 2nd Day Air', price: 18, estimatedDays: '2 business days', carrier: 'UPS' },
          { code: 'overnight', name: 'UPS Next Day Air', price: 32, estimatedDays: '1 business day', carrier: 'UPS' },
        ],
      });
    }
    if (url.includes('/api/orders/create') && method === 'POST') {
      counts.create += 1;
      const raw = route.request().postData() || '{}';
      let body = {};
      try { body = JSON.parse(raw); } catch { /* keep empty */ }
      if (!Array.isArray(body.lines) || body.lines.length !== 1) {
        return fulfill(route, 400, { error: `expected 1 line after remove, got ${body.lines?.length}` });
      }
      if (body.lines[0].quantity !== 3) {
        return fulfill(route, 400, { error: `expected qty 3, got ${body.lines[0].quantity}` });
      }
      if (body.modelData) return fulfill(route, 400, { error: 'singular modelData is not this checkout' });
      return fulfill(route, 201, {
        success: true,
        priceUpdated: true,
        order: {
          id: 'order-checkout-1',
          orderNumber: 'ORD-202610-0001AB',
          subtotal: 18,
          shipping: 17,
          tax: 2.5,
          total: 37.5,
          lineCount: 1,
          boxCount: 2,
          lines: [{ lineId: body.lines[0].lineId, partName: 'Bracket', quantity: 3, quotedUnitPrice: 6 }],
        },
        skipped: [],
        clientSecret: 'pi_test_secret_checkout_page',
        publishableKey: 'pk_test_checkout_page',
      });
    }
    if (url.includes('/api/orders/order-checkout-1/confirm') && method === 'POST') {
      return fulfill(route, 200, {
        success: true,
        order: { orderNumber: 'ORD-202610-0001AB', status: 'paid', total: 37.5, quantity: 3 },
      });
    }
    if (url.includes('/api/quotes')) {
      counts.quote += 1;
      return fulfill(route, 201, { quoteId: 'should-not-requote' });
    }
    return fulfill(route, 404, {});
  });

  await page.goto(APP_URL, { waitUntil: 'load', timeout: 45000 });
  await seedAssembly(page);
  await page.reload({ waitUntil: 'load', timeout: 45000 });
  await page.waitForSelector('[data-part-order="part-plate"]', { state: 'attached', timeout: 40000 });
  await showParts(page, width);
  await page.locator('[data-cart-badge]:visible').first().click();
  await page.waitForSelector('[data-cart-sheet]', { timeout: 5000 });
  const checkout = page.locator('[data-cart-checkout]');
  if (await checkout.isDisabled()) {
    const note = await page.locator('[data-cart-checkout-skip]').textContent().catch(() => '');
    throw new Error(`checkout disabled ${width}: ${note}`);
  }
  await checkout.click();
  await page.waitForSelector('[data-checkout-page]', { timeout: 10000 });
  await page.waitForFunction(
    () => document.querySelectorAll('[data-checkout-line]').length === 2,
    null,
    { timeout: 5000 },
  );
  if (await page.locator('[data-checkout-stepper]').count()) {
    throw new Error('per-line stepper opened');
  }

  const bracket = page.locator('[data-checkout-line="00000000-0000-4000-8000-000000000001"]');
  await bracket.locator('[data-checkout-qty-inc]').click();
  await page.waitForFunction(
    () => document.querySelector('[data-checkout-line="00000000-0000-4000-8000-000000000001"] [data-checkout-qty]')
      ?.getAttribute('data-checkout-qty') === '3',
    null,
    { timeout: 5000 },
  );

  await page.locator('[data-address-choice="addr-lab"]').click();
  await page.waitForFunction(
    () => document.querySelector('[data-address-choice="addr-lab"]')?.getAttribute('data-address-selected') === 'true',
    null,
    { timeout: 5000 },
  );

  await page.waitForSelector('[data-shipping-boxes="2"]', { timeout: 90000 });
  const boxesText = await page.locator('[data-shipping-boxes]').innerText();
  if (!/2 boxes/.test(boxesText)) throw new Error(`box copy: ${boxesText}`);
  const groundText = await page.locator('[data-shipping-method="ground"]').innerText();
  if (!groundText.includes('$17.00')) throw new Error(`expected summed ground rate, got ${groundText}`);

  const shotReview = join(OUT, `checkout-page-${width}.png`);
  await page.screenshot({ path: shotReview, fullPage: false });
  console.log(`  wrote ${shotReview}`);

  await page.locator('[data-checkout-line="00000000-0000-4000-8000-000000000002"] [data-checkout-remove]').click();
  await page.locator('[data-cart-remove-confirm]').click();
  await page.waitForFunction(
    () => document.querySelectorAll('[data-checkout-line]').length === 1,
    null,
    { timeout: 5000 },
  );
  await page.waitForSelector('[data-shipping-boxes="2"]', { timeout: 90000 });

  await page.locator('[data-checkout-review]').click();
  await page.waitForSelector('[data-price-updated]', { timeout: 15000 });
  const payButton = page.locator('[data-checkout-pay]');
  if (await payButton.isEnabled()) throw new Error('Pay was enabled before the price confirm');
  await page.locator('[data-price-updated]').scrollIntoViewIfNeeded();
  const shotPay = join(OUT, `checkout-page-${width}-pay.png`);
  await page.screenshot({ path: shotPay, fullPage: false });
  console.log(`  wrote ${shotPay}`);
  copyFileSync(shotPay, join(ARTIFACTS, `checkout-page-${width}.png`));

  await page.locator('[data-price-confirm]').click();
  await page.locator('[data-checkout-terms]').check();
  await page.waitForFunction(
    () => document.querySelector('[data-checkout-pay]') && !document.querySelector('[data-checkout-pay]').disabled,
    null,
    { timeout: 10000 },
  );

  await payButton.click();
  await page.waitForSelector('[data-checkout-confirmation]', { timeout: 15000 });
  const payCalls = await page.evaluate(() => window.__surfcadPayCalls);
  counts.pay = payCalls;
  if (counts.create !== 1) throw new Error(`create calls ${counts.create}`);
  if (counts.pay !== 1) throw new Error(`pay calls ${counts.pay}`);
  if (counts.quote !== 0) throw new Error(`unexpected re-quote calls ${counts.quote}`);
  await page.close();
  console.log(`  ${width}px: qty edit, remove, address, 2 boxes, price confirm, 1 pay`);
}

if (!await waitForServer()) {
  console.log(`\n❌ checkout page golden: preview did not start on ${APP_URL}`);
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
  console.log(failed ? `\n❌ FAIL (${failed} failed, ${passed} passed)` : `\n✅ PASS (${passed})`);
} catch (err) {
  console.log(`\n❌ ${err?.stack || err?.message || err}`);
  failed += 1;
} finally {
  await browser.close();
  stop();
}
process.exit(failed ? 1 : 0);

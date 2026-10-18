#!/usr/bin/env node
/**
 * Cart remove confirm, on the cart sheet and the one-page checkout.
 * Remove opens a confirm that names the part. Cancel keeps the line.
 * Confirming removes it, and that removal syncs the cart once.
 * A quantity change does not ask. 390px, so the phone layout fits.
 *
 * Shots go to GOLDEN_SHOT_DIR or os.tmpdir(). Needs a production build
 * and system Chrome.
 */
/* global document, indexedDB, localStorage, getComputedStyle */
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';
import { attachConsentPresetToBrowser } from './lib/presetConsentInit.mjs';
import { serializeAssembly } from '../../src/utils/assembly.js';
import { scriptHash } from '../../src/utils/cart.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(join(root, rel), 'utf8');

let failed = 0;
let passed = 0;
function ok(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${extra ? ` — ${extra}` : ''}`); }
}

console.log('cart remove confirm — both surfaces, Cancel default');
{
  const dialog = read('src/components/CartRemoveDialog.jsx');
  const sheet = read('src/components/CartSheet.jsx');
  const page = read('src/components/checkout/CheckoutPage.jsx');
  const quote = read('src/components/QuoteModal.jsx');
  const ui = read('docs/ui-map.md');
  const sheetRemove = sheet.slice(sheet.indexOf('data-cart-remove=""'));
  const pageRemove = page.slice(page.indexOf('data-checkout-remove=""'));

  ok('dialog matches the part-delete card and portals off ModalFit',
    /createPortal\(/.test(dialog)
    && /document\.body/.test(dialog)
    && !/import ModalFit/.test(dialog)
    && !/<ModalFit/.test(dialog)
    && /surface-scrim/.test(dialog)
    && /surface-glass/.test(dialog)
    && /z-\[100\]/.test(dialog));
  ok('the message names the part and Remove is destructive',
    /data-cart-remove-name/.test(dialog)
    && /from the cart\?/.test(dialog)
    && /can't be undone/.test(dialog)
    && /data-cart-remove-cancel/.test(dialog)
    && /data-cart-remove-confirm/.test(dialog)
    && /bg-red-600/.test(dialog)
    && /cancelRef\.current\?\.focus\(\)/.test(dialog));
  ok('Cancel is the default: focused, first, and Escape cancels',
    dialog.indexOf('data-cart-remove-cancel') < dialog.indexOf('data-cart-remove-confirm')
    && /event\.key !== 'Escape'/.test(dialog)
    && /onCancel\?\.\(\)/.test(dialog));
  ok('the sheet asks, then removes once',
    /setPendingRemove\(/.test(sheet)
    && /CartRemoveDialog/.test(sheet)
    && /cart\.removeLine\?\.\(lineId\)/.test(sheet)
    && !/onClick=\{\(\) => cart\.removeLine/.test(sheetRemove));
  ok('checkout asks, then removes once',
    /setPendingRemove\(/.test(page)
    && /CartRemoveDialog/.test(page)
    && /cart\?\.removeLine\?\.\(lineId\)/.test(page)
    && !/onClick=\{\(\) => cart\?\.removeLine/.test(pageRemove));
  ok('quantity still changes without a confirm',
    /onClick=\{\(\) => cart\.changeQty\?\.\(line\.lineId/.test(sheet)
    && /onClick=\{\(\) => cart\?\.changeQty\?\.\(row\.lineId/.test(page)
    && !/changeQty[\s\S]{0,80}setPendingRemove/.test(sheet)
    && !/changeQty[\s\S]{0,80}setPendingRemove/.test(page));
  ok('quote and checkout ModalFit caps are unchanged',
    /className="surface-scrim flex items-center justify-center z-50 px-4"/.test(quote)
    && /cap="92vh"/.test(page)
    && /cap="85vh"/.test(sheet)
    && /modal-fit-sheet z-\[90\]/.test(page)
    && /modal-fit-sheet z-\[80\]/.test(sheet));
  ok('the UI map names the confirm',
    /data-cart-remove-dialog/.test(ui)
    && /Cancel is the default/.test(ui));
}

if (failed) {
  console.log(`\n❌ FAIL (${failed} failed, ${passed} passed)`);
  process.exit(1);
}

const PORT = Number(process.env.SMOKE_PORT || 4388);
const APP_URL = `http://127.0.0.1:${PORT}/`;
const OUT = process.env.GOLDEN_SHOT_DIR || join(tmpdir(), 'surfcad-cart-remove-shots');
const CHROME = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].filter(Boolean).find((path) => existsSync(path));

const SCRIPT_A = 'let part = Manifold.cube([40, 30, 20], true);\nreturn part;\n';
const SCRIPT_B = 'let part = Manifold.cube([24, 24, 10], true);\nreturn part;\n';
const QUOTED_AT = new Date().toISOString();
const THUMB = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const BRACKET = '00000000-0000-4000-8000-000000000001';
const PLATE = '00000000-0000-4000-8000-000000000002';

function cartLine(lineId, partId, partName, script, qty) {
  return {
    lineId,
    source: 'local',
    assemblyName: 'Bracket Box',
    partId,
    surfId: null,
    partName,
    scriptHash: scriptHash(script),
    thumbDataUrl: THUMB,
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
  _id: 'user-cart-remove',
  email: 'ada@example.com',
  firstName: 'Ada',
  lastName: 'Lovelace',
  addresses: [],
};

const SEEDED = {
  version: 1,
  lines: [
    cartLine(BRACKET, 'part-bracket', 'Bracket', SCRIPT_A, 1),
    cartLine(PLATE, 'part-plate', 'Plate', SCRIPT_B, 1),
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
  console.log('\n❌ cart remove confirm: no system Chrome');
  process.exit(1);
}
if (!existsSync(new URL('../../dist/index.html', import.meta.url))) {
  console.log('\n❌ cart remove confirm: dist/ missing — run npm run build first');
  process.exit(1);
}

mkdirSync(OUT, { recursive: true });

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

async function shot(page, name) {
  const file = join(OUT, name);
  await page.screenshot({ path: file, fullPage: false });
  console.log(`  wrote ${file}`);
  if (file.startsWith('/opt/cursor/artifacts')) {
    throw new Error(`shot escaped to artifacts: ${file}`);
  }
}

async function settle(sync, page) {
  let last = -1;
  const started = Date.now();
  while (Date.now() - started < 8000) {
    if (sync.put === last) {
      await page.waitForTimeout(700);
      if (sync.put === last) return sync.put;
    }
    last = sync.put;
    await page.waitForTimeout(100);
  }
  throw new Error(`cart sync did not settle at ${sync.put}`);
}

async function expectPuts(sync, page, from, extra) {
  const started = Date.now();
  while (Date.now() - started < 5000 && sync.put < from + extra) {
    await page.waitForTimeout(50);
  }
  await page.waitForTimeout(800);
  const delta = sync.put - from;
  if (delta !== extra) {
    throw new Error(`expected ${extra} cart sync${extra === 1 ? '' : 's'}, got ${delta} (puts ${JSON.stringify(sync.notes)})`);
  }
}

function fits(box, width, height, label) {
  if (!box) throw new Error(`${label} has no box`);
  if (box.x < -1 || box.y < -1 || box.x + box.width > width + 1 || box.y + box.height > height + 1) {
    throw new Error(`${label} overflows 390: ${JSON.stringify(box)}`);
  }
}

async function openRemove(page, lineSelector, name) {
  await page.locator(`${lineSelector} [data-cart-remove], ${lineSelector} [data-checkout-remove]`).click();
  await page.waitForSelector('[data-cart-remove-dialog]', { timeout: 5000 });
  const shown = await page.locator('[data-cart-remove-name]').innerText();
  if (shown !== name) throw new Error(`confirm named ${shown}, expected ${name}`);
  const message = await page.locator('[data-cart-remove-message]').innerText();
  if (!message.includes(name) || !/can't be undone/.test(message)) {
    throw new Error(`message: ${message}`);
  }
  const focused = await page.evaluate(() => document.activeElement?.hasAttribute('data-cart-remove-cancel') === true);
  if (!focused) throw new Error('Cancel is not the focused default');
  const tone = await page.locator('[data-cart-remove-confirm]').evaluate((node) => getComputedStyle(node).backgroundColor);
  if (tone !== 'rgb(220, 38, 38)') throw new Error(`Remove background ${tone}`);
}

async function capture(browser) {
  const width = 390;
  const height = 844;
  const sync = { put: 0, notes: [] };
  const page = await browser.newPage({ viewport: { width, height } });
  page.on('pageerror', (err) => console.log(`  pageerror: ${err.message}`));
  await page.addInitScript((seeded) => {
    localStorage.setItem('surfcad_cart:user-cart-remove', JSON.stringify(seeded));
  }, SEEDED);
  await page.route('**/api/**', (route) => {
    const url = route.request().url();
    const method = route.request().method();
    if (url.includes('/api/auth/me')) {
      return fulfill(route, 200, { authenticated: true, user: USER });
    }
    if (url.includes('/api/config')) return fulfill(route, 200, {});
    if (url.includes('/api/cart') && method === 'PUT') {
      let body = {};
      try { body = route.request().postDataJSON() || {}; } catch { body = {}; }
      const ids = (body.lines || []).map((line) => line.lineId);
      sync.put += 1;
      sync.notes.push(ids.join(',') || '(empty)');
      return fulfill(route, 200, {
        version: (Number(body.baseVersion) || 0) + 1,
        lines: Array.isArray(body.lines) ? body.lines : [],
        tombstones: Array.isArray(body.tombstones) ? body.tombstones : [],
        merged: true,
      });
    }
    if (url.includes('/api/cart')) {
      return fulfill(route, 200, { version: 1, lines: SEEDED.lines, tombstones: [], merged: false });
    }
    if (url.includes('/api/shipping/')) {
      return fulfill(route, 200, { success: true, packageInfo: { boxCount: 1, boxes: [] }, rates: [] });
    }
    return fulfill(route, 404, {});
  });

  await page.goto(APP_URL, { waitUntil: 'load', timeout: 45000 });
  await seedAssembly(page);
  await page.reload({ waitUntil: 'load', timeout: 45000 });
  await page.waitForSelector('[data-part-order="part-plate"]', { state: 'attached', timeout: 40000 });
  const parts = page.locator('[data-stage-btn="parts"]');
  if (await parts.count()) await parts.click();
  await page.waitForSelector('[data-parts-feed]', { timeout: 10000 });
  await page.locator('[data-cart-badge]:visible').first().waitFor({ timeout: 10000 });
  await page.locator('[data-cart-badge]:visible').first().click();
  await page.waitForSelector('[data-cart-sheet]', { timeout: 5000 });
  await page.waitForFunction(
    (id) => document.querySelector(`[data-cart-line="${id}"]`) != null,
    BRACKET,
    { timeout: 5000 },
  );

  const sheetLine = `[data-cart-line="${BRACKET}"]`;
  await page.locator(`${sheetLine} [data-cart-qty-inc]`).click();
  await page.waitForFunction(
    () => document.querySelector('[data-cart-line="00000000-0000-4000-8000-000000000001"] [data-cart-qty]')
      ?.getAttribute('data-cart-qty') === '2',
    null,
    { timeout: 5000 },
  );
  if (await page.locator('[data-cart-remove-dialog]').count()) {
    throw new Error('quantity change opened the confirm');
  }
  const afterQty = await settle(sync, page);

  await openRemove(page, sheetLine, 'Bracket');
  const dialogBox = await page.locator('[data-cart-remove-dialog] > div').boundingBox();
  fits(dialogBox, width, height, 'sheet confirm');
  const cancelBox = await page.locator('[data-cart-remove-cancel]').boundingBox();
  const removeBox = await page.locator('[data-cart-remove-confirm]').boundingBox();
  fits(cancelBox, width, height, 'Cancel');
  fits(removeBox, width, height, 'Remove');
  await shot(page, 'cart-remove-confirm-390.png');
  if (sync.put !== afterQty) throw new Error('opening the confirm synced the cart');

  await page.locator('[data-cart-remove-cancel]').click();
  await page.waitForSelector('[data-cart-remove-dialog]', { state: 'detached', timeout: 5000 });
  const kept = await page.evaluate(
    (id) => document.querySelector(`[data-cart-line="${id}"]`) != null,
    BRACKET,
  );
  if (!kept) throw new Error('Cancel removed the sheet line');
  await expectPuts(sync, page, afterQty, 0);

  await openRemove(page, sheetLine, 'Bracket');
  const beforeRemove = sync.put;
  await page.locator('[data-cart-remove-confirm]').click();
  await page.waitForFunction(
    (id) => !document.querySelector(`[data-cart-line="${id}"]`),
    BRACKET,
    { timeout: 5000 },
  );
  await expectPuts(sync, page, beforeRemove, 1);
  const removedPut = sync.notes[sync.notes.length - 1] || '';
  if (removedPut.includes(BRACKET)) throw new Error(`remove sync still listed Bracket: ${removedPut}`);
  if (!removedPut.includes(PLATE)) throw new Error(`remove sync dropped Plate: ${removedPut}`);

  const checkout = page.locator('[data-cart-checkout]');
  if (await checkout.isDisabled()) {
    const note = await page.locator('[data-cart-checkout-skip]').textContent().catch(() => '');
    throw new Error(`checkout disabled: ${note}`);
  }
  await checkout.click();
  await page.waitForSelector('[data-checkout-page]', { timeout: 10000 });
  await page.waitForSelector(`[data-checkout-line="${PLATE}"]`, { timeout: 5000 });
  if (await page.locator(`[data-checkout-line="${BRACKET}"]`).count()) {
    throw new Error('Bracket was still on the checkout page');
  }

  const checkoutLine = `[data-checkout-line="${PLATE}"]`;
  await page.locator(`${checkoutLine} [data-checkout-qty-inc]`).click();
  await page.waitForFunction(
    () => document.querySelector('[data-checkout-line="00000000-0000-4000-8000-000000000002"] [data-checkout-qty]')
      ?.getAttribute('data-checkout-qty') === '2',
    null,
    { timeout: 5000 },
  );
  if (await page.locator('[data-cart-remove-dialog]').count()) {
    throw new Error('checkout quantity change opened the confirm');
  }
  const afterCheckoutQty = await settle(sync, page);

  await openRemove(page, checkoutLine, 'Plate');
  const checkoutDialog = await page.locator('[data-cart-remove-dialog] > div').boundingBox();
  fits(checkoutDialog, width, height, 'checkout confirm');
  const modal = await page.evaluate(() => {
    const fit = document.querySelector('[data-checkout-page]');
    const panel = fit && fit.querySelector('.modal-fit-panel');
    const box = panel ? panel.getBoundingClientRect() : null;
    return {
      cap: fit ? getComputedStyle(fit).getPropertyValue('--modal-cap').trim() : '',
      inFit: !!(fit && fit.querySelector('[data-cart-remove-dialog]')),
      height: box ? box.height : 0,
      bottom: box ? box.bottom : 0,
    };
  });
  if (modal.inFit) throw new Error('confirm is inside the checkout ModalFit');
  if (modal.cap !== '92vh') throw new Error(`checkout cap changed to ${modal.cap}`);
  if (!(modal.height > 80 && modal.bottom <= height + 1)) {
    throw new Error(`checkout panel left the 390 viewport: ${JSON.stringify(modal)}`);
  }
  await shot(page, 'checkout-remove-confirm-390.png');
  if (sync.put !== afterCheckoutQty) throw new Error('opening the checkout confirm synced the cart');

  await page.locator('[data-cart-remove-cancel]').click();
  await page.waitForSelector('[data-cart-remove-dialog]', { state: 'detached', timeout: 5000 });
  if (!await page.locator(checkoutLine).count()) throw new Error('Cancel removed the checkout line');
  await expectPuts(sync, page, afterCheckoutQty, 0);

  await openRemove(page, checkoutLine, 'Plate');
  const beforeCheckoutRemove = sync.put;
  await page.locator('[data-cart-remove-confirm]').click();
  await page.waitForFunction(
    (id) => !document.querySelector(`[data-checkout-line="${id}"]`),
    PLATE,
    { timeout: 5000 },
  );
  await expectPuts(sync, page, beforeCheckoutRemove, 1);
  await page.close();
  console.log('  390px: sheet and checkout confirm, cancel keeps, remove syncs once');
}

if (!await waitForServer()) {
  console.log(`\n❌ cart remove confirm: preview did not start on ${APP_URL}`);
  stop();
  process.exit(1);
}

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
attachConsentPresetToBrowser(browser);
try {
  await capture(browser);
  console.log(failed ? `\n❌ FAIL (${failed} failed, ${passed} passed)` : `\n✅ PASS (${passed})`);
} catch (err) {
  console.log(`\n❌ ${err?.stack || err?.message || err}`);
  failed += 1;
} finally {
  await browser.close();
  stop();
}
process.exit(failed ? 1 : 0);

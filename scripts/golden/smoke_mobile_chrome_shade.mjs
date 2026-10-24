#!/usr/bin/env node
/**
 * iPhone 390: the About dialog, the profile panel, and the Connect agent
 * dialog leave the page's top rows and the root styles alone.
 *
 * iOS Safari tints its status bar and toolbar from the page's top rows and
 * keeps that sample after a layer closes. With a 45% scrim under the status
 * bar the bars went 0.55 x chrome and stayed there. This emulates a 47px
 * notch (`--safe-area-top` on <html>) and samples real pixels: inside the
 * band nothing changes while a dialog is open; below it the scrim dims;
 * after close every sample and the root inline styles are back to baseline.
 */
/* global indexedDB, localStorage, window, document, getComputedStyle */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { chromium } from 'playwright-core';
import { attachConsentPresetToBrowser } from './lib/presetConsentInit.mjs';

const PORT = Number(process.env.SMOKE_PORT || 5199);
const APP_URL = `http://127.0.0.1:${PORT}/`;
const NOTCH = 47;

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].filter(Boolean);

const DOC = {
  version: 1,
  source: 'local',
  name: 'Bracket',
  activeId: 'bracket',
  parts: [{ id: 'bracket', name: 'Bracket', visible: true, order: 0 }],
};
const SCRIPT = 'let part = Manifold.cube([20, 20, 20], true);\nreturn part;\n';

let failed = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`);
  }
}

const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!exe) {
  console.log('mobile chrome shade golden: no system Chrome found — set CHROME_PATH. Skipping.');
  process.exit(0);
}

console.log('mobile chrome shade golden');

const server = spawn('npx', ['vite', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort', '--logLevel', 'error'], {
  cwd: new URL('../../', import.meta.url).pathname,
  stdio: 'ignore',
  detached: true,
});
let stopped = false;
const stop = () => {
  if (stopped) return;
  stopped = true;
  try { process.kill(-server.pid, 'SIGTERM'); } catch { /* gone */ }
  try { server.kill('SIGKILL'); } catch { /* gone */ }
};
process.on('exit', stop);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { stop(); process.exit(1); });

async function waitForServer(timeoutMs = 40000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(APP_URL);
      if (res.ok) return true;
    } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

/** 8-bit RGB or RGBA non-interlaced PNG (what Chrome screenshots are) → { width, height, bpp, px }. */
function decodePng(buf) {
  let pos = 8;
  let width = 0;
  let height = 0;
  let bpp = 4;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8 || (data[9] !== 2 && data[9] !== 6) || data[12] !== 0) throw new Error('expected 8-bit RGB/RGBA non-interlaced PNG');
      bpp = data[9] === 6 ? 4 : 3;
    } else if (type === 'IDAT') {
      idat.push(data);
    }
    pos += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const px = Buffer.alloc(stride * height);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = px.subarray(y * stride, (y + 1) * stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? out[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      let v = line[i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : (pb <= pc ? b : c);
      }
      out[i] = v & 0xff;
    }
    prev = out;
  }
  return { width, height, bpp, px };
}

const POINTS = {
  bandLeft: [12, 10],
  bandMid: [195, 24],
  bandRight: [378, 40],
  belowBand: [195, NOTCH + 30],
  centre: [195, 420],
};

async function samples(page) {
  const png = decodePng(await page.screenshot({ type: 'png' }));
  const out = {};
  for (const [name, [x, y]] of Object.entries(POINTS)) {
    const i = (y * png.width + x) * png.bpp;
    out[name] = [png.px[i], png.px[i + 1], png.px[i + 2]];
  }
  return out;
}

const same = (a, b, tol = 2) => a.every((v, i) => Math.abs(v - b[i]) <= tol);
const darker = (a, b, by = 8) => a.every((v, i) => v <= b[i] - by);
const fmt = (s) => Object.entries(s).map(([k, v]) => `${k}=${v.join(',')}`).join(' ');

async function rootState(page) {
  return page.evaluate(() => ({
    htmlStyle: document.documentElement.getAttribute('style') || '',
    bodyStyle: document.body.getAttribute('style') || '',
    htmlBg: getComputedStyle(document.documentElement).backgroundColor,
    bodyBg: getComputedStyle(document.body).backgroundColor,
    theme: document.documentElement.getAttribute('data-loading-theme'),
  }));
}

async function scrimState(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const own = getComputedStyle(el);
    const before = getComputedStyle(el, '::before');
    return {
      ownBg: own.backgroundColor,
      beforeBg: before.backgroundColor,
      beforeTop: before.top,
      beforeBottom: before.bottom,
      beforeZ: before.zIndex,
    };
  }, selector);
}

async function seedAssembly(page) {
  await page.evaluate(async ({ doc, script }) => {
    localStorage.removeItem('surfcad.github.token');
    localStorage.removeItem('surfcad.github.tokenBundle');
    await new Promise((resolve, reject) => {
      const req = indexedDB.deleteDatabase('surfcad-assembly');
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
      req.onblocked = () => resolve();
    });
    await new Promise((resolve, reject) => {
      const req = indexedDB.open('surfcad-assembly', 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('assembly')) db.createObjectStore('assembly');
        if (!db.objectStoreNames.contains('parts')) db.createObjectStore('parts');
      };
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction(['assembly', 'parts'], 'readwrite');
        tx.objectStore('assembly').put(doc, 'current');
        tx.objectStore('parts').put({ id: 'bracket', script, savedAt: Date.now() }, 'bracket');
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
    });
  }, { doc: DOC, script: SCRIPT });
}

/** Open a pane, sample while open, close it, sample again. */
async function exercise(page, label, { open, openSel, close, scrim }, base) {
  await open();
  await page.waitForSelector(openSel, { state: 'visible', timeout: 10000 });
  await page.waitForTimeout(250);
  const during = await samples(page);
  const rootDuring = await rootState(page);
  check(`${label}: the top band is untouched while open`,
    same(during.bandLeft, base.px.bandLeft) && same(during.bandMid, base.px.bandMid) && same(during.bandRight, base.px.bandRight),
    `${fmt(base.px)} -> ${fmt(during)}`);
  if (scrim) {
    check(`${label}: the page below the band is dimmed while open`,
      darker(during.belowBand, base.px.belowBand) || darker(during.centre, base.px.centre),
      `${fmt(base.px)} -> ${fmt(during)}`);
    const s = await scrimState(page, scrim);
    check(`${label}: the scrim element paints nothing and its ::before starts at the notch`,
      !!s && s.ownBg === 'rgba(0, 0, 0, 0)' && s.beforeBg === 'rgba(0, 0, 0, 0.45)'
        && s.beforeTop === `${NOTCH}px` && s.beforeBottom === '0px' && s.beforeZ === '-1',
      JSON.stringify(s));
  }
  check(`${label}: html and body styles are untouched while open`,
    rootDuring.htmlStyle === base.root.htmlStyle && rootDuring.bodyStyle === base.root.bodyStyle
      && rootDuring.htmlBg === base.root.htmlBg && rootDuring.bodyBg === base.root.bodyBg && rootDuring.theme === null,
    JSON.stringify({ base: base.root, during: rootDuring }));
  await close();
  await page.waitForSelector(openSel, { state: 'hidden', timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(250);
  const after = await samples(page);
  const rootAfter = await rootState(page);
  check(`${label}: every sample is back to baseline after close`,
    Object.keys(POINTS).every((k) => same(after[k], base.px[k])),
    `${fmt(base.px)} -> ${fmt(after)}`);
  check(`${label}: html and body styles are back to baseline after close`,
    rootAfter.htmlStyle === base.root.htmlStyle && rootAfter.bodyStyle === base.root.bodyStyle
      && rootAfter.htmlBg === base.root.htmlBg && rootAfter.bodyBg === base.root.bodyBg,
    JSON.stringify({ base: base.root, after: rootAfter }));
}

let browser;
try {
  if (!await waitForServer()) {
    check('dev server started', false, APP_URL);
    process.exit(1);
  }
  check('dev server started', true);
  browser = await chromium.launch({
    executablePath: exe,
    args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
  });
  attachConsentPresetToBrowser(browser);
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 1,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });
  await context.addInitScript(() => { window.open = () => null; });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(String(err?.message || err)));
  await page.route('**/api/**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ authenticated: false }),
  }));
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await seedAssembly(page);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-brand-about-trigger]', { timeout: 45000 });
  await page.waitForFunction(() => !document.querySelector('[data-app-loading]'), { timeout: 45000 });
  await page.waitForTimeout(800);

  // Emulate the notch: headless Chrome has env(safe-area-inset-top) = 0.
  await page.evaluate((n) => {
    document.documentElement.style.setProperty('--safe-area-top', `${n}px`);
  }, NOTCH);
  const base = { px: await samples(page), root: await rootState(page) };
  check('baseline: html paints no background of its own, body is the chrome token',
    base.root.htmlBg === 'rgba(0, 0, 0, 0)' && base.root.bodyBg === 'rgb(30, 30, 30)' && base.root.theme === null,
    JSON.stringify(base.root));
  check('baseline: the top band is the chrome colour', same(base.px.bandLeft, [30, 30, 30], 3) && same(base.px.bandRight, [30, 30, 30], 3), fmt(base.px));

  // 1. About, from the header logo.
  await exercise(page, 'About', {
    open: () => page.click('[data-brand-about-trigger]'),
    openSel: '[data-about-modal]',
    close: () => page.click('[data-about-modal-close]'),
    scrim: '[data-about-modal]',
  }, base).catch((err) => check('About exercised', false, err?.message || String(err)));

  // 2. Profile panel from the chip (no scrim; nothing may change at all).
  await exercise(page, 'Profile panel', {
    open: () => page.locator('[data-profile-chip-variant="viewport"]').click(),
    openSel: '[data-profile-panel]',
    close: () => page.keyboard.press('Escape'),
    scrim: null,
  }, base).catch((err) => check('Profile panel exercised', false, err?.message || String(err)));

  // 3. Connect agent dialog, from the profile panel row.
  await exercise(page, 'Connect agent', {
    open: async () => {
      await page.locator('[data-profile-chip-variant="viewport"]').click();
      await page.waitForSelector('[data-ui-action="data-agent-bridge-connect"]', { state: 'visible', timeout: 10000 });
      await page.click('[data-ui-action="data-agent-bridge-connect"]');
    },
    openSel: '[data-agent-bridge-dialog]',
    close: () => page.keyboard.press('Escape'),
    scrim: '[data-agent-bridge-dialog]',
  }, base).catch((err) => check('Connect agent exercised', false, err?.message || String(err)));

  check('no page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
  await context.close();
} catch (err) {
  check('golden threw', false, err?.stack || String(err));
} finally {
  if (browser) await browser.close().catch(() => {});
  stop();
}

if (failed) {
  console.log(`mobile chrome shade golden: ${failed} failed`);
  process.exit(1);
}
console.log('mobile chrome shade golden: ok');
// The dev server child is killed above; exit explicitly so CI's step returns.
process.exit(0);

#!/usr/bin/env node
/**
 * iPhone 390: About, the profile menu, the Account pane, Connect agent, and
 * the part-delete confirm leave the safe-area bands and the root styles alone.
 *
 * iOS Safari tints its status bar and toolbar from the page's top rows and
 * keeps that sample after a layer closes. A blur or a transparent fixed box
 * over those rows is enough to shift the tint, even when the dim itself
 * stops at the insets. This emulates a 47px notch and a 34px home-indicator
 * band (`--safe-area-top` / `--safe-area-bottom` on <html>) and samples real
 * pixels on a fresh load, while each dialog is open, and after it closes.
 */
/* global indexedDB, localStorage, sessionStorage, window, document, getComputedStyle */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { chromium } from 'playwright-core';
import { attachConsentPresetToBrowser } from './lib/presetConsentInit.mjs';

const PORT = Number(process.env.SMOKE_PORT || 5199);
const APP_URL = `http://127.0.0.1:${PORT}/`;
const NOTCH = 47;
const BOTTOM = 34;
const VIEW_H = 844;

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
  bandMid: [195, 8],
  bandRight: [378, 20],
  belowBand: [195, NOTCH + 30],
  centre: [195, 420],
  bottomLeft: [120, VIEW_H - 12],
  bottomRight: [300, VIEW_H - 12],
  aboveBottom: [20, VIEW_H - BOTTOM - 28],
};
const TOP_BAND = ['bandLeft', 'bandMid', 'bandRight'];
const BOTTOM_BAND = ['bottomLeft', 'bottomRight'];

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
    const rect = el.getBoundingClientRect();
    const scrims = [...document.querySelectorAll('.surface-scrim')].map((node) => {
      const box = node.getBoundingClientRect();
      const cs = getComputedStyle(node);
      return {
        top: box.top,
        bottom: box.bottom,
        filter: cs.backdropFilter || cs.webkitBackdropFilter || 'none',
        bg: cs.backgroundColor,
      };
    });
    return {
      ownBg: own.backgroundColor,
      ownFilter: own.backdropFilter || own.webkitBackdropFilter || 'none',
      ownTop: own.top,
      ownBottom: own.bottom,
      beforeBg: before.backgroundColor,
      beforeFilter: before.backdropFilter || before.webkitBackdropFilter || 'none',
      beforeTop: before.top,
      beforeBottom: before.bottom,
      rectTop: rect.top,
      rectBottom: rect.bottom,
      scrims,
    };
  }, selector);
}

async function seedAssembly(page) {
  await page.evaluate(async ({ doc, script }) => {
    const bundle = {
      accessToken: 'gho_shade',
      refreshToken: '',
      expiresAt: Date.now() + 60 * 60 * 1000,
      refreshExpiresAt: 0,
    };
    localStorage.setItem('surfcad.github.tokenBundle', JSON.stringify(bundle));
    sessionStorage.setItem('surfcad.github.token', bundle.accessToken);
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

const filterNone = (value) => !value || value === 'none';

/** Open a pane, sample while open, close it, sample again. */
async function exercise(page, label, { open, openSel, close, scrim }, base) {
  await open();
  await page.waitForSelector(openSel, { state: 'visible', timeout: 10000 });
  await page.waitForTimeout(250);
  const during = await samples(page);
  const rootDuring = await rootState(page);
  const bandsClear = [...TOP_BAND, ...BOTTOM_BAND].every((k) => same(during[k], base.px[k]));
  check(`${label}: the top and bottom bands are untouched while open`,
    bandsClear,
    `${fmt(base.px)} -> ${fmt(during)}`);
  if (scrim) {
    check(`${label}: the page between the bands is dimmed while open`,
      darker(during.belowBand, base.px.belowBand) || darker(during.aboveBottom, base.px.aboveBottom) || darker(during.centre, base.px.centre),
      `${fmt(base.px)} -> ${fmt(during)}`);
    const s = await scrimState(page, scrim);
    const boxClear = !!s && s.rectTop >= NOTCH - 1 && s.rectBottom <= VIEW_H - BOTTOM + 1
      && s.ownTop === `${NOTCH}px` && s.ownBottom === `${BOTTOM}px`;
    const paintClear = !!s && s.ownBg === 'rgba(0, 0, 0, 0)' && filterNone(s.ownFilter)
      && s.beforeBg === 'rgba(0, 0, 0, 0.45)' && /blur/.test(s.beforeFilter)
      && s.beforeTop === '0px' && s.beforeBottom === '0px';
    const everyClear = !!s && s.scrims.every((node) => node.top >= NOTCH - 1
      && node.bottom <= VIEW_H - BOTTOM + 1
      && node.bg === 'rgba(0, 0, 0, 0)'
      && filterNone(node.filter));
    check(`${label}: the scrim box stays out of both bands and only ::before dims`,
      boxClear && paintClear && everyClear,
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
  await page.route('**/api/**', (route) => {
    const url = route.request().url();
    if (url.includes('/api/auth/me')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          authenticated: true,
          user: { _id: 'user-shade', email: 'shade@test.local', name: 'Shade' },
        }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ authenticated: false }),
    });
  });
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await seedAssembly(page);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-brand-about-trigger]', { timeout: 45000 });
  await page.waitForFunction(() => !document.querySelector('[data-app-loading]'), { timeout: 45000 });
  await page.waitForTimeout(800);

  // Emulate the notch and the home indicator. Headless Chrome has both envs at 0.
  await page.evaluate(({ notch, bottom }) => {
    const root = document.documentElement;
    root.style.setProperty('--safe-area-top', `${notch}px`);
    root.style.setProperty('--safe-area-bottom', `${bottom}px`);
  }, { notch: NOTCH, bottom: BOTTOM });
  const themeMeta = await page.locator('meta[name="theme-color"]').getAttribute('content');
  const base = { px: await samples(page), root: await rootState(page) };
  check('fresh load: theme-color meta is still the brand ink', themeMeta === '#16171D', themeMeta || '');
  check('fresh load: html and body are both the chrome ground',
    base.root.htmlBg === 'rgb(30, 30, 30)' && base.root.bodyBg === 'rgb(30, 30, 30)' && base.root.theme === null,
    JSON.stringify(base.root));
  check('fresh load: the top and bottom bands are the chrome colour',
    [...TOP_BAND, ...BOTTOM_BAND].every((k) => same(base.px[k], [30, 30, 30], 3)),
    fmt(base.px));
  const headerFit = await page.evaluate(() => {
    const row = document.querySelector('[data-viewer-header-row]');
    const beta = row?.querySelector('[data-brand-beta]');
    const word = row?.querySelector('[data-brand-wordmark]');
    const trigger = row?.querySelector('[data-brand-about-trigger]');
    if (!row || !beta || !word || !trigger) return null;
    const rowBox = row.getBoundingClientRect();
    const betaBox = beta.getBoundingClientRect();
    const wordBox = word.getBoundingClientRect();
    const midY = (rect) => rect.top + rect.height / 2;
    const hit = document.elementFromPoint(wordBox.left + wordBox.width / 2, midY(wordBox));
    return {
      rowH: Math.round(rowBox.height),
      text: (beta.textContent || '').trim(),
      sameLine: Math.abs(midY(betaBox) - midY(wordBox)) <= 2,
      stacked: betaBox.top >= wordBox.bottom - 1,
      logoHit: hit === trigger || trigger.contains(hit),
    };
  });
  check('390 header stays 36px and the beta tag stays on the logo line',
    headerFit && headerFit.rowH === 36 && headerFit.text === 'beta'
    && headerFit.sameLine && !headerFit.stacked && headerFit.logoHit,
    JSON.stringify(headerFit));

  // 1. About, from the header logo.
  await exercise(page, 'About', {
    open: () => page.click('[data-brand-about-trigger]'),
    openSel: '[data-about-modal]',
    close: () => page.click('[data-about-modal-close]'),
    scrim: '[data-about-modal]',
  }, base).catch((err) => check('About exercised', false, err?.message || String(err)));

  // 2. Profile menu from the chip (no scrim; nothing may change at all).
  await exercise(page, 'Profile panel', {
    open: () => page.locator('[data-profile-chip-variant="viewport"]').click(),
    openSel: '[data-profile-panel]',
    close: () => page.keyboard.press('Escape'),
    scrim: null,
  }, base).catch((err) => check('Profile panel exercised', false, err?.message || String(err)));

  // 3. Account pane, from the profile menu.
  await exercise(page, 'Account panel', {
    open: async () => {
      const openPanel = page.locator('[data-profile-panel]');
      if (!(await openPanel.isVisible().catch(() => false))) {
        await page.locator('[data-profile-chip-variant="viewport"]').click();
      }
      await page.waitForSelector('[data-profile-account]', { state: 'visible', timeout: 10000 });
      await page.click('[data-profile-account]');
    },
    openSel: '[data-profile-account-pane]',
    close: () => page.click('[data-profile-account-done]'),
    scrim: '[data-git-dialog="account"]',
  }, base).catch((err) => check('Account panel exercised', false, err?.message || String(err)));

  // 4. Connect agent dialog, from the profile panel row.
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

  // 5. Part delete confirm, from the parts stage. The bands are compared to
  // the parts page, then CAD is checked against the fresh-load baseline.
  await page.click('[data-stage-btn="parts"]').catch((err) => check('parts stage opened', false, err?.message || String(err)));
  const partsProbe = await page.evaluate(() => {
    const btn = document.querySelector('[data-part-delete]');
    const rect = btn?.getBoundingClientRect();
    const cs = btn ? getComputedStyle(btn) : null;
    return {
      stage: document.querySelector('[data-mobile-stage]')?.getAttribute('data-mobile-stage') || '',
      rows: [...document.querySelectorAll('[data-part-row]')].map((el) => el.getAttribute('data-part-row')),
      id: btn?.getAttribute('data-part-delete') || '',
      paneHidden: document.querySelector('[data-stage-pane="parts"]')?.getAttribute('aria-hidden') || '',
      rect: rect ? { x: rect.x, y: rect.y, w: rect.width, h: rect.height } : null,
      vis: cs?.visibility || '',
      display: cs?.display || '',
    };
  }).catch((err) => ({ error: err?.message || String(err) }));
  check('parts stage lists a part',
    partsProbe.stage === 'parts' && !!partsProbe.id && partsProbe.rect?.w > 0,
    JSON.stringify(partsProbe));
  await page.waitForTimeout(300);
  const partsBase = { px: await samples(page), root: await rootState(page) };
  check('parts stage: html and body stay the chrome ground',
    partsBase.root.htmlBg === base.root.htmlBg && partsBase.root.bodyBg === base.root.bodyBg
      && partsBase.root.theme === null,
    JSON.stringify(partsBase.root));
  await exercise(page, 'Part delete', {
    open: () => page.click(`[data-part-delete="${partsProbe.id}"]`),
    openSel: '[data-part-delete-dialog]',
    close: () => page.click('[data-part-delete-cancel]'),
    scrim: '[data-part-delete-dialog]',
  }, partsBase).catch((err) => check('Part delete exercised', false, err?.message || String(err)));
  await page.click('[data-stage-btn="cad"]');
  await page.waitForTimeout(300);
  const backOnCad = await samples(page);
  check('back on CAD: the bands match the fresh load',
    [...TOP_BAND, ...BOTTOM_BAND].every((k) => same(backOnCad[k], base.px[k])),
    `${fmt(base.px)} -> ${fmt(backOnCad)}`);

  // Fresh load again, after every dialog has opened and closed.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-brand-about-trigger]', { timeout: 45000 });
  await page.waitForFunction(() => !document.querySelector('[data-app-loading]'), { timeout: 45000 });
  await page.waitForTimeout(800);
  await page.evaluate(({ notch, bottom }) => {
    const root = document.documentElement;
    root.style.setProperty('--safe-area-top', `${notch}px`);
    root.style.setProperty('--safe-area-bottom', `${bottom}px`);
  }, { notch: NOTCH, bottom: BOTTOM });
  const fresh = { px: await samples(page), root: await rootState(page) };
  check('fresh load after dialogs: bands match the first load',
    [...TOP_BAND, ...BOTTOM_BAND].every((k) => same(fresh.px[k], base.px[k])),
    `${fmt(base.px)} -> ${fmt(fresh.px)}`);
  check('fresh load after dialogs: html and body match the first load',
    fresh.root.htmlBg === base.root.htmlBg && fresh.root.bodyBg === base.root.bodyBg
      && fresh.root.htmlStyle === base.root.htmlStyle && fresh.root.bodyStyle === base.root.bodyStyle
      && fresh.root.theme === null,
    JSON.stringify({ base: base.root, fresh: fresh.root }));

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

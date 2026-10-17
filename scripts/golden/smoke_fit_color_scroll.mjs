#!/usr/bin/env node
/**
 * Fit frames every visible part. Unpainted faces are off-white; paint stays.
 *
 * Two cubes sit apart. One is selected. Zoom to Fit puts both in the frame.
 * A hidden cube far away does not pull the camera. The selected cube's top
 * is painted red; a side stays DEFAULT_PART_COLOR (#ECEAE4).
 *
 * The quote scroll hint (show at the top, hide at the bottom, 390×664) is
 * the mobile-modal-fit golden. This file checks the markup is still there.
 *
 * Screenshots go to GOLDEN_SHOT_DIR or os.tmpdir() only.
 */
/* global document, indexedDB, localStorage, window */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { attachConsentPresetToBrowser } from './lib/presetConsentInit.mjs';

const PORT = Number(process.env.SMOKE_PORT || 5221);
const APP_URL = `http://127.0.0.1:${PORT}/`;
const SHOT_DIR = process.env.GOLDEN_SHOT_DIR || tmpdir();
const USER = 'user-fit';
const NEAR = 'near';
const FAR = 'far';
const HIDDEN = 'hidden';
const SURF = '2026-10-09-12-00-00-0001-f171';
const CUBE = 'return Manifold.cube([20, 20, 20], true);\n';
const OFFWHITE = [0xec, 0xea, 0xe4];
const RED = [0xef, 0x44, 0x44];

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].filter(Boolean);

let failed = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed += 1;
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function dist(rgb, want) {
  if (!rgb) return 999;
  return Math.abs(rgb[0] - want[0]) + Math.abs(rgb[1] - want[1]) + Math.abs(rgb[2] - want[2]);
}

console.log('fit, off-white, quote hint — source');
{
  const quote = readFileSync(new URL('../../src/components/QuoteModal.jsx', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../../src/index.css', import.meta.url), 'utf8');
  const view = readFileSync(new URL('../../src/components/Viewport.jsx', import.meta.url), 'utf8');
  const scrollCss = css.slice(css.indexOf('.quote-scroll'), css.indexOf('.quote-scroll') + 700);
  check('zoom to fit unions visible parts', /unionWorldBox\(meshes\)/.test(view));
  check('quote hint markup and thin scrollbar stay',
    /data-quote-scroll-hint/.test(quote)
    && /quote-scroll/.test(quote)
    && /flex-1 overflow-y-auto/.test(quote)
    && /::-webkit-scrollbar/.test(scrollCss)
    && /scrollbar-width:\s*thin/.test(scrollCss)
    && /scrollbar-color:/.test(scrollCss));
}

const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!exe) {
  console.log('fit color scroll: no system Chrome — set CHROME_PATH');
  process.exit(failed ? 1 : 0);
}

mkdirSync(SHOT_DIR, { recursive: true });
check('shot dir is not the artifacts folder', !String(SHOT_DIR).startsWith('/opt/cursor/artifacts'), SHOT_DIR);

const server = spawn('npx', ['vite', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], {
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

const DOC = {
  version: 1,
  source: 'local',
  name: 'Fit',
  activeId: NEAR,
  parts: [
    { id: NEAR, name: 'Near', visible: true, order: 0, position: [0, 0, 0], surfId: SURF },
    { id: FAR, name: 'Far', visible: true, order: 1, position: [90, 0, 0] },
    { id: HIDDEN, name: 'Hidden', visible: false, order: 2, position: [500, 0, 0] },
  ],
  colors: {
    [SURF]: {
      faces: [{ color: '#ef4444', key: { at: [0, 0, 10], n: [0, 0, 1], area: 400 } }],
    },
  },
};

async function seed(page) {
  await page.evaluate(async ({ doc, cube, user }) => {
    const drop = (name) => new Promise((resolve) => {
      const req = indexedDB.deleteDatabase(name);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    });
    await drop('surfcad-assembly');
    await drop('surfcad');
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
        for (const part of doc.parts) {
          tx.objectStore('parts').put({ id: part.id, script: cube, savedAt: Date.now() }, part.id);
        }
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
    });
    await new Promise((resolve, reject) => {
      const req = indexedDB.open('surfcad', 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('editorDraft')) db.createObjectStore('editorDraft');
      };
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('editorDraft', 'readwrite');
        tx.objectStore('editorDraft').put({
          script: cube,
          filename: 'Near',
          partId: doc.activeId,
          savedAt: Date.now(),
        }, 'current');
        localStorage.setItem('surfcad.github.tokenBundle', JSON.stringify({
          accessToken: 'ghu_fit',
          refreshToken: '',
          expiresAt: Date.now() + 86_400_000,
          refreshExpiresAt: 0,
        }));
        localStorage.setItem('surfcad.lastAssembly', JSON.stringify({
          [user]: {
            name: doc.name,
            activeId: doc.activeId,
            source: 'local',
            savedAt: Date.now(),
          },
        }));
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
    });
  }, { doc: DOC, cube: CUBE, user: USER });
}

async function signIn(page) {
  await page.route('**/api/**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ authenticated: false }),
  }));
  await page.route('**/api/auth/me', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      authenticated: true,
      user: { id: USER, email: 'fit@surfcad.test', vaultName: null },
    }),
  }));
  await page.route('https://api.github.com/**', (route) => route.fulfill({
    status: 401,
    contentType: 'application/json',
    body: JSON.stringify({ message: 'Bad credentials' }),
  }));
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
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader'],
  });
attachConsentPresetToBrowser(browser);
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    colorScheme: 'dark',
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(String(err).slice(0, 240)));
  await signIn(page);
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => {
    const canvas = document.querySelector('.viewport-shell > canvas');
    return !!(canvas && canvas.clientWidth > 0 && window.__VIEWPORT__ && window.__MANIFOLD_CONTEXT__?.isReady);
  }, null, { timeout: 90000 });
  await seed(page);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => {
    const framing = window.__VIEWPORT__?.stageVisibleFraming?.();
    const pending = window.__MANIFOLD_CONTEXT__?.worker?.pendingRequests?.size || 0;
    return pending === 0 && framing && framing.parts && framing.parts.length >= 2;
  }, null, { timeout: 90000 });
  await page.waitForTimeout(400);

  const selected = await page.locator('[data-part-selected="true"]').count();
  const selectedId = await page.locator('[data-part-selected="true"]').first().getAttribute('data-part-row');
  check('one part is selected', selected === 1 && selectedId === NEAR, `n=${selected} id=${selectedId}`);

  await page.evaluate(() => window.__VIEWPORT__.stageFit({ az: 35, el: 20, margin: 1.15 }));
  const before = await page.evaluate(() => window.__VIEWPORT__.stageVisibleFraming());
  const beforeFar = (before.parts || []).find((part) => part.id === 'far');
  const beforeNear = (before.parts || []).find((part) => part.id === 'near');
  console.log(`  before ${JSON.stringify(before.parts)}`);
  check('framing the selected part leaves the other outside',
    !!beforeNear && !!beforeFar
    && beforeFar.inside === false
    && beforeFar.extent > beforeNear.extent + 2,
    JSON.stringify(before.parts));
  const beforeShot = join(SHOT_DIR, 'fit-two-parts-before.png');
  await page.locator('.viewport-shell > canvas').screenshot({ path: beforeShot });
  check('before-fit shot saved outside artifacts', existsSync(beforeShot) && !beforeShot.startsWith('/opt/cursor/artifacts'));

  await page.locator('[data-zoom-to-fit]:visible').click();
  await page.waitForTimeout(200);
  const after = await page.evaluate(() => window.__VIEWPORT__.stageVisibleFraming());
  console.log(`  after ${JSON.stringify(after.parts)} target ${JSON.stringify(after.target)}`);
  const afterIds = new Set((after.parts || []).map((part) => part.id));
  check('fit puts both visible parts inside the frame',
    after.ok === true
    && afterIds.has(NEAR)
    && afterIds.has(FAR)
    && !afterIds.has(HIDDEN)
    && (after.parts || []).every((part) => part.inside),
    JSON.stringify(after.parts));
  check('the hidden part does not pull the frame',
    !!after.target && after.target[0] > 20 && after.target[0] < 70,
    JSON.stringify(after.target));
  const afterShot = join(SHOT_DIR, 'fit-two-parts-after.png');
  await page.locator('.viewport-shell > canvas').screenshot({ path: afterShot });
  check('after-fit shot saved outside artifacts', existsSync(afterShot) && !afterShot.startsWith('/opt/cursor/artifacts'));

  await page.evaluate(() => window.__VIEWPORT__.stageSnap('top'));
  const top = await page.evaluate(() => window.__VIEWPORT__.stageSampleCenter());
  await page.evaluate(() => window.__VIEWPORT__.stageSnap('front'));
  const front = await page.evaluate(() => window.__VIEWPORT__.stageSampleCenter());
  console.log(`  top ${JSON.stringify(top)} front ${JSON.stringify(front)}`);
  check('a painted face keeps its paint', dist(top, RED) < 48, JSON.stringify(top));
  check('an unpainted face is off-white', dist(front, OFFWHITE) < 48, JSON.stringify(front));

  await page.evaluate(() => window.__VIEWPORT__.stageSnap('iso'));
  const deskShot = join(SHOT_DIR, 'offwhite-desktop.png');
  await page.locator('.viewport-shell > canvas').screenshot({ path: deskShot });
  check('desktop off-white shot saved outside artifacts', existsSync(deskShot) && !deskShot.startsWith('/opt/cursor/artifacts'));

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  await page.evaluate(() => window.__VIEWPORT__.stageSnap('iso'));
  const phone = await page.evaluate(() => window.__VIEWPORT__.stageSampleCenter());
  console.log(`  390 center ${JSON.stringify(phone)}`);
  const phoneShot = join(SHOT_DIR, 'offwhite-390.png');
  await page.locator('.viewport-shell > canvas').screenshot({ path: phoneShot });
  check('390 off-white shot saved outside artifacts', existsSync(phoneShot) && !phoneShot.startsWith('/opt/cursor/artifacts'));
  check('390 view still shows the part, not the ground', dist(phone, [0x1e, 0x1e, 0x1e]) > 80, JSON.stringify(phone));
  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await context.close();
} finally {
  if (browser) await browser.close();
  stop();
}

if (failed) {
  console.log(`\n${failed} failed`);
  process.exit(1);
}
console.log('\nfit color scroll: ok');

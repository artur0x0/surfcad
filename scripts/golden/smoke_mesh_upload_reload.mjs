#!/usr/bin/env node
/**
 * Upload an STL from the Parts ribbon. It becomes a new part, not a rewrite
 * of the one that was open. After reload that uploaded part still renders
 * when it is not the active row.
 *
 * Screenshots (390 and 1440) land in GOLDEN_SHOT_DIR or /opt/cursor/artifacts:
 * the parts header, the new row's local-only badge, and the oversize toast.
 */
/* global document, indexedDB, localStorage */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { attachConsentPresetToBrowser } from './lib/presetConsentInit.mjs';

const PORT = Number(process.env.SMOKE_PORT || 5271);
const APP_URL = `http://127.0.0.1:${PORT}/`;
const SHOT_DIR = process.env.GOLDEN_SHOT_DIR || '/opt/cursor/artifacts';
const USER = 'user-mesh';
const BLOCK_ID = 'block-mesh';
const CUBE = 'let part = Manifold.cube([20, 20, 20], true);\nreturn part;\n';

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].filter(Boolean);

const ALLOWED = [
  /favicon/i,
  /Failed to load resource/i,
  /WebGL|WEBGL|GPU stall|Automatic fallback to software WebGL/i,
  /\[APP\]|\[App\]|\[Import\]|\[Export\]|\[Viewport\]|\[Manifold/i,
];

let failed = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`);
  }
}

function cubeStl() {
  const v = [
    [0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0],
    [0, 0, 10], [10, 0, 10], [10, 10, 10], [0, 10, 10],
  ];
  const faces = [
    [0, 2, 1], [0, 3, 2],
    [4, 5, 6], [4, 6, 7],
    [0, 1, 5], [0, 5, 4],
    [1, 2, 6], [1, 6, 5],
    [2, 3, 7], [2, 7, 6],
    [3, 0, 4], [3, 4, 7],
  ];
  const lines = ['solid wedge'];
  for (const [a, b, c] of faces) {
    lines.push('  facet normal 0 0 0');
    lines.push('    outer loop');
    for (const i of [a, b, c]) lines.push(`      vertex ${v[i].join(' ')}`);
    lines.push('    endloop');
    lines.push('  endfacet');
  }
  lines.push('endsolid wedge');
  return `${lines.join('\n')}\n`;
}

console.log('mesh upload creates a part and survives reload');

const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!exe) {
  console.log('mesh upload reload: no system Chrome — set CHROME_PATH. Skipping.');
  process.exit(0);
}

mkdirSync(SHOT_DIR, { recursive: true });
const fixtureDir = join(tmpdir(), 'surfcad-mesh-upload');
mkdirSync(fixtureDir, { recursive: true });
const stlPath = join(fixtureDir, 'wedge.stl');
const oversizePath = join(fixtureDir, 'oversize.stl');
writeFileSync(stlPath, cubeStl());
writeFileSync(oversizePath, '');
// 32 MiB + 1. The size check runs before the parser reads the bytes.
truncateSync(oversizePath, 32 * 1024 * 1024 + 1);

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

async function seed(page) {
  await page.evaluate(async ({ userId, blockId, script }) => {
    await new Promise((resolve) => {
      const req = indexedDB.deleteDatabase('surfcad-assembly');
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
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
        const doc = {
          version: 1,
          source: 'local',
          name: 'BracketBox',
          activeId: blockId,
          parts: [{ id: blockId, name: 'Block', visible: true, order: 0 }],
        };
        tx.objectStore('assembly').put(doc, 'current');
        tx.objectStore('parts').put({ id: blockId, script, savedAt: Date.now() }, blockId);
        localStorage.setItem('surfcad.lastAssembly', JSON.stringify({
          [userId]: {
            name: 'BracketBox',
            activeId: blockId,
            source: 'local',
            savedAt: Date.now(),
          },
        }));
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
    });
  }, { userId: USER, blockId: BLOCK_ID, script: CUBE });
}

async function boot(page) {
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
      user: { id: USER, email: 'mesh@surfcad.test', vaultName: null },
    }),
  }));
  await page.route('**/api/config', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({}),
  }));
  const errors = [];
  const notes = [];
  page.on('pageerror', (err) => {
    const text = String(err);
    notes.push(text.slice(0, 300));
    if (!ALLOWED.some((re) => re.test(text))) errors.push(text.slice(0, 240));
  });
  page.on('console', (msg) => {
    if (msg.type() !== 'error' && msg.type() !== 'warning') return;
    const text = msg.text();
    notes.push(text.slice(0, 300));
    if (msg.type() !== 'error') return;
    if (ALLOWED.some((re) => re.test(text))) return;
    errors.push(text.slice(0, 240));
  });
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForSelector('canvas', { timeout: 40000 });
  return { errors, notes };
}

async function showParts(page, touch) {
  if (!touch) return;
  await page.locator('[data-stage-btn="parts"]').click();
  await page.waitForSelector('[data-part-upload]', { timeout: 10000 });
}

async function waitForSolids(page, count, timeoutMs = 20000) {
  const started = Date.now();
  let last = '';
  while (Date.now() - started < timeoutMs) {
    last = await page.evaluate(() => (
      document.querySelector('[data-assembly-solids]')?.getAttribute('data-assembly-solids') || ''
    ));
    if (last === String(count)) return last;
    await page.waitForTimeout(200);
  }
  return last;
}

let browser;
try {
  if (!await waitForServer()) {
    check('dev server started', false, `no response on ${APP_URL}`);
    process.exit(1);
  }
  check('dev server started', true);
  browser = await chromium.launch({
    executablePath: exe,
    args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
  });
attachConsentPresetToBrowser(browser);

  const viewports = [
    { name: '390', width: 390, height: 844, touch: true },
    { name: '1440', width: 1440, height: 900, touch: false },
  ];

  for (const vp of viewports) {
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      hasTouch: vp.touch,
      isMobile: vp.touch,
      userAgent: vp.touch
        ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
        : undefined,
    });
    const page = await context.newPage();
    const { errors, notes } = await boot(page);
    await seed(page);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-assembly-file]', { timeout: 40000, state: 'attached' });
    const opened = await waitForSolids(page, 1);
    check(`${vp.name} seeded part rendered`, opened === '1', `solids=${opened}`);
    await showParts(page, vp.touch);
    await page.waitForSelector('[data-part-row]', { timeout: 20000 });
    const header = await page.evaluate(() => {
      const bar = document.querySelector('[data-parts-feed-toolbar]');
      if (!bar) return { upload: false, download: false };
      return {
        upload: !!bar.querySelector('[data-part-upload]'),
        download: !!bar.querySelector('[data-part-download]'),
      };
    });
    check(`${vp.name} parts header has Upload and Download`, header.upload && header.download);
    const headerShot = join(SHOT_DIR, `parts-upload-download-${vp.name}.png`);
    await page.screenshot({ path: headerShot });
    check(`${vp.name} header shot`, existsSync(headerShot), headerShot);

    await page.setInputFiles('[data-part-upload-input]', stlPath);
    let uploaded = false;
    try {
      await page.waitForFunction(() => {
        const rows = [...document.querySelectorAll('[data-part-row]')];
        return rows.some((row) => /wedge/i.test(row.textContent || ''))
          && document.querySelector('[data-part-mesh-local]');
      }, null, { timeout: 30000 });
      uploaded = true;
    } catch (err) {
      const snap = await page.evaluate(() => ({
        rows: [...document.querySelectorAll('[data-part-row]')].map((row) => (row.textContent || '').replace(/\s+/g, ' ').trim()),
        toast: document.querySelector('[data-upload-toast]')?.textContent || '',
        badge: !!document.querySelector('[data-part-mesh-local]'),
        title: document.querySelector('[data-viewer-title]')?.textContent || '',
      }));
      check(`${vp.name} upload created wedge`, false, `${err.message} ${JSON.stringify(snap)} notes=${notes.slice(-8).join(' | ')}`);
    }
    if (!uploaded) {
      await context.close();
      continue;
    }
    const badge = await page.evaluate(() => {
      const el = document.querySelector('[data-part-mesh-local]');
      return {
        text: (el?.textContent || '').trim(),
        vault: el?.getAttribute('data-part-mesh-vault') || '',
        title: el?.getAttribute('title') || '',
      };
    });
    check(`${vp.name} uploaded part wears local only`, badge.text === 'local only' && badge.vault === 'offline',
      JSON.stringify(badge));
    const badgeShot = join(SHOT_DIR, `parts-upload-badge-${vp.name}.png`);
    await page.screenshot({ path: badgeShot });
    check(`${vp.name} badge shot`, existsSync(badgeShot), badgeShot);

    if (vp.name === '1440') {
      const stored = await page.evaluate(async (blockId) => {
        const scripts = await new Promise((resolve, reject) => {
          const req = indexedDB.open('surfcad-assembly', 1);
          req.onerror = () => reject(req.error);
          req.onsuccess = () => {
            const db = req.result;
            const tx = db.transaction(['assembly', 'parts'], 'readonly');
            const docReq = tx.objectStore('assembly').get('current');
            const partsReq = tx.objectStore('parts').getAll();
            const out = {};
            docReq.onsuccess = () => { out.doc = docReq.result; };
            partsReq.onsuccess = () => { out.parts = partsReq.result; };
            tx.oncomplete = () => { db.close(); resolve(out); };
            tx.onerror = () => reject(tx.error);
          };
        });
        const wedge = (scripts.parts || []).find((row) => /importMesh\('wedge\.mesh'\)/.test(row.script || ''));
        return {
          activeId: scripts.doc?.activeId || '',
          names: (scripts.doc?.parts || []).map((part) => part.name),
          wedgeScript: !!wedge,
          wedgeAssets: wedge?.assets?.['wedge.mesh'] || '',
          meshSynced: wedge?.meshSynced === true,
          blockKept: (scripts.parts || []).some((row) => row.id === blockId && /Manifold\.cube/.test(row.script || '')),
        };
      }, BLOCK_ID);
      check('upload kept the original part and stored wedge.mesh',
        stored.names.includes('Block') && stored.names.includes('wedge')
        && stored.wedgeScript && /^[0-9a-f]{40}$/.test(stored.wedgeAssets)
        && stored.meshSynced === false && stored.blockKept,
        JSON.stringify(stored));

      await page.evaluate(async (blockId) => {
        await new Promise((resolve, reject) => {
          const req = indexedDB.open('surfcad-assembly', 1);
          req.onerror = () => reject(req.error);
          req.onsuccess = () => {
            const db = req.result;
            const tx = db.transaction('assembly', 'readwrite');
            const get = tx.objectStore('assembly').get('current');
            get.onsuccess = () => {
              const doc = get.result;
              if (doc) {
                doc.activeId = blockId;
                tx.objectStore('assembly').put(doc, 'current');
              }
            };
            tx.oncomplete = () => { db.close(); resolve(); };
            tx.onerror = () => reject(tx.error);
          };
        });
        const raw = JSON.parse(localStorage.getItem('surfcad.lastAssembly') || '{}');
        const userId = Object.keys(raw)[0];
        if (userId && raw[userId]) {
          raw[userId].activeId = blockId;
          localStorage.setItem('surfcad.lastAssembly', JSON.stringify(raw));
        }
      }, BLOCK_ID);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForSelector('[data-assembly-file]', { timeout: 40000, state: 'attached' });
      const solids = await waitForSolids(page, 2, 30000);
      const rows = await page.evaluate(() => (
        [...document.querySelectorAll('[data-part-row]')].map((row) => (row.textContent || '').replace(/\s+/g, ' ').trim())
      ));
      check('non-active uploaded part still renders', solids === '2' && rows.length === 2, `solids=${solids} rows=${JSON.stringify(rows)}`);
    }

    await showParts(page, vp.touch);
    await page.setInputFiles('[data-part-upload-input]', oversizePath);
    await page.waitForSelector('[data-upload-toast]', { timeout: 10000 });
    const toast = await page.locator('[data-upload-toast]').innerText();
    check(`${vp.name} oversize toast names 32 MiB`, /32 MiB/.test(toast), toast.slice(0, 180));
    const toastShot = join(SHOT_DIR, `parts-upload-oversize-${vp.name}.png`);
    await page.screenshot({ path: toastShot });
    check(`${vp.name} oversize shot`, existsSync(toastShot), toastShot);
    check(`${vp.name} no page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
    await context.close();
  }
} finally {
  if (browser) await browser.close();
  stop();
}

if (failed) {
  console.log(`\n${failed} failed`);
  process.exit(1);
}
console.log('\nmesh upload reload: ok');

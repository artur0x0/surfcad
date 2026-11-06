#!/usr/bin/env node
/**
 * Upload a STEP file from the Parts ribbon. The file is converted in the
 * browser by the Open CASCADE wasm module: it becomes a new part, the wasm is
 * fetched from the app's own origin, and no request reaches the server
 * convert route or carries the file anywhere. While it converts, the
 * Importing toast shows a spinner and the open-source notices link. A file
 * that is not STEP shows the unreadable toast.
 *
 * The session is mocked only so a seeded local assembly opens, as in
 * smoke_mesh_upload_reload.mjs. The import itself does not use it; every
 * /api call is answered by the test and none is made for the upload.
 *
 * STEP_GOLDEN_PREVIEW=1 serves the production bundle (`vite preview` of
 * dist/, after `npm run build`) instead of the dev server, to check that the
 * build emits the worker and the wasm as separate files that load.
 */
/* global document, indexedDB, localStorage, window, MutationObserver */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { attachConsentPresetToBrowser } from './lib/presetConsentInit.mjs';
import { boxStepText, cylinderStepText } from '../../src/step/stepFixtures.js';

const PORT = Number(process.env.SMOKE_PORT || 5273);
const APP_URL = `http://127.0.0.1:${PORT}/`;
const USER = 'user-step';
const BLOCK_ID = 'block-step';
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
  // The dev proxy forwards /agent to whatever listens on :3000. Not this test's subject.
  /WebSocket connection to 'ws:\/\/[^']+\/agent/i,
];

// Text that is in every STEP file this test uploads. A request body that
// contains it would be the file leaving the browser.
const STEP_MARKERS = ['ISO-10303-21', 'CARTESIAN_POINT', 'this is not a STEP file'];

let failed = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`);
  }
}

console.log('STEP upload converts in the browser and sends nothing to the server');

const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!exe) {
  console.log('step upload local: no system Chrome found — set CHROME_PATH. Skipping.');
  process.exit(0);
}

const fixtureDir = join(tmpdir(), 'surfcad-step-upload');
mkdirSync(fixtureDir, { recursive: true });
const cylinderPath = join(fixtureDir, 'cylinder.step');
const boxPath = join(fixtureDir, 'crate.stp');
const brokenPath = join(fixtureDir, 'broken.step');
writeFileSync(cylinderPath, cylinderStepText(10, 20));
writeFileSync(boxPath, boxStepText([20, 20, 40]));
writeFileSync(brokenPath, 'this is not a STEP file\n');

const viteArgs = process.env.STEP_GOLDEN_PREVIEW === '1' ? ['vite', 'preview'] : ['vite'];
const server = spawn('npx', [...viteArgs, '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], {
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
        tx.objectStore('assembly').put({
          version: 1,
          source: 'local',
          name: 'BracketBox',
          activeId: blockId,
          parts: [{ id: blockId, name: 'Block', visible: true, order: 0 }],
        }, 'current');
        tx.objectStore('parts').put({ id: blockId, script, savedAt: Date.now() }, blockId);
        localStorage.setItem('surfcad.lastAssembly', JSON.stringify({
          [userId]: { name: 'BracketBox', activeId: blockId, source: 'local', savedAt: Date.now() },
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
      user: { id: USER, email: 'step@surfcad.test', vaultName: null },
    }),
  }));
  await page.route('**/api/config', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({}),
  }));
  const errors = [];
  const logs = [];
  const requests = [];
  page.on('request', (request) => {
    let body = '';
    try { body = request.postDataBuffer()?.toString('latin1') || ''; } catch { /* no body */ }
    requests.push({
      url: request.url(),
      method: request.method(),
      bytes: body.length,
      carriesStep: STEP_MARKERS.some((marker) => body.includes(marker)),
    });
  });
  page.on('pageerror', (err) => {
    const text = String(err);
    if (!ALLOWED.some((re) => re.test(text))) errors.push(text.slice(0, 240));
  });
  page.on('console', (msg) => {
    const text = msg.text();
    logs.push(text.slice(0, 300));
    if (msg.type() !== 'error') return;
    if (ALLOWED.some((re) => re.test(text))) return;
    errors.push(text.slice(0, 240));
  });
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForSelector('canvas', { timeout: 40000 });
  return { errors, logs, requests };
}

async function showParts(page, touch) {
  if (!touch) return;
  await page.locator('[data-stage-btn="parts"]').click();
  await page.waitForSelector('[data-part-upload]', { timeout: 10000 });
}

const rowNames = (page) => page.evaluate(() => (
  [...document.querySelectorAll('[data-part-row]')].map((row) => (row.textContent || '').replace(/\s+/g, ' ').trim())
));

async function uploadAndWait(page, path, name, notes) {
  await page.setInputFiles('[data-part-upload-input]', path);
  try {
    await page.waitForFunction((needle) => (
      [...document.querySelectorAll('[data-part-row]')].some((row) => (row.textContent || '').toLowerCase().includes(needle))
    ), name, { timeout: 60000 });
    return true;
  } catch (err) {
    const toast = await page.evaluate(() => document.querySelector('[data-upload-toast]')?.textContent || '');
    check(`upload created ${name}`, false, `${err.message.split('\n')[0]} toast=${toast} rows=${JSON.stringify(await rowNames(page))} logs=${notes.slice(-6).join(' | ')}`);
    return false;
  }
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
    { name: '1440', width: 1440, height: 900, touch: false },
    { name: '390', width: 390, height: 844, touch: true },
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
    const { errors, logs, requests } = await boot(page);
    await seed(page);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-assembly-file]', { timeout: 40000, state: 'attached' });
    await showParts(page, vp.touch);
    await page.waitForSelector('[data-part-row]', { timeout: 20000 });
    const before = (await rowNames(page)).length;

    // A small file converts in well under a second, so the toast is recorded
    // the moment it is attached instead of being polled for.
    await page.evaluate(() => {
      window.__stepToast = null;
      const read = () => {
        const el = document.querySelector('[data-step-importing]');
        if (!el || window.__stepToast) return;
        const link = el.querySelector('[data-step-notices-link]');
        window.__stepToast = {
          text: (el.textContent || '').replace(/\s+/g, ' ').trim(),
          href: link?.getAttribute('href') || '',
          linkText: (link?.textContent || '').trim(),
          spinner: !!el.querySelector('.animate-spin'),
        };
      };
      new MutationObserver(read).observe(document.body, { childList: true, subtree: true });
    });

    const cylinder = await uploadAndWait(page, cylinderPath, 'cylinder', logs);
    const toastSeen = await page.evaluate(() => window.__stepToast);
    check(`${vp.name} the Importing toast showed a spinner while the file converted`,
      !!toastSeen && toastSeen.spinner && /Importing…/.test(toastSeen.text) && /Open CASCADE Technology/.test(toastSeen.text),
      JSON.stringify(toastSeen));
    check(`${vp.name} the toast links to the open-source notices`,
      !!toastSeen && toastSeen.href === '/THIRD_PARTY_NOTICES.txt' && toastSeen.linkText === 'Open-source notices',
      JSON.stringify(toastSeen));
    const notices = await fetch(`${APP_URL}THIRD_PARTY_NOTICES.txt`).then(async (res) => ({ ok: res.ok, text: await res.text() }));
    check(`${vp.name} the notices file is served and names Open CASCADE and the LGPL`,
      notices.ok && /Open CASCADE Technology/.test(notices.text) && /GNU LESSER GENERAL PUBLIC LICENSE/.test(notices.text));
    if (cylinder) {
      // The row appears before the import handler finishes saving the part.
      const gone = await page.waitForSelector('[data-step-importing]', { state: 'detached', timeout: 20000 })
        .then(() => true, () => false);
      check(`${vp.name} the Importing toast leaves when the import settles`, gone);
      check(`${vp.name} STEP upload created a part`, (await rowNames(page)).length === before + 1,
        JSON.stringify(await rowNames(page)));
      const done = logs.map((line) => line.match(/STEP import complete in [\d.]+s \(volume: ([\d.]+) mm/)).find(Boolean);
      const volume = done ? Number(done[1]) : NaN;
      const exact = Math.PI * 100 * 20;
      check(`${vp.name} cylinder volume is inside the chord tolerance`, volume > exact * 0.97 && volume < exact,
        `volume=${volume} exact=${exact.toFixed(2)}`);
    }

    const crate = await uploadAndWait(page, boxPath, 'crate', logs);
    if (crate) {
      check(`${vp.name} .stp upload created a second part`, (await rowNames(page)).length === before + 2,
        JSON.stringify(await rowNames(page)));
    }

    const wasm = requests.filter((r) => /surfcad_step.*\.wasm/.test(r.url));
    check(`${vp.name} the STEP wasm came from the app origin`,
      wasm.length > 0 && wasm.every((r) => r.url.startsWith(APP_URL) && r.method === 'GET'),
      JSON.stringify(wasm.slice(0, 3)));
    const convert = requests.filter((r) => /\/api\/convert/.test(r.url));
    check(`${vp.name} no request reached the server convert route`, convert.length === 0, JSON.stringify(convert));

    await page.setInputFiles('[data-part-upload-input]', brokenPath);
    await page.waitForSelector('[data-upload-toast]', { timeout: 30000 });
    const toast = await page.locator('[data-upload-toast]').innerText();
    const carried = requests.filter((r) => r.carriesStep);
    check(`${vp.name} no request body carried STEP file contents`, carried.length === 0,
      JSON.stringify(carried.map(({ url, method, bytes }) => ({ url, method, bytes })).slice(0, 3)));
    check(`${vp.name} a file that is not STEP shows the unreadable toast`, /couldn't read this file as STEP/.test(toast), toast.slice(0, 180));
    check(`${vp.name} the failed file added no part`, (await rowNames(page)).length === before + (cylinder ? 1 : 0) + (crate ? 1 : 0));
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
console.log('\nstep upload local: ok');
process.exit(0);

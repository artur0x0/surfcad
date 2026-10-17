#!/usr/bin/env node
/**
 * The Opening-assembly overlay clears after a real open.
 *
 * Reload and parts-list file open, at 390px (touch) and on desktop:
 * an assembly with saved face colors, one without, one named Part 1,
 * and a reload while that colored part is current. The spinner must be
 * gone within the timeout, including when it never flashed.
 *
 * Screenshots go to GOLDEN_SHOT_DIR or os.tmpdir() only.
 */
/* global document, indexedDB, localStorage */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { attachConsentPresetToBrowser } from './lib/presetConsentInit.mjs';

const PORT = Number(process.env.SMOKE_PORT || 5197);
const APP_URL = `http://127.0.0.1:${PORT}/`;
const CLEAR_MS = Number(process.env.OPEN_CLEAR_MS || 12000);
const SHOT_DIR = process.env.GOLDEN_SHOT_DIR || tmpdir();
const CUBE = 'let part = Manifold.cube([20, 20, 20], true);\nreturn part;\n';
const SURF_C = '2026-10-08-17-26-00-0001-a3f9';
const SURF_P = '2026-10-08-17-26-00-0002-b10c';

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
    failed++;
    console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`);
  }
}

function assembly(name, part) {
  return {
    version: 1,
    source: 'local',
    name,
    activeId: part.id,
    parts: [part],
    ...(part.colors ? { colors: part.colors } : {}),
  };
}

const coloredPart = {
  id: 'local:painted',
  name: 'Bracket',
  visible: true,
  order: 0,
  surfId: SURF_C,
  colors: {
    [SURF_C]: {
      part: '#6b7280',
      faces: [{ color: '#e11d48', key: { at: [0, 0, 10], n: [0, 0, 1], area: 400, src: -1, ord: 0 } }],
    },
  },
};
const plainPart = {
  id: 'local:plain',
  name: 'Block',
  visible: true,
  order: 0,
  surfId: SURF_P,
};
const legacyPart = {
  id: 'local:legacy',
  name: 'Part 1',
  visible: true,
  order: 0,
};

function docOf(part, asmName) {
  const { colors, ...row } = part;
  const doc = assembly(asmName, row);
  if (colors) doc.colors = colors;
  return doc;
}

const SCRIPTS = {
  'local:painted': `// @surf-id ${SURF_C}\n${CUBE}`,
  'local:plain': `// @surf-id ${SURF_P}\n${CUBE}`,
  'local:legacy': CUBE,
};

console.log('assembly open overlay clears');

const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!exe) {
  console.log('assembly open clears: no system Chrome — set CHROME_PATH. Skipping.');
  process.exit(0);
}

mkdirSync(SHOT_DIR, { recursive: true });
const files = {
  colors: join(SHOT_DIR, 'open-colors.surf.json'),
  plain: join(SHOT_DIR, 'open-plain.surf.json'),
  legacy: join(SHOT_DIR, 'open-legacy.surf.json'),
};
writeFileSync(files.colors, JSON.stringify(docOf(coloredPart, 'Painted')));
writeFileSync(files.plain, JSON.stringify(docOf(plainPart, 'Plain')));
writeFileSync(files.legacy, JSON.stringify(docOf(legacyPart, 'Legacy')));

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

async function seed(page, current) {
  await page.evaluate(async ({ current: doc, scripts }) => {
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
        for (const [id, script] of Object.entries(scripts)) {
          tx.objectStore('parts').put({ id, script, savedAt: Date.now() }, id);
        }
        localStorage.setItem('surfcad.lastAssembly', JSON.stringify({
          'user-open': {
            name: doc.name,
            activeId: doc.activeId,
            source: doc.source || 'local',
            savedAt: Date.now(),
          },
        }));
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
    });
  }, { current, scripts: SCRIPTS });
}

async function overlayGone(page, label) {
  const started = Date.now();
  let saw = false;
  let last = null;
  while (Date.now() - started < CLEAR_MS) {
    last = await page.evaluate(() => {
      const el = document.querySelector('[data-assembly-open-spinner]');
      const toast = document.querySelector('[data-assembly-open-toast]');
      return {
        spinner: !!el,
        label: el?.querySelector('[data-assembly-open-label]')?.textContent || '',
        toast: (toast?.textContent || '').trim(),
        solids: document.querySelector('[data-assembly-solids]')?.getAttribute('data-assembly-solids') || '',
        title: document.querySelector('[data-viewer-title]')?.textContent
          || document.body?.innerText?.slice(0, 80)
          || '',
      };
    });
    if (last.spinner) saw = true;
    if (!last.spinner && last.solids === '1' && !last.toast) break;
    await page.waitForTimeout(200);
  }
  const ms = Date.now() - started;
  check(
    `${label} overlay cleared`,
    last && !last.spinner && !last.toast && last.solids === '1',
    `after ${ms}ms sawSpinner=${saw} ${JSON.stringify(last)}`,
  );
  return last;
}

async function boot(page) {
  // A signed-out reload clears the chip and does not open IndexedDB.
  // This golden signs in so a seeded assembly is the last-opened document.
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
      user: { id: 'user-open', email: 'open@surfcad.test', vaultName: null },
    }),
  }));
  const errors = [];
  page.on('pageerror', (err) => errors.push(String(err).slice(0, 240)));
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForSelector('canvas', { timeout: 40000 });
  return errors;
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
    { name: 'desktop', width: 1280, height: 900, touch: false },
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
    const errors = await boot(page);
    await seed(page, docOf(coloredPart, 'Painted'));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-assembly-file]', { timeout: 40000, state: 'attached' });
    const reloaded = await overlayGone(page, `${vp.name} reload colors`);
    if (vp.touch && reloaded && !reloaded.spinner) {
      const shot = join(SHOT_DIR, 'assembly-open-cleared-390.png');
      await page.screenshot({ path: shot });
      check('390 shot saved', existsSync(shot), shot);
      console.log(`  shot ${shot}`);
    }
    await page.setInputFiles('[data-assembly-file]', files.plain);
    await overlayGone(page, `${vp.name} open no colors`);
    await page.setInputFiles('[data-assembly-file]', files.legacy);
    await overlayGone(page, `${vp.name} open Part 1`);
    await page.setInputFiles('[data-assembly-file]', files.colors);
    await overlayGone(page, `${vp.name} open colors`);
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
console.log('\nassembly open overlay clears: ok');

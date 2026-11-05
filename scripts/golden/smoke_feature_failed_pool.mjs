#!/usr/bin/env node
/**
 * A part that recovered from a thrown feature on the geometry pool shows it.
 *
 * Open a two-part assembly whose active part is fine and whose other part
 * has a fillet on edges that do not exist. The pool builds that part, the
 * worker skips the thrown block and returns the recovered solid with
 * `featureSkip`. Before this golden the run record dropped that report, so
 * the Parts feed row stayed plain and switching to the part reused the
 * built mesh without a viewport run, which left every strip chip grey.
 *
 * Checks: the row is red with "Feature failed" and a thumbnail, the strip
 * marks the fillet chip after the switch (a reuse, no rerun), the good
 * part's chip stays grey, and switching away and back keeps the mark.
 */
/* global document, window, indexedDB, localStorage */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright-core';
import { attachConsentPresetToBrowser } from './lib/presetConsentInit.mjs';

const PORT = Number(process.env.SMOKE_PORT || 4338);
const APP_URL = `http://127.0.0.1:${PORT}/?agent=1`;
const SHOT_DIR = process.env.GOLDEN_SHOT_DIR || tmpdir();
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].filter(Boolean);

const CUBE = `// --- cube begin ---
let part = Manifold.cube([20, 20, 20], true);
// --- cube end ---`;
const GOOD_FILLET = `// --- fillet-mode begin ---
const selEdges = edgesBetween(part, 0, 6);
const path = makeSweepPath(selEdges);
part = filletAlongPath(part, path, 2);
// --- fillet-mode end ---`;
const BAD_FILLET = `// --- fillet-mode begin ---
const selEdges2 = edgesBetween(part, 90, 91);
const path2 = makeSweepPath(selEdges2);
part = filletAlongPath(part, path2, 2);
// --- fillet-mode end ---`;
const BAD_SCRIPT = `${CUBE}\n${GOOD_FILLET}\n${BAD_FILLET}\nreturn part;\n`;
const GOOD_SCRIPT = `${CUBE}\nreturn part;\n`;

const ASSEMBLY = {
  format: 'surfcad.assembly',
  v: 1,
  name: 'feature-failed-pool',
  activeId: 'local:good',
  source: 'git',
  parts: [
    { id: 'local:bad', name: 'Bad part', visible: true },
    { id: 'local:good', name: 'Good part', visible: true },
  ],
  joints: [],
};

let failed = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed += 1;
    console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`);
  }
}

const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!exe) {
  console.log('feature failed pool: no system Chrome found — set CHROME_PATH. Skipping.');
  process.exit(0);
}
if (!existsSync(new URL('../../dist/index.html', import.meta.url))) {
  console.log('  ❌ dist/ missing — run npm run build');
  process.exit(1);
}
mkdirSync(SHOT_DIR, { recursive: true });

const server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], {
  cwd: new URL('../../', import.meta.url).pathname,
  stdio: 'ignore',
  detached: true,
});
let stopped = false;
const stop = () => {
  if (stopped) return;
  stopped = true;
  try { process.kill(-server.pid, 'SIGTERM'); } catch { /* */ }
  try { server.kill('SIGKILL'); } catch { /* */ }
};
process.on('exit', stop);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { stop(); process.exit(1); });

async function waitForServer(timeoutMs = 40000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      if ((await fetch(`http://127.0.0.1:${PORT}/`)).ok) return true;
    } catch { /* */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

async function seedAssembly(page) {
  await page.evaluate(async ({ doc, scripts }) => {
    localStorage.setItem('surfcadAgent', '1');
    localStorage.setItem('surfcad.lastAssembly', JSON.stringify({
      'user-feature-failed-pool': { name: doc.name, activeId: doc.activeId, source: 'git', savedAt: Date.now() },
    }));
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
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
    });
  }, { doc: ASSEMBLY, scripts: { 'local:bad': BAD_SCRIPT, 'local:good': GOOD_SCRIPT } });
}

async function agentCall(page, name, args) {
  return page.evaluate(async ({ name, argsJson }) => window.surfcad.call(name, argsJson), { name, argsJson: JSON.stringify(args ?? {}) });
}

const readUi = (page) => page.evaluate(() => {
  const chips = Array.from(document.querySelectorAll('[data-feature-chip]')).map((el) => ({
    id: el.getAttribute('data-feature-id'),
    failed: el.getAttribute('data-feature-failed') === '1',
    red: /border-red-400/.test(el.className),
  }));
  const rows = Array.from(document.querySelectorAll('[data-part-row]')).map((el) => ({
    id: el.getAttribute('data-part-row'),
    status: el.getAttribute('data-part-status'),
    featureFailed: el.getAttribute('data-part-feature-failed') === 'true',
    red: /bg-red-950/.test(el.className),
    caption: (el.querySelector('[data-part-error]')?.textContent || '').trim(),
    thumb: !!el.querySelector('canvas, img'),
  }));
  return { chips, rows };
});

async function settleRun(page) {
  let last = null;
  for (let i = 0; i < 120; i += 1) {
    const st = await agentCall(page, 'status', { return: 'summary' });
    last = st?.result || null;
    const state = last?.runState;
    if (state === 'ok' || state === 'failed') return last;
    await page.waitForTimeout(250);
  }
  return last;
}

console.log('feature failed pool golden');
if (!(await waitForServer())) {
  console.log('  ❌ preview server did not start');
  stop();
  process.exit(1);
}

const browser = await chromium.launch({
  executablePath: exe,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader'],
});
attachConsentPresetToBrowser(browser);
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const pageErrors = [];
page.on('pageerror', (err) => pageErrors.push(err.message));
await page.route('**/api/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
await page.route('**/api/auth/me', (route) => route.fulfill({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({ authenticated: true, user: { _id: 'user-feature-failed-pool', email: 'pool@test.local' } }),
}));

await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
await seedAssembly(page);
await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(
  () => typeof window.surfcad?.call === 'function' && !document.querySelector('[data-app-loading]'),
  { timeout: 120000 },
);
await page.waitForSelector('[data-cad-run]', { state: 'attached', timeout: 120000 });
const opened = await settleRun(page);
check('the assembly opened on the good part', opened?.partId === 'good', JSON.stringify(opened));

// The bad part built on the pool: its row is red before it is ever active.
await page.waitForFunction(() => document.querySelector('[data-part-row="bad"][data-part-feature-failed="true"]'), null, { timeout: 30000 }).catch(() => {});
const afterOpen = await readUi(page);
const badRow = afterOpen.rows.find((row) => row.id === 'bad');
const goodRow = afterOpen.rows.find((row) => row.id === 'good');
check('the recovered part\'s row is red with "Feature failed" and keeps its thumbnail',
  badRow && badRow.featureFailed && badRow.red && badRow.caption === 'Feature failed' && badRow.status === 'ok' && badRow.thumb,
  JSON.stringify(badRow));
check('the good part\'s row stays plain', goodRow && !goodRow.featureFailed && !goodRow.red && goodRow.caption === '', JSON.stringify(goodRow));

// Switch to the bad part. Its mesh is reused (no rerun), and the strip
// must still mark the fillet that threw.
const switched = await agentCall(page, 'set_active_part', { part_id: 'bad' });
check('set_active_part bad', switched?.ok === true, JSON.stringify(switched));
await page.waitForFunction(() => document.querySelector('[data-feature-chip][data-feature-id="fillet-2"]'), null, { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(600);
const onBad = await readUi(page);
const chipIds = onBad.chips.map((chip) => chip.id);
check('the strip shows the bad part\'s three chips', JSON.stringify(chipIds) === JSON.stringify(['cube-0', 'fillet-1', 'fillet-2']), JSON.stringify(chipIds));
check('the fillet that threw is red, the others are not',
  onBad.chips.find((c) => c.id === 'fillet-2')?.failed === true
  && onBad.chips.find((c) => c.id === 'fillet-2')?.red === true
  && onBad.chips.filter((c) => c.id !== 'fillet-2').every((c) => !c.failed && !c.red),
  JSON.stringify(onBad.chips));
await page.screenshot({ path: `${SHOT_DIR}/feature-failed-pool-1280.png` });

// Away and back: the mark follows the part, and the good part shows none.
await agentCall(page, 'set_active_part', { part_id: 'good' });
await page.waitForTimeout(800);
const onGood = await readUi(page);
check('the good part\'s chip is grey', onGood.chips.length === 1 && !onGood.chips[0].failed, JSON.stringify(onGood.chips));
await agentCall(page, 'set_active_part', { part_id: 'bad' });
await page.waitForTimeout(800);
const back = await readUi(page);
check('back on the bad part the fillet chip is red again',
  back.chips.find((c) => c.id === 'fillet-2')?.failed === true, JSON.stringify(back.chips));
check('the bad row is still red', back.rows.find((row) => row.id === 'bad')?.red === true, JSON.stringify(back.rows));
check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));

await browser.close();
stop();
if (failed) {
  console.log(`\nfeature failed pool golden: ${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nfeature failed pool golden: ok');
process.exit(0);

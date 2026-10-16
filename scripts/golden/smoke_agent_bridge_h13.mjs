#!/usr/bin/env node
/**
 * Agent bridge H13: paint and measure — open, state, faces, confirm, clear, undo.
 */
/* global document, window, indexedDB, localStorage */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { newPartStarterScript } from '../../src/utils/helperPaletteSnippets.js';

const SHOT_DIR = process.env.GOLDEN_SHOT_DIR || tmpdir();
const PORT = Number(process.env.SMOKE_PORT || 4327);
const APP_URL = `http://127.0.0.1:${PORT}/?agent=1`;

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].filter(Boolean);

const SURF_ID = '2026-10-16-12-00-00-0001-b6d5';
const ASSEMBLY = {
  format: 'surfcad.assembly',
  v: 1,
  name: 'agent-h13',
  activeId: 'local:part1',
  source: 'git',
  parts: [{ id: 'local:part1', name: 'Part (1)', visible: true, surfId: SURF_ID }],
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
  console.log('agent bridge h13: no system Chrome found — set CHROME_PATH. Skipping.');
  process.exit(0);
}

if (!existsSync(new URL('../../dist/index.html', import.meta.url))) {
  console.log('  ❌ dist/ missing — run `npm run build:playtest` first');
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
  try { process.kill(-server.pid, 'SIGTERM'); } catch { /* already gone */ }
  try { server.kill('SIGKILL'); } catch { /* already gone */ }
};
process.on('exit', stop);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { stop(); process.exit(1); });

async function waitForServer(timeoutMs = 40000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/`);
      if (res.ok) return true;
    } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

async function seedAssembly(page) {
  await page.evaluate(async ({ doc, script }) => {
    localStorage.setItem('surfcadAgent', '1');
    localStorage.setItem('surfcad.lastAssembly', JSON.stringify({
      'user-agent-h13': {
        name: doc.name,
        activeId: doc.activeId,
        source: 'git',
        savedAt: Date.now(),
      },
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
        tx.objectStore('parts').put({ id: 'local:part1', script, savedAt: Date.now() }, 'local:part1');
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
    });
  }, { doc: ASSEMBLY, script: `// @surf-id ${SURF_ID}\n${newPartStarterScript()}` });
}

async function agentCall(page, name, args) {
  return page.evaluate(async ({ name, argsJson }) => window.surfcad.call(name, argsJson), {
    name,
    argsJson: JSON.stringify(args ?? {}),
  });
}

async function shot(page, label, width) {
  await page.setViewportSize({ width, height: Math.round(width * 0.62) });
  const buf = await page.screenshot({ type: 'png' });
  writeFileSync(join(SHOT_DIR, `agent-bridge-h13-${label}-${width}.png`), buf);
}

console.log('agent bridge h13 golden');

if (!(await waitForServer())) {
  console.log('  ❌ preview server did not start');
  stop();
  process.exit(1);
}

const browser = await chromium.launch({
  executablePath: exe,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.route('**/api/auth/me', (route) => route.fulfill({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({
    authenticated: true,
    user: { _id: 'user-agent-h13', email: 'agent@test.local' },
  }),
}));
await page.route('**/api/config', (route) => route.fulfill({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({}),
}));

await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
await seedAssembly(page);
await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });

await page.waitForFunction(
  () => typeof window.surfcad?.call === 'function' && !document.querySelector('[data-app-loading]'),
  { timeout: 120000 },
);
await page.waitForSelector('[data-cad-run]', { state: 'attached', timeout: 120000 });
await page.waitForTimeout(500);

const cube = await agentCall(page, 'insert_cube', { width: 60, depth: 40, height: 8 });
check('insert_cube', cube.ok === true && cube.result?.ok === true, JSON.stringify(cube));
const ran = await agentCall(page, 'run', {});
check('run cube', ran.ok === true && ran.result?.ok === true, JSON.stringify(ran));
await page.waitForTimeout(400);

const paintOpen = await agentCall(page, 'paint_open', {});
check('paint_open', paintOpen.ok === true, JSON.stringify(paintOpen));

const modePaint = await agentCall(page, 'mode', {});
check('mode paint', modePaint.ok === true && modePaint.result?.viewport === 'paint', JSON.stringify(modePaint));

const faces = await agentCall(page, 'list_faces', {});
const top = (faces.result?.faces || []).find((row) => row.normal?.[2] > 0.9);
check('list_faces top', !!top?.key);

await agentCall(page, 'paint_set_color', { color: '#ef4444' });
const painted = await agentCall(page, 'paint_faces', { keys: [top.key] });
check('paint_faces', painted.ok === true && (painted.result?.painted ?? 0) >= 1, JSON.stringify(painted));

const pState = await agentCall(page, 'paint_state', {});
check('paint_state pending', pState.ok === true && pState.result?.pendingCount >= 1 && pState.result?.canConfirm,
  JSON.stringify(pState));

const pUndo = await agentCall(page, 'paint_undo', {});
check('paint_undo', pUndo.ok === true, JSON.stringify(pUndo));

const pState2 = await agentCall(page, 'paint_state', {});
check('paint_state after undo', pState2.ok === true && (pState2.result?.pendingCount ?? 0) === 0,
  JSON.stringify(pState2));

await agentCall(page, 'paint_faces', { keys: [top.key] });
const confirmed = await agentCall(page, 'paint_confirm', {});
check('paint_confirm', confirmed.ok === true && confirmed.result?.written === true, JSON.stringify(confirmed));

await agentCall(page, 'paint_open', {});
await agentCall(page, 'paint_set_color', { color: '#22c55e' });
const repaint = await agentCall(page, 'paint_faces', { keys: [top.key] });
check('repaint after confirm loads assembly colors', repaint.ok === true && (repaint.result?.painted ?? 0) >= 1,
  JSON.stringify(repaint));
await agentCall(page, 'paint_cancel', {});

const paintClosed = await agentCall(page, 'paint_close', {});
check('paint_close', paintClosed.ok === true, JSON.stringify(paintClosed));

const mOpen = await agentCall(page, 'measure_open', {});
check('measure_open', mOpen.ok === true, JSON.stringify(mOpen));

const modeMeasure = await agentCall(page, 'mode', {});
check('mode measure', modeMeasure.ok === true && modeMeasure.result?.viewport === 'measure', JSON.stringify(modeMeasure));

const side = (faces.result?.faces || []).find((row) => Math.abs(row.normal?.[0]) > 0.9);
const mPick = await agentCall(page, 'measure_pick', { face_keys: [top.key, side?.key || top.key] });
check('measure_pick', mPick.ok === true && (mPick.result?.count ?? 0) >= 1, JSON.stringify(mPick));

const mState = await agentCall(page, 'measure_state', {});
check('measure_state readout', mState.ok === true && (mState.result?.readout?.rows?.length ?? 0) > 0,
  JSON.stringify(mState));

const mClear = await agentCall(page, 'measure_clear', {});
check('measure_clear', mClear.ok === true && mClear.result?.count === 0, JSON.stringify(mClear));

const mClose = await agentCall(page, 'measure_close', {});
check('measure_close', mClose.ok === true, JSON.stringify(mClose));

await shot(page, 'paint-measure', 1280);
await shot(page, 'paint-measure', 390);

await browser.close();
stop();

if (failed) {
  console.log(`\nagent bridge h13: ${failed} failed`);
  process.exit(1);
}
console.log('\nagent bridge h13: all checks passed');
process.exit(0);

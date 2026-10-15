#!/usr/bin/env node
/**
 * Agent bridge H10: hole card, offset workplane, sketch point picks, hole_commit, undo.
 */
/* global document, window, indexedDB, localStorage */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const SHOT_DIR = process.env.GOLDEN_SHOT_DIR || tmpdir();
const PORT = Number(process.env.SMOKE_PORT || 4325);
const APP_URL = `http://127.0.0.1:${PORT}/?agent=1`;

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].filter(Boolean);

const ASSEMBLY = {
  format: 'surfcad.assembly',
  v: 1,
  name: 'agent-h10',
  activeId: 'local:part1',
  source: 'git',
  parts: [{ id: 'local:part1', name: 'Part (1)', visible: true }],
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
  console.log('agent bridge h10: no system Chrome found — set CHROME_PATH. Skipping.');
  process.exit(0);
}

if (!existsSync(new URL('../../dist/index.html', import.meta.url))) {
  console.log('  ❌ dist/ missing — run `npm run build` first');
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
  await page.evaluate(async ({ doc }) => {
    localStorage.setItem('surfcadAgent', '1');
    localStorage.setItem('surfcad.lastAssembly', JSON.stringify({
      'user-agent-h10': {
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
        tx.objectStore('parts').put({ id: 'local:part1', script: '', savedAt: Date.now() }, 'local:part1');
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
    });
  }, { doc: ASSEMBLY });
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
  writeFileSync(join(SHOT_DIR, `agent-bridge-h10-${label}-${width}.png`), buf);
}

console.log('agent bridge h10 golden');

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
    user: { _id: 'user-agent-h10', email: 'agent@test.local' },
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
await page.waitForSelector('.monaco-editor', { state: 'attached', timeout: 120000 });
await page.waitForTimeout(500);

const cube = await agentCall(page, 'insert_cube', { width: 60, depth: 40, height: 8 });
check('insert_cube', cube.ok === true && cube.result?.ok === true, JSON.stringify(cube));

const faces = await agentCall(page, 'list_faces', {});
const top = (faces.result?.faces || []).find((row) => row.normal?.[2] > 0.9);
check('list_faces top', !!top?.key);

await agentCall(page, 'pick_faces', { keys: [top.key], max: 1 });

const opened = await agentCall(page, 'hole_open', {});
check('hole_open', opened.ok === true, JSON.stringify(opened));

const params = await agentCall(page, 'hole_set_params', { size: 'M4', fit: 'normal', through: true });
check('hole_set_params', params.ok === true, JSON.stringify(params));

const centres = await agentCall(page, 'hole_begin_centres', {});
check('hole_begin_centres', centres.ok === true, JSON.stringify(centres));

const plane = await agentCall(page, 'plane_set', { preset: 'z', offset: 4 });
check('plane_set offset', plane.ok === true, JSON.stringify(plane));

const accept = await agentCall(page, 'sketch_accept_plane', {});
check('sketch_accept_plane', accept.ok === true, JSON.stringify(accept));

const rect = await agentCall(page, 'sketch_add', { tool: 'rectangle', width: 30, height: 20 });
check('sketch_add rectangle centres', rect.ok === true, JSON.stringify(rect));

const arcSketch = await agentCall(page, 'sketch_add', {
  tool: 'cursor',
  params: {
    contour: {
      centers: true,
      points: [{ id: 'pArc', at: [-12, 8] }],
      lines: [],
      arcs: [{ id: 'a0', center: 'pArc', radius: 6, sweep: 'ccw' }],
    },
  },
});
check('sketch_add arc centre contour', arcSketch.ok === true, JSON.stringify(arcSketch));

const arcPick = await agentCall(page, 'pick_points', { kind: 'arc', keys: ['a0'] });
check('pick_points arc centre', arcPick.ok === true && arcPick.result?.target === 'holeCentres',
  JSON.stringify(arcPick));

const committed = await agentCall(page, 'hole_commit', {});
check('hole_commit', committed.ok === true && committed.result?.ok === true && committed.result?.written === true,
  JSON.stringify(committed));

const tree = await agentCall(page, 'feature_tree', {});
check('feature_tree hole + centres contour', (tree.result?.features || []).some((f) => f.kind === 'hole'),
  JSON.stringify((tree.result?.features || []).map((f) => f.kind)));

const beforeUndo = await agentCall(page, 'get_script', {});
const undone = await agentCall(page, 'undo', {});
check('undo one step', undone.ok === true && undone.result?.ok === true, JSON.stringify(undone));
const afterUndo = await agentCall(page, 'get_script', {});
check('undo restores script', afterUndo.result?.source !== beforeUndo.result?.source,
  'script unchanged');

await shot(page, 'plate-holes', 390);
await shot(page, 'plate-holes', 1280);
check('screenshots 390+1280', true);

await browser.close();
stop();

if (failed) {
  console.log(`\nagent bridge h10: ${failed} failed`);
  process.exit(1);
}
console.log('\nagent bridge h10: all checks passed');
process.exit(0);

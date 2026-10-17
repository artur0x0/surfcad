#!/usr/bin/env node
/**
 * Agent bridge H7: sketch → dimension → constrain → commit → extrude.
 */
/* global document, window, indexedDB, localStorage */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright-core';
import { attachConsentPresetToBrowser } from './lib/presetConsentInit.mjs';
import { focusPartHistoryForUndo } from './lib/focusPartHistory.mjs';

const SHOT_DIR = process.env.GOLDEN_SHOT_DIR || tmpdir();
const PORT = Number(process.env.SMOKE_PORT || 4324);
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
  name: 'agent-h7',
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
  console.log('agent bridge h7: no system Chrome found — set CHROME_PATH. Skipping.');
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
      'user-agent-h7': {
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
  return page.evaluate(async ({ name, argsJson }) => {
    const env = await window.surfcad.call(name, argsJson);
    return env;
  }, { name, argsJson: JSON.stringify(args ?? {}) });
}

async function waitContourReady(page) {
  await page.waitForFunction(async () => {
    const env = await window.surfcad.call('mode', '{}');
    return env?.result?.viewport === 'contour' && env?.result?.contour?.planeOpen !== true;
  }, { timeout: 30000 });
}

console.log('agent bridge h7 golden');

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
attachConsentPresetToBrowser(browser);

const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.route('**/api/auth/me', (route) => route.fulfill({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({
    authenticated: true,
    user: { _id: 'user-agent-h7', email: 'agent@test.local' },
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

const listed = await agentCall(page, 'list_commands', {});
const names = (listed.result?.commands || []).map((row) => row.name);
check('list_commands has sketch_dimension', names.includes('sketch_dimension'), JSON.stringify(names));
check('list_commands has sketch_constrain', names.includes('sketch_constrain'), JSON.stringify(names));

const cube = await agentCall(page, 'insert_cube', { width: 40, depth: 30, height: 20 });
check('insert_cube', cube.ok === true && cube.result?.ok === true, JSON.stringify(cube));

const faces = await agentCall(page, 'list_faces', {});
const topKey = faces.result.faces.find((row) => row.key?.n?.[2] > 0.9)?.key
  || faces.result.faces[0]?.key;
await agentCall(page, 'select_faces', { keys: [topKey] });

const began = await agentCall(page, 'sketch_begin', { entry: 'crossSection', accept_plane: true });
check('sketch_begin', began.ok === true, JSON.stringify(began));
await waitContourReady(page);

const drew = await agentCall(page, 'sketch_add', { tool: 'rectangle', width: 24, height: 16 });
check('sketch_add rectangle', drew.ok === true, JSON.stringify(drew));

const idsBefore = await page.evaluate(async () => {
  const env = await window.surfcad.call('get_script', '{}');
  return env?.result?.source?.includes('e0') && env?.result?.source?.includes('p0');
});
check('entity ids not in script before contour block', idsBefore === false, String(idsBefore));

const dim = await agentCall(page, 'sketch_dimension', { kind: 'length', edge: 'e0', value: 28 });
check('sketch_dimension', dim.ok === true && dim.result?.written === true && dim.result?.dimensionId === 'd0',
  JSON.stringify(dim));

const con = await agentCall(page, 'sketch_constrain', {
  kind: 'horizontal',
  picks: [{ kind: 'line', id: 'e2' }],
});
check('sketch_constrain', con.ok === true && con.result?.written === true, JSON.stringify(con));

const committed = await agentCall(page, 'sketch_commit', {});
check(
  'sketch_commit',
  committed.ok === true
    && (committed.result?.written === true || committed.result?.unchanged === true),
  JSON.stringify(committed),
);

const scriptAfterSketch = await agentCall(page, 'get_script', {});
check('script has @contour', scriptAfterSketch.result?.source?.includes('@contour'),
  String(scriptAfterSketch.result?.source?.length));

const contourId = (scriptAfterSketch.result?.source?.match(/@contour id=(c\d+)/) || [])[1] || 'c1';
await agentCall(page, 'slot_open', { kind: 'makeExtrude' });
await agentCall(page, 'slot_assign_contour', { contour_id: contourId, role: 'profile' });
await agentCall(page, 'slot_set_params', { distance: 12 });
const extruded = await agentCall(page, 'slot_commit', {});
check('slot_commit extrude', extruded.ok === true && extruded.result?.written === true,
  JSON.stringify(extruded));

await focusPartHistoryForUndo(page, agentCall);
const undo = await agentCall(page, 'undo', {});
check('undo after extrude', undo.ok === true && undo.result?.ok === true, JSON.stringify(undo));

await browser.close();
stop();

if (failed) {
  console.log(`agent bridge h7: ${failed} failed`);
  process.exit(1);
}
console.log('agent bridge h7: ok');

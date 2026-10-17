#!/usr/bin/env node
/**
 * Agent bridge H6+H8: sketch on face → named contour → extrude slot.
 */
/* global document, window, indexedDB, localStorage */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright-core';
import { attachConsentPresetToBrowser } from './lib/presetConsentInit.mjs';

const SHOT_DIR = process.env.GOLDEN_SHOT_DIR || tmpdir();
const PORT = Number(process.env.SMOKE_PORT || 4323);
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
  name: 'agent-h6-h8',
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
  console.log('agent bridge h6-h8: no system Chrome found — set CHROME_PATH. Skipping.');
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
      'user-agent-h6-h8': {
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

console.log('agent bridge h6-h8 golden');

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
    user: { _id: 'user-agent-h6-h8', email: 'agent@test.local' },
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

const cube = await agentCall(page, 'insert_cube', { width: 40, depth: 30, height: 20 });
check('insert_cube', cube.ok === true && cube.result?.ok === true, JSON.stringify(cube));

const faces = await agentCall(page, 'list_faces', {});
check('list_faces', faces.ok === true && (faces.result?.faces?.length ?? 0) >= 6, JSON.stringify(faces));

const topKey = faces.result.faces.find((row) => row.key?.n?.[2] > 0.9)?.key
  || faces.result.faces[0]?.key;
const picked = await agentCall(page, 'select_faces', { keys: [topKey] });
check('select_faces top', picked.ok === true, JSON.stringify(picked));

const began = await agentCall(page, 'sketch_begin', { entry: 'crossSection', accept_plane: true });
check('sketch_begin', began.ok === true, JSON.stringify(began));
await waitContourReady(page);

const drew = await agentCall(page, 'sketch_add', { tool: 'rectangle', width: 24, height: 16 });
check('sketch_add rectangle', drew.ok === true, JSON.stringify(drew));

const committed = await agentCall(page, 'sketch_commit', {});
check('sketch_commit', committed.ok === true && committed.result?.written === true,
  JSON.stringify(committed));

const scriptAfterSketch = await agentCall(page, 'get_script', {});
check('script has @contour', scriptAfterSketch.result?.source?.includes('@contour'),
  String(scriptAfterSketch.result?.source?.length));

const slot = await agentCall(page, 'slot_open', { kind: 'makeExtrude' });
check('slot_open extrude', slot.ok === true, JSON.stringify(slot));

const modeSlot = await agentCall(page, 'mode', {});
check('feature slot open', modeSlot.result?.featureSlot?.kind === 'makeExtrude',
  JSON.stringify(modeSlot.result));

const contourId = (scriptAfterSketch.result?.source?.match(/@contour id=(c\d+)/) || [])[1] || 'c1';
const assigned = await agentCall(page, 'slot_assign_contour', { contour_id: contourId, role: 'profile' });
check('slot_assign_contour', assigned.ok === true, JSON.stringify(assigned));

const params = await agentCall(page, 'slot_set_params', { distance: 12 });
check('slot_set_params', params.ok === true, JSON.stringify(params));

const statusBeforeSlot = await agentCall(page, 'status', {});
const volBefore = statusBeforeSlot.result?.volume ?? 0;
const fcBefore = statusBeforeSlot.result?.featureCount ?? 0;

const extruded = await agentCall(page, 'slot_commit', {});
check('slot_commit', extruded.ok === true && extruded.result?.written === true,
  JSON.stringify(extruded));
check(
  'slot_commit returns fresh status.volume',
  (extruded.result?.status?.volume ?? 0) > volBefore,
  JSON.stringify({ before: volBefore, after: extruded.result?.status?.volume }),
);
check(
  'slot_commit returns fresh status.featureCount',
  (extruded.result?.status?.featureCount ?? 0) > fcBefore,
  JSON.stringify({ before: fcBefore, after: extruded.result?.status?.featureCount }),
);

const tree = await agentCall(page, 'feature_tree', {});
const kinds = (tree.result?.features || []).map((row) => row.kind);
check('feature_tree has extrude', kinds.includes('extrude'), JSON.stringify(kinds));

const status = await agentCall(page, 'status', {});
check(
  'status matches slot_commit without extra run',
  status.ok === true
    && status.result?.volume === extruded.result?.status?.volume
    && status.result?.featureCount === extruded.result?.status?.featureCount,
  JSON.stringify({ status: status.result, slot: extruded.result?.status }),
);

const errs = await agentCall(page, 'errors', {});
check('errors empty', errs.ok === true && (errs.result?.errors?.length ?? 0) === 0,
  JSON.stringify(errs.result?.errors));

await browser.close();
stop();

if (failed) {
  console.log(`agent bridge h6-h8: ${failed} failed`);
  process.exit(1);
}
console.log('agent bridge h6-h8: ok');

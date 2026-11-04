#!/usr/bin/env node
/**
 * Cross-section: a view-only clip while the options are open, a capped cut
 * on accept. An assembly and a solo part keep their geometry and show the
 * preview plane while editing; accepting (closing the options) trims every
 * visible solid with Manifold and the cut is capped; reopening or turning
 * the tool off restores the uncut geometry. Saves screenshots.
 */
/* global document, window, indexedDB, localStorage */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { SECTION_PLANE_COLOR } from '../../src/utils/sectionClip.js';

const PORT = Number(process.env.SMOKE_PORT || 4331);
const APP_URL = `http://127.0.0.1:${PORT}/?agent=1`;
const SHOT_DIR = process.env.GOLDEN_SHOT_DIR || tmpdir();
const USER = 'user-xsec';
const P1 = 'near';
const P2 = 'far';
const CUBE = 'return Manifold.cube([24, 24, 24], true);\n';

const DOC = {
  version: 1,
  source: 'local',
  name: 'XSec',
  activeId: P1,
  parts: [
    { id: P1, name: 'Near', visible: true, order: 0, position: [0, 0, 0] },
    { id: P2, name: 'Far', visible: true, order: 1, position: [80, 0, 0] },
  ],
};

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

const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!exe) {
  console.log('cross-section caps: no Chrome — skipping browser checks');
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
  try { process.kill(-server.pid, 'SIGTERM'); } catch { /* gone */ }
  try { server.kill('SIGKILL'); } catch { /* gone */ }
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

async function seed(page) {
  await page.evaluate(async ({ doc, cube, user }) => {
    localStorage.setItem('surfcadAgent', '1');
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
    localStorage.setItem('surfcad.lastAssembly', JSON.stringify({
      [user]: { name: doc.name, activeId: doc.activeId, source: 'local', savedAt: Date.now() },
    }));
  }, { doc: DOC, cube: CUBE, user: USER });
}

async function agentCall(page, name, args) {
  return page.evaluate(async ({ name, argsJson }) => window.surfcad.call(name, argsJson), {
    name,
    argsJson: JSON.stringify(args ?? {}),
  });
}

/** Poll the section state until the accepted trims have landed (caps on every target). */
async function waitForCaps(page, parts, timeoutMs = 20000) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeoutMs) {
    last = await agentCall(page, 'cross_section_state');
    const r = last.result || {};
    if ((r.trimmedPartIds?.length ?? 0) >= parts && (r.capCount ?? 0) > 0 && (r.clippedMaterials ?? 0) === 0) return last;
    await page.waitForTimeout(250);
  }
  return last;
}

function capped(state, label, parts, fullVolume) {
  const r = state.result || {};
  check(`${label} accept caps the solids`, r.geometryMutated === true && (r.capCount ?? 0) > 0,
    JSON.stringify({ geometryMutated: r.geometryMutated, capCount: r.capCount }));
  check(`${label} every target is trimmed`, (r.trimmedPartIds?.length ?? 0) === parts,
    JSON.stringify(r.trimmedPartIds));
  check(`${label} the cut keeps part of the volume`, (r.remainingVolume ?? 0) > fullVolume * 0.2 && (r.remainingVolume ?? 0) < fullVolume * 0.8,
    JSON.stringify({ remainingVolume: r.remainingVolume, fullVolume }));
  check(`${label} the clip comes off once the solids are cut`, (r.clippedMaterials ?? 0) === 0,
    JSON.stringify({ clippedMaterials: r.clippedMaterials }));
  check(`${label} preview plane hidden`, r.planeInScene === false, JSON.stringify({ planeInScene: r.planeInScene }));
}

console.log('cross-section caps golden');

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
  body: JSON.stringify({ authenticated: true, user: { _id: USER, email: 'x@test.local' } }),
}));
await page.route('**/api/config', (route) => route.fulfill({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({}),
}));

await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
await seed(page);
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForFunction(
  () => typeof window.surfcad?.call === 'function' && !document.querySelector('[data-app-loading]'),
  { timeout: 120000 },
);
for (const id of [P1, P2]) {
  const pick = await agentCall(page, 'set_active_part', { part_id: id });
  check(`activate ${id}`, pick.ok === true, JSON.stringify(pick));
  let ranPart = await agentCall(page, 'run', {});
  if (!ranPart.result?.ok) {
    await page.waitForTimeout(1500);
    ranPart = await agentCall(page, 'run', {});
  }
  check(`run ${id}`, ranPart.ok === true && ranPart.result?.ok === true, JSON.stringify(ranPart));
}
await agentCall(page, 'set_active_part', { part_id: P1 });
await page.waitForTimeout(3000);

writeFileSync(join(SHOT_DIR, 'cross-section-before.png'), await page.screenshot({ type: 'png' }));

const PREVIEW_BLUE = SECTION_PLANE_COLOR;

function viewOnly(state, label) {
  check(`${label} geometry unchanged`, state.result?.geometryMutated === false,
    JSON.stringify(state.result));
  check(`${label} plane in scene`, state.result?.planeInScene === true,
    JSON.stringify({ planeInScene: state.result?.planeInScene, planeColor: state.result?.planeColor }));
  check(`${label} plane is text-blue-400`, state.result?.planeColor === PREVIEW_BLUE,
    JSON.stringify({ planeColor: state.result?.planeColor }));
  check(`${label} no trimmed parts`, (state.result?.trimmedPartIds?.length ?? 0) === 0,
    JSON.stringify(state.result?.trimmedPartIds));
  check(`${label} no caps`, (state.result?.capCount ?? 0) === 0,
    JSON.stringify({ capCount: state.result?.capCount }));
  check(`${label} volume not replaced`, (state.result?.remainingVolume ?? 0) === 0,
    JSON.stringify({ remainingVolume: state.result?.remainingVolume }));
}

await agentCall(page, 'cross_section_toggle', { enabled: true });
await agentCall(page, 'cross_section_expand', { open: true });
const planeA = await agentCall(page, 'cross_section_plane', { plane: 'XZ' });
check('plane A read-back XZ + Y normal', planeA.ok === true
  && planeA.result?.plane === 'XZ'
  && Math.abs((planeA.result?.normal?.[1] ?? 0) - 1) < 0.01
  && (planeA.result?.appliedGen ?? 0) > 0,
  JSON.stringify(planeA.result));

let state = await agentCall(page, 'cross_section_state');
check('assembly scope on', state.result?.assemblyScope === true, JSON.stringify(state.result));
check('A two targets', (state.result?.targetPartIds?.length ?? 0) >= 2,
  JSON.stringify(state.result?.targetPartIds));
viewOnly(state, 'A');

const planeB = await agentCall(page, 'cross_section_plane', { plane: 'XY' });
check('plane B read-back XY + Z normal', planeB.ok === true
  && planeB.result?.plane === 'XY'
  && Math.abs((planeB.result?.normal?.[2] ?? 0) - 1) < 0.01,
  JSON.stringify(planeB.result));
state = await agentCall(page, 'cross_section_state');
check('B two targets still', (state.result?.targetPartIds?.length ?? 0) >= 2,
  JSON.stringify(state.result?.targetPartIds));
viewOnly(state, 'B');

const planeC = await agentCall(page, 'cross_section_plane', { plane: 'XZ' });
check('plane C different orientation back to XZ', planeC.ok === true && planeC.result?.plane === 'XZ',
  JSON.stringify(planeC.result));
state = await agentCall(page, 'cross_section_state');
viewOnly(state, 'C');
await agentCall(page, 'cross_section_expand', { open: false });
state = await agentCall(page, 'cross_section_state');
check('accept hides the plane at once and keeps the clip until the caps land', state.result?.planeInScene === false
  && state.result?.optionsOpen === false
  && ((state.result?.clippedMaterials ?? 0) > 0 || state.result?.geometryMutated === true),
  JSON.stringify({
    planeInScene: state.result?.planeInScene,
    optionsOpen: state.result?.optionsOpen,
    clippedMaterials: state.result?.clippedMaterials,
    geometryMutated: state.result?.geometryMutated,
  }));
const CUBE_VOLUME = 24 * 24 * 24;
state = await waitForCaps(page, 2);
capped(state, 'assembly', 2, 2 * CUBE_VOLUME);
await agentCall(page, 'cross_section_expand', { open: true });
state = await agentCall(page, 'cross_section_state');
viewOnly(state, 'reopen');
check('reopen clips again', (state.result?.clippedMaterials ?? 0) > 0, JSON.stringify({ clippedMaterials: state.result?.clippedMaterials }));
await agentCall(page, 'cross_section_expand', { open: false });
state = await waitForCaps(page, 2);
capped(state, 'assembly re-accept', 2, 2 * CUBE_VOLUME);

writeFileSync(join(SHOT_DIR, 'cross-section-after-assembly.png'), await page.screenshot({ type: 'png' }));

await agentCall(page, 'cross_section_toggle', { enabled: false });
state = await agentCall(page, 'cross_section_state');
check('toggle off restores the uncut geometry', state.result?.geometryMutated === false
  && (state.result?.trimmedPartIds?.length ?? 0) === 0 && (state.result?.capCount ?? 0) === 0
  && (state.result?.clippedMaterials ?? 0) === 0,
  JSON.stringify(state.result));
const soloDoc = {
  version: 1,
  source: 'local',
  name: 'Solo',
  activeId: 'solo',
  parts: [{ id: 'solo', name: 'Solo', visible: true, order: 0, position: [0, 0, 0] }],
};
await page.evaluate(async ({ doc, cube, user }) => {
  localStorage.setItem('surfcad.lastAssembly', JSON.stringify({
    [user]: { name: doc.name, activeId: doc.activeId, source: 'local', savedAt: Date.now() },
  }));
  await new Promise((resolve, reject) => {
    const req = indexedDB.open('surfcad-assembly', 1);
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction(['assembly', 'parts'], 'readwrite');
      tx.objectStore('assembly').put(doc, 'current');
      tx.objectStore('parts').put({ id: 'solo', script: cube, savedAt: Date.now() }, 'solo');
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
    req.onerror = () => reject(req.error);
  });
}, { doc: soloDoc, cube: CUBE, user: USER });
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForFunction(
  () => typeof window.surfcad?.call === 'function' && !document.querySelector('[data-app-loading]'),
  { timeout: 120000 },
);
const ranSolo = await agentCall(page, 'run', {});
check('solo run', ranSolo.ok === true && ranSolo.result?.ok === true, JSON.stringify(ranSolo));
await page.waitForTimeout(2000);
await agentCall(page, 'cross_section_toggle', { enabled: true });
await agentCall(page, 'cross_section_plane', { plane: 'XY' });
await page.waitForTimeout(1200);
state = await agentCall(page, 'cross_section_state');
check('part editor scope off', state.result?.assemblyScope === false, JSON.stringify(state.result));
check('part editor clips one target', state.result?.targetPartIds?.length === 1,
  JSON.stringify(state.result?.targetPartIds));
viewOnly(state, 'solo');
await agentCall(page, 'cross_section_expand', { open: false });
state = await waitForCaps(page, 1);
capped(state, 'solo', 1, CUBE_VOLUME);

writeFileSync(join(SHOT_DIR, 'cross-section-after-single.png'), await page.screenshot({ type: 'png' }));

// A rebuilt mesh while capped: the new solid is never overwritten with the
// stale trim, and the accepted section caps it again.
const rerun = await agentCall(page, 'run', {});
check('solo rerun while capped', rerun.ok === true && rerun.result?.ok === true, JSON.stringify(rerun));
state = await waitForCaps(page, 1);
capped(state, 'solo after rebuild', 1, CUBE_VOLUME);

await agentCall(page, 'cross_section_toggle', { enabled: false });
state = await agentCall(page, 'cross_section_state');
check('solo toggle off restores the uncut geometry', state.result?.geometryMutated === false
  && (state.result?.capCount ?? 0) === 0, JSON.stringify(state.result));

await browser.close();
stop();
console.log(failed ? 'cross-section caps: FAILED' : 'cross-section caps: ok');
process.exit(failed ? 1 : 0);

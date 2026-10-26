#!/usr/bin/env node
/**
 * Agent bridge H5: feature strip open/edit/confirm, rollback_to, feature_tree.
 */
/* global document, window, indexedDB, localStorage */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright-core';
import { attachConsentPresetToBrowser } from './lib/presetConsentInit.mjs';

const SHOT_DIR = process.env.GOLDEN_SHOT_DIR || tmpdir();
const PORT = Number(process.env.SMOKE_PORT || 4322);
const APP_URL = `http://127.0.0.1:${PORT}/?agent=1`;

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].filter(Boolean);

const STARTER = `// --- cube begin id=seed ---
let part = Manifold.cube([40, 30, 20], true);
// --- cube end ---
return part;
`;

const ASSEMBLY = {
  format: 'surfcad.assembly',
  v: 1,
  name: 'agent-h5',
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
  console.log('agent bridge h5: no system Chrome found — set CHROME_PATH. Skipping.');
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
  await page.evaluate(async ({ doc, script }) => {
    localStorage.setItem('surfcadAgent', '1');
    localStorage.setItem('surfcad.lastAssembly', JSON.stringify({
      'user-agent-h5': {
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
  }, { doc: ASSEMBLY, script: STARTER });
}

async function agentCall(page, name, args) {
  return page.evaluate(async ({ name, argsJson }) => {
    const env = await window.surfcad.call(name, argsJson);
    return env;
  }, { name, argsJson: JSON.stringify(args ?? {}) });
}

console.log('agent bridge h5 golden');

if (!(await waitForServer())) {
  console.log('  ❌ preview server did not start');
  stop();
  process.exit(1);
}

const browser = await chromium.launch({
  executablePath: exe,
  headless: true,
  args: [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
  ],
});
attachConsentPresetToBrowser(browser);

const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.route('**/api/auth/me', (route) => route.fulfill({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({
    authenticated: true,
    user: { _id: 'user-agent-h5', email: 'agent@test.local' },
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

const ran = await agentCall(page, 'run', {});
check('seed run', ran.ok === true && ran.result?.ok === true, JSON.stringify(ran));

const cube = await agentCall(page, 'insert_cube', { width: 40, depth: 30, height: 10 });
check('insert_cube', cube.ok === true && cube.result?.ok === true, JSON.stringify(cube));

const tree0 = await agentCall(page, 'feature_tree', {});
const features0 = tree0.result?.features || [];
const cubeChip = features0.find((f) => f.kind === 'cube') || features0[0];
check('feature_tree cube', features0.length >= 1, JSON.stringify(tree0));

const grouped = await agentCall(page, 'list_feature_edges', {});
const edgeKey = grouped.result?.edges?.[0]?.key;
check('grouped edges for fillet', typeof edgeKey === 'string', edgeKey);
await agentCall(page, 'select_edges', { keys: [edgeKey] });
const fillet = await agentCall(page, 'insert_fillet_edges', { radius: 1.5 });
check('insert_fillet_edges', fillet.ok === true && fillet.result?.ok === true, JSON.stringify(fillet));

const treeF = await agentCall(page, 'feature_tree', {});
const filletChip = (treeF.result?.features || []).find((f) => f.kind === 'fillet' || f.kind === 'fillet-mode')
  || (treeF.result?.features || [])[1];
check('fillet chip', !!filletChip, JSON.stringify(treeF));

const openForCancel = await agentCall(page, 'open_feature', { id: filletChip.id });
check('open_feature for cancel', openForCancel.ok === true, JSON.stringify(openForCancel));
const cancelOpen = await agentCall(page, 'cancel_feature', {});
check('cancel_feature after open', cancelOpen.ok === true && cancelOpen.result?.cancelled === true,
  JSON.stringify(cancelOpen));

const volAfterFillet = (await agentCall(page, 'status', {})).result?.volume;
const openFillet = await agentCall(page, 'open_feature', { id: filletChip.id });
check('open_feature fillet', openFillet.ok === true, JSON.stringify(openFillet));
await page.waitForTimeout(300);

const edit = await agentCall(page, 'edit_feature', { params: { radius: 5 } });
check('edit_feature fillet radius', edit.ok === true, JSON.stringify(edit));

const confirm = await agentCall(page, 'confirm_feature', {});
const volOnConfirm = confirm.result?.status?.volume;
check('confirm_feature fillet', confirm.ok === true && confirm.result?.ok === true, JSON.stringify(confirm));
check('confirm_feature refreshes volume without run',
  typeof volOnConfirm === 'number' && volOnConfirm > 0
  && Math.abs(volOnConfirm - volAfterFillet) > 0.5,
  `before=${volAfterFillet} after=${volOnConfirm}`);

const faces = await agentCall(page, 'list_faces', {});
const faceList = faces.result?.faces || [];
const top = faceList.find((f) => Array.isArray(f.normal) && f.normal[2] > 0.85) || faceList[0];
check('list_faces for hole', faceList.length > 0, JSON.stringify(faces));

if (top?.key) {
  await agentCall(page, 'select_faces', { key: top.key });
}
const hole = await agentCall(page, 'insert_hole', { use_selection: true, size: 'M6' });
check('insert_hole', hole.ok === true && hole.result?.ok === true, JSON.stringify(hole));

const tree1 = await agentCall(page, 'feature_tree', {});
const features = tree1.result?.features || [];
check('feature_tree two features', features.length >= 2, `n=${features.length}`);

const volBeforeRollback = (await agentCall(page, 'status', {})).result?.volume;
const rollback = await agentCall(page, 'rollback_to', { id: cubeChip.id });
check('rollback_to cube', rollback.ok === true && rollback.result?.rollbackAnchor === cubeChip.id,
  JSON.stringify(rollback));
// B14: the result and status describe the rolled-back solid (the seed cube,
// 40×30×20, which contains the 40×30×10 box), not the previous run with the
// fillet and the hole.
const CUBE_VOLUME = 40 * 30 * 20;
check('rollback_to result carries the rolled-back status', rollback.result?.ok === true
  && Math.abs((rollback.result?.status?.volume ?? 0) - CUBE_VOLUME) < 1, JSON.stringify(rollback.result?.status));

const tree2 = await agentCall(page, 'feature_tree', {});
check('feature_tree rollback anchor', tree2.result?.rollbackAnchor === cubeChip.id, JSON.stringify(tree2));

const dirty = await agentCall(page, 'dirty', {});
check('dirty.unsaved after edits', dirty.ok === true && dirty.result?.unsaved === true,
  JSON.stringify(dirty.result));

const st = await agentCall(page, 'status', {});
check('status after rollback', st.ok === true && (st.result?.volume ?? 0) > 0, JSON.stringify(st));
check('status after rollback is the cube alone, not the previous run (B14)', Math.abs((st.result?.volume ?? 0) - CUBE_VOLUME) < 1, String(st.result?.volume));

// Follow-up 6: an insert after rollback_to lands at the bar and is evaluated;
// the bar moves onto the new block.
const atBar = await agentCall(page, 'insert_cube', { width: 10, depth: 10, height: 10, x: 100 });
check('insert_cube after rollback_to runs', atBar.ok === true && atBar.result?.ok === true, JSON.stringify(atBar.result?.errors || atBar.error));
check('the inserted cube is evaluated, not blanked as rolled back', Math.abs((atBar.result?.status?.volume ?? 0) - (CUBE_VOLUME + 1000)) < 1, String(atBar.result?.status?.volume));
const treeAtBar = await agentCall(page, 'feature_tree', {});
const cubes = (treeAtBar.result?.features || []).filter((f) => f.kind === 'cube');
// The fixture has two cubes (the seed and the box inside it); the new one
// lands right after the seed, where the bar was, and the bar moves onto it.
check('the bar moved onto the new cube', cubes.length === 3 && treeAtBar.result?.rollbackAnchor === cubes[1].id, JSON.stringify({ anchor: treeAtBar.result?.rollbackAnchor, cubes: cubes.map((f) => f.id) }));
check('the fillet and hole stay rolled back behind the bar', Math.abs(((await agentCall(page, 'status', {})).result?.volume ?? 0) - (CUBE_VOLUME + 1000)) < 1);

const cleared = await agentCall(page, 'rollback_to', { clear: true });
check('rollback_to clear', cleared.ok === true && cleared.result?.rollbackAnchor === null, JSON.stringify(cleared.result?.rollbackAnchor));
const stCleared = await agentCall(page, 'status', {});
// Ground truth: an explicit run of the full script. The clear result and the
// status read before that run must already match it (B14).
const ranFull = await agentCall(page, 'run', {});
const fullVolume = ranFull.result?.status?.volume;
check('the full script runs after clear', ranFull.ok === true && ranFull.result?.ok === true && Number.isFinite(fullVolume), JSON.stringify(ranFull.result?.errors));
check('rollback_to clear result has the full volume at once (B14)', Math.abs((cleared.result?.status?.volume ?? 0) - fullVolume) < 1 && Math.abs(fullVolume - (CUBE_VOLUME + 1000)) > 1, `got ${cleared.result?.status?.volume} expected ${fullVolume}`);
check('status after clear is current without a run (B14)', Math.abs((stCleared.result?.volume ?? 0) - fullVolume) < 1, `got ${stCleared.result?.volume} expected ${fullVolume}`);
check('the rolled-back volume differed from the full one', Math.abs(volBeforeRollback - CUBE_VOLUME) > 1);

const bad = await agentCall(page, 'open_feature', { index: 99 });
check('bad_index refused', bad.ok === false && bad.error?.code === 'bad_index', JSON.stringify(bad));

await browser.close();
stop();

if (failed) {
  console.log(`agent bridge h5: ${failed} failed`);
  process.exit(1);
}
console.log('agent bridge h5: ok');

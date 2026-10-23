#!/usr/bin/env node
/**
 * Contour edit through the feature strip commands (MVP-2 step 8, bike M7).
 *
 * open_feature on a saved contour chip reopens it in the contour sketch;
 * edit_feature patches that sketch; confirm_feature saves and closes it and
 * rewrites the contour by id. cancel_feature closes the sketch. A bad edit is
 * refused with a hint and leaves the sketch open for the next edit. No sketch
 * is left open behind the agent at the end of any of those.
 */
/* global document, window, indexedDB, localStorage */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright-core';
import { attachConsentPresetToBrowser } from './lib/presetConsentInit.mjs';

const SHOT_DIR = process.env.GOLDEN_SHOT_DIR || tmpdir();
const PORT = Number(process.env.SMOKE_PORT || 4361);
const APP_URL = `http://127.0.0.1:${PORT}/?agent=1`;
const LABEL = 'contour edit feature';

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
  version: 1,
  source: 'local',
  name: 'Contour Edit',
  activeId: 'local:part1',
  parts: [{ id: 'local:part1', name: 'Part 1', visible: true, order: 0 }],
};

let failed = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed += 1;
    console.log(`  ❌ ${name}${detail ? ` — ${String(detail).slice(0, 600)}` : ''}`);
  }
}

mkdirSync(SHOT_DIR, { recursive: true });

const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!exe) {
  console.log(`${LABEL}: no system Chrome found — set CHROME_PATH`);
  process.exit(1);
}

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

async function waitForServer(timeoutMs = 60000) {
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

async function seedAssembly(page) {
  await page.evaluate(async ({ doc, script }) => {
    localStorage.setItem('surfcadAgent', '1');
    localStorage.setItem('surfcad.lastAssembly', JSON.stringify({
      'user-contour-edit': { name: doc.name, activeId: doc.activeId, source: 'local', savedAt: Date.now() },
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
  return page.evaluate(async ({ name, argsJson }) => window.surfcad.call(name, argsJson), {
    name,
    argsJson: JSON.stringify(args ?? {}),
  });
}

const script = async (page) => (await agentCall(page, 'get_script', {})).result?.source || '';
const modeOf = async (page) => (await agentCall(page, 'mode', {})).result || {};
const contourIds = (src) => [...src.matchAll(/@contour id=([A-Za-z0-9_-]+)/g)].map((m) => m[1]);

console.log(`${LABEL} golden`);

if (!(await waitForServer())) {
  console.log('  ❌ dev server did not start');
  stop();
  process.exit(1);
}

const browser = await chromium.launch({
  executablePath: exe,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
attachConsentPresetToBrowser(browser);

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', (err) => errors.push(String(err).slice(0, 300)));
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(`console ${msg.text().slice(0, 300)}`); });
  await page.route('**/api/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ authenticated: false }) }));
  await page.route('**/api/auth/me', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ authenticated: true, user: { _id: 'user-contour-edit', email: 'agent@test.local' } }),
  }));
  await page.route('**/api/config', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));

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

  // A saved contour, the way an agent makes one.
  const begin = await agentCall(page, 'sketch_begin', { entry: 'crossSection', plane: 'z' });
  check('sketch_begin on the z plane', begin.ok === true, JSON.stringify(begin));
  const add = await agentCall(page, 'sketch_add', { tool: 'rectangle', width: 30, height: 20 });
  check('sketch_add rectangle 30 x 20', add.ok === true, JSON.stringify(add));
  const commit = await agentCall(page, 'sketch_commit', {});
  check('sketch_commit writes the contour', commit.ok === true && commit.result?.written === true, JSON.stringify(commit));
  const src0 = await script(page);
  const ids0 = contourIds(src0);
  check('one @contour statement with a rectangle', ids0.length === 1 && /profileRectangle\(30, 20/.test(src0), src0);
  const contourId = ids0[0];
  check('sketch closed after sketch_commit', (await modeOf(page)).contour == null);

  const tree = await agentCall(page, 'feature_tree', {});
  const features = tree.result?.features || [];
  const chip = features.find((f) => f.id === `contour:${contourId}`) || features.find((f) => f.kind === 'contour');
  check('feature_tree lists the contour chip', !!chip, JSON.stringify(features));
  const featureCount0 = features.length;

  // 1. Reopen, patch the width, confirm.
  const open1 = await agentCall(page, 'open_feature', { id: chip.id });
  check('open_feature reopens the contour in the sketch', open1.ok === true && open1.result?.sketchOpen === true && open1.result?.contourId === contourId, JSON.stringify(open1));
  const mode1 = await modeOf(page);
  check('mode.contour names the contour being edited', mode1.contour?.contourId === contourId && mode1.contour?.tool === 'rectangle', JSON.stringify(mode1.contour));

  const edit1 = await agentCall(page, 'edit_feature', { params: { width: 44 } });
  check('edit_feature width patches the sketch', edit1.ok === true && edit1.result?.sketch?.tool === 'rectangle' && edit1.result?.sketch?.params?.width === 44 && edit1.result?.ignored === undefined, JSON.stringify(edit1));
  check('sketch still open after edit_feature', (await modeOf(page)).contour?.contourId === contourId);

  const confirm1 = await agentCall(page, 'confirm_feature', {});
  check('confirm_feature saves and closes the sketch', confirm1.ok === true && confirm1.result?.ok === true && confirm1.result?.sketchClosed === true && confirm1.result?.id === `contour:${contourId}` && confirm1.result?.unchanged === false, JSON.stringify(confirm1));
  const src1 = await script(page);
  check('the contour statement is rewritten in place', contourIds(src1).length === 1 && contourIds(src1)[0] === contourId && /profileRectangle\(44, 20/.test(src1) && !/profileRectangle\(30, 20/.test(src1), src1);
  const mode1b = await modeOf(page);
  check('no sketch and no feature edit left open after confirm', mode1b.contour == null && mode1b.featureEdit == null, JSON.stringify(mode1b));
  const tree1 = await agentCall(page, 'feature_tree', {});
  check('feature count unchanged by the edit', (tree1.result?.features || []).length === featureCount0, JSON.stringify(tree1.result?.features));

  // 2. Reopen, replace the profile with points.
  const open2 = await agentCall(page, 'open_feature', { id: chip.id });
  check('open_feature again', open2.ok === true && open2.result?.sketchOpen === true, JSON.stringify(open2));
  const edit2 = await agentCall(page, 'edit_feature', { params: { points: [[0, 0], [20, 0], [10, 15]], distance: 5 } });
  check('edit_feature points switches to a polyline and reports the ignored key', edit2.ok === true && edit2.result?.sketch?.tool === 'polyline' && Array.isArray(edit2.result?.ignored) && edit2.result.ignored.includes('distance'), JSON.stringify(edit2));
  const confirm2 = await agentCall(page, 'confirm_feature', {});
  check('confirm_feature writes the polyline', confirm2.ok === true && confirm2.result?.ok === true && confirm2.result?.sketchClosed === true, JSON.stringify(confirm2));
  const src2 = await script(page);
  check('the same contour id now holds the points, no rectangle left', contourIds(src2).length === 1 && contourIds(src2)[0] === contourId && !/profileRectangle/.test(src2) && /20, 0/.test(src2) && /10, 15/.test(src2), src2);
  check('sketch closed after the second confirm', (await modeOf(page)).contour == null);

  // 3. A bad edit is refused with the hint; cancel closes the sketch.
  const open3 = await agentCall(page, 'open_feature', { id: chip.id });
  check('open_feature a third time', open3.ok === true && open3.result?.sketchOpen === true, JSON.stringify(open3));
  const bad = await agentCall(page, 'edit_feature', { params: { distance: 5 } });
  check('an edit with nothing for the contour is bad_args with the hint', bad.ok === false && bad.error?.code === 'bad_args' && /points/.test(bad.error?.message || ''), JSON.stringify(bad));
  check('the sketch stays open for the next edit', (await modeOf(page)).contour?.contourId === contourId);
  const cancel = await agentCall(page, 'cancel_feature', {});
  check('cancel_feature closes the sketch', cancel.ok === true && cancel.result?.cancelled === true && cancel.result?.sketchClosed === true, JSON.stringify(cancel));
  const mode3 = await modeOf(page);
  check('no sketch left open after cancel', mode3.contour == null && mode3.featureEdit == null, JSON.stringify(mode3));
  check('cancel wrote nothing', (await script(page)) === src2);

  // 4. undo takes the last contour edit back in one step.
  const undo = await agentCall(page, 'undo', {});
  check('undo once restores the rectangle', undo.ok === true && /profileRectangle\(44, 20/.test(await script(page)), JSON.stringify(undo));

  // A plain card edit still works the old way next to this.
  const cubeChip = (tree1.result?.features || []).find((f) => f.kind === 'cube');
  if (cubeChip) {
    const openCube = await agentCall(page, 'open_feature', { id: cubeChip.id });
    check('open_feature on a cube still opens its card', openCube.ok === true && openCube.result?.sketchOpen !== true, JSON.stringify(openCube));
    const cancelCube = await agentCall(page, 'cancel_feature', {});
    check('cancel_feature on the cube card', cancelCube.ok === true && cancelCube.result?.sketchClosed === undefined, JSON.stringify(cancelCube));
  }

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (err) {
  check('golden completed', false, err?.stack || String(err));
} finally {
  await browser.close().catch(() => {});
  stop();
}

if (failed) {
  console.log(`${LABEL}: ${failed} failed`);
  process.exit(1);
}
console.log(`${LABEL} golden: ok`);

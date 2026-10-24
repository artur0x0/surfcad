#!/usr/bin/env node
/**
 * sketch_edit (MVP plan step 8, improvements §4): one call reopens a saved
 * contour, applies profile / dimension / constraint ops, saves and closes it.
 *   - the rewritten contour keeps its dimensions and constraints in the
 *     script (solveContour) and reopens with them (list_sketch_entities)
 *   - a failing op names its index, writes nothing, leaves no sketch open
 *   - another feature's chip is not_a_contour and its card is closed
 *   - undo takes the whole edit back in one step
 *
 * Runs the app on the Vite dev server. Chrome from CHROME_PATH or the usual paths.
 */
/* global document, window, indexedDB, localStorage */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { attachConsentPresetToBrowser } from './lib/presetConsentInit.mjs';

const PORT = Number(process.env.SMOKE_PORT || 4363);
const APP_URL = `http://127.0.0.1:${PORT}/?agent=1`;
const LABEL = 'sketch edit';

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
  name: 'Sketch Edit',
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
      'user-sketch-edit': { name: doc.name, activeId: doc.activeId, source: 'local', savedAt: Date.now() },
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
const solveBlock = (src) => (src.match(/solveContour\(\{[\s\S]*?\}\)/) || [''])[0];

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
    body: JSON.stringify({ authenticated: true, user: { _id: 'user-sketch-edit', email: 'agent@test.local' } }),
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
  const contourId = contourIds(src0)[0];
  check('one @contour statement', contourIds(src0).length === 1 && !!contourId, src0);
  check('sketch closed after sketch_commit', (await modeOf(page)).contour == null);

  // Learn the entity ids of the rectangle by reopening once (what an agent would do).
  const peek = await agentCall(page, 'open_feature', { id: `contour:${contourId}` });
  check('open_feature reopens the contour', peek.ok === true && peek.result?.sketchOpen === true, JSON.stringify(peek));
  const ents0 = (await agentCall(page, 'list_sketch_entities', {})).result || {};
  const lines0 = (ents0.lines || []).map((l) => (typeof l === 'string' ? l : l.id));
  check('list_sketch_entities shows the four rectangle lines', lines0.length === 4, JSON.stringify(ents0).slice(0, 400));
  const firstLine = lines0[0];
  await agentCall(page, 'cancel_feature', {});
  check('cancel after the peek leaves no sketch open', (await modeOf(page)).contour == null);

  // 1. One call: profile width, a length dimension, a horizontal constraint.
  const edit1 = await agentCall(page, 'sketch_edit', {
    contour_id: contourId,
    ops: [
      { op: 'profile', width: 44 },
      { op: 'dimension', kind: 'length', edge: firstLine, value: 44 },
      { op: 'constrain', kind: 'horizontal', picks: [{ kind: 'line', id: firstLine }] },
    ],
  });
  check('sketch_edit applies the three ops and saves', edit1.ok === true && edit1.result?.ok === true && edit1.result?.sketchClosed === true && edit1.result?.contourId === contourId && edit1.result?.id === `contour:${contourId}`, JSON.stringify(edit1).slice(0, 800));
  check('applied lists the ops in order', Array.isArray(edit1.result?.applied) && edit1.result.applied.map((a) => a.op).join(',') === 'profile,dimension,constrain', JSON.stringify(edit1.result?.applied));
  // Solving a rectangle gives it its own width / height dimensions and edge
  // constraints; the ones this call added are among them.
  const ents1 = edit1.result?.entities || {};
  const dim44 = (ents1.dimensions || []).find((d) => d.edge === firstLine && d.value === 44);
  const horiz = (ents1.constraints || []).find((c) => c.kind === 'horizontal' && (c.items || []).includes(firstLine));
  check('the result lists the added length dimension and horizontal constraint with their ids', !!dim44?.id && !!horiz?.id, JSON.stringify(ents1).slice(0, 400));
  check('sketch closed after sketch_edit', (await modeOf(page)).contour == null && (await modeOf(page)).featureEdit == null);
  const src1 = await script(page);
  check('the same contour id now holds a solved sketch with dimensions and constraints in the script', contourIds(src1).includes(contourId) && /solveContour\(/.test(src1) && /dimensions: \[\{/.test(solveBlock(src1)) && /constraints: \[\{/.test(solveBlock(src1)), JSON.stringify(contourIds(src1)) + ' :: ' + (solveBlock(src1) || src1).slice(0, 300));
  check('still one contour statement', contourIds(src1).length === 1, JSON.stringify(contourIds(src1)));
  check('the width dimension is in the script', /value: 44/.test(solveBlock(src1)), solveBlock(src1));

  // 2. Reopened, the sketch still has them (persisted, not lost on commit).
  const reopen = await agentCall(page, 'open_feature', { id: `contour:${contourId}` });
  check('open_feature after sketch_edit', reopen.ok === true && reopen.result?.sketchOpen === true, JSON.stringify(reopen));
  const ents2 = (await agentCall(page, 'list_sketch_entities', {})).result || {};
  check('list_sketch_entities reports the saved dimension and constraint', !!(ents2.dimensions || []).find((d) => d.id === dim44?.id && d.value === 44) && !!(ents2.constraints || []).find((c) => c.id === horiz?.id), JSON.stringify(ents2).slice(0, 400));
  await agentCall(page, 'cancel_feature', {});
  check('cancel leaves no sketch open', (await modeOf(page)).contour == null);

  // 3. A failing op: names its index, writes nothing, closes the sketch.
  const bad = await agentCall(page, 'sketch_edit', {
    contour_id: contourId,
    ops: [{ op: 'profile', width: 50 }, { op: 'dimension', kind: 'length', edge: 'e99', value: 1 }],
  });
  check('a dimension on an unknown line fails naming ops[1]', bad.ok === false && bad.error?.details?.op === 1 && /ops\[1\] \(dimension\)/.test(bad.error?.message || '') && /closed without saving/.test(bad.error?.message || ''), JSON.stringify(bad));
  check('nothing written by the failed call', (await script(page)) === src1);
  const modeBad = await modeOf(page);
  check('no sketch and no feature edit left open after the failure', modeBad.contour == null && modeBad.featureEdit == null, JSON.stringify(modeBad));

  // 4. A profile op with nothing for the contour is bad_args with the hint.
  const nothing = await agentCall(page, 'sketch_edit', { contour_id: contourId, ops: [{ op: 'profile', distance: 5 }] });
  check('a profile op with a foreign key is bad_args naming the key', nothing.ok === false && nothing.error?.code === 'bad_args' && /does not take distance/.test(nothing.error?.message || ''), JSON.stringify(nothing));
  check('no sketch left open after bad_args', (await modeOf(page)).contour == null);

  // 5. Another feature's chip is not a contour; its card is closed again.
  const tree = await agentCall(page, 'feature_tree', {});
  const cube = (tree.result?.features || []).find((f) => f.kind === 'cube');
  if (cube) {
    const notContour = await agentCall(page, 'sketch_edit', { id: cube.id, ops: [{ op: 'undo' }] });
    check('a cube chip is not_a_contour', notContour.ok === false && notContour.error?.code === 'not_a_contour', JSON.stringify(notContour));
    const modeCube = await modeOf(page);
    check('the cube card was closed again', modeCube.featureEdit == null, JSON.stringify(modeCube));
  }
  const unknown = await agentCall(page, 'sketch_edit', { contour_id: 'nope', ops: [{ op: 'undo' }] });
  check('an unknown contour id is unknown_contour', unknown.ok === false && unknown.error?.code === 'unknown_contour', JSON.stringify(unknown));

  // 6. undo takes the whole sketch_edit back in one step.
  const undo = await agentCall(page, 'undo', {});
  const srcUndone = await script(page);
  check('undo once restores the 30 x 20 rectangle', undo.ok === true && /profileRectangle\(30, 20/.test(srcUndone) && !/solveContour\(/.test(srcUndone), JSON.stringify(undo).slice(0, 300) + ' :: ' + srcUndone.slice(0, 300));

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

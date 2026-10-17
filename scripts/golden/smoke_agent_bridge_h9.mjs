#!/usr/bin/env node
/**
 * Agent bridge H9: pick sessions on the real viewport.
 *
 * 1. insert_cube → pick_faces (top) → insert_hole use_selection.
 * 2. pick_begin edge → pick_next eN → pick_done → insert_fillet_edges use_selection.
 * 3. pick_edges on the Fillet card with Accept: one undo step.
 * 4. open_feature on that fillet → pick_begin feeds the edit card → add an
 *    edge → pick_done accept rewrites the same block.
 * Plus the structured errors: no session, empty pick, unknown key, busy.
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
  '/usr/local/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].filter(Boolean);

const ASSEMBLY = {
  format: 'surfcad.assembly',
  v: 1,
  name: 'agent-h9',
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
  console.log('agent bridge h9: no system Chrome found — set CHROME_PATH. Skipping.');
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
      'user-agent-h9': {
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

/**
 * The box edge whose midpoint is `mid`. Grouped rows are matched by `mid`,
 * not by faceKeyA/B: those can name the wrong patches once a hole is cut.
 */
function boxEdge(rows, mid) {
  return rows.find((row) => Array.isArray(row.mid)
    && row.mid.every((x, i) => Math.abs(x - mid[i]) < 0.5)) || null;
}

console.log('agent bridge h9 golden');

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
    user: { _id: 'user-agent-h9', email: 'agent@test.local' },
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
// Monaco loads late and its mount auto-runs the buffer 100ms later. That run
// would replace an edit-card preview mesh mid-flow, so let it land first.
await page.waitForSelector('.monaco-editor', { state: 'attached', timeout: 120000 });
await page.waitForTimeout(500);

const ran = await agentCall(page, 'run', {});
check('seed run', ran.ok === true && ran.result?.ok === true, JSON.stringify(ran));

const cube = await agentCall(page, 'insert_cube', { width: 40, depth: 30, height: 20 });
check('insert_cube', cube.ok === true && cube.result?.ok === true, JSON.stringify(cube));

// --- errors before any session -------------------------------------------
const none = await agentCall(page, 'pick_done', {});
check('pick_done without a session → no_pick_session', none.ok === false && none.error?.code === 'no_pick_session',
  JSON.stringify(none));
const noKind = await agentCall(page, 'pick_begin', {});
check('pick_begin on the selection needs kind', noKind.ok === false && noKind.error?.code === 'bad_args',
  JSON.stringify(noKind));

// --- 1. face → hole -------------------------------------------------------
const faces = await agentCall(page, 'list_faces', {});
const top = (faces.result?.faces || []).find((row) => row.normal?.[2] > 0.9);
check('list_faces top', !!top?.key, JSON.stringify(faces.result?.faces?.length));

const pickedFace = await agentCall(page, 'pick_faces', { keys: [top.key], max: 1 });
check('pick_faces top → selection', pickedFace.ok === true && pickedFace.result?.target === 'selection'
  && pickedFace.result?.count === 1 && pickedFace.result?.done === true, JSON.stringify(pickedFace));
const sel1 = await agentCall(page, 'selection', {});
check('selection face is the picked top', sel1.result?.face?.normal?.[2] > 0.9, JSON.stringify(sel1.result?.face));

const hole = await agentCall(page, 'insert_hole', { use_selection: true, size: 'M6' });
check('insert_hole use_selection', hole.ok === true && hole.result?.ok === true, JSON.stringify(hole));
const treeHole = await agentCall(page, 'feature_tree', {});
check('feature_tree has hole', (treeHole.result?.features || []).some((f) => f.kind === 'hole'),
  JSON.stringify((treeHole.result?.features || []).map((f) => f.kind)));

// --- 2. edges → fillet via use_selection ----------------------------------
const edges1 = await agentCall(page, 'list_feature_edges', {});
const bottomFront = boxEdge(edges1.result?.edges || [], [0, -15, -10]);
check('list_feature_edges bottom-front edge', !!bottomFront, JSON.stringify((edges1.result?.edges || []).map((r) => r.mid)));

const beganEdges = await agentCall(page, 'pick_begin', { kind: 'edge' });
check('pick_begin edge on the selection', beganEdges.ok === true && beganEdges.result?.kind === 'edge'
  && beganEdges.result?.count === 0, JSON.stringify(beganEdges));
const mode1 = await agentCall(page, 'mode', {});
check('pick_state reports the session', (await agentCall(page, 'pick_state', {})).result?.session?.target === 'selection',
  JSON.stringify(mode1.result?.viewport));
const empty = await agentCall(page, 'pick_done', {});
check('pick_done with nothing picked → empty_pick', empty.ok === false && empty.error?.code === 'empty_pick'
  && empty.error?.details?.min === 1, JSON.stringify(empty));
const badKey = await agentCall(page, 'pick_next', { keys: [bottomFront.key, 'e9999'] });
check('unknown edge key → unknown_edge with index', badKey.ok === false && badKey.error?.code === 'unknown_edge'
  && badKey.error?.details?.index === 1, JSON.stringify(badKey));
const nextEdge = await agentCall(page, 'pick_next', { key: bottomFront.key });
check('pick_next eN', nextEdge.ok === true && nextEdge.result?.count === 1 && nextEdge.result?.entries >= 1,
  JSON.stringify(nextEdge));
const doneEdges = await agentCall(page, 'pick_done', {});
check('pick_done leaves the edges selected', doneEdges.ok === true && doneEdges.result?.done === true,
  JSON.stringify(doneEdges));
const sel2 = await agentCall(page, 'selection', {});
check('selection has the picked edge', (sel2.result?.edges?.length ?? 0) >= 1, JSON.stringify(sel2.result?.edges?.length));

const filletSel = await agentCall(page, 'insert_fillet_edges', { use_selection: true, radius: 1.5 });
check('insert_fillet_edges use_selection', filletSel.ok === true && filletSel.result?.ok === true,
  JSON.stringify(filletSel.error || filletSel.result?.errors));
const errs1 = await agentCall(page, 'errors', {});
check('no errors after use_selection fillet', (errs1.result?.errors?.length ?? 0) === 0, JSON.stringify(errs1.result));

// --- 3. Fillet card: pick, set radius, Accept -----------------------------
const edges2 = await agentCall(page, 'list_feature_edges', {});
const topRight = boxEdge(edges2.result?.edges || [], [20, 0, 10]);
check('top-right edge', !!topRight, JSON.stringify((edges2.result?.edges || []).map((r) => r.mid)));
const beforeCard = (await agentCall(page, 'get_script', {})).result?.source;
const volBeforeCard = (await agentCall(page, 'status', {})).result?.volume;
const card = await agentCall(page, 'pick_edges', {
  tool: 'filletEdges',
  keys: [topRight.key],
  params: { radius: 2 },
  accept: true,
});
check('pick_edges on the Fillet card with accept', card.ok === true && card.result?.accepted === true
  && card.result?.ok === true && card.result?.opened === true && card.result?.unchanged === false,
  JSON.stringify(card));
check('card accept refreshed volume', typeof card.result?.status?.volume === 'number'
  && card.result.status.volume < volBeforeCard - 0.1, `before=${volBeforeCard} after=${card.result?.status?.volume}`);
const modeAfter = await agentCall(page, 'mode', {});
check('Fillet card closed after accept', modeAfter.result?.fillet == null, JSON.stringify(modeAfter.result));
const afterCard = (await agentCall(page, 'get_script', {})).result?.source;
check('card accept wrote the script', afterCard !== beforeCard && /fillet/i.test(afterCard.slice(beforeCard.length - 200)),
  String(afterCard?.length));

await focusPartHistoryForUndo(page, agentCall);
const undo = await agentCall(page, 'undo', {});
const undone = (await agentCall(page, 'get_script', {})).result?.source;
check('one undo reverts the card accept', undo.ok === true && undone === beforeCard, JSON.stringify(undo));
const redoRun = await agentCall(page, 'set_script', { source: afterCard });
check('restore the card fillet', redoRun.ok === true && redoRun.result?.ok === true, JSON.stringify(redoRun));

// --- 4. feature-sheet pick: add an edge on the fillet edit card ----------
const tree = await agentCall(page, 'feature_tree', {});
const filletChips = (tree.result?.features || []).filter((f) => /fillet/.test(f.kind));
const lastFillet = filletChips.at(-1);
check('two fillet chips', filletChips.length >= 2, JSON.stringify((tree.result?.features || []).map((f) => f.kind)));

const opened = await agentCall(page, 'open_feature', { id: lastFillet.id });
check('open_feature fillet', opened.ok === true, JSON.stringify(opened));
const busy = await agentCall(page, 'pick_begin', { tool: 'shell' });
check('another card while the edit is open → picker_busy', busy.ok === false && busy.error?.code === 'picker_busy'
  && busy.error?.details?.viewport === 'fillet', JSON.stringify(busy));
const editBegin = await agentCall(page, 'pick_begin', {});
check('pick_begin targets the edit card with its stored edges', editBegin.ok === true
  && editBegin.result?.target === 'filletEdges' && editBegin.result?.editing === true
  && editBegin.result?.opened === false && editBegin.result?.seeded >= 1, JSON.stringify(editBegin));

const editEdges = await agentCall(page, 'list_feature_edges', {});
const topLeft = boxEdge(editEdges.result?.edges || [], [-20, 0, 10]);
check('top-left edge on the edit preview', !!topLeft, JSON.stringify((editEdges.result?.edges || []).map((r) => r.mid)));
const addEdge = await agentCall(page, 'pick_next', { key: topLeft.key });
check('pick_next adds to the stored edges', addEdge.ok === true && addEdge.result?.count === editBegin.result?.seeded + 1,
  JSON.stringify(addEdge));
const editMode = await agentCall(page, 'mode', {});
check('mode shows the edit card edge count', (editMode.result?.fillet?.edgeCount ?? 0) >= 2, JSON.stringify(editMode.result?.fillet));

const editDone = await agentCall(page, 'pick_done', { accept: true });
check('pick_done accept on the edit card', editDone.ok === true && editDone.result?.accepted === true
  && editDone.result?.ok === true && editDone.result?.unchanged === false, JSON.stringify(editDone));
const afterEdit = (await agentCall(page, 'get_script', {})).result?.source;
check('edit rewrote the fillet block, not a new one',
  (afterEdit.match(/fillet/gi) || []).length >= 1
  && (await agentCall(page, 'feature_tree', {})).result?.features?.filter((f) => /fillet/.test(f.kind)).length === filletChips.length,
  String(afterEdit?.length));
const modeEnd = await agentCall(page, 'mode', {});
check('edit card closed', modeEnd.result?.fillet == null && modeEnd.result?.featureEdit == null,
  JSON.stringify(modeEnd.result));
const errsEnd = await agentCall(page, 'errors', {});
check('no errors after the edit-card pick', (errsEnd.result?.errors?.length ?? 0) === 0, JSON.stringify(errsEnd.result));
const stateEnd = await agentCall(page, 'pick_state', {});
check('no session left open', stateEnd.result?.session === null, JSON.stringify(stateEnd.result));

await page.screenshot({ path: `${SHOT_DIR}/agent-bridge-h9.png` });

await browser.close();
stop();

if (failed) {
  console.log(`agent bridge h9: ${failed} failed`);
  process.exit(1);
}
console.log('agent bridge h9: ok');

#!/usr/bin/env node
/**
 * Agent bridge H17: one sketch holds an outer rectangle and an inner
 * rectangle, and one extrude of that contour is a single body with a
 * through hole. The agent path and the rectangle-tool clicks both do it.
 * Volume, body count, and face count match a two-extrude subtract.
 */
/* global document, window, indexedDB, localStorage */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { attachConsentPresetToBrowser } from './lib/presetConsentInit.mjs';

const PORT = Number(process.env.SMOKE_PORT || 4330);
const APP_URL = `http://127.0.0.1:${PORT}/?agent=1`;
const USER = 'user-agent-h17';

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].filter(Boolean);

const ASSEMBLY = {
  format: 'surfcad.assembly',
  v: 1,
  name: 'agent-h17',
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
  console.log('agent bridge h17: no system Chrome found — set CHROME_PATH. Skipping.');
  process.exit(0);
}

if (!existsSync(new URL('../../dist/index.html', import.meta.url))) {
  console.log('  ❌ dist/ missing — run `npm run build` first');
  process.exit(1);
}

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
  await page.evaluate(async ({ doc, user }) => {
    localStorage.setItem('surfcadAgent', '1');
    localStorage.setItem('surfcad.lastAssembly', JSON.stringify({
      [user]: {
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
  }, { doc: ASSEMBLY, user: USER });
}

async function agentCall(page, name, args) {
  return page.evaluate(async ({ name, argsJson }) => {
    const env = await window.surfcad.call(name, argsJson);
    return env;
  }, { name, argsJson: JSON.stringify(args ?? {}) });
}

async function poll(page, read, ready, timeoutMs = 30000) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeoutMs) {
    last = await read();
    if (ready(last)) return last;
    await page.waitForTimeout(200);
  }
  return last;
}

async function waitContourReady(page) {
  await poll(
    page,
    () => agentCall(page, 'mode', {}),
    (env) => env?.result?.viewport === 'contour' && env?.result?.contour?.planeOpen !== true,
  );
}

async function frameExtrude(page, width, height, holeW, holeH, distance) {
  const began = await agentCall(page, 'sketch_begin', { entry: 'crossSection', accept_plane: true });
  if (!began.ok) return { error: began };
  await waitContourReady(page);
  const outer = await agentCall(page, 'sketch_add', { tool: 'rectangle', width, height, centered: true });
  const inner = await agentCall(page, 'sketch_add', { tool: 'rectangle', width: holeW, height: holeH, centered: true });
  const committed = await agentCall(page, 'sketch_commit', {});
  const script = await agentCall(page, 'get_script', {});
  const contourId = (script.result?.source?.match(/@contour id=(c\d+)/) || [])[1] || 'c1';
  const slot = await agentCall(page, 'slot_open', { kind: 'makeExtrude' });
  const assigned = await agentCall(page, 'slot_assign_contour', { contour_id: contourId, role: 'profile' });
  await agentCall(page, 'slot_set_params', { distance });
  const extruded = await agentCall(page, 'slot_commit', {});
  return { outer, inner, committed, slot, assigned, extruded, script };
}

function near(a, b, tol = 1) {
  return typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) < tol;
}

console.log('agent bridge h17 golden');

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
    user: { _id: USER, email: 'agent@test.local' },
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

const frame = await frameExtrude(page, 40, 24, 20, 12, 10);
check('sketch_add second rectangle appends a loop', frame.inner?.ok === true && frame.inner?.result?.appended === true && frame.inner?.result?.loops === 2, JSON.stringify(frame.inner));
check('sketch_commit writes the frame', frame.committed?.ok === true && frame.committed?.result?.written === true, JSON.stringify(frame.committed));
const afterCommit = frame.script?.result?.source || '';
check('committed sketch is one contour', (afterCommit.match(/@contour id=/g) || []).length === 1, afterCommit.slice(0, 400));
check('slot_commit frame', frame.extruded?.ok === true && frame.extruded?.result?.written === true, JSON.stringify(frame.extruded));

const frameStatus = frame.extruded?.result?.status || {};
const frameScript = await agentCall(page, 'get_script', {});
check(
  'frame script is one makeExtrude of c1.contours',
  (frameScript.result?.source?.match(/makeExtrude\(/g) || []).length === 1
    && /makeExtrude\(c1\.contours, 10\)/.test(frameScript.result?.source || ''),
  frameScript.result?.source,
);
const frameFaces = await agentCall(page, 'list_faces', {});
const frameBodies = await agentCall(page, 'list_bodies', {});
const frameFaceCount = frameFaces.result?.total ?? frameFaces.result?.faces?.length ?? null;
const frameBodyCount = frameStatus.bodyCount;
check('frame volume is the outer minus the hole', near(frameStatus.volume, (40 * 24 - 20 * 12) * 10), String(frameStatus.volume));
check('frame is one body', frameBodyCount === 1, JSON.stringify(frameStatus));

const workaround = await agentCall(page, 'create_part', { name: 'Workaround' });
check('create workaround part', workaround.ok === true, JSON.stringify(workaround));
const beganOuter = await agentCall(page, 'sketch_begin', { entry: 'crossSection', accept_plane: true });
check('workaround outer sketch', beganOuter.ok === true, JSON.stringify(beganOuter));
await waitContourReady(page);
await agentCall(page, 'sketch_add', { tool: 'rectangle', width: 40, height: 24, centered: true });
await agentCall(page, 'sketch_commit', {});
let src = (await agentCall(page, 'get_script', {})).result?.source || '';
let contourId = (src.match(/@contour id=(c\d+)/) || [])[1];
await agentCall(page, 'slot_open', { kind: 'makeExtrude' });
await agentCall(page, 'slot_assign_contour', { contour_id: contourId });
await agentCall(page, 'slot_set_params', { distance: 10, combine: 'add' });
const outerSolid = await agentCall(page, 'slot_commit', {});
check('workaround outer extrude', outerSolid.ok === true, JSON.stringify(outerSolid));

const beganInner = await agentCall(page, 'sketch_begin', { entry: 'crossSection', accept_plane: true });
check('workaround inner sketch', beganInner.ok === true, JSON.stringify(beganInner));
await waitContourReady(page);
await agentCall(page, 'sketch_add', { tool: 'rectangle', width: 20, height: 12, centered: true });
await agentCall(page, 'sketch_commit', {});
src = (await agentCall(page, 'get_script', {})).result?.source || '';
contourId = (src.match(/@contour id=(c\d+)(?![\s\S]*@contour id=)/) || [])[1]
  || (src.match(/@contour id=(c\d+)/g) || []).at(-1)?.replace('@contour id=', '');
await agentCall(page, 'slot_open', { kind: 'makeExtrude' });
await agentCall(page, 'slot_assign_contour', { contour_id: contourId });
await agentCall(page, 'slot_set_params', { distance: 20, sense: 'both', combine: 'subtract' });
const cut = await agentCall(page, 'slot_commit', {});
check('workaround hole subtract', cut.ok === true, JSON.stringify(cut));
const cutStatus = cut.result?.status || {};
const cutFaces = await agentCall(page, 'list_faces', {});
const cutFaceCount = cutFaces.result?.total ?? cutFaces.result?.faces?.length ?? null;
check('workaround volume matches the frame', near(cutStatus.volume, frameStatus.volume), `frame ${frameStatus.volume} cut ${cutStatus.volume}`);
check('workaround body count matches the frame', cutStatus.bodyCount === frameBodyCount, JSON.stringify(cutStatus));
check('workaround face count matches the frame', cutFaceCount === frameFaceCount, `frame ${frameFaceCount} cut ${cutFaceCount}`);
const frameTris = frameBodies.result?.bodies?.[0]?.triangleCount ?? null;
const cutBodies = await agentCall(page, 'list_bodies', {});
const cutTris = cutBodies.result?.bodies?.[0]?.triangleCount ?? null;
check('workaround triangle count matches the frame', frameTris != null && frameTris === cutTris, `frame ${frameTris} cut ${cutTris}`);

const uiPart = await agentCall(page, 'create_part', { name: 'Ui frame' });
check('create UI part', uiPart.ok === true, JSON.stringify(uiPart));
const beforeUi = (await agentCall(page, 'get_script', {})).result?.source || '';
const uiSketch = await agentCall(page, 'sketch_begin', { entry: 'crossSection', accept_plane: true });
check('UI sketch open', uiSketch.ok === true, JSON.stringify(uiSketch));
await waitContourReady(page);
await page.locator('[data-contour-tool="rectangle"]').click();
await poll(
  page,
  () => agentCall(page, 'mode', {}),
  (env) => env?.result?.contour?.tool === 'rectangle' && env?.result?.contour?.profileSet === true,
  10000,
);
await page.locator('[data-contour-tool="rectangle"]').click();
const uiMode = await agentCall(page, 'mode', {});
check('UI second rectangle is another loop', uiMode.result?.contour?.tool === 'cursor', JSON.stringify(uiMode.result?.contour));
await page.locator('[data-contour-confirm]').click();
const saved = await poll(
  page,
  async () => ({
    script: await agentCall(page, 'get_script', {}),
    rail: await page.locator('[data-contour-tool]').count(),
  }),
  (row) => {
    const source = row.script?.result?.source || '';
    return source.includes('@contour') && source !== beforeUi && row.rail === 0;
  },
);
const savedSource = saved?.script?.result?.source || '';
check('UI confirm saves the contour', savedSource.includes('@contour') && savedSource !== beforeUi && saved?.rail === 0, savedSource.slice(0, 400));
const insert = page.locator('button[aria-label^="Insert Extrude"]').filter({ visible: true });
await insert.first().click();
await page.locator('[data-feature-slot-card="makeExtrude"]').waitFor({ timeout: 8000 });
await page.locator('[data-slot-role="profile"] [data-slot-pick]').first().click();
await page.waitForFunction(() => document.querySelector('[data-slot-chip]'), null, { timeout: 8000 });
await page.locator('[data-feature-card-confirm]').click();
await page.waitForFunction(() => !document.querySelector('[data-feature-slot-card]'), null, { timeout: 20000 });
const uiScript = await agentCall(page, 'get_script', {});
const uiSource = uiScript.result?.source || '';
check(
  'UI confirm is one makeExtrude',
  (uiSource.match(/makeExtrude\(/g) || []).length === 1,
  uiSource,
);
// status stays on the last agent run. run reads the script the card wrote.
const uiRun = await agentCall(page, 'run', {});
const uiStatus = uiRun.result?.status || {};
check('UI frame volume', uiRun.result?.ok === true && near(uiStatus.volume, (20 * 12 - 10 * 6) * 10), JSON.stringify(uiRun.result?.errors || uiStatus));
check('UI frame is one body', uiStatus.bodyCount === 1, JSON.stringify(uiStatus));
const uiFaces = await agentCall(page, 'list_faces', {});
const uiFaceCount = uiFaces.result?.total ?? uiFaces.result?.faces?.length ?? null;
check('UI face count matches the agent frame', uiFaceCount === frameFaceCount, `frame ${frameFaceCount} ui ${uiFaceCount}`);
const uiBodies = await agentCall(page, 'list_bodies', {});
const uiTris = uiBodies.result?.bodies?.[0]?.triangleCount ?? null;
check('UI triangle count matches the agent frame', frameTris != null && uiTris === frameTris, `frame ${frameTris} ui ${uiTris}`);

await browser.close();
stop();

if (failed) {
  console.log(`agent bridge h17: ${failed} failed`);
  process.exit(1);
}
console.log('agent bridge h17: all checks passed');

#!/usr/bin/env node
/**
 * Agent bridge H3: real wiring for select_faces + camera_set (not mocked handlers).
 *
 * Builds a box, selects the top face by stable key, asserts the selection reader,
 * snaps the camera to top, and asserts the camera reader moved.
 */
/* global document, window, indexedDB, localStorage */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright-core';
import { attachConsentPresetToBrowser } from './lib/presetConsentInit.mjs';

const SHOT_DIR = process.env.GOLDEN_SHOT_DIR || tmpdir();
const PORT = Number(process.env.SMOKE_PORT || 4320);
const APP_URL = `http://127.0.0.1:${PORT}/?agent=1`;

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].filter(Boolean);

const BOX = `// --- cube begin id=cube1 ---
let part = Manifold.cube([40, 30, 20], true);
// --- cube end ---
return part;
`;

const ASSEMBLY = {
  format: 'surfcad.assembly',
  v: 1,
  name: 'agent-h3',
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
  console.log('agent bridge h3: no system Chrome found — set CHROME_PATH. Skipping.');
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
      'user-agent-h3': {
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
  }, { doc: ASSEMBLY, script: BOX });
}

async function agentCall(page, name, args) {
  return page.evaluate(async ({ name, argsJson }) => {
    const env = await window.surfcad.call(name, argsJson);
    return env;
  }, { name, argsJson: JSON.stringify(args ?? {}) });
}

console.log('agent bridge h3 golden');

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
const errors = [];
const ALLOWED = [
  /favicon/i,
  /Failed to load resource.*404/i,
  /Failed to load resource: the server responded with a status of 500/i,
];
page.on('pageerror', (err) => errors.push(String(err?.message || err)));
page.on('console', (msg) => {
  if (msg.type() !== 'error') return;
  const text = msg.text();
  if (ALLOWED.some((re) => re.test(text))) return;
  errors.push(text);
});

await page.route('**/api/auth/me', (route) => route.fulfill({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({
    authenticated: true,
    user: { _id: 'user-agent-h3', email: 'agent@test.local' },
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

const wrote = await agentCall(page, 'set_script', { source: BOX });
check('set_script box', wrote.ok === true && wrote.result?.ok === true, JSON.stringify(wrote));

const camBefore = await agentCall(page, 'camera', {});
const beforePos = camBefore.result?.position;
check('camera before', Array.isArray(beforePos) && beforePos.every((n) => Number.isFinite(n)),
  JSON.stringify(beforePos));

const listedFaces = await agentCall(page, 'list_faces', {});
check('list_faces non-empty', listedFaces.ok === true && listedFaces.result?.faces?.length >= 6,
  JSON.stringify(listedFaces.result?.faces?.length));

const topKey = listedFaces.result.faces.find((row) => row.key?.n?.[2] > 0.9)?.key
  || listedFaces.result.faces[0].key;

const picked = await agentCall(page, 'select_faces', { keys: [topKey] });
check('select_faces ok', picked.ok === true, JSON.stringify(picked));

const sel = await agentCall(page, 'selection', {});
check('selection face area after select_faces',
  sel.ok === true && (sel.result?.face?.area ?? 0) > 100,
  JSON.stringify(sel.result?.face));

const zoomSel = await agentCall(page, 'zoom_to_selection', {});
check('zoom_to_selection after face pick', zoomSel.ok === true, JSON.stringify(zoomSel));

const plusXKey = listedFaces.result.faces.find((row) => row.key?.n?.[0] > 0.9)?.key;
if (plusXKey) {
  const pickX = await agentCall(page, 'select_faces', { keys: [plusXKey] });
  check('select_faces +X via list_faces key', pickX.ok === true, JSON.stringify(pickX));
  const selX = await agentCall(page, 'selection', {});
  check('+X face area', (selX.result?.face?.area ?? 0) > 100, JSON.stringify(selX.result?.face));
  const zoomX = await agentCall(page, 'zoom_to_selection', {});
  check('zoom_to_selection +X face', zoomX.ok === true, JSON.stringify(zoomX));
}

const listedEdges = await agentCall(page, 'list_edges', {});
check('list_edges non-empty', listedEdges.ok === true && listedEdges.result?.edges?.length >= 4,
  JSON.stringify(listedEdges.result?.edges?.length));

const edgeRow = listedEdges.result.edges.find((row) => row.faceKeyA?.area > 0 && row.faceKeyB?.area > 0)
  || listedEdges.result.edges[0];
const edgePick = await agentCall(page, 'select_edges', {
  keys: [{ faceKeyA: edgeRow.faceKeyA, faceKeyB: edgeRow.faceKeyB }],
});
check('select_edges via adjacent face keys', edgePick.ok === true, JSON.stringify(edgePick));

const snap = await agentCall(page, 'camera_set', { view: 'top' });
check('camera_set top', snap.ok === true, JSON.stringify(snap));

const camAfter = await agentCall(page, 'camera', {});
const afterPos = camAfter.result?.position;
const moved = Array.isArray(afterPos) && Array.isArray(beforePos)
  && Math.abs(afterPos[2] - beforePos[2]) > 1;
check('camera reader changed after top', moved, `before=${beforePos} after=${afterPos}`);

check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
stop();

if (failed) {
  console.log(`agent bridge h3: ${failed} failed`);
  process.exit(1);
}
console.log('agent bridge h3: ok');

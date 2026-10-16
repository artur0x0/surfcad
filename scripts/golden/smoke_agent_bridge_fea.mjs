#!/usr/bin/env node
/**
 * Agent bridge FEA: open Analyze, material, fixture + force, run, magnitude re-run changes stress.
 */
/* global window, indexedDB, localStorage */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { feaStudyBlock } from '../../src/fea/studyScript.js';

const SHOT_DIR = process.env.GOLDEN_SHOT_DIR || tmpdir();
const PORT = Number(process.env.SMOKE_PORT || 4328);
const APP_URL = `http://127.0.0.1:${PORT}/?agent=1`;
const STUDY = feaStudyBlock({ mesh: { target: 8, refine: 'off' } });
const BEAM = `// @surf-id fea-agent-beam\nconst part = Manifold.cube([40, 10, 10], false);\nreturn part;\n${STUDY}`;

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].filter(Boolean);

const PART_ID = 'local:part1';
const ASSEMBLY = {
  format: 'surfcad.assembly',
  v: 1,
  name: 'agent-fea',
  activeId: PART_ID,
  source: 'git',
  parts: [{ id: PART_ID, name: 'Beam', visible: true }],
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
  console.log('agent bridge fea: no system Chrome found — set CHROME_PATH. Skipping.');
  process.exit(0);
}

if (!existsSync(new URL('../../dist/index.html', import.meta.url))) {
  console.log('  ❌ dist/ missing — run `npm run build:playtest` first');
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
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 3000);
      const res = await fetch(`http://127.0.0.1:${PORT}/`, { signal: ctrl.signal });
      clearTimeout(timer);
      if (res.ok) return true;
    } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

async function seedAssembly(page) {
  await page.evaluate(async ({ doc, script }) => {
    localStorage.setItem('surfcadAgent', '1');
    localStorage.setItem('surfcad.github.tokenBundle', JSON.stringify({
      accessToken: 'ghu_agent_fea',
      refreshToken: '',
      expiresAt: Date.now() + 86_400_000,
      refreshExpiresAt: 0,
    }));
    localStorage.setItem('surfcad.lastAssembly', JSON.stringify({
      'user-agent-fea': {
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
        tx.objectStore('parts').put({ id: PART_ID, script, savedAt: Date.now() }, PART_ID);
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
    });
  }, { doc: ASSEMBLY, script: BEAM });
}

async function agentCall(page, name, args = {}, timeoutMs = 180_000) {
  return page.evaluate(async ({ name, argsJson }) => {
    const env = await window.surfcad.call(name, argsJson);
    return JSON.parse(JSON.stringify(env));
  }, { name, argsJson: JSON.stringify(args ?? {}) }, { timeout: timeoutMs });
}

async function shot(page, label, width) {
  await page.setViewportSize({ width, height: Math.round(width * 0.62) });
  const buf = await page.screenshot({ type: 'png' });
  writeFileSync(join(SHOT_DIR, `agent-bridge-fea-${label}-${width}.png`), buf);
}

function logStep(msg) {
  console.log(msg);
}
logStep('agent bridge fea golden');

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
    user: { _id: 'user-agent-fea', email: 'agent@test.local' },
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
  () => typeof window.surfcad?.call === 'function',
  { timeout: 120000 },
);
await page.waitForTimeout(600);

logStep('  run beam…');
const ran = await agentCall(page, 'run', {});
check('run beam', ran.ok === true && ran.result?.ok === true, JSON.stringify(ran));
await page.waitForTimeout(800);

const opened = await agentCall(page, 'fea_open', {});
check('fea_open', opened.ok === true && opened.result?.open === true, JSON.stringify(opened));

const modeFea = await agentCall(page, 'mode', {});
check('mode fea', modeFea.ok === true && modeFea.result?.viewport === 'fea', JSON.stringify(modeFea));

const mat = await agentCall(page, 'fea_set_material', { id: 'pla-ultimaker' });
check('fea_set_material', mat.ok === true, JSON.stringify(mat));

const faces = await agentCall(page, 'list_faces', {});
const list = faces.result?.faces || [];
const norm = (row) => row.normal || row.key?.n || row.n || [];
// Clamp the −Y bottom face and apply −Z force on the +Y top (list_faces omits some caps).
const fixFace = list.find((row) => norm(row)[1] < -0.9)
  || list.find((row) => (row.center?.[1] ?? 99) < 1);
const loadFace = list.find((row) => norm(row)[1] > 0.9)
  || list.find((row) => (row.center?.[1] ?? 0) > 9);
check('list_faces fix/load', !!fixFace?.key && !!loadFace?.key && fixFace.key !== loadFace.key,
  JSON.stringify({ n: list.length, fix: fixFace?.key, load: loadFace?.key }));

const fix = await agentCall(page, 'fea_set_fixture', { keys: [fixFace.key] });
check('fea_set_fixture', fix.ok === true, JSON.stringify(fix));
await page.waitForSelector('[data-fea-fixture-count="1"]', { timeout: 15000 });

await agentCall(page, 'fea_set_force', { magnitudeN: 200, direction: '-z' });
const load = await agentCall(page, 'fea_pick', { keys: [loadFace.key] });
check('fea_pick load face', load.ok === true, JSON.stringify(load));
await page.waitForSelector('[data-fea-load-count="1"]', { timeout: 15000 });

logStep('  fea_run (200 N)…');
const run1 = await agentCall(page, 'fea_run', {}, 300_000);
check('fea_run first', run1.ok === true && run1.result?.status === 'done', JSON.stringify(run1.result));
check('fea_run reports dof', Number.isFinite(run1.result?.dof) && run1.result.dof > 0,
  JSON.stringify({ dof: run1.result?.dof }));
check('fea_run peak stress', (run1.result?.maxVonMises_MPa ?? 0) > 0,
  JSON.stringify({ max: run1.result?.maxVonMises_MPa }));

const scriptBefore = await agentCall(page, 'get_script', {});
const bump = await agentCall(page, 'fea_set_force', { magnitudeN: 400, direction: '-z' });
check('fea_set_force magnitude commit', bump.ok === true, JSON.stringify(bump));
const scriptAfter = await agentCall(page, 'get_script', {});
check('magnitude write updates study script', scriptAfter.ok === true
  && scriptAfter.result?.source !== scriptBefore.result?.source,
  'study script unchanged after magnitude bump');

logStep('  fea_run (400 N)…');
const run2 = await agentCall(page, 'fea_run', {}, 300_000);
check('fea_run second', run2.ok === true && run2.result?.status === 'done', JSON.stringify(run2.result));
const max1 = run1.result?.maxVonMises_MPa;
const max2 = run2.result?.maxVonMises_MPa;
const stressRatio = (typeof max1 === 'number' && max1 > 0 && typeof max2 === 'number')
  ? max2 / max1
  : NaN;
check('peak von Mises roughly doubles when load doubles',
  Number.isFinite(stressRatio) && stressRatio >= 1.8 && stressRatio <= 2.2,
  JSON.stringify({ max1, max2, stressRatio }));

const results = await agentCall(page, 'fea_results', {});
check('fea_results summary', results.ok === true && Number.isFinite(results.result?.maxVonMises_MPa),
  JSON.stringify(results.result));

const state = await agentCall(page, 'fea_state', { include: ['summary'] });
check('fea_state', state.ok === true && state.result?.open === true && state.result?.fixtureCount >= 1,
  JSON.stringify(state.result));

await shot(page, 'fea-results', 1280);
await shot(page, 'fea-results', 390);

await agentCall(page, 'fea_close', {});
const closed = await agentCall(page, 'fea_state', {});
check('fea_close', closed.ok === true && closed.result?.open === false, JSON.stringify(closed));

await browser.close();
stop();

if (failed) {
  console.log(`\nagent bridge fea: ${failed} failed`);
  process.exit(1);
}
console.log('\nagent bridge fea: all checks passed');
process.exit(0);

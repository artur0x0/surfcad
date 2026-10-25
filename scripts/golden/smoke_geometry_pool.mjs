#!/usr/bin/env node
/**
 * Geometry PR 3: the parts that are not active build on a pool of workers.
 * A ten-part assembly is opened cold with the cap at 1 (serial, on the
 * primary) and at 4 (three pool members plus the primary). A later Run does
 * not rebuild parts whose mesh is already on the page, so the parallel work
 * is this first open. Every part's volume and triangle count is the same in
 * both, the pool never holds more members than the cap allows, at least two
 * built at once, and both open times are printed. The speed-up is reported,
 * not asserted: CI runners vary.
 * Chrome from CHROME_PATH or the usual paths.
 */
/* global document, window, indexedDB, localStorage */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { attachConsentPresetToBrowser } from './lib/presetConsentInit.mjs';

const PORT = Number(process.env.SMOKE_PORT || 4348);
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
    console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`);
  }
}

const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!exe) {
  console.log('geometry pool golden: no system Chrome found — set CHROME_PATH. Skipping.');
  process.exit(0);
}

const server = spawn('npx', ['vite', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort', '--logLevel', 'error'], {
  cwd: new URL('../../', import.meta.url).pathname,
  stdio: 'ignore',
  detached: true,
});
let stopped = false;
const stop = () => {
  if (stopped) return;
  stopped = true;
  try { process.kill(-server.pid, 'SIGTERM'); } catch { /* gone */ }
};
process.on('exit', stop);
process.on('SIGINT', () => { stop(); process.exit(130); });

async function waitForServer() {
  for (let i = 0; i < 120; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/`);
      if (res.ok) return true;
    } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function agentCall(page, name, args) {
  return page.evaluate(async ({ name, argsJson }) => window.surfcad.call(name, argsJson), {
    name,
    argsJson: JSON.stringify(args ?? {}),
  });
}

// Ten medium parts: a plate with a hole grid, spaced along x. Each takes a
// few hundred milliseconds, enough for parallelism to show.
function partScript(i) {
  return [
    `let part = Manifold.cube([60, 40, 6], true).translate([${i * 80}, 0, 0]);`,
    'for (let r = 0; r < 4; r++) for (let c = 0; c < 6; c++) {',
    `  part = part.subtract(Manifold.cylinder(10, 2.5, 2.5, 48).translate([${i * 80} - 25 + c * 10, -15 + r * 10, -5]));`,
    '}',
    `part = part.add(Manifold.cylinder(20, 6, 6, 64).translate([${i * 80}, 0, 3]));`,
    'return part;',
  ].join('\n');
}

async function seedPlates(page) {
  const parts = [];
  const scripts = {};
  for (let i = 0; i < 10; i += 1) {
    const id = `p${i}`;
    parts.push({ id, name: `Plate ${i}`, visible: true, order: i });
    scripts[id] = partScript(i);
  }
  const doc = {
    format: 'surfcad.assembly',
    v: 1,
    name: 'Pool plates',
    activeId: 'p0',
    source: 'local',
    parts,
    joints: [],
  };
  await page.evaluate(async ({ doc, scripts }) => {
    localStorage.setItem('surfcadAgent', '1');
    localStorage.setItem('surfcad.lastAssembly', JSON.stringify({
      'user-geometry-pool': {
        name: doc.name,
        activeId: doc.activeId,
        source: 'local',
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
        for (const [id, script] of Object.entries(scripts)) {
          tx.objectStore('parts').put({ id, script, savedAt: Date.now() }, id);
        }
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
    });
  }, { doc, scripts });
}

async function buildAssembly(browser, cap) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  await page.route('**/api/**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({}),
  }));
  await page.route('**/api/auth/me', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ authenticated: true, user: { _id: 'user-geometry-pool', email: 'agent@test.local' } }),
  }));
  await page.route('**/api/config', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
  await seedPlates(page);
  const ids = Array.from({ length: 10 }, (_, i) => `p${i}`);
  const t0 = Date.now();
  await page.goto(`http://127.0.0.1:${PORT}/?agent=1&geometryWorkers=${cap}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => typeof window.surfcad?.call === 'function' && !document.querySelector('[data-app-loading]'),
    { timeout: 120000 },
  );
  await page.waitForSelector('[data-cad-run]', { state: 'attached', timeout: 120000 });
  let openedRows = [];
  for (let i = 0; i < 180; i += 1) {
    openedRows = (await agentCall(page, 'parts', {})).result?.parts || [];
    if (openedRows.length === 10 && openedRows.every((row) => row.runState === 'ok')) break;
    await page.waitForTimeout(500);
  }
  const buildMs = Date.now() - t0;
  const opened = openedRows;
  check(`cap ${cap}: opened ten parts`, opened.length === 10 && opened.every((row) => row.runState === 'ok'), JSON.stringify(opened.map((row) => [row.name, row.runState])));
  const workers = (await agentCall(page, 'geometry_workers', {})).result;
  check(`cap ${cap}: geometry_workers reports the cap`, workers?.cap === cap, JSON.stringify(workers));
  const after = workers;
  check(`cap ${cap}: live workers never exceed the cap`, Number(after?.live) <= cap && Number(after?.pool?.size ?? 0) === cap - 1, JSON.stringify(after));

  // Every part's fingerprint.
  const rows = (await agentCall(page, 'parts', {})).result?.parts || [];
  check(`cap ${cap}: every part ran ok`, rows.length === 10 && rows.every((r) => r.runState === 'ok'), JSON.stringify(rows.map((r) => [r.name, r.runState])));
  const prints = [];
  for (const id of ids) {
    await agentCall(page, 'set_active_part', { part_id: id });
    const status = (await agentCall(page, 'status', {})).result;
    const bodies = (await agentCall(page, 'list_bodies', {})).result?.bodies || [];
    prints.push({ volume: Number(status?.volume).toFixed(3), tris: bodies.reduce((n, b) => n + (b.triangleCount || 0), 0), bodies: bodies.length });
  }
  check(`cap ${cap}: no page errors`, pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
  await page.close();
  return { buildMs, prints, after };
}

console.log('geometry pool golden');
if (!(await waitForServer())) {
  console.log('  ❌ dev server did not start');
  stop();
  process.exit(1);
}
const browser = await chromium.launch({
  executablePath: exe,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader'],
});
attachConsentPresetToBrowser(browser);

const serial = await buildAssembly(browser, 1);
const pooled = await buildAssembly(browser, 4);
check('the pool built at least two parts at once', Number(pooled.after?.pool?.peakBusy) >= 2, JSON.stringify(pooled.after?.pool));
check('every part has the same volume, triangle count, and body count with 1 and with 4 workers', JSON.stringify(serial.prints) === JSON.stringify(pooled.prints), `${JSON.stringify(serial.prints)} vs ${JSON.stringify(pooled.prints)}`);
console.log(`  (open of 10 parts: ${serial.buildMs} ms with 1 worker, ${pooled.buildMs} ms with 4)`);
if (pooled.buildMs > serial.buildMs) console.log('  ⚠️ the pooled build was not faster on this machine (reported, not asserted)');

await browser.close();
stop();
if (failed) {
  console.log(`geometry pool golden: FAIL (${failed})`);
  process.exit(1);
}
console.log('geometry pool golden: ok');

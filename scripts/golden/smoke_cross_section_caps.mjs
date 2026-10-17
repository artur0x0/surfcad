#!/usr/bin/env node
/**
 * Cross-section: capped Manifold trims on every visible part in assembly scope,
 * and only the active part in part-editor scope. Saves before/after screenshots.
 */
/* global document, window, indexedDB, localStorage */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

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

await agentCall(page, 'cross_section_toggle', { enabled: true });
await agentCall(page, 'cross_section_expand', { open: true });
const plane = await agentCall(page, 'cross_section_plane', { plane: 'XZ' });
check('plane read-back XZ + Y normal', plane.ok === true
  && plane.result?.plane === 'XZ'
  && Math.abs((plane.result?.normal?.[1] ?? 0) - 1) < 0.01,
  JSON.stringify(plane.result));
await page.waitForTimeout(1500);

let state = await agentCall(page, 'cross_section_state');
check('assembly scope on', state.result?.assemblyScope === true, JSON.stringify(state.result));
check('assembly lists two targets', (state.result?.targetPartIds?.length ?? 0) >= 2,
  JSON.stringify(state.result?.targetPartIds));
check('both parts trimmed with caps', (state.result?.trimmedPartIds?.length ?? 0) >= 2,
  JSON.stringify(state.result?.trimmedPartIds));

writeFileSync(join(SHOT_DIR, 'cross-section-after-assembly.png'), await page.screenshot({ type: 'png' }));

await agentCall(page, 'cross_section_toggle', { enabled: false });
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
check('only active part trimmed', state.result?.trimmedPartIds?.length === 1,
  JSON.stringify(state.result?.trimmedPartIds));

writeFileSync(join(SHOT_DIR, 'cross-section-after-single.png'), await page.screenshot({ type: 'png' }));

await browser.close();
stop();
console.log(failed ? 'cross-section caps: FAILED' : 'cross-section caps: ok');
process.exit(failed ? 1 : 0);

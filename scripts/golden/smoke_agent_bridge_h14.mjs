#!/usr/bin/env node
/**
 * Agent bridge H14: sheet-metal flow — base, bends, check/refold, thickness, undo.
 */
/* global document, window, indexedDB, localStorage */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { newPartStarterScript } from '../../src/utils/helperPaletteSnippets.js';

const SHOT_DIR = process.env.GOLDEN_SHOT_DIR || tmpdir();
const PORT = Number(process.env.SMOKE_PORT || 4326);
const APP_URL = `http://127.0.0.1:${PORT}/?agent=1`;
const catalog = readFileSync(new URL('../golden/fixtures/scs/catalog.json', import.meta.url), 'utf8');
const specs = readFileSync(new URL('../golden/fixtures/scs/specs.json', import.meta.url), 'utf8');

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].filter(Boolean);

const ASSEMBLY = {
  format: 'surfcad.assembly',
  v: 1,
  name: 'agent-h14',
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
  console.log('agent bridge h14: no system Chrome found — set CHROME_PATH. Skipping.');
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
      'user-agent-h14': {
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
  }, { doc: ASSEMBLY, script: newPartStarterScript() });
}

async function agentCall(page, name, args) {
  return page.evaluate(async ({ name, argsJson }) => window.surfcad.call(name, argsJson), {
    name,
    argsJson: JSON.stringify(args ?? {}),
  });
}

async function shot(page, label, width) {
  await page.setViewportSize({ width, height: Math.round(width * 0.62) });
  const buf = await page.screenshot({ type: 'png' });
  writeFileSync(join(SHOT_DIR, `agent-bridge-h14-${label}-${width}.png`), buf);
}

console.log('agent bridge h14 golden');

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
    user: { _id: 'user-agent-h14', email: 'agent@test.local' },
  }),
}));
await page.route('**/api/config', (route) => route.fulfill({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({}),
}));
await page.route('**/sendcutsend-catalog*.json', (route) => route.fulfill({
  status: 200,
  contentType: 'application/json',
  body: catalog,
}));
await page.route('**/sendcutsend-specs*.json', (route) => route.fulfill({
  status: 200,
  contentType: 'application/json',
  body: specs,
}));

await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
await seedAssembly(page);
await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });

await page.setDefaultTimeout(120000);
await page.waitForFunction(
  () => typeof window.surfcad?.call === 'function' && !document.querySelector('[data-app-loading]'),
  null,
  { timeout: 120000 },
);
await page.waitForSelector('[data-cad-run]', { state: 'attached', timeout: 120000 });
await page.waitForTimeout(500);

const opened = await agentCall(page, 'sheet_open', {});
check('sheet_open', opened.ok === true, JSON.stringify(opened));

const started = await agentCall(page, 'sheet_start', { sku: 'ALU-090' });
check('sheet_start', started.ok === true, JSON.stringify(started));

const plane = await agentCall(page, 'sheet_pick', { plane: 'XY' });
check('sheet_pick plane', plane.ok === true, JSON.stringify(plane));

await agentCall(page, 'sheet_set_params', { width: 80, height: 50 });
const baseCommit = await agentCall(page, 'sheet_commit', {});
check('sheet_commit base', baseCommit.ok === true && baseCommit.result?.written === true, JSON.stringify(baseCommit));

await agentCall(page, 'run', {});
const afterBase = await agentCall(page, 'status', {});
check('status after base', afterBase.ok === true && (afterBase.result?.volume ?? 0) > 500, JSON.stringify(afterBase));

await agentCall(page, 'sheet_set_tool', { tool: 'bend' });
await agentCall(page, 'sheet_pick', { panel: 'base', edge: 'u+' });
await agentCall(page, 'sheet_set_params', { angle: 90, length: 20 });
const bend1 = await agentCall(page, 'sheet_commit', {});
check('sheet_commit bend 1', bend1.ok === true, JSON.stringify(bend1));

await agentCall(page, 'sheet_pick', { panel: 'base', edge: 'u-' });
await agentCall(page, 'sheet_set_params', { angle: 90, length: 20 });
const bend2 = await agentCall(page, 'sheet_commit', {});
check('sheet_commit bend 2', bend2.ok === true, JSON.stringify(bend2));

await agentCall(page, 'sheet_set_params', { r: 2 });
const checkOpen = await agentCall(page, 'sheet_check', {});
check('sheet_check unfold', checkOpen.ok === true, JSON.stringify(checkOpen));

const refold = await agentCall(page, 'sheet_refold', {});
check('sheet_refold', refold.ok === true, JSON.stringify(refold));

await agentCall(page, 'sheet_edit', { chip_id: 'sheet:base' });
await agentCall(page, 'sheet_set_params', { sku: 'ALU-125' });
const thick = await agentCall(page, 'sheet_commit', {});
check('sheet_commit thickness sku', thick.ok === true, JSON.stringify(thick));

const undone = await agentCall(page, 'undo', {});
check('undo one step', undone.ok === true, JSON.stringify(undone));

await shot(page, 'bracket', 1280);
await shot(page, 'bracket', 390);

await browser.close();
stop();

if (failed) process.exit(1);
console.log('agent bridge h14: ok');

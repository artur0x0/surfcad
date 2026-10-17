#!/usr/bin/env node
/**
 * Agent bridge H11: create_part, joint_open/pick/commit, assembly undo.
 */
/* global document, window, indexedDB, localStorage */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { attachConsentPresetToBrowser } from './lib/presetConsentInit.mjs';

const SHOT_DIR = process.env.GOLDEN_SHOT_DIR || tmpdir();
const PORT = Number(process.env.SMOKE_PORT || 4326);
const APP_URL = `http://127.0.0.1:${PORT}/?agent=1`;

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].filter(Boolean);

const ASSEMBLY = {
  format: 'surfcad.assembly',
  v: 1,
  name: 'agent-h11',
  activeId: 'local:part1',
  source: 'local',
  parts: [{ id: 'local:part1', name: 'Part (1)', visible: true, order: 0 }],
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
  console.log('agent bridge h11: no system Chrome found — set CHROME_PATH. Skipping.');
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
      'user-agent-h11': {
        name: doc.name,
        activeId: doc.activeId,
        source: doc.source,
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

async function shot(page, label, width) {
  await page.setViewportSize({ width, height: Math.round(width * 0.62) });
  const buf = await page.screenshot({ type: 'png' });
  writeFileSync(join(SHOT_DIR, `agent-bridge-h11-${label}-${width}.png`), buf);
}

console.log('agent bridge h11 golden');

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
    user: { _id: 'user-agent-h11', email: 'agent@test.local' },
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
await page.waitForTimeout(500);

const cubeA = await agentCall(page, 'insert_cube', { width: 50, depth: 40, height: 10 });
check('insert_cube base', cubeA.ok === true && cubeA.result?.ok === true);

let baseId = null;
let pinId = null;

const created = await agentCall(page, 'create_part', { name: 'Pin' });
check('create_part', created.ok === true, JSON.stringify(created));
const partsAfter = await agentCall(page, 'parts', {});
baseId = partsAfter.result?.parts?.[0]?.id;
pinId = partsAfter.result?.activeId;
check('two parts', (partsAfter.result?.parts?.length ?? 0) >= 2 && baseId && pinId);

const cubeB = await agentCall(page, 'insert_cube', { width: 12, depth: 12, height: 20 });
check('insert_cube pin', cubeB.ok === true && cubeB.result?.ok === true);

await agentCall(page, 'set_active_part', { part_id: baseId });
await agentCall(page, 'run', {});
const baseFaces = await agentCall(page, 'list_faces', {});
const top = (baseFaces.result?.faces || []).find((row) => (row.normal?.[2] ?? 0) > 0.9);

await agentCall(page, 'set_active_part', { part_id: pinId });
await agentCall(page, 'run', {});
const pinFaces = await agentCall(page, 'list_faces', {});
const bottom = (pinFaces.result?.faces || []).find((row) => (row.normal?.[2] ?? 0) < -0.9);
check('face keys', !!top?.key && !!bottom?.key);

const opened = await agentCall(page, 'joint_open', {});
check('joint_open', opened.ok === true);

const picked = await agentCall(page, 'joint_pick', {
  picks: [
    { part_id: baseId, key: top.key },
    { part_id: pinId, key: bottom.key },
  ],
});
check('joint_pick', picked.ok === true, JSON.stringify(picked));

await agentCall(page, 'joint_set_params', { type: 'coincident' });
const committed = await agentCall(page, 'joint_commit', {});
check('joint_commit', committed.ok === true, JSON.stringify(committed));

const undone = await agentCall(page, 'undo', {});
check('undo assembly joint', undone.ok === true && undone.result?.kind === 'assembly', JSON.stringify(undone));

await shot(page, 'after-undo', 1280);
await shot(page, 'after-undo', 390);

await browser.close();
stop();

if (failed) process.exit(1);
console.log('agent bridge h11: ok');

#!/usr/bin/env node
/**
 * Agent bridge H15: history, undo, redo on the feature-bar stacks.
 */
/* global document, window, indexedDB, localStorage */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const SHOT_DIR = process.env.GOLDEN_SHOT_DIR || tmpdir();
const PORT = Number(process.env.SMOKE_PORT || 4327);
const APP_URL = `http://127.0.0.1:${PORT}/?agent=1`;

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].filter(Boolean);

const BOX = `// --- cube begin ---
let part = Manifold.cube([40, 30, 20], true);
// --- cube end ---
return part;
`;

const HOLE = `// --- cube begin ---
let part = Manifold.cube([40, 30, 20], true);
// --- cube end ---
// --- hole begin ---
part = part.subtract(Manifold.cylinder(40, 6, 6, 48, true));
// --- hole end ---
return part;
`;

const ASSEMBLY = {
  format: 'surfcad.assembly',
  v: 1,
  name: 'agent-h15',
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
  console.log('agent bridge h15: no system Chrome found — set CHROME_PATH. Skipping.');
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
      'user-agent-h15': {
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
        if (!db.objectStoreNames.contains('assemblies')) {
          db.createObjectStore('assemblies');
        }
        if (!db.objectStoreNames.contains('parts')) {
          db.createObjectStore('parts');
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction(['assemblies', 'parts'], 'readwrite');
        tx.objectStore('assemblies').put(doc, 'user-agent-h15');
        tx.objectStore('parts').put({ id: 'local:part1', script: '' }, 'local:part1');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });
  }, { doc: ASSEMBLY });
}

async function agentCall(page, command, args = {}) {
  return page.evaluate(async ({ command, args }) => {
    const env = await window.surfcad.call(command, args);
    return JSON.parse(JSON.stringify(env));
  }, { command, args });
}

async function shot(page, label, width) {
  const height = width === 390 ? 844 : 800;
  await page.setViewportSize({ width, height });
  await page.waitForTimeout(300);
  const dataUrl = await page.evaluate(() => window.surfcad.screenshot());
  const buf = Buffer.from(dataUrl.replace(/^data:image\/png;base64,/, ''), 'base64');
  writeFileSync(join(SHOT_DIR, `agent-bridge-h15-${label}-${width}.png`), buf);
}

if (!(await waitForServer())) {
  console.log('  ❌ preview server did not start');
  stop();
  process.exit(1);
}

const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage();
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
await seedAssembly(page);
await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(
  () => typeof window.surfcad?.call === 'function' && !document.querySelector('[data-app-loading]'),
  null,
  { timeout: 120000 },
);
await page.waitForSelector('[data-cad-run]', { state: 'attached', timeout: 120000 });
await page.waitForTimeout(500);

const boot = await agentCall(page, 'insert_cube', { width: 40, depth: 30, height: 20 });
check('insert_cube boot', boot.ok === true && boot.result?.ok === true, JSON.stringify(boot));
const parts0 = await agentCall(page, 'parts', {});
const partId = parts0.result?.activeId;
const picked = await agentCall(page, 'select_parts', { part_id: partId });
check('select_parts highlights base', picked.ok === true, JSON.stringify(picked));
await agentCall(page, 'set_script', { source: BOX });
await agentCall(page, 'set_script', { source: HOLE });

const hist1 = await agentCall(page, 'history', {});
check('history part stack', hist1.ok === true && hist1.result?.kind === 'part'
  && hist1.result?.canUndo === true && (hist1.result?.entries?.length ?? 0) >= 2,
  JSON.stringify(hist1.result));

const undone = await agentCall(page, 'undo', {});
check('undo reports reverted label', undone.ok === true && undone.result?.kind === 'part'
  && undone.result?.reverted?.label && undone.result?.applied?.label,
  JSON.stringify(undone.result));

const hist2 = await agentCall(page, 'history', {});
check('history canRedo after undo', hist2.result?.canRedo === true, JSON.stringify(hist2.result));

const redone = await agentCall(page, 'redo', {});
check('redo restores hole', redone.ok === true && redone.result?.kind === 'part'
  && (redone.result?.status?.featureCount ?? 0) >= 2,
  JSON.stringify(redone.result));

await agentCall(page, 'undo', {});
const before = await agentCall(page, 'history', {});
check('redo available before new edit', before.result?.canRedo === true, JSON.stringify(before.result));
const changed = await agentCall(page, 'set_script', { source: HOLE });
const hist3 = await agentCall(page, 'history', {});
check('new edit clears redo', changed.ok === true && hist3.result?.canRedo === false, JSON.stringify(hist3.result));

await shot(page, 'history', 1280);
await shot(page, 'history', 390);

await browser.close();
stop();

if (failed) process.exit(1);
console.log('agent bridge h15: ok');

#!/usr/bin/env node
/**
 * Agent bridge H16: export_part STL/3MF/STEP bytes and download path.
 */
/* global document, window, indexedDB, localStorage */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const SHOT_DIR = process.env.GOLDEN_SHOT_DIR || tmpdir();
const PORT = Number(process.env.SMOKE_PORT || 4328);
const APP_URL = `http://127.0.0.1:${PORT}/?agent=1`;

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].filter(Boolean);

const CUBE = `// --- cube begin ---
let part = Manifold.cube([30, 20, 10], true);
// --- cube end ---
return part;
`;

const ASSEMBLY = {
  format: 'surfcad.assembly',
  v: 1,
  name: 'agent-h16',
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
  console.log('agent bridge h16: no system Chrome found — set CHROME_PATH. Skipping.');
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
      'user-agent-h16': {
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
  }, { doc: ASSEMBLY, script: CUBE });
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
  writeFileSync(join(SHOT_DIR, `agent-bridge-h16-${label}-${width}.png`), buf);
}

console.log('agent bridge h16 golden');

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

for (const width of [390, 1280]) {
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
  await page.waitForTimeout(400);

  const boot = await agentCall(page, 'insert_cube', { width: 30, depth: 20, height: 10 });
  check(`insert_cube @${width}`, boot.ok === true && boot.result?.ok === true, JSON.stringify(boot));

  const stl = await agentCall(page, 'export_part', { format: 'stl' });
  check(
    `export_part stl bytes @${width}`,
    stl.ok === true && (stl.result?.byteLength ?? 0) > 80 && typeof stl.result?.bytesBase64 === 'string',
    JSON.stringify(stl.error || stl.result),
  );

  const mf = await agentCall(page, 'export_part', { format: '3mf' });
  check(
    `export_part 3mf bytes @${width}`,
    mf.ok === true && (mf.result?.byteLength ?? 0) > 200,
    JSON.stringify(mf.error || { byteLength: mf.result?.byteLength }),
  );

  const step = await agentCall(page, 'export_part', { format: 'step' });
  check(
    `export_part step bytes @${width}`,
    step.ok === true && (step.result?.byteLength ?? 0) > 100,
    JSON.stringify(step.error || { byteLength: step.result?.byteLength }),
  );

  const dl = await agentCall(page, 'export_download', { format: '3mf' });
  check(
    `export_download 3mf @${width}`,
    dl.ok === true && dl.result?.downloaded === true && dl.result?.format === '3mf',
    JSON.stringify(dl),
  );

  await shot(page, 'export', width);
  await page.close();
}

await browser.close();
stop();

if (failed) {
  console.log(`agent bridge h16: ${failed} failed`);
  process.exit(1);
}
console.log('agent bridge h16: ok');

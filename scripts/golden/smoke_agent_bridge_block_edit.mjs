#!/usr/bin/env node
/**
 * Agent bridge: partial edit_feature on a 20³ cube must not reset to palette defaults.
 */
/* global document, window, indexedDB, localStorage */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright-core';

const PORT = Number(process.env.SMOKE_PORT || 4329);
const APP_URL = `http://127.0.0.1:${PORT}/?agent=1`;
const SHOT_DIR = process.env.GOLDEN_SHOT_DIR || tmpdir();
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].filter(Boolean);

const ASSEMBLY = {
  format: 'surfcad.assembly',
  v: 1,
  name: 'agent-block-edit',
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
  console.log('agent bridge block edit: no system Chrome found — set CHROME_PATH. Skipping.');
  process.exit(0);
}
if (!existsSync(new URL('../../dist/index.html', import.meta.url))) {
  console.log('  ❌ dist/ missing — run npm run build');
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
  try { process.kill(-server.pid, 'SIGTERM'); } catch { /* */ }
  try { server.kill('SIGKILL'); } catch { /* */ }
};
process.on('exit', stop);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { stop(); process.exit(1); });

async function waitForServer(timeoutMs = 40000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      if ((await fetch(`http://127.0.0.1:${PORT}/`)).ok) return true;
    } catch { /* */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

async function seedAssembly(page) {
  await page.evaluate(async ({ doc }) => {
    localStorage.setItem('surfcadAgent', '1');
    localStorage.setItem('surfcad.lastAssembly', JSON.stringify({
      'user-agent-block-edit': {
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
  return page.evaluate(async ({ name, argsJson }) => {
    const env = await window.surfcad.call(name, argsJson);
    return env;
  }, { name, argsJson: JSON.stringify(args ?? {}) });
}

console.log('agent bridge block edit golden');
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
    user: { _id: 'user-agent-block-edit', email: 'agent@test.local' },
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

const cube = await agentCall(page, 'insert_cube', { width: 20, depth: 20, height: 20 });
check('insert 20³ cube', cube.ok === true && cube.result?.ok === true, JSON.stringify(cube));

const tree = await agentCall(page, 'feature_tree', {});
const chip = (tree.result?.features || []).find((f) => f.kind === 'cube');
check('cube chip', !!chip, JSON.stringify(tree));

const open = await agentCall(page, 'open_feature', { id: chip.id });
check('open_feature', open.ok === true, JSON.stringify(open));
await page.waitForTimeout(400);

await agentCall(page, 'edit_feature', { params: { x: 15, center: false } });
const confirm = await agentCall(page, 'confirm_feature', {});
check('confirm_feature', confirm.ok === true && confirm.result?.ok === true, JSON.stringify(confirm));

const src = await agentCall(page, 'get_script', {});
const text = src.result?.source || '';
check('script keeps 20³ and pose', /Manifold\.cube\(\[20, 20, 20\], false\)/.test(text)
  && /\.translate\(\[15, 0, 0\]\)/.test(text)
  && !/Manifold\.cube\(\[40, 30, 20\]/.test(text),
  text.slice(0, 280));

const st = await agentCall(page, 'status', {});
const bbox = st.result?.bbox;
check('status bbox reflects translate after confirm',
  bbox && Array.isArray(bbox.min) && bbox.min[0] > 4,
  JSON.stringify(bbox));

await page.screenshot({ path: `${SHOT_DIR}/agent-bridge-block-edit-1280.png` });
await browser.close();
stop();

if (failed) {
  console.log(`\n${failed} failed`);
  process.exit(1);
}
console.log('\nall passed');

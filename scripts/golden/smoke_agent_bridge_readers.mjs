#!/usr/bin/env node
/**
 * Agent bridge H2 readers must read live App / Viewport state, not stub fallbacks.
 *
 * Production preview at 1280 with `?agent=1`. Builds a box, adds a hole, then
 * asserts feature_tree, parts, camera, mode, and dirty are populated.
 *
 * `npm run build` first. Chrome is the system binary (`CHROME_PATH`).
 */
/* global document, window, indexedDB, localStorage */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright-core';
import { attachConsentPresetToBrowser } from './lib/presetConsentInit.mjs';
import { wrapAgentCall } from '../playtest/lib/wrapAgentCall.mjs';

const SHOT_DIR = process.env.GOLDEN_SHOT_DIR || tmpdir();
const PORT = Number(process.env.SMOKE_PORT || 4319);
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

const HOLE = `// --- cube begin id=cube1 ---
let part = Manifold.cube([40, 30, 20], true);
// --- cube end ---
// --- hole begin id=hole1 ---
part = part.subtract(Manifold.cylinder(40, 6, 6, 48, true));
// --- hole end ---
return part;
`;

const SEED_SCRIPT = BOX;

const ASSEMBLY = {
  format: 'surfcad.assembly',
  v: 1,
  name: 'agent-readers',
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
  console.log('agent bridge readers: no system Chrome found — set CHROME_PATH. Skipping.');
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
      'user-agent-readers': {
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
  }, { doc: ASSEMBLY, script: SEED_SCRIPT });
}

// page.evaluate has no Playwright timeout. A call that never settles used to
// hold this step until the job was cancelled. The deadline is outside the
// page so a stuck main thread still fails here.
const CALL_TIMEOUT_MS = 90_000;
let browser = null;

async function rawAgentCall(page, name, args) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(
        `agent bridge readers: '${name}' did not return within ${CALL_TIMEOUT_MS / 1000}s`,
      ));
    }, CALL_TIMEOUT_MS);
  });
  let hung = null;
  try {
    return await Promise.race([
      page.evaluate(async ({ name: command, argsJson }) => {
        const env = await window.surfcad.call(command, argsJson);
        return env;
      }, { name, argsJson: JSON.stringify(args ?? {}) }),
      timeout,
    ]);
  } catch (err) {
    const message = String(err?.message || err);
    if (message.includes('did not return')) hung = message;
    else throw err;
  } finally {
    clearTimeout(timer);
  }
  console.log(`  ❌ ${hung}`);
  stop();
  if (browser) {
    await Promise.race([
      browser.close().catch(() => {}),
      new Promise((resolve) => setTimeout(resolve, 2000)),
    ]);
  }
  process.exit(1);
}
const agentCall = wrapAgentCall(rawAgentCall);

console.log('agent bridge readers golden');

if (!(await waitForServer())) {
  console.log('  ❌ preview server did not start');
  stop();
  process.exit(1);
}

browser = await chromium.launch({
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

// Every other /api call is answered here too. The Vite proxy forwards an
// unstubbed call to a backend on :3000 when one is running (a staging box),
// and that backend answers 401, which "no page errors" then catches. CI has
// no backend, so this keeps the golden's answer the same on both.
await page.route('**/api/**', (route) => route.fulfill({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({}),
}));
await page.route('**/api/auth/me', (route) => route.fulfill({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({
    authenticated: true,
    user: { _id: 'user-agent-readers', email: 'agent@test.local' },
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

const dirtyBefore = await agentCall(page, 'dirty', {});
check('dirty unsaved false before agent edit', dirtyBefore.ok === true
  && dirtyBefore.result?.unsaved === false,
  JSON.stringify(dirtyBefore.result));

const wrote = await agentCall(page, 'set_script', { source: BOX });
check('set_script box', wrote.ok === true && wrote.result?.ok === true, JSON.stringify(wrote));

const hole = await agentCall(page, 'set_script', { source: HOLE });
check('set_script hole', hole.ok === true && hole.result?.ok === true, JSON.stringify(hole));

const tree = await agentCall(page, 'feature_tree', {});
check('feature_tree two features', tree.ok === true && tree.result?.features?.length === 2,
  `count=${tree.result?.features?.length}`);

const parts = await agentCall(page, 'parts', {});
check('parts non-empty', parts.ok === true && parts.result?.parts?.length >= 1,
  JSON.stringify(parts.result));

const camera = await agentCall(page, 'camera', {});
check('camera position', camera.ok === true && Array.isArray(camera.result?.position)
  && camera.result.position.every((n) => Number.isFinite(n)),
  JSON.stringify(camera.result?.position));

const mode = await agentCall(page, 'mode', {});
check('mode app cad', mode.ok === true && mode.result?.app === 'cad', JSON.stringify(mode.result));

const selection = await agentCall(page, 'selection', {});
check('selection active part', selection.ok === true && selection.result?.activePartId != null,
  JSON.stringify(selection.result));
check('selection cadPartId', selection.ok === true && selection.result?.cadPartId != null,
  JSON.stringify(selection.result));

const dirtyAfter = await agentCall(page, 'dirty', {});
check('dirty unsaved after hole edit', dirtyAfter.ok === true
  && dirtyAfter.result?.unsaved === true
  && (dirtyAfter.result?.editedSinceLoad?.length ?? 0) >= 1,
  JSON.stringify(dirtyAfter.result));

check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
stop();

if (failed) {
  console.log(`agent bridge readers: ${failed} failed`);
  process.exit(1);
}
console.log('agent bridge readers: ok');

#!/usr/bin/env node
/**
 * Agent bridge H4: invoke_helper + list_feature_edges + boundary edge select.
 */
/* global document, window, indexedDB, localStorage */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright-core';

const SHOT_DIR = process.env.GOLDEN_SHOT_DIR || tmpdir();
const PORT = Number(process.env.SMOKE_PORT || 4321);
const APP_URL = `http://127.0.0.1:${PORT}/?agent=1`;

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].filter(Boolean);

const STARTER = `// --- cube begin id=seed ---
let part = Manifold.cube([40, 30, 20], true);
// --- cube end ---
part = part.subtract(Manifold.cylinder(10, 8, 8, 48, true));
return part;
`;

const ASSEMBLY = {
  format: 'surfcad.assembly',
  v: 1,
  name: 'agent-h4',
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
  console.log('agent bridge h4: no system Chrome found — set CHROME_PATH. Skipping.');
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
      'user-agent-h4': {
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
  }, { doc: ASSEMBLY, script: STARTER });
}

async function agentCall(page, name, args) {
  return page.evaluate(async ({ name, argsJson }) => {
    const env = await window.surfcad.call(name, argsJson);
    return env;
  }, { name, argsJson: JSON.stringify(args ?? {}) });
}

console.log('agent bridge h4 golden');

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
    user: { _id: 'user-agent-h4', email: 'agent@test.local' },
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

const ran = await agentCall(page, 'run', {});
check('seed run', ran.ok === true && ran.result?.ok === true, JSON.stringify(ran));

const rawBefore = await agentCall(page, 'list_edges', { raw: true });
const groupedBefore = await agentCall(page, 'list_feature_edges', {});
const rawN = rawBefore.result?.edges?.length ?? 0;
const groupedN = groupedBefore.result?.edges?.length ?? 0;
check('list_feature_edges << list_edges on box', groupedN > 0 && rawN > groupedN,
  `raw=${rawN} grouped=${groupedN}`);

const helper = await agentCall(page, 'invoke_helper', {
  id: 'cube',
  params: { width: 30, depth: 20, height: 10 },
});
check('invoke_helper cube', helper.ok === true && helper.result?.ok === true, JSON.stringify(helper));

const groupedAfter = await agentCall(page, 'list_feature_edges', {});
const groupedAfterN = groupedAfter.result?.edges?.length ?? 0;
check('grouped edge count after union', groupedAfterN >= groupedN,
  `grouped=${groupedAfterN}`);

const edgeKey = groupedAfter.result?.edges?.[0]?.key;
check('grouped key shape', typeof edgeKey === 'string' && /^e\d+$/.test(edgeKey), edgeKey);

const picked = await agentCall(page, 'select_edges', { keys: [edgeKey] });
check('select_edges via grouped key', picked.ok === true && (picked.result?.count ?? 0) >= 1,
  JSON.stringify(picked));

const alias = await agentCall(page, 'insert_cylinder', { height: 12, radius: 5 });
check('insert_cylinder alias', alias.ok === true && alias.result?.ok === true, JSON.stringify(alias));

await browser.close();
stop();

if (failed) {
  console.log(`agent bridge h4: ${failed} failed`);
  process.exit(1);
}
console.log('agent bridge h4: ok');

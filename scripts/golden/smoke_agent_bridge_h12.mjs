#!/usr/bin/env node
/**
 * Agent bridge H12: mock vault save, branch create/switch, confirm gate.
 */
/* global document, window, indexedDB, localStorage, sessionStorage */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const SHOT_DIR = process.env.GOLDEN_SHOT_DIR || tmpdir();
const PORT = Number(process.env.SMOKE_PORT || 4327);
const APP_URL = `http://127.0.0.1:${PORT}/?agent=1`;
const VAULT = 'agent-h12-vault';

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].filter(Boolean);

const ASSEMBLY = {
  format: 'surfcad.assembly',
  v: 1,
  name: 'agent-h12',
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
  console.log('agent bridge h12: no system Chrome found — set CHROME_PATH. Skipping.');
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
      'user-agent-h12': {
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
        tx.objectStore('parts').put({
          id: 'local:part1',
          script: `// --- cube begin ---
let part = Manifold.cube([30, 20, 8], true);
// --- cube end ---
return part;
`,
          savedAt: Date.now(),
        }, 'local:part1');
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
  writeFileSync(join(SHOT_DIR, `agent-bridge-h12-${label}-${width}.png`), buf);
}

console.log('agent bridge h12 golden');

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
    user: { _id: 'user-agent-h12', email: 'agent@test.local' },
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
await page.waitForTimeout(600);

const moved = await agentCall(page, 'git_move_to_repo', { vault_name: VAULT });
check('git_move_to_repo', moved.ok === true && moved.result?.status === 'moved', JSON.stringify(moved));

await agentCall(page, 'run', {});
const cur = await agentCall(page, 'get_script', {});
const edited = await agentCall(page, 'set_script', {
  source: `${cur.result?.source || ''}\n// h12 golden\n`,
});
check('set_script edit', edited.ok === true);
await agentCall(page, 'run', {});

const saved = await agentCall(page, 'git_save', { message: 'h12 golden save' });
check('git_save', saved.ok === true && ['committed', 'queued', 'clean'].includes(saved.result?.status), JSON.stringify(saved));

const created = await agentCall(page, 'git_branch_create', { name: 'feature/h12-golden' });
check('git_branch_create', created.ok === true && created.result?.status === 'created', JSON.stringify(created));

const switched = await agentCall(page, 'git_branch_switch', { branch: 'feature/h12-golden' });
check('git_branch_switch', switched.ok === true, JSON.stringify(switched));

const denied = await agentCall(page, 'git_branch_delete', { branch: 'feature/h12-golden' });
check('confirm_required', denied.ok === false && denied.error?.code === 'confirm_required', JSON.stringify(denied));

const kept = await agentCall(page, 'git_behind_resolve', { action: 'keep' });
check('git_behind_resolve keep (no marker)', kept.ok === false || kept.result?.status === 'error', JSON.stringify(kept));

await shot(page, 'after-git', 1280);
await shot(page, 'after-git', 390);

await browser.close();
stop();

if (failed) process.exit(1);
console.log('agent bridge h12: ok');

#!/usr/bin/env node
/**
 * Geometry PR 2: a kernel crash on one part fails fast with the structured
 * error, the worker is replaced, the other part keeps its mesh, and the next
 * run of the failed part works without a reload. Two parts through the agent
 * bridge on the Vite dev server. The crash is a simulated abort (a script
 * that throws WebAssembly.RuntimeError the way an Emscripten abort does);
 * the real out-of-memory abort is golden:kernel-crash-headless.
 * Chrome from CHROME_PATH or the usual paths.
 */
/* global document, window */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { attachConsentPresetToBrowser } from './lib/presetConsentInit.mjs';

const PORT = Number(process.env.SMOKE_PORT || 4347);
const APP_URL = `http://127.0.0.1:${PORT}/?agent=1`;
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
  console.log('geometry worker crash golden: no system Chrome found — set CHROME_PATH. Skipping.');
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

const CUBE = 'let part = Manifold.cube([20, 20, 20], true);\nreturn part;\n';
// The worker classifies a WebAssembly.RuntimeError as the kernel dying, the
// same as the RuntimeError an Emscripten abort() throws.
const CRASH = 'let part = Manifold.cube([10, 10, 10], true);\nthrow new WebAssembly.RuntimeError("Aborted(). Build with -sASSERTIONS for more info.");\n';
// A pure CPU loop: no handles, so it never runs out of memory; only the watchdog ends it.
const HANG = 'let part = Manifold.cube([10, 10, 10], true);\nlet n = 0;\nfor (;;) { n = (n + 1) % 7; }\n';

console.log('geometry worker crash golden');
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
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const pageErrors = [];
page.on('pageerror', (err) => pageErrors.push(err.message));
await page.route('**/api/auth/me', (route) => route.fulfill({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({ authenticated: true, user: { _id: 'user-worker-crash', email: 'agent@test.local' } }),
}));
await page.route('**/api/config', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));

await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(
  () => typeof window.surfcad?.call === 'function' && !document.querySelector('[data-app-loading]'),
  { timeout: 120000 },
);
await page.waitForSelector('[data-cad-run]', { state: 'attached', timeout: 120000 });

const created = await agentCall(page, 'create_assembly', {});
check('create_assembly', created.ok === true, JSON.stringify(created));
const firstId = (await agentCall(page, 'parts', {})).result?.activeId;
const seeded = await agentCall(page, 'set_script', { part_id: firstId, source: CUBE });
check('first part builds', seeded.ok === true && seeded.result?.ok === true && seeded.result?.status?.runState === 'ok', JSON.stringify(seeded.result?.status));

const second = await agentCall(page, 'create_part', { name: 'Crasher' });
check('create_part', second.ok === true && typeof second.result?.partId === 'string', JSON.stringify(second));
const crasherId = second.result?.partId;

// The crash: fast, structured, and the worker is replaced.
const t0 = Date.now();
const crashed = await agentCall(page, 'set_script', { part_id: crasherId, source: CRASH });
const crashMs = Date.now() - t0;
check('set_script returns within 2 s of the abort', crashMs < 2000 + 3000, `${crashMs} ms`);
check('the result is ok: false with the crash record', crashed.ok === true && crashed.result?.ok === false && crashed.result?.crash?.code === 'geometry_worker_crashed', JSON.stringify(crashed.result));
check('crash reason is wasm_abort and the worker was restarted', crashed.result?.crash?.reason === 'wasm_abort' && crashed.result?.crash?.workerRestarted === true, JSON.stringify(crashed.result?.crash));
check('status is failed', crashed.result?.status?.runState === 'failed', JSON.stringify(crashed.result?.status));
const errors = await agentCall(page, 'errors', {});
const row = (errors.result?.errors || [])[0];
check('errors is one geometry_worker_crashed row with reason and detail', row?.code === 'geometry_worker_crashed' && row.reason === 'wasm_abort' && row.workerRestarted === true && /Simplify/.test(row.detail || ''), JSON.stringify(errors.result));
check('the message says the engine restarted and other parts are unaffected', /restarted/.test(row?.message || '') && /other parts/.test(row?.message || ''), row?.message);

// Every part's state is visible without activating it.
const parts = await agentCall(page, 'parts', {});
const rows = parts.result?.parts || [];
const firstRow = rows.find((r) => r.id === firstId);
const crashRow = rows.find((r) => r.id === crasherId);
check('parts: the first part is ok, the crashed part is failed with the crash', firstRow?.runState === 'ok' && crashRow?.runState === 'failed' && crashRow?.crash?.code === 'geometry_worker_crashed', JSON.stringify(rows));

// The other part still has its mesh and still accepts edits.
await agentCall(page, 'set_active_part', { part_id: firstId });
const firstStatus = await agentCall(page, 'status', {});
check('the first part kept its run', firstStatus.result?.runState === 'ok' && Math.abs((firstStatus.result?.volume || 0) - 8000) < 1, JSON.stringify(firstStatus.result));
const edited = await agentCall(page, 'set_script', { part_id: firstId, source: 'let part = Manifold.cube([30, 20, 20], true);\nreturn part;\n' });
check('the first part builds again on the fresh worker', edited.ok === true && edited.result?.ok === true && Math.abs((edited.result?.status?.volume || 0) - 12000) < 1, JSON.stringify(edited.result?.status));

// Fix the crashed part: it runs in the new worker, no reload.
await agentCall(page, 'set_active_part', { part_id: crasherId });
const fixed = await agentCall(page, 'set_script', { part_id: crasherId, source: CUBE });
check('the crashed part builds after the fix', fixed.ok === true && fixed.result?.ok === true && fixed.result?.status?.runState === 'ok', JSON.stringify(fixed.result?.status));
check('errors cleared', ((await agentCall(page, 'errors', {})).result?.errors || []).length === 0);
const rows2 = (await agentCall(page, 'parts', {})).result?.parts || [];
check('parts: no crash left on the fixed part', rows2.find((r) => r.id === crasherId)?.runState === 'ok' && !rows2.find((r) => r.id === crasherId)?.crash, JSON.stringify(rows2));

// A run past its budget is killed by the watchdog, not left holding the thread.
await page.evaluate(() => { window.ManifoldContext?.worker?.configure?.({ jobBudgetMs: 3000 }); });
const t1 = Date.now();
const hung = await agentCall(page, 'set_script', { part_id: crasherId, source: HANG });
const hungMs = Date.now() - t1;
check('a hung script fails as timeout within budget + 2 s', hung.ok === true && hung.result?.ok === false && hung.result?.crash?.reason === 'timeout' && hungMs < 3000 + 2000 + 2000, `${hungMs} ms ${JSON.stringify(hung.result?.crash)}`);
const afterHang = await agentCall(page, 'set_script', { part_id: crasherId, source: CUBE });
check('the part builds again after the watchdog', afterHang.ok === true && afterHang.result?.ok === true, JSON.stringify(afterHang.result?.status));
await page.evaluate(() => { window.ManifoldContext?.worker?.configure?.({ jobBudgetMs: 0 }); });

check('no page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));

await browser.close();
stop();
if (failed) {
  console.log(`geometry worker crash golden: FAIL (${failed})`);
  process.exit(1);
}
console.log('geometry worker crash golden: ok');

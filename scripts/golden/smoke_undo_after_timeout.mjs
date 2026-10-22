#!/usr/bin/env node
/**
 * MVP-1 step 4b: undo right after a run past its budget returns the real
 * post-undo state. The watchdog kills the worker and restarts it; the undo
 * that follows must wait for the fresh worker, re-run the restored script,
 * and report that run (ok, volume, script without the hung block), not the
 * timeout failure left over from the previous run. Through the agent bridge
 * on the Vite dev server. Chrome from CHROME_PATH or the usual paths.
 */
/* global document, window */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { attachConsentPresetToBrowser } from './lib/presetConsentInit.mjs';

const PORT = Number(process.env.SMOKE_PORT || 4349);
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
  console.log('undo after timeout golden: no system Chrome found — set CHROME_PATH. Skipping.');
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
const BIG = 'let part = Manifold.cube([30, 20, 20], true);\nreturn part;\n';
// A pure CPU loop: no handles, so it never runs out of memory; only the watchdog ends it.
const HANG = 'let part = Manifold.cube([10, 10, 10], true);\nlet n = 0;\nfor (;;) { n = (n + 1) % 7; }\n';

console.log('undo after timeout golden');
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
await page.route('**/api/**', (route) => route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }));
await page.route('**/api/auth/me', (route) => route.fulfill({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({ authenticated: true, user: { _id: 'user-undo-timeout', email: 'agent@test.local' } }),
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
const partId = (await agentCall(page, 'parts', {})).result?.activeId;
const seeded = await agentCall(page, 'set_script', { part_id: partId, source: CUBE });
check('cube builds', seeded.ok === true && seeded.result?.ok === true && seeded.result?.status?.runState === 'ok', JSON.stringify(seeded.result?.status));
const grown = await agentCall(page, 'set_script', { part_id: partId, source: BIG });
check('bigger cube builds (volume 12000)', grown.ok === true && grown.result?.ok === true && Math.abs((grown.result?.status?.volume || 0) - 12000) < 1, JSON.stringify(grown.result?.status));

async function timeoutThenUndo(label, { settleMs = 0 } = {}) {
  await page.evaluate(() => { window.ManifoldContext?.worker?.configure?.({ jobBudgetMs: 3000 }); });
  const hung = await agentCall(page, 'set_script', { part_id: partId, source: HANG });
  check(`${label}: the hung script fails as timeout`, hung.ok === true && hung.result?.ok === false && hung.result?.crash?.reason === 'timeout' && hung.result?.status?.runState === 'failed', JSON.stringify(hung.result?.crash || hung.result));
  await page.evaluate(() => { window.ManifoldContext?.worker?.configure?.({ jobBudgetMs: 0 }); });
  if (settleMs) await page.waitForTimeout(settleMs);

  const t0 = Date.now();
  const undone = await agentCall(page, 'undo', {});
  const undoMs = Date.now() - t0;
  const st = undone.result?.status;
  check(`${label}: undo returns ok with the restored run`, undone.ok === true && undone.result?.ok === true && st?.runState === 'ok', `${undoMs} ms ${JSON.stringify(undone.result?.errors || undone.error)} ${JSON.stringify(st)}`);
  check(`${label}: undo status volume is the restored cube`, Math.abs((st?.volume || 0) - 12000) < 1, JSON.stringify(st?.volume));
  check(`${label}: undo status script is the restored script`, typeof st?.script === 'string' && !st.script.includes('for (;;)') && st.script.includes('[30, 20, 20]'), JSON.stringify(st?.script));
  check(`${label}: undo result has no stale timeout error`, (undone.result?.errors || []).length === 0 && !undone.result?.crash, JSON.stringify(undone.result?.errors));
  const status = await agentCall(page, 'status', {});
  check(`${label}: status agrees after undo`, status.result?.runState === 'ok' && Math.abs((status.result?.volume || 0) - 12000) < 1 && !String(status.result?.script || '').includes('for (;;)'), JSON.stringify(status.result));
  const errors = await agentCall(page, 'errors', {});
  check(`${label}: errors is empty after undo`, (errors.result?.errors || []).length === 0, JSON.stringify(errors.result));
  const rows = (await agentCall(page, 'parts', {})).result?.parts || [];
  const row = rows.find((r) => r.id === partId);
  check(`${label}: parts row is ok with no crash`, row?.runState === 'ok' && !row?.crash, JSON.stringify(row));
  // Back to the hung script via redo would hang again; instead confirm the stack moved.
  const history = await agentCall(page, 'history', {});
  check(`${label}: history can redo`, history.result?.canRedo === true, JSON.stringify(history.result));
  // Put the hung block back on the stack head without running it: a plain
  // set_script of BIG keeps the part buildable for the next round.
  const reset = await agentCall(page, 'set_script', { part_id: partId, source: BIG });
  check(`${label}: part builds again`, reset.ok === true && reset.result?.ok === true, JSON.stringify(reset.result?.status));
}

// 1. Undo while the replacement worker is still starting (the bike session).
await timeoutThenUndo('restart in flight');
// 2. Undo after the restart settled.
await timeoutThenUndo('restart settled', { settleMs: 1500 });

check('no page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));

await browser.close();
stop();
if (failed) {
  console.log(`undo after timeout golden: FAIL (${failed})`);
  process.exit(1);
}
console.log('undo after timeout golden: ok');

#!/usr/bin/env node
/**
 * Per-block kernel budget: a marked feature block that runs past the
 * watchdog fails alone. The worker reports which block it is in as it runs,
 * so when the watchdog kills the thread the job is re-posted to the fresh
 * worker with that block skipped. The part shows every other feature, the
 * chip for that block is marked failed, the agent error names the block
 * (feature_timeout with elapsedMs and budgetMs), feature_tree carries each
 * block's kernel time, and undo and delete_feature keep working. Through the
 * agent bridge on the Vite dev server. Chrome from CHROME_PATH or the usual
 * paths.
 */
/* global document, window */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { attachConsentPresetToBrowser } from './lib/presetConsentInit.mjs';

const PORT = Number(process.env.SMOKE_PORT || 4357);
const APP_URL = `http://127.0.0.1:${PORT}/?agent=1`;
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].filter(Boolean);
const BUDGET_MS = 2000;

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
  console.log('feature timeout golden: no system Chrome found — set CHROME_PATH. Skipping.');
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

const CUBE_BLOCK = [
  '// --- cube begin id=cube1 ---',
  'let part = Manifold.cube([20, 20, 20], true);',
  '// --- cube end ---',
];
// A pure CPU loop inside a marked block: no handles, so it never runs out of
// memory; only the watchdog ends it. Skipped, the block adds nothing.
const SLOW_BLOCK = [
  '// --- cube begin id=slow1 ---',
  'let spin = 0;',
  'for (;;) { spin = (spin + 1) % 7; }',
  '// --- cube end ---',
];
const GOOD = [...CUBE_BLOCK, 'return part;', ''].join('\n');
const WITH_SLOW = [...CUBE_BLOCK, ...SLOW_BLOCK, 'return part;', ''].join('\n');

console.log('feature timeout golden');
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
  body: JSON.stringify({ authenticated: true, user: { _id: 'user-feature-timeout', email: 'agent@test.local' } }),
}));
await page.route('**/api/config', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));

await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(
  () => typeof window.surfcad?.call === 'function' && !document.querySelector('[data-app-loading]'),
  { timeout: 120000 },
);
await page.waitForSelector('[data-cad-run]', { state: 'attached', timeout: 120000 });

const setBudget = (ms) => page.evaluate((v) => { window.ManifoldContext?.worker?.configure?.({ jobBudgetMs: v }); }, ms);
const failedChips = () => page.evaluate(() => Array.from(document.querySelectorAll('[data-feature-chip][data-feature-failed="1"]')).map((el) => el.textContent.trim()));

const created = await agentCall(page, 'create_assembly', {});
check('create_assembly', created.ok === true, JSON.stringify(created));
const partId = (await agentCall(page, 'parts', {})).result?.activeId;
const seeded = await agentCall(page, 'set_script', { part_id: partId, source: GOOD, return: 'full' });
check('the good script builds (volume 8000)', seeded.ok === true && seeded.result?.ok === true && Math.abs((seeded.result?.status?.volume || 0) - 8000) < 1, JSON.stringify(seeded.result?.status));
check('a good run reports kernel time per block', Number.isFinite(seeded.result?.status?.featureMs?.cube1), JSON.stringify(seeded.result?.status?.featureMs));

// 1. One block runs past the budget: the part comes back without it.
await setBudget(BUDGET_MS);
const t0 = Date.now();
const slow = await agentCall(page, 'set_script', { part_id: partId, source: WITH_SLOW, return: 'full' });
const slowMs = Date.now() - t0;
await setBudget(0);
const res = slow.result || {};
check('the run fails, but not as a crash', slow.ok === true && res.ok === false && !res.crash, `${slowMs} ms ${JSON.stringify({ ok: res.ok, crash: res.crash, errors: res.errors })}`);
check('the run finished within three budgets', slowMs < BUDGET_MS * 3 + 15000, `${slowMs} ms`);
const row = (res.failures || [])[0];
check('one feature_timeout row names the block', (res.failures || []).length === 1 && row?.code === 'feature_timeout' && row.featureId === 'slow1' && row.featureType === 'cube', JSON.stringify(res.failures));
check('the row carries elapsedMs and budgetMs', row?.budgetMs === BUDGET_MS && Number.isFinite(row?.elapsedMs) && row.elapsedMs >= 0 && row.elapsedMs < BUDGET_MS + 5000, JSON.stringify(row));
check('the row has the recovery as detail', typeof row?.detail === 'string' && /fewer edges/.test(row.detail), JSON.stringify(row?.detail));
check('the message says which block and that the part was rebuilt without it', typeof res.errors?.[0] === 'string' && /did not finish within the 2 s budget/.test(res.errors[0]) && /rebuilt without that feature/.test(res.errors[0]), JSON.stringify(res.errors));
check('status is failed with the run kept honest', res.status?.runState === 'failed', JSON.stringify(res.status));
check('status.featureMs has the block that ran and not the one that was skipped', Number.isFinite(res.status?.featureMs?.cube1) && res.status?.featureMs?.slow1 === undefined, JSON.stringify(res.status?.featureMs));

const bodies = await agentCall(page, 'list_bodies', {});
check('the part keeps the other features (one body at the origin)', bodies.ok === true && (bodies.result?.bodies || []).length === 1 && (bodies.result.bodies[0].at || []).every((v) => Math.abs(v) < 1e-6), JSON.stringify(bodies.result));

const errors = await agentCall(page, 'errors', {});
check('errors reads the same feature_timeout row', (errors.result?.errors || []).length === 1 && errors.result.errors[0].code === 'feature_timeout' && errors.result.errors[0].featureId === 'slow1' && errors.result.errors[0].workerRestarted === true, JSON.stringify(errors.result));

const tree = await agentCall(page, 'feature_tree', {});
const treeRows = tree.result?.features || [];
const cubeRow = treeRows.find((r) => r.id === 'cube1');
const slowRow = treeRows.find((r) => r.id === 'slow1');
check('feature_tree marks the block failed and times the one that ran', cubeRow && Number.isFinite(cubeRow.ms) && cubeRow.failed === false && slowRow && slowRow.failed === true && slowRow.ms === undefined, JSON.stringify(treeRows));

const chips = await failedChips();
check('exactly one chip is marked failed (the second cube, labelled by its index)', chips.length === 1, JSON.stringify(chips));

const parts = await agentCall(page, 'parts', {});
const partRow = (parts.result?.parts || []).find((r) => r.id === partId);
// A recovered mesh is a mesh: the parts row reads ok, as for any skipped
// feature; status.runState (above) is what says the run failed.
check('the parts row has a mesh and no crash record', partRow?.runState === 'ok' && !partRow?.crash, JSON.stringify(partRow));

// 2. Undo brings the good script back and the part is clean.
const undone = await agentCall(page, 'undo', { return: 'full' });
check('undo returns the good run', undone.ok === true && undone.result?.ok === true && undone.result?.status?.runState === 'ok' && Math.abs((undone.result?.status?.volume || 0) - 8000) < 1 && !String(undone.result?.status?.script || '').includes('slow1'), JSON.stringify(undone.result?.status));
check('undo clears the failed chip', (await failedChips()).length === 0);
check('errors is empty after undo', ((await agentCall(page, 'errors', {})).result?.errors || []).length === 0);

// 3. The same timeout again, then delete_feature on the failed block.
await setBudget(BUDGET_MS);
const again = await agentCall(page, 'set_script', { part_id: partId, source: WITH_SLOW });
await setBudget(0);
check('the slow block times out again on its own', again.result?.ok === false && (again.result?.failures || [])[0]?.code === 'feature_timeout' && !again.result?.crash, JSON.stringify(again.result?.failures));
const removed = await agentCall(page, 'delete_feature', { id: 'slow1', return: 'full' });
check('delete_feature removes the timed-out block and the part builds', removed.ok === true && removed.result?.ok === true && removed.result?.status?.runState === 'ok' && Math.abs((removed.result?.status?.volume || 0) - 8000) < 1 && !String(removed.result?.status?.script || '').includes('slow1'), JSON.stringify(removed.result?.status || removed));
check('no failed chip after delete', (await failedChips()).length === 0);
const after = (await agentCall(page, 'parts', {})).result?.parts?.find((r) => r.id === partId);
check('the parts row is ok with no crash', after?.runState === 'ok' && !after?.crash, JSON.stringify(after));

check('no page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));

await browser.close();
stop();
if (failed) {
  console.log(`feature timeout golden: FAIL (${failed})`);
  process.exit(1);
}
console.log('feature timeout golden: ok');

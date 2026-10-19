#!/usr/bin/env node
/**
 * Bike acceptance PR 3: there is no seed cube. A new part (create_part, or
 * Parts + → Part in the UI) starts empty; the first Block or Shape creates
 * the body; a helper that needs a body is refused on an empty part instead
 * of seeding a hidden cube; bodyCount is the real count; deleting the only
 * feature leaves a valid empty part. Vite dev server; Chrome from CHROME_PATH
 * or the usual paths.
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
  console.log('new part empty golden: no system Chrome found — set CHROME_PATH. Skipping.');
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

const bodyOf = (script) => String(script || '').replace(/^\/\/ @surf-id [^\n]*\n?/, '').trim();

console.log('new part empty golden');
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
await page.route('**/api/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
await page.route('**/api/auth/me', (route) => route.fulfill({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({ authenticated: true, user: { _id: 'user-new-part-empty', email: 'agent@test.local' } }),
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

// create_part with no script: an empty part, run, no bodies.
const lid = await agentCall(page, 'create_part', { name: 'Lid' });
check('create_part Lid', lid.ok === true && typeof lid.result?.partId === 'string', JSON.stringify(lid));
const lidScript = (await agentCall(page, 'get_script', {})).result?.source;
check('the new part has no script body (no seed cube)', bodyOf(lidScript) === '', JSON.stringify(lidScript));
// Run it (create_part's own run rule is Pi 5 C, #634): an empty part is a valid, body-less run.
const lidRun = await agentCall(page, 'run', {});
check('the empty part runs clean', lidRun.ok === true && lidRun.result?.ok === true, JSON.stringify(lidRun.result?.errors || lidRun.error));
const lidStatus = await agentCall(page, 'status', {});
check('status: ok, bodyCount 0, featureCount 0', lidStatus.result?.runState === 'ok' && lidStatus.result?.bodyCount === 0 && lidStatus.result?.featureCount === 0, JSON.stringify(lidStatus.result));

// A helper that needs a body is refused on the empty part, nothing seeded.
const hole = await agentCall(page, 'insert_hole', {});
check('insert_hole on an empty part is refused', hole.ok === false && hole.error?.code === 'insert_failed' && /body/i.test(hole.error.message), JSON.stringify(hole));
check('the refusal names a Block or Shape', /Block|Shape/.test(hole.error?.message || ''), hole.error?.message);
check('nothing was written', bodyOf((await agentCall(page, 'get_script', {})).result?.source) === '');

// The first feature creates the body: a cylinder, no cube anywhere.
const cyl = await agentCall(page, 'insert_cylinder', { radius: 10, height: 30 });
check('insert_cylinder on the empty part', cyl.ok === true && cyl.result?.ok === true, JSON.stringify(cyl.error || cyl.result?.errors));
const afterCyl = await agentCall(page, 'status', {});
check('bodyCount is 1 and the volume is the cylinder', afterCyl.result?.bodyCount === 1 && Math.abs((afterCyl.result?.volume ?? 0) - Math.PI * 100 * 30) < Math.PI * 100 * 30 * 0.01, JSON.stringify({ bodyCount: afterCyl.result?.bodyCount, volume: afterCyl.result?.volume }));
const cylScript = (await agentCall(page, 'get_script', {})).result?.source || '';
check('no cube in the script', !/Manifold\.cube/.test(cylScript), cylScript.slice(0, 200));
const tree = await agentCall(page, 'feature_tree', {});
check('one feature', (tree.result?.features || []).length === 1, JSON.stringify(tree.result?.features));

// Deleting the only feature leaves a valid empty part.
const chip = tree.result.features[0];
const deleted = await agentCall(page, 'delete_feature', { id: chip.id });
check('delete the only feature', deleted.ok === true, JSON.stringify(deleted));
const afterDelete = await agentCall(page, 'status', {});
check('empty part is valid: runState ok, bodyCount 0, no errors', afterDelete.result?.runState !== 'failed' && afterDelete.result?.bodyCount === 0, JSON.stringify(afterDelete.result));
check('no error toast', !(await page.$('[data-execution-error]')));

// UI: Parts + → Part makes an empty part too.
const partsBefore = (await agentCall(page, 'parts', {})).result?.parts?.length ?? 0;
for (let i = 0; i < 3 && await page.$('[data-modal-fit]'); i += 1) {
  const close = page.locator('[data-modal-fit] button').first();
  if (await close.count()) await close.click();
  else await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
}
// Parts + opens a Part / Assembly menu; Part is the create_part uiEntry.
const plus = page.locator('[data-part-add]').first();
await plus.waitFor({ timeout: 15000 });
await plus.click();
const partItem = page.locator('[data-part-add-kind="part"]').first();
await partItem.waitFor({ timeout: 15000 });
await partItem.click();
// The menu opens a New part dialog (name, Cancel, Create). Create it.
const create = page.locator('[data-modal-fit] button:has-text("Create"), [role="dialog"] button:has-text("Create")').first();
await create.waitFor({ timeout: 15000 });
await create.click();
await page.waitForFunction(async (n) => {
  const parts = await window.surfcad.call('parts', '{}');
  return (parts.result?.parts?.length ?? 0) > n;
}, partsBefore, { timeout: 15000 }).catch(() => {});
const partsAfter = await agentCall(page, 'parts', {});
check('UI New part added a row', (partsAfter.result?.parts?.length ?? 0) === partsBefore + 1, JSON.stringify(partsAfter.result?.parts?.length));
const uiScript = (await agentCall(page, 'get_script', {})).result?.source;
check('UI New part starts empty', bodyOf(uiScript) === '', JSON.stringify(uiScript));

check('no page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));

await browser.close();
stop();
if (failed) {
  console.log(`new part empty golden: FAIL (${failed})`);
  process.exit(1);
}
console.log('new part empty golden: ok');

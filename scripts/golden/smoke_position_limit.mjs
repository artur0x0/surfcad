#!/usr/bin/env node
/**
 * Bike acceptance PR 2: feature positions are no longer capped at ±500 mm.
 * A cube at Z = 600 and Z = 2000 builds through the agent and through the
 * cube card's typed Pos Z box; ±1,000,000 mm is the limit, NaN and Infinity
 * are refused. Vite dev server; Chrome from CHROME_PATH or the usual paths.
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
  console.log('position limit golden: no system Chrome found — set CHROME_PATH. Skipping.');
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

// An insert result carries status under result.status; the status command under result.
const zMax = (env) => (env?.result?.status?.bbox ?? env?.result?.bbox)?.max?.[2];

console.log('position limit golden');
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
// Every other API call answers empty: a live backend behind the dev proxy
// would 401 and open the Login modal over the rail. Later routes win.
await page.route('**/api/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
await page.route('**/api/auth/me', (route) => route.fulfill({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({ authenticated: true, user: { _id: 'user-position-limit', email: 'agent@test.local' } }),
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
await agentCall(page, 'set_script', { part_id: partId, source: '' });

// Agent: Z = 600 and Z = 2000.
const at600 = await agentCall(page, 'insert_cube', { width: 20, depth: 20, height: 20, center: true, z: 600 });
check('agent insert_cube at Z = 600', at600.ok === true && at600.result?.ok === true, JSON.stringify(at600.error || at600.result?.errors));
check('bbox top at 610', Math.abs((zMax(at600) ?? 0) - 610) < 1e-3, JSON.stringify(at600.result?.status?.bbox));
await agentCall(page, 'set_script', { part_id: partId, source: '' });
const at2000 = await agentCall(page, 'insert_cube', { width: 20, depth: 20, height: 20, center: true, z: 2000 });
check('agent insert_cube at Z = 2000', at2000.ok === true && at2000.result?.ok === true, JSON.stringify(at2000.error || at2000.result?.errors));
check('bbox top at 2010', Math.abs((zMax(at2000) ?? 0) - 2010) < 1e-3, JSON.stringify(at2000.result?.status?.bbox));

// Agent: the limit, NaN, Infinity.
const far = await agentCall(page, 'insert_cube', { z: 1000001 });
check('agent refuses Z beyond ±1,000,000', far.ok === false && far.error?.code === 'bad_args' && /1000000/.test(far.error.message), JSON.stringify(far));
const nan = await page.evaluate(async () => window.surfcad.call('insert_cube', '{"z": NaN}'));
check('agent refuses NaN', nan.ok === false, JSON.stringify(nan));
const inf = await page.evaluate(async () => window.surfcad.call('insert_cube', { z: Infinity }));
check('agent refuses Infinity', inf.ok === false, JSON.stringify(inf));
const moveFar = await agentCall(page, 'insert_move', { body_index: 0, dx: 2000000 });
check('agent refuses a move delta beyond the limit', moveFar.ok === false && moveFar.error?.code === 'bad_args', JSON.stringify(moveFar));

// UI: the cube card's typed Pos Z box takes 2000.
await agentCall(page, 'set_script', { part_id: partId, source: '' });
// A Login modal can be up in this headless session; it is not what this
// golden tests. Close it before touching the rail.
for (let i = 0; i < 3 && await page.$('[data-modal-fit]'); i += 1) {
  const close = page.locator('[data-modal-fit] button').first();
  if (await close.count()) await close.click();
  else await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
}
check('no modal over the rail', !(await page.$('[data-modal-fit]')));
await page.locator('[data-ui-action="cube"]').first().click();
const posZ = page.locator('[data-feature-card] input[type="number"][data-field-label="Pos Z"]').first();
await posZ.waitFor({ timeout: 15000 });
await posZ.fill('2000');
await posZ.dispatchEvent('change');
await page.locator('[data-feature-card] [data-feature-card-confirm]').first().click();
await page.waitForFunction(async () => {
  const src = await window.surfcad.call('get_script', '{}');
  return /translate\(\[0, 0, 2000\]\)/.test(src.result?.source || '');
}, null, { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(800);
check('UI script carries the 2000 mm translate', /translate\(\[0, 0, 2000\]\)/.test((await agentCall(page, 'get_script', {})).result?.source || ''));
check('UI confirm raised no error toast', !(await page.$('[data-execution-error]')));
// The bridge caches status from its own runs; re-run the UI's script to read the bbox.
const uiRun = await agentCall(page, 'run', {});
// Typing a position clears Centered on the card, so the default 40×30×20
// cube spans z = 2000..2020.
const uiBox = uiRun.result?.status?.bbox;
check('UI card: cube at Pos Z 2000 builds', uiRun.result?.ok === true && Math.abs((uiBox?.min?.[2] ?? 0) - 2000) < 1e-3 && Math.abs((uiBox?.max?.[2] ?? 0) - 2020) < 1e-3, JSON.stringify(uiBox || uiRun.result?.errors));

check('no page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));

await browser.close();
stop();
if (failed) {
  console.log(`position limit golden: FAIL (${failed})`);
  process.exit(1);
}
console.log('position limit golden: ok');

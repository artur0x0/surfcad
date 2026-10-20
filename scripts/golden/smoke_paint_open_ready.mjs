#!/usr/bin/env node
/**
 * Bike joints acceptance 4: paint_open right after create_part or
 * set_active_part gives a working paint session, with no retry.
 *   - create_part → paint_open → paint_part → paint_state.pendingCount 1
 *   - set_active_part → paint_open → open, paint_state open
 *   - paint_open never answers open: false (an error names the reason)
 *
 * Runs the app on the Vite dev server. Chrome from CHROME_PATH or the usual paths.
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
  console.log('paint open ready golden: no system Chrome found — set CHROME_PATH. Skipping.');
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

const CUBE = 'let part = Manifold.cube([40, 30, 20], true);\nreturn part;\n';

console.log('paint open ready golden');
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
  body: JSON.stringify({ authenticated: true, user: { _id: 'user-paint-open', email: 'agent@test.local' } }),
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
check('first part script', seeded.ok === true && seeded.result?.ok === true, JSON.stringify(seeded));

// create_part → paint_open straight away.
const lid = await agentCall(page, 'create_part', { name: 'Lid', script: CUBE });
check('create_part Lid', lid.ok === true && typeof lid.result?.partId === 'string', JSON.stringify(lid));
const open1 = await agentCall(page, 'paint_open', {});
check('paint_open right after create_part opens', open1.ok === true && open1.result?.open === true, JSON.stringify(open1));
check('paint_open never answers open: false', !(open1.ok === true && open1.result?.open === false), JSON.stringify(open1));
const painted = await agentCall(page, 'paint_part', {});
check('paint_part on the new part works', painted.ok === true && painted.result?.ok === true, JSON.stringify(painted));
const state1 = await agentCall(page, 'paint_state', {});
check('paint_state is open with one pending paint', state1.result?.open === true && state1.result?.pendingCount === 1, JSON.stringify(state1.result));
const cancel1 = await agentCall(page, 'paint_cancel', {});
check('paint_cancel', cancel1.ok === true, JSON.stringify(cancel1));

// set_active_part → paint_open straight away.
const back = await agentCall(page, 'set_active_part', { part_id: firstId });
check('set_active_part first', back.ok === true, JSON.stringify(back));
const open2 = await agentCall(page, 'paint_open', {});
check('paint_open right after set_active_part opens', open2.ok === true && open2.result?.open === true, JSON.stringify(open2));
const state2 = await agentCall(page, 'paint_state', {});
check('paint_state open after the switch', state2.result?.open === true, JSON.stringify(state2.result));
const again = await agentCall(page, 'paint_open', {});
check('a second paint_open says already', again.result?.open === true && again.result?.already === true, JSON.stringify(again));
await agentCall(page, 'paint_cancel', {});

check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));

await browser.close();
stop();
if (failed) {
  console.log(`paint open ready golden: ${failed} failed`);
  process.exit(1);
}
console.log('paint open ready golden: all passed');

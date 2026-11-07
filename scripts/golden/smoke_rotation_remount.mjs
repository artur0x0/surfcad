#!/usr/bin/env node
/**
 * Rotation across the 768px breakpoint (an iPhone turning sideways) swaps
 * the responsive shells, which remounts Viewport, CodeEditor and
 * PromptInput. Brief: ios-rotation-chat-assembly, 2026-11-06. This golden
 * resizes 1280 → 390 → 1280 (desktop, phone, desktop) and checks that
 * these survive both swaps:
 *  - the chat: messages, the composer draft (DEV echo stub);
 *  - the active part's live script, including an edit the open-time seed
 *    does not have, and the active part id (the stale seed must not be
 *    written back into the script);
 *  - the placed solids (data-assembly-solids) and the camera pose;
 *  - no rerun (the run counter does not move).
 * Emulated resize is not physical iOS; the physical repro is separate.
 * Chrome from CHROME_PATH or the usual paths.
 */
/* global document, window */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { attachConsentPresetToBrowser } from './lib/presetConsentInit.mjs';

const PORT = Number(process.env.SMOKE_PORT || 4397);
// The DEV demo pin shows the prompt with the echo stub and an empty chat;
// without a pairing the prompt would not mount at all.
const APP_URL = `http://127.0.0.1:${PORT}/?agentPromptDemo=1&agentPromptState=idle`;
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
  console.log('rotation remount golden: no system Chrome found — set CHROME_PATH. Skipping.');
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

const SCRIPT_A = 'let part = Manifold.cube([20, 20, 20], true);\nreturn part;';
const SCRIPT_B = 'let part = Manifold.cube([20, 20, 30], true);\nreturn part;';

console.log('rotation remount golden');
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
const pageErrors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (err) => pageErrors.push(err.message));
  await page.route('**/api/auth/me', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ authenticated: false }) }));
  await page.route('**/api/config', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));

  const agentCall = (name, args) => page.evaluate(
    async ({ name, argsJson }) => window.surfcad.call(name, argsJson),
    { name, argsJson: JSON.stringify(args ?? {}) },
  );
  // get_script returns the stamped source (a // @surf-id header); compare the body.
  const body = (src) => String(src || '').split('\n').filter((l) => !l.startsWith('// @surf-id')).join('\n').trim();
  const script = async () => body((await agentCall('get_script', {})).result?.source);
  const activeId = async () => (await agentCall('parts', {})).result?.activeId;
  const camera = async () => (await agentCall('camera', {})).result;
  const solids = () => page.evaluate(() => document.querySelector('[data-assembly-solids]')?.getAttribute('data-assembly-solids') ?? null);
  const chatRows = () => page.evaluate(() => Array.from(document.querySelectorAll('[data-agent-msg]')).map((el) => `${el.getAttribute('data-agent-msg')}:${el.textContent.trim().slice(0, 40)}`));
  const draft = () => page.evaluate(() => document.querySelector('[data-agent-prompt-input]')?.value ?? null);
  const runCount = () => page.evaluate(() => Number(window.__SURFCAD_ASSEMBLY_TIMING?.seq || 0));
  const swapInfo = () => page.evaluate(() => window.__SURFCAD_SHELL_SWAP || null);
  const width = () => page.evaluate(() => window.innerWidth);
  const closeCamera = (a, b) => a && b && ['position', 'target'].every((k) => Array.isArray(a[k]) && Array.isArray(b[k]) && a[k].every((v, i) => Math.abs(v - b[k][i]) < 0.5));

  await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForFunction(() => typeof window.surfcad?.call === 'function' && !document.querySelector('[data-app-loading]'), null, { timeout: 60000 });
  await page.waitForSelector('canvas', { timeout: 30000 });

  // Two parts with different scripts, the second active with an edit the
  // open-time seed does not know.
  check('create_assembly', (await agentCall('create_assembly', {})).ok === true);
  const first = await activeId();
  const setA = await agentCall('set_script', { part_id: first, source: SCRIPT_A, return: 'status' });
  check('first part builds', setA.ok === true && setA.result?.status?.runState === 'ok', JSON.stringify(setA).slice(0, 200));
  const created = await agentCall('create_part', { name: 'Second' });
  check('second part created', created.ok === true, JSON.stringify(created).slice(0, 200));
  const second = await activeId();
  check('the second part is active and distinct', typeof second === 'string' && second !== first, JSON.stringify({ first, second }));
  const setB = await agentCall('set_script', { part_id: second, source: SCRIPT_B, return: 'status' });
  check('second part builds with its own script', setB.ok === true && setB.result?.status?.runState === 'ok', JSON.stringify(setB).slice(0, 200));
  await page.waitForTimeout(800);

  // A camera that is not the default, so a reset is visible.
  const moved = await agentCall('camera_set', { position: [150, 90, 120], target: [0, 0, 10] });
  check('camera_set', moved.ok === true, JSON.stringify(moved).slice(0, 200));
  await page.waitForTimeout(400);

  // A live chat through the DEV echo stub, plus an unsent draft.
  await page.waitForSelector('[data-agent-prompt-input]', { timeout: 15000 });
  for (const text of ['Make the second part taller.', 'And add a hole.']) {
    await page.fill('[data-agent-prompt-input]', text);
    await page.click('[data-agent-prompt-send]');
    await page.waitForFunction((n) => document.querySelectorAll('[data-agent-msg]').length >= n, 0, { timeout: 10000 });
    await page.waitForTimeout(300);
  }
  await page.waitForFunction(() => document.querySelectorAll('[data-agent-msg]').length >= 4, null, { timeout: 10000 });
  await page.fill('[data-agent-prompt-input]', 'unsent draft');

  const before = {
    script: await script(), active: await activeId(), camera: await camera(), solids: await solids(),
    rows: await chatRows(), draft: await draft(), runs: await runCount(),
  };
  check('before: the live script is the edit', before.script.includes(SCRIPT_B), before.script.slice(0, 120));
  check('before: four chat rows and the draft', before.rows.length === 4 && before.draft === 'unsent draft', JSON.stringify(before.rows));
  check('before: solids are placed', before.solids != null && before.solids !== '0', String(before.solids));

  // Rotate: desktop → phone. The shells swap; everything remounts.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => window.innerWidth === 390 && !!document.querySelector('[data-mobile-stage]'), null, { timeout: 15000 });
  await page.waitForTimeout(1500);
  const phone = { script: await script(), active: await activeId(), camera: await camera(), solids: await solids(), runs: await runCount(), width: await width() };
  check('phone: the mobile shell is up', phone.width === 390);
  check('phone: the active part did not change', phone.active === before.active, JSON.stringify({ before: before.active, after: phone.active }));
  check('phone: the live script survived (no stale seed written back)', phone.script.includes(SCRIPT_B) && !phone.script.includes(SCRIPT_A), phone.script.slice(0, 120));
  check('phone: the solids are placed again', phone.solids === before.solids, JSON.stringify({ before: before.solids, after: phone.solids }));
  check('phone: the camera pose survived', closeCamera(before.camera, phone.camera), JSON.stringify({ before: before.camera?.position, after: phone.camera?.position, swap: await swapInfo() }));
  check('phone: no rerun', phone.runs === before.runs, JSON.stringify({ before: before.runs, after: phone.runs }));

  // And back: phone → desktop. The chat remounts on desktop with its history.
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForFunction(() => window.innerWidth === 1280 && !document.querySelector('[data-mobile-stage]'), null, { timeout: 15000 });
  await page.waitForSelector('[data-agent-prompt-input]', { timeout: 15000 });
  await page.waitForTimeout(1500);
  const after = {
    script: await script(), active: await activeId(), camera: await camera(), solids: await solids(),
    rows: await chatRows(), draft: await draft(), runs: await runCount(),
  };
  check('desktop again: the chat history and the draft came back', after.rows.join('|') === before.rows.join('|') && after.draft === 'unsent draft', JSON.stringify({ rows: after.rows, draft: after.draft }));
  check('desktop again: the active part did not change', after.active === before.active);
  check('desktop again: the live script survived', after.script.includes(SCRIPT_B) && !after.script.includes(SCRIPT_A), after.script.slice(0, 120));
  check('desktop again: the solids are placed again', after.solids === before.solids, JSON.stringify({ before: before.solids, after: after.solids }));
  check('desktop again: the camera pose survived', closeCamera(before.camera, after.camera), JSON.stringify({ before: before.camera, after: after.camera }));
  check('desktop again: no rerun', after.runs === before.runs, JSON.stringify({ before: before.runs, after: after.runs }));

  // The first part's script is untouched by any of it (get_script reads the
  // active part, so activate it first).
  check('set_active_part back to the first', (await agentCall('set_active_part', { part_id: first })).ok === true);
  await page.waitForTimeout(500);
  const firstScript = await script();
  check('the other part kept its own script', firstScript.includes(SCRIPT_A) && !firstScript.includes(SCRIPT_B), firstScript.slice(0, 120));

  // A resize that stays under 768px does not swap shells: nothing to restore.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => !!document.querySelector('[data-mobile-stage]'), null, { timeout: 15000 });
  await page.waitForTimeout(800);
  const runsAtPhone = await runCount();
  await page.setViewportSize({ width: 700, height: 400 });
  await page.waitForTimeout(800);
  check('under 768px (390 → 700): still the mobile shell, no rerun', (await page.evaluate(() => !!document.querySelector('[data-mobile-stage]'))) && (await runCount()) === runsAtPhone);
  check('no page errors', pageErrors.length === 0, pageErrors.join(' | ').slice(0, 300));
} finally {
  await browser.close();
  stop();
}

if (failed) {
  console.log(`rotation remount golden: FAIL (${failed})`);
  process.exit(1);
}
console.log('rotation remount golden: all passed');

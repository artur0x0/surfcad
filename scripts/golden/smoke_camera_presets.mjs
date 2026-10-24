#!/usr/bin/env node
/**
 * MCP improvements #5 / bug M11: camera_set { view: "side" | "front_of_model" }
 * read the assembly's longest horizontal extent, so a vehicle modelled along X
 * gets a side elevation (camera on -Y, +X to the right) and a front view from
 * its +X end, and the same two names flip for a model that runs along Y.
 * Vite dev server; Chrome from CHROME_PATH or the usual paths.
 */
/* global document, window */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { attachConsentPresetToBrowser } from './lib/presetConsentInit.mjs';

const PORT = Number(process.env.SMOKE_PORT || 4374);
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
  console.log('camera presets golden: no system Chrome found — set CHROME_PATH. Skipping.');
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
const near = (a, b, tol) => Math.abs(a - b) <= tol;

const CUBE = 'let part = Manifold.cube([20, 20, 20], true);\nreturn part;\n';

console.log('camera presets golden');
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
  body: JSON.stringify({ authenticated: true, user: { _id: 'user-camera-presets', email: 'agent@test.local' } }),
}));
await page.route('**/api/config', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));

await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(
  () => typeof window.surfcad?.call === 'function' && !document.querySelector('[data-app-loading]'),
  { timeout: 120000 },
);
await page.waitForSelector('[data-cad-run]', { state: 'attached', timeout: 120000 });

// The catalog advertises the two model views.
const cat = await agentCall(page, 'list_commands', { names: ['camera_set'] });
const row = cat.result?.commands?.[0] || {};
const viewEnum = (row.args || row.schema || row.inputSchema)?.properties?.view?.enum || [];
check('camera_set lists side and front_of_model', viewEnum.includes('side') && viewEnum.includes('front_of_model'), JSON.stringify(viewEnum));
// In-page rows carry the schema, not the catalog description: the axis note
// lives on the view argument itself.
const viewDesc = (row.args || row.schema || row.inputSchema)?.properties?.view?.description || '';
check('camera_set says which side each world view looks from', /front = camera on -Y looking \+Y/.test(viewDesc) && /right = camera on \+X/.test(viewDesc), viewDesc.slice(0, 160));

// A model long along X: a cube at the origin and one 200 mm along +X.
const created = await agentCall(page, 'create_assembly', {});
check('create_assembly', created.ok === true, JSON.stringify(created));
const baseId = (await agentCall(page, 'parts', {})).result?.activeId;
await agentCall(page, 'set_script', { part_id: baseId, source: CUBE });
const far = await agentCall(page, 'create_part', { name: 'Far', script: CUBE, position: [200, 0, 0] });
check('second cube at x = 200', far.ok === true, JSON.stringify(far));
await agentCall(page, 'set_active_part', { part_id: baseId });
await agentCall(page, 'run', {});
await page.waitForTimeout(600);
await agentCall(page, 'select_clear', {});

const side = await agentCall(page, 'camera_set', { view: 'side' });
check('camera_set side', side.ok === true, JSON.stringify(side));
const camSide = (await agentCall(page, 'camera', {})).result;
check('side on an X-long model: camera on -Y, centred on the assembly', camSide?.position && camSide.position[1] < -50 && near(camSide.position[0], camSide.target[0], 1) && near(camSide.target[0], 100, 15), JSON.stringify(camSide));

const front = await agentCall(page, 'camera_set', { view: 'front_of_model' });
check('camera_set front_of_model', front.ok === true, JSON.stringify(front));
const camFront = (await agentCall(page, 'camera', {})).result;
check('front_of_model on an X-long model: camera past the +X end', camFront?.position && camFront.position[0] > 200 && near(camFront.position[1], camFront.target[1], 1), JSON.stringify(camFront));

// Turn the model: the far cube goes to y = 200, so the long axis is Y.
const moved = await agentCall(page, 'part_set_transform', { part_id: far.result?.partId, position: [0, 200, 0] });
check('far cube moved to y = 200', moved.ok === true, JSON.stringify(moved));
await page.waitForTimeout(400);
await agentCall(page, 'select_clear', {});
const side2 = await agentCall(page, 'camera_set', { view: 'side' });
check('camera_set side again', side2.ok === true, JSON.stringify(side2));
const camSide2 = (await agentCall(page, 'camera', {})).result;
check('side on a Y-long model: camera on +X', camSide2?.position && camSide2.position[0] > 50 && near(camSide2.position[1], camSide2.target[1], 1), JSON.stringify(camSide2));
const front2 = await agentCall(page, 'camera_set', { view: 'front_of_model' });
check('camera_set front_of_model again', front2.ok === true, JSON.stringify(front2));
const camFront2 = (await agentCall(page, 'camera', {})).result;
check('front_of_model on a Y-long model: camera past the +Y end', camFront2?.position && camFront2.position[1] > 200 && near(camFront2.position[0], camFront2.target[0], 1), JSON.stringify(camFront2));

const bad = await agentCall(page, 'camera_set', { view: 'diagonal' });
check('an unknown view is still bad_view', bad.ok === false && bad.error?.code === 'bad_view', JSON.stringify(bad));
check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));

await browser.close();
stop();
console.log(failed ? `camera presets golden: FAIL (${failed})` : 'camera presets golden: ok');
process.exit(failed ? 1 : 0);

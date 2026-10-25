#!/usr/bin/env node
/**
 * Pattern on points, the hardware flow: a housing part with a hole grid,
 * list_faces gives each hole's center and axis, a bolt part is patterned
 * onto them with insert_pattern_points, and the bolt count equals the hole
 * count. Bad points are bad_args. Points is Array Type=Points, not a
 * separate rail button. Dev server, agent bridge. Chrome from CHROME_PATH
 * or the usual paths.
 */
/* global document, window */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { attachConsentPresetToBrowser } from './lib/presetConsentInit.mjs';

const PORT = Number(process.env.SMOKE_PORT || 4355);
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
  console.log('pattern points golden: no system Chrome found — set CHROME_PATH. Skipping.');
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

console.log('pattern points golden');
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
  body: JSON.stringify({ authenticated: true, user: { _id: 'user-pattern-points', email: 'agent@test.local' } }),
}));
await page.route('**/api/config', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(
  () => typeof window.surfcad?.call === 'function' && !document.querySelector('[data-app-loading]'),
  { timeout: 120000 },
);
await page.waitForSelector('[data-cad-run]', { state: 'attached', timeout: 120000 });

// The housing: a plate with a 3 × 2 grid of Ø4 holes.
const created = await agentCall(page, 'create_assembly', {});
check('create_assembly', created.ok === true, JSON.stringify(created));
await agentCall(page, 'parts', {});
const plate = await agentCall(page, 'insert_cube', { width: 80, depth: 50, height: 6, center: true });
check('housing plate', plate.ok === true && plate.result?.ok === true, JSON.stringify(plate.result?.errors || plate.error));
const grid = await agentCall(page, 'insert_hole_pattern', { n: 3, m: 2, spacingU: 24, spacingV: 20, dia: 4 });
check('hole grid', grid.ok === true && grid.result?.ok === true, JSON.stringify(grid.result?.errors || grid.error));
const faces = (await agentCall(page, 'list_faces', {})).result?.faces || [];
const cylindrical = faces.filter((f) => f.type === 'cylindrical');
console.log(`  (first cylindrical face: ${JSON.stringify(cylindrical[0] || null).slice(0, 240)})`);
// The holes are the small cylinders; the bolt is Ø3.8 so anything under R 3 is one.
const holes = cylindrical.filter((f) => !Number.isFinite(f.radius) || f.radius < 3).map((f) => ({
  center: Array.isArray(f.center) ? f.center : (Array.isArray(f.key?.at) ? f.key.at : null),
  axis: Array.isArray(f.axis) ? f.axis : [0, 0, 1],
})).filter((f) => Array.isArray(f.center));
check('list_faces finds the six hole faces with center and axis', holes.length === 6, JSON.stringify({ cylindrical: cylindrical.length, holes: holes.length }));

// The bolt: one instance in its own part, patterned onto the holes.
const bolt = await agentCall(page, 'create_part', { name: 'Bolt M4x12 SHCS' });
check('bolt part', bolt.ok === true && typeof bolt.result?.partId === 'string', JSON.stringify(bolt));
const one = await agentCall(page, 'insert_cylinder', { radius: 1.9, height: 12, center: false });
check('one bolt body', one.ok === true && one.result?.ok === true, JSON.stringify(one.result?.errors || one.error));
const bad = await agentCall(page, 'insert_pattern_points', { points: [] });
check('empty points is bad_args', bad.ok === false && bad.error?.code === 'bad_args', JSON.stringify(bad));
const points = holes.map((f) => ({ at: f.center, axis: f.axis }));
const patterned = await agentCall(page, 'insert_pattern_points', { points, up: 'z' });
check('insert_pattern_points runs', patterned.ok === true && patterned.result?.ok === true, JSON.stringify(patterned.result?.errors || patterned.error));
const bodies = (await agentCall(page, 'list_bodies', {})).result?.bodies || [];
check('one bolt per hole', bodies.length === 6, JSON.stringify(bodies.length));
const tree = (await agentCall(page, 'feature_tree', {})).result?.features || [];
check('the feature tree has the cylinder then a Points block', tree.length === 2 && tree[1].kind === 'patternPoints', JSON.stringify(tree.map((f) => f.kind)));
const source = (await agentCall(page, 'get_script', {})).result?.source || '';
check('the script calls patternOnPoints with the hole points', /patternOnPoints\(part, \[\{"at":\[/.test(source), source.slice(-220));
const centroids = bodies.map((b) => b.at.slice(0, 2).map((v) => Math.round(v))).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
const expected = holes.map((h) => h.center.slice(0, 2).map((v) => Math.round(v))).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
check('each bolt sits on a hole center', JSON.stringify(centroids) === JSON.stringify(expected), `${JSON.stringify(centroids)} vs ${JSON.stringify(expected)}`);

// Array Type=Points opens the same points field. No separate rail button.
check('the Points button is off the rail', (await page.locator('[data-ui-action="patternPoints"]').count()) === 0);
const modalText = await page.evaluate(() => document.querySelector('[data-modal-fit]')?.textContent?.trim().slice(0, 120) || '');
if (modalText) {
  console.log(`  (a modal was up before the Array click: ${JSON.stringify(modalText)})`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
}
const arrayButton = page.locator('[data-ui-action="array3D"]');
check('the Array button is on the rail', (await arrayButton.count()) === 1);
await arrayButton.first().click();
await page.waitForTimeout(400);
const typeSelect = page.locator('select').filter({ has: page.locator('option[value="points"]') });
check('Array Type lists Points', (await typeSelect.count()) >= 1);
await typeSelect.first().selectOption('points');
await page.waitForTimeout(200);
check('the sheet shows the points field', (await page.locator('textarea[data-helper-param="points"]').count()) === 1);
await page.keyboard.press('Escape');

check('no page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));

await browser.close();
stop();
if (failed) {
  console.log(`pattern points golden: FAIL (${failed})`);
  process.exit(1);
}
console.log('pattern points golden: ok');

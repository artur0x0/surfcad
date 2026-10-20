#!/usr/bin/env node
/**
 * Bike joints acceptance 3: Fixed on a single target.
 *   - fixed by a face through the agent: one pick, no second reference
 *   - a coincident joint against the fixed part moves only the free part
 *   - fixed by the whole part: joint_pick { part_id } alone, type suggested
 *   - the fixed joint is removed like any other (chip → Delete)
 *
 * Runs the app on the Vite dev server. Chrome from CHROME_PATH or the usual paths.
 */
/* global document, window */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { attachConsentPresetToBrowser } from './lib/presetConsentInit.mjs';

const PORT = Number(process.env.SMOKE_PORT || 4348);
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
  console.log('joint fixed target golden: no system Chrome found — set CHROME_PATH. Skipping.');
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
const near = (a, b, tol = 1e-6) => Array.isArray(a) && Array.isArray(b) && a.every((v, i) => Math.abs(v - b[i]) < tol);

console.log('joint fixed target golden');
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
  body: JSON.stringify({ authenticated: true, user: { _id: 'user-joint-fixed', email: 'agent@test.local' } }),
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
const frameId = (await agentCall(page, 'parts', {})).result?.activeId;
const seeded = await agentCall(page, 'set_script', { part_id: frameId, source: CUBE });
check('frame script', seeded.ok === true && seeded.result?.ok === true, JSON.stringify(seeded));
const wheel = await agentCall(page, 'create_part', { name: 'Wheel', script: CUBE, position: [3, 4, 60] });
check('create_part Wheel', wheel.ok === true && typeof wheel.result?.partId === 'string', JSON.stringify(wheel));
const wheelId = wheel.result?.partId;

// Fixed by a face: one pick, no second reference asked for.
const openA = await agentCall(page, 'joint_open', {});
check('joint_open', openA.ok === true, JSON.stringify(openA));
const frameFaces = (await agentCall(page, 'list_faces', { part_id: frameId })).result?.faces || [];
const frameTop = frameFaces.find((f) => f.type === 'planar' && f.normal?.[2] > 0.9);
check('frame top face listed', !!frameTop, JSON.stringify(frameFaces.map((f) => f.id)));
const pickA = await agentCall(page, 'joint_pick', { part_id: frameId, face_id: frameTop?.id });
check('one face pick accepted', pickA.ok === true && pickA.result?.count === 1, JSON.stringify(pickA));
const typeA = await agentCall(page, 'joint_set_params', { type: 'fixed' });
check('fixed takes the single pick', typeA.ok === true && typeA.result?.type === 'fixed' && typeA.result?.pickCount === 1, JSON.stringify(typeA));
const commitA = await agentCall(page, 'joint_commit', {});
check('fixed by face commits', commitA.ok === true && commitA.result?.ok === true && typeof commitA.result?.jointId === 'string', JSON.stringify(commitA));
const groundId = commitA.result?.jointId;

// Coincident frame top ↔ wheel bottom: the wheel moves, the frame does not.
const before = (await agentCall(page, 'part_get_transform', { part_id: frameId })).result;
const openB = await agentCall(page, 'joint_open', {});
check('joint_open again', openB.ok === true, JSON.stringify(openB));
const wheelFaces = (await agentCall(page, 'list_faces', { part_id: wheelId })).result?.faces || [];
const wheelBottom = wheelFaces.find((f) => f.type === 'planar' && f.normal?.[2] < -0.9);
const pickB = await agentCall(page, 'joint_pick', { picks: [{ part_id: frameId, face_id: frameTop?.id }, { part_id: wheelId, face_id: wheelBottom?.id }] });
check('two face picks', pickB.ok === true && pickB.result?.count === 2, JSON.stringify(pickB));
await agentCall(page, 'joint_set_params', { type: 'coincident' });
const commitB = await agentCall(page, 'joint_commit', {});
check('coincident commits', commitB.ok === true && commitB.result?.ok === true, JSON.stringify(commitB));
const frameAfter = (await agentCall(page, 'part_get_transform', { part_id: frameId })).result;
const wheelAfter = (await agentCall(page, 'part_get_transform', { part_id: wheelId })).result;
check('the fixed frame did not move', near(frameAfter?.position, before?.position) && near(frameAfter?.rotation, before?.rotation), JSON.stringify({ before, frameAfter }));
check('the free wheel moved onto the frame top (z 20)', wheelAfter && Math.abs(wheelAfter.position[2] - 20) < 1e-6 && Math.abs(wheelAfter.position[0] - 3) < 1e-6, JSON.stringify(wheelAfter));

// Fixed by the whole part: part_id alone, no geometry, type suggested.
const openC = await agentCall(page, 'joint_open', {});
check('joint_open for a whole-part pick', openC.ok === true, JSON.stringify(openC));
const pickC = await agentCall(page, 'joint_pick', { part_id: wheelId });
check('joint_pick with part_id alone is accepted', pickC.ok === true && pickC.result?.count === 1, JSON.stringify(pickC));
const paramsC = await agentCall(page, 'joint_set_params', {});
check('a whole-part pick suggests fixed', paramsC.ok === true && paramsC.result?.type === 'fixed', JSON.stringify(paramsC));
const commitC = await agentCall(page, 'joint_commit', {});
check('fixed by whole part commits', commitC.ok === true && commitC.result?.ok === true && commitC.result?.jointCount === 3, JSON.stringify(commitC));
const wholeId = commitC.result?.jointId;

// Removal: the chip reopens the fixed joint and Delete removes it.
const sel = await agentCall(page, 'joint_select', { joint_id: wholeId });
check('joint_select reopens the whole-part fixed joint', sel.ok === true, JSON.stringify(sel));
await page.waitForTimeout(300);
const del = page.locator('[data-joint-delete]').first();
check('the card offers Delete', (await del.count()) === 1);
// A modal scrim (agent connect prompt) can sit over the card in headless runs; fire the button's own click.
await del.dispatchEvent('click');
await page.waitForTimeout(400);
const hist = await agentCall(page, 'history', {});
const current = (hist.result?.entries || []).find((e) => e.current);
check('the fixed joint was removed like any other', current?.jointCount === 2, JSON.stringify(current));
const selGone = await agentCall(page, 'joint_select', { joint_id: wholeId });
check('the removed joint is unknown', selGone.ok === false && selGone.error?.code === 'unknown_joint', JSON.stringify(selGone));
const selGround = await agentCall(page, 'joint_select', { joint_id: groundId });
check('the face-fixed joint still exists', selGround.ok === true, JSON.stringify(selGround));
await agentCall(page, 'joint_cancel', {});

check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));

await browser.close();
stop();
if (failed) {
  console.log(`joint fixed target golden: ${failed} failed`);
  process.exit(1);
}
console.log('joint fixed target golden: all passed');

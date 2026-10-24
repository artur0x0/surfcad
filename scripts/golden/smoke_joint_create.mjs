#!/usr/bin/env node
/**
 * joint_create (MVP plan step 8, improvements §3): one call opens the joint
 * card, feeds the picks, sets the type and commits, and answers with the
 * joint id and the solved placements.
 *   - fixed by the whole part in one call
 *   - coincident frame top ↔ wheel bottom: the wheel lands on the frame
 *   - an unknown part is unknown_part, nothing written, no card left open
 *   - a joint the solver refuses is joint_unsolvable with the reason
 *   - undo takes the joint back in one assembly step
 *
 * Runs the app on the Vite dev server. Chrome from CHROME_PATH or the usual paths.
 */
/* global document, window */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { attachConsentPresetToBrowser } from './lib/presetConsentInit.mjs';

const PORT = Number(process.env.SMOKE_PORT || 4362);
const APP_URL = `http://127.0.0.1:${PORT}/?agent=1`;
const LABEL = 'joint create';
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
    console.log(`  ❌ ${name}${detail ? ` — ${String(detail).slice(0, 600)}` : ''}`);
  }
}

const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!exe) {
  console.log(`${LABEL}: no system Chrome found — set CHROME_PATH`);
  process.exit(1);
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
  try { server.kill('SIGKILL'); } catch { /* gone */ }
};
process.on('exit', stop);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { stop(); process.exit(1); });

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
const near = (a, b, tol = 1e-6) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < tol);
const facePick = (partId, face) => ({ part_id: partId, face_id: face.id, key: face.key });

console.log(`${LABEL} golden`);
if (!(await waitForServer())) {
  console.log('  ❌ dev server did not start');
  stop();
  process.exit(1);
}

const browser = await chromium.launch({
  executablePath: exe,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
attachConsentPresetToBrowser(browser);

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', (err) => errors.push(String(err).slice(0, 300)));
  await page.route('**/api/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ authenticated: false }) }));
  await page.route('**/api/auth/me', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ authenticated: true, user: { _id: 'user-joint-create', email: 'agent@test.local' } }),
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
  check('create_part Wheel at [3, 4, 60]', wheel.ok === true && typeof wheel.result?.partId === 'string', JSON.stringify(wheel));
  const wheelId = wheel.result?.partId;

  // The catalog knows the tool and its contract.
  const listed = await agentCall(page, 'list_commands', { names: ['joint_create'] });
  const row = listed.result?.commands?.find?.((c) => c.name === 'joint_create') || listed.result?.commands?.[0];
  check('list_commands has joint_create in the joint group with the return flag', !!row && row.group === 'joint' && !!row.schema?.properties?.return, JSON.stringify(listed).slice(0, 400));

  // 1. Fixed by the whole part, one call.
  const fixed = await agentCall(page, 'joint_create', { type: 'fixed', picks: [{ part_id: frameId }] });
  check('joint_create fixed by the whole part', fixed.ok === true && fixed.result?.ok === true && typeof fixed.result?.jointId === 'string' && fixed.result?.type === 'fixed', JSON.stringify(fixed));
  check('the fixed result carries the frame placement', Array.isArray(fixed.result?.placements) && fixed.result.placements.length === 1 && fixed.result.placements[0].part_id === frameId && near(fixed.result.placements[0].position, [0, 0, 0]), JSON.stringify(fixed.result?.placements));
  check('usedSelection is false on an explicit-pick tool', fixed.result?.usedSelection === false);
  const frameBefore = (await agentCall(page, 'part_get_transform', { part_id: frameId })).result;

  // 2. Coincident frame top ↔ wheel bottom: the wheel moves, the frame does not.
  const frameFaces = (await agentCall(page, 'list_faces', { part_id: frameId, filter: { kind: 'planar', normalWithin: { n: [0, 0, 1], deg: 5 } } })).result?.faces || [];
  const wheelFaces = (await agentCall(page, 'list_faces', { part_id: wheelId, filter: { kind: 'planar', normalWithin: { n: [0, 0, -1], deg: 5 } } })).result?.faces || [];
  check('frame top and wheel bottom listed', frameFaces.length === 1 && wheelFaces.length === 1, JSON.stringify({ frame: frameFaces.length, wheel: wheelFaces.length }));
  const coincident = await agentCall(page, 'joint_create', {
    type: 'coincident',
    name: 'Wheel seat',
    picks: [facePick(frameId, frameFaces[0]), facePick(wheelId, wheelFaces[0])],
  });
  check('joint_create coincident commits', coincident.ok === true && coincident.result?.ok === true && typeof coincident.result?.jointId === 'string' && coincident.result?.jointId !== fixed.result?.jointId, JSON.stringify(coincident));
  check('the result names the joint and counts both picks', coincident.result?.type === 'coincident' && coincident.result?.name === 'Wheel seat' && coincident.result?.pickCount === 2 && coincident.result?.jointCount === 2, JSON.stringify(coincident.result));
  const placedWheel = coincident.result?.placements?.find((p) => p.part_id === wheelId);
  const placedFrame = coincident.result?.placements?.find((p) => p.part_id === frameId);
  check('placements: the wheel landed on the frame top (z 20), x and y kept', placedWheel && Math.abs(placedWheel.position[2] - 20) < 1e-6 && Math.abs(placedWheel.position[0] - 3) < 1e-6 && Math.abs(placedWheel.position[1] - 4) < 1e-6, JSON.stringify(placedWheel));
  check('placements: the fixed frame did not move', placedFrame && near(placedFrame.position, frameBefore?.position) && near(placedFrame.rotation, frameBefore?.rotation), JSON.stringify({ placedFrame, frameBefore }));
  const wheelNow = (await agentCall(page, 'part_get_transform', { part_id: wheelId })).result;
  check('part_get_transform agrees with the placement', wheelNow && near(wheelNow.position, placedWheel?.position), JSON.stringify(wheelNow));

  // 3. An unknown part: nothing written, no card left open.
  const ghost = await agentCall(page, 'joint_create', { type: 'coincident', picks: [facePick(frameId, frameFaces[0]), { part_id: 'ghost', face_id: 'f1', key: wheelFaces[0].key }] });
  check('unknown part is unknown_part with the hint', ghost.ok === false && ghost.error?.code === 'unknown_part' && /joint_create takes type/.test(ghost.error?.message || ''), JSON.stringify(ghost));
  const modeAfterGhost = (await agentCall(page, 'mode', {})).result || {};
  check('no joint card left open after the refused pick', !modeAfterGhost.jointCard && modeAfterGhost.featureEdit == null, JSON.stringify(modeAfterGhost));

  // 4. A joint the solver refuses: concentric needs two axes, planar faces give none.
  const unsolvable = await agentCall(page, 'joint_create', { type: 'concentric', picks: [facePick(frameId, frameFaces[0]), facePick(wheelId, wheelFaces[0])] });
  check('concentric on two planar faces is joint_unsolvable with the reason', unsolvable.ok === false && unsolvable.error?.code === 'joint_unsolvable' && typeof unsolvable.error?.details?.reason === 'string' && unsolvable.error.details.reason.length > 0 && /Nothing was written/.test(unsolvable.error?.message || ''), JSON.stringify(unsolvable));
  const modeAfterRefusal = (await agentCall(page, 'mode', {})).result || {};
  check('no joint card left open after the refused joint', !modeAfterRefusal.jointCard, JSON.stringify(modeAfterRefusal));
  const wheelStill = (await agentCall(page, 'part_get_transform', { part_id: wheelId })).result;
  check('the refused joint moved nothing', near(wheelStill?.position, placedWheel?.position), JSON.stringify(wheelStill));

  // 5. Bad args never open a card.
  const bad = await agentCall(page, 'joint_create', { type: 'coincident', picks: [facePick(frameId, frameFaces[0])] });
  check('one pick for coincident is bad_args', bad.ok === false && bad.error?.code === 'bad_args' && /exactly two picks/.test(bad.error?.message || ''), JSON.stringify(bad));

  // 6. The joint is one assembly undo step; a second joint_create still works after it.
  const undo = await agentCall(page, 'undo', {});
  check('undo takes the coincident joint back as one assembly step', undo.ok === true && undo.result?.kind === 'assembly', JSON.stringify(undo));
  const wheelUndone = (await agentCall(page, 'part_get_transform', { part_id: wheelId })).result;
  check('the wheel is back at z 60', wheelUndone && Math.abs(wheelUndone.position[2] - 60) < 1e-6, JSON.stringify(wheelUndone));
  const again = await agentCall(page, 'joint_create', { type: 'coincident', picks: [facePick(frameId, frameFaces[0]), facePick(wheelId, wheelFaces[0])] });
  check('joint_create works again after undo', again.ok === true && again.result?.ok === true, JSON.stringify(again));

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (err) {
  check('golden completed', false, err?.stack || String(err));
} finally {
  await browser.close().catch(() => {});
  stop();
}

if (failed) {
  console.log(`${LABEL}: ${failed} failed`);
  process.exit(1);
}
console.log(`${LABEL} golden: ok`);

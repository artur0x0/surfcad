#!/usr/bin/env node
/**
 * Pi 5 acceptance C: state reporting through the agent bridge.
 *   C1 dirty.editedSinceLoad lists every edited part, not only the newest.
 *   C2 status.bodyCount is a number after undo.
 *   C3 a part create_part returned is never not_run_yet.
 *   C4 mode.featureEdit is set while open_feature has a card up.
 *   C5 paint_state.pendingCount is 1 after one paint on a part with a saved paint.
 *
 * Runs the app on the Vite dev server. Chrome from CHROME_PATH or the usual paths.
 */
/* global document, window */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { attachConsentPresetToBrowser } from './lib/presetConsentInit.mjs';

const PORT = Number(process.env.SMOKE_PORT || 4343);
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
  console.log('agent state reporting golden: no system Chrome found — set CHROME_PATH. Skipping.');
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

const BASE = 'let part = Manifold.cube([40, 30, 20], true);\nreturn part;\n';
const BASE_EDITED = 'let part = Manifold.cube([40, 30, 20], true);\npart = part.add(Manifold.cube([5, 5, 50], true));\nreturn part;\n';

console.log('agent state reporting golden');
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
  body: JSON.stringify({ authenticated: true, user: { _id: 'user-state-reporting', email: 'agent@test.local' } }),
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
const baseId = (await agentCall(page, 'parts', {})).result?.activeId;
check('base part id', typeof baseId === 'string' && baseId.length > 0);
const seeded = await agentCall(page, 'set_script', { part_id: baseId, source: BASE });
check('base script', seeded.ok === true && seeded.result?.ok === true, JSON.stringify(seeded));

// C1: edit the base heavily, then add a part. The base must stay listed.
const edited = await agentCall(page, 'set_script', { part_id: baseId, source: BASE_EDITED });
check('base edited', edited.ok === true && edited.result?.ok === true, JSON.stringify(edited));
const dirtyBefore = await agentCall(page, 'dirty', {});
check('editedSinceLoad lists the base before the lid exists', (dirtyBefore.result?.editedSinceLoad || []).includes(baseId), JSON.stringify(dirtyBefore.result?.editedSinceLoad));
const lid = await agentCall(page, 'create_part', { name: 'Lid' });
check('create_part Lid', lid.ok === true && typeof lid.result?.partId === 'string', JSON.stringify(lid));
const lidId = lid.result?.partId;
await page.waitForTimeout(300);
const dirtyAfter = await agentCall(page, 'dirty', {});
check('C1 editedSinceLoad still lists the base after the lid was added', (dirtyAfter.result?.editedSinceLoad || []).includes(baseId), JSON.stringify(dirtyAfter.result?.editedSinceLoad));

// C3: the part create_part returned has run.
const lidStatus = await agentCall(page, 'status', {});
check('C3 new part status is the lid', lidStatus.result?.partId === lidId, JSON.stringify(lidStatus.result?.partId));
check('C3 new part is not not_run_yet', lidStatus.result?.runState === 'ok' && lidStatus.result?.bodyCount != null, JSON.stringify({ runState: lidStatus.result?.runState, bodyCount: lidStatus.result?.bodyCount }));

// C2: bodyCount after undo on the base.
const back = await agentCall(page, 'set_active_part', { part_id: baseId });
check('set_active_part base', back.ok === true, JSON.stringify(back));
const cube = await agentCall(page, 'insert_cube', { width: 6, depth: 6, height: 6, combine: 'add', z: 30 });
check('insert_cube on base', cube.ok === true && cube.result?.ok === true, JSON.stringify(cube));
const undone = await agentCall(page, 'undo', {});
check('undo', undone.ok === true && undone.result?.kind === 'part', JSON.stringify(undone));
check('C2 undo result status has bodyCount', Number.isFinite(undone.result?.status?.bodyCount), JSON.stringify(undone.result?.status));
const afterUndo = await agentCall(page, 'status', {});
check('C2 status bodyCount after undo is a number', Number.isFinite(afterUndo.result?.bodyCount), JSON.stringify({ bodyCount: afterUndo.result?.bodyCount, runState: afterUndo.result?.runState }));

// C4: mode.featureEdit while a card is open.
const tree = await agentCall(page, 'feature_tree', {});
const chip = (tree.result?.features || []).find((f) => f.kind === 'cube') || tree.result?.features?.[0];
check('a feature chip to open', !!chip, JSON.stringify(tree.result));
const opened = await agentCall(page, 'open_feature', { id: chip.id });
check('open_feature', opened.ok === true, JSON.stringify(opened));
await page.waitForTimeout(400);
const modeOpen = await agentCall(page, 'mode', {});
check('C4 mode.featureEdit names the open feature', modeOpen.result?.featureEdit?.featureId === chip.id, JSON.stringify(modeOpen.result));
const cancelled = await agentCall(page, 'cancel_feature', {});
check('cancel_feature', cancelled.ok === true, JSON.stringify(cancelled));
await page.waitForTimeout(300);
const modeClosed = await agentCall(page, 'mode', {});
check('C4 mode.featureEdit is null after cancel', modeClosed.result?.featureEdit == null, JSON.stringify(modeClosed.result?.featureEdit));

// C5: one paint on a part that already has a saved paint.
const faces = await agentCall(page, 'list_faces', {});
const list = faces.result?.faces || [];
check('faces to paint', list.length >= 2, JSON.stringify(list.length));
const opened1 = await agentCall(page, 'paint_open', {});
check('paint_open', opened1.ok === true, JSON.stringify(opened1));
const first = await agentCall(page, 'paint_faces', { keys: [list[0].key] });
check('paint first face', first.ok === true, JSON.stringify(first));
const state1 = await agentCall(page, 'paint_state', {});
check('pendingCount 1 after the first paint', state1.result?.pendingCount === 1, JSON.stringify(state1.result));
const saved = await agentCall(page, 'paint_confirm', {});
check('paint_confirm', saved.ok === true, JSON.stringify(saved));
await page.waitForTimeout(300);
const opened2 = await agentCall(page, 'paint_open', {});
check('paint_open again', opened2.ok === true, JSON.stringify(opened2));
const state2 = await agentCall(page, 'paint_state', {});
check('C5 pendingCount 0 as the popup reopens over a saved paint', state2.result?.pendingCount === 0, JSON.stringify(state2.result));
const second = await agentCall(page, 'paint_faces', { keys: [list[1].key] });
check('paint second face', second.ok === true, JSON.stringify(second));
const state3 = await agentCall(page, 'paint_state', {});
check('C5 pendingCount 1 after a single paint', state3.result?.pendingCount === 1, JSON.stringify(state3.result));
await agentCall(page, 'paint_cancel', {});

check('no page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));

await browser.close();
stop();
if (failed) {
  console.log(`agent state reporting golden: FAIL (${failed})`);
  process.exit(1);
}
console.log('agent state reporting golden: ok');

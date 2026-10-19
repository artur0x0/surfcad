#!/usr/bin/env node
/**
 * Bike acceptance PR 1: insert_move names the body it moves, edit_feature
 * re-points a move, a confirm that leaves the part failed says so, and
 * feature_failed carries detail. Two-body part through the agent bridge on
 * the Vite dev server. Chrome from CHROME_PATH or the usual paths.
 */
/* global document, window */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { attachConsentPresetToBrowser } from './lib/presetConsentInit.mjs';

const PORT = Number(process.env.SMOKE_PORT || 4345);
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
  console.log('agent move target golden: no system Chrome found — set CHROME_PATH. Skipping.');
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

const near = (a, b, tol = 0.05) => Array.isArray(a) && Array.isArray(b) && a.length >= 3 && b.length >= 3
  && a.slice(0, 3).every((v, i) => Math.abs(v - b[i]) <= tol);
const sortByX = (bodies) => [...bodies].sort((p, q) => p.at[0] - q.at[0]);

// Two separate bodies: a 20 mm cube at the origin and a 10 mm cube at x = 40.
const TWO = 'let part = Manifold.cube([20, 20, 20], true);\npart = part.add(Manifold.cube([10, 10, 10], true).translate([40, 0, 0]), { merge: false });\nreturn part;\n';

console.log('agent move target golden');
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
  body: JSON.stringify({ authenticated: true, user: { _id: 'user-move-target', email: 'agent@test.local' } }),
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
const seeded = await agentCall(page, 'set_script', { part_id: partId, source: TWO });
check('two-body part', seeded.ok === true && seeded.result?.ok === true && seeded.result?.status?.bodyCount === 2, JSON.stringify(seeded.result?.status));

const bodies0 = await agentCall(page, 'list_bodies', {});
const listed0 = sortByX(bodies0.result?.bodies || []);
check('list_bodies lists two bodies with centroids', listed0.length === 2 && near(listed0[0].at, [0, 0, 0]) && near(listed0[1].at, [40, 0, 0]), JSON.stringify(bodies0.result));
const big = listed0[0];
const small = listed0[1];

// Nothing named, nothing selected: a clear error, nothing written.
const scriptBefore = (await agentCall(page, 'get_script', {})).result?.source;
const unnamed = await agentCall(page, 'insert_move', { dx: 0, dy: 15, dz: 0 });
check('insert_move with no body is no_body', unnamed.ok === false && unnamed.error?.code === 'no_body', JSON.stringify(unnamed));
check('nothing was written', (await agentCall(page, 'get_script', {})).result?.source === scriptBefore);

// body_index moves the small cube only.
const moved = await agentCall(page, 'insert_move', { body_index: small.index, dx: 0, dy: 15, dz: 0 });
check('insert_move body_index', moved.ok === true && moved.result?.ok === true, JSON.stringify(moved.result?.errors || moved.error));
const bodies1 = sortByX((await agentCall(page, 'list_bodies', {})).result?.bodies || []);
check('the chosen body moved and the other stayed', bodies1.length === 2 && near(bodies1[0].at, [0, 0, 0]) && near(bodies1[1].at, [40, 15, 0]), JSON.stringify(bodies1));

// edit_feature re-points the move to the big cube.
const tree = await agentCall(page, 'feature_tree', {});
const moveChip = (tree.result?.features || []).find((f) => f.kind === 'move');
check('move chip', !!moveChip, JSON.stringify(tree.result?.features));
const opened = await agentCall(page, 'open_feature', { id: moveChip.id });
check('open_feature move', opened.ok === true, JSON.stringify(opened));
await page.waitForTimeout(500);
const edited = await agentCall(page, 'edit_feature', { params: { at: big.at } });
check('edit_feature at', edited.ok === true, JSON.stringify(edited));
const confirmed = await agentCall(page, 'confirm_feature', {});
check('confirm_feature re-pointed move', confirmed.ok === true && confirmed.result?.ok === true, JSON.stringify(confirmed.result?.errors || confirmed.error));
const bodies2 = sortByX((await agentCall(page, 'list_bodies', {})).result?.bodies || []);
check('the big cube moved and the small one is back', bodies2.length === 2 && near(bodies2[0].at, [0, 15, 0]) && near(bodies2[1].at, [40, 0, 0]), JSON.stringify(bodies2));
const script2 = (await agentCall(page, 'get_script', {})).result?.source || '';
check('script names the big cube centroid', /at: \[0, 0, 0\]/.test(script2), script2.slice(-200));

// A target that is no body leaves the part failed: the confirm says so, with detail.
const opened2 = await agentCall(page, 'open_feature', { id: moveChip.id });
check('open_feature move again', opened2.ok === true, JSON.stringify(opened2));
await page.waitForTimeout(500);
await agentCall(page, 'edit_feature', { params: { at: [500, 500, 500] } });
const broken = await agentCall(page, 'confirm_feature', {});
check('confirm with a bogus target is ok: false', broken.ok === true && broken.result?.ok === false, JSON.stringify(broken.result));
const errors = await agentCall(page, 'errors', {});
const row = (errors.result?.errors || [])[0];
check('feature_failed names move and carries detail', row?.code === 'feature_failed' && typeof row.detail === 'string' && /list_bodies/.test(row.detail), JSON.stringify(row));
const status = await agentCall(page, 'status', {});
check('status is failed', status.result?.runState === 'failed', JSON.stringify(status.result?.runState));

// An unchanged confirm on the failed part is still ok: false.
const opened3 = await agentCall(page, 'open_feature', { id: moveChip.id });
check('open_feature move (unchanged confirm)', opened3.ok === true);
await page.waitForTimeout(500);
const unchanged = await agentCall(page, 'confirm_feature', {});
check('unchanged confirm on a failed part is ok: false', unchanged.ok === true && unchanged.result?.ok === false && unchanged.result?.unchanged === true, JSON.stringify(unchanged.result));

// Repair with a real body through face_id, then use_selection.
await agentCall(page, 'undo', {});
const faces = await agentCall(page, 'list_faces', {});
const smallFace = (faces.result?.faces || []).find((f) => f.center && Math.abs(f.center[0] - 45) < 0.5);
check('a face on the small cube', !!smallFace, JSON.stringify((faces.result?.faces || []).length));
const byFace = await agentCall(page, 'insert_move', { face_id: smallFace.id, dx: 0, dy: 0, dz: 30 });
check('insert_move face_id', byFace.ok === true && byFace.result?.ok === true, JSON.stringify(byFace.result?.errors || byFace.error));
const bodies3 = sortByX((await agentCall(page, 'list_bodies', {})).result?.bodies || []);
check('face_id moved the small cube up', near(bodies3[1].at, [40, 0, 30]) && near(bodies3[0].at, [0, 15, 0]), JSON.stringify(bodies3));
const facesNow = await agentCall(page, 'list_faces', {});
const bigFace = (facesNow.result?.faces || []).find((f) => f.center && Math.abs(f.center[0]) < 0.5 && Math.abs(f.center[1] - 15) < 0.5 && f.normal && f.normal[2] > 0.9);
check('a face on the big cube', !!bigFace, JSON.stringify((facesNow.result?.faces || []).length));
const selected = await agentCall(page, 'select_faces', { keys: [bigFace.key] });
check('select_faces', selected.ok === true, JSON.stringify(selected));
const bySelection = await agentCall(page, 'insert_move', { use_selection: true, dx: -10, dy: 0, dz: 0 });
check('insert_move use_selection', bySelection.ok === true && bySelection.result?.ok === true, JSON.stringify(bySelection.result?.errors || bySelection.error));
const bodies4 = sortByX((await agentCall(page, 'list_bodies', {})).result?.bodies || []);
check('the selected body moved', near(bodies4[0].at, [-10, 15, 0]) && near(bodies4[1].at, [40, 0, 30]), JSON.stringify(bodies4));

check('no page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));

await browser.close();
stop();
if (failed) {
  console.log(`agent move target golden: FAIL (${failed})`);
  process.exit(1);
}
console.log('agent move target golden: ok');

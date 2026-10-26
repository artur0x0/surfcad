#!/usr/bin/env node
/**
 * Edge identity, part 3 (MVP 3 B5 / B13 / B11): `list_feature_edges` lists
 * edges by name with the face keys `list_faces` returns, agrees with
 * `list_edges` with the rollback bar active, and a pick session on an open
 * chamfer card takes edge names and accepts them.
 *
 * Vite dev server, Chrome from CHROME_PATH or the usual paths, the agent
 * bridge in-page (`window.surfcad.call`).
 */
/* global window */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { attachConsentPresetToBrowser } from './lib/presetConsentInit.mjs';

const PORT = Number(process.env.SMOKE_PORT || 4384);
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
const note = (text) => console.log(`  · ${text}`);

console.log('agent edges named golden');

const exe = CHROME_CANDIDATES.find((p) => p && existsSync(p));
if (!exe) {
  console.log('  ❌ no system Chrome found (set CHROME_PATH)');
  console.log('agent edges named golden: FAIL (no Chrome)');
  process.exit(1);
}

const server = spawn('npx', ['vite', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], {
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

const waitForServer = async () => {
  for (let i = 0; i < 120; i += 1) {
    try {
      if ((await fetch(`http://127.0.0.1:${PORT}/`)).ok) return true;
    } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
};

// A plate with a boss and a hook (a hanging tab under one end), the shapes
// whose edges the Banner End Cap playtest reported with wrong faces and
// normals (B5) and missing with the rollback bar active (B13).
const PLATE = `// --- cube begin id=plate ---
let part = Manifold.cube([120, 60, 8], true);
// --- cube end id=plate ---
// --- cube begin id=boss ---
part = part.add(Manifold.cube([20, 12, 10], true).translate([30, 0, 9]));
// --- cube end id=boss ---
// --- cube begin id=hook ---
part = part.add(Manifold.cube([6, 60, 14], true).translate([-57, 0, -11]));
// --- cube end id=hook ---
return part;
`;

const near = (a, b, tol = 1e-3) => Array.isArray(a) && Array.isArray(b) && a.length === 3 && a.every((v, i) => Math.abs(v - b[i]) <= tol);
const sameKey = (a, b) => !!a && !!b && near(a.at, b.at) && near(a.n, b.n) && Math.abs(a.area - b.area) <= 1e-3 * Math.max(1, a.area);

if (!(await waitForServer())) {
  check('dev server started', false, APP_URL);
} else {
  const browser = await chromium.launch({
    executablePath: exe,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader'],
  });
  attachConsentPresetToBrowser(browser);
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }));
    await page.route('**/api/auth/me', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ authenticated: true, user: { _id: 'user-edges-named', email: 'agent@test.local' } }),
    }));
    await page.route('**/api/config', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));

    const agentCall = (name, args) => page.evaluate(
      async ({ name, argsJson }) => window.surfcad.call(name, argsJson),
      { name, argsJson: JSON.stringify(args ?? {}) },
    );
    const script = async () => (await agentCall('get_script', {})).result?.source || '';
    const nameSet = (rows) => new Set((rows || []).map((r) => r.name).filter(Boolean));

    await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForFunction(() => typeof window.surfcad?.call === 'function', null, { timeout: 30000 });
    await page.waitForSelector('canvas', { timeout: 30000 });

    check('create_assembly', (await agentCall('create_assembly', {})).ok === true);
    const partId = (await agentCall('parts', {})).result?.activeId;
    const set = await agentCall('set_script', { part_id: partId, source: PLATE, return: 'status' });
    check('plate, boss and hook build', set.ok === true && set.result?.status?.runState === 'ok', JSON.stringify(set).slice(0, 300));

    // B5: list_feature_edges rows are named and carry the list_faces keys of both sides.
    const faces = (await agentCall('list_faces', {})).result?.faces || [];
    const faceByName = new Map(faces.map((f) => [f.name, f]));
    const listed = (await agentCall('list_feature_edges', {})).result;
    check('list_feature_edges is named', listed?.named === true && listed?.grouped === true && (listed?.edges || []).length > 0, JSON.stringify(listed).slice(0, 200));
    const rows = listed?.edges || [];
    check('every row is keyed by its name', rows.every((r) => typeof r.name === 'string' && r.key === r.name && r.name.includes('~')), JSON.stringify(rows.slice(0, 2)).slice(0, 300));
    const topRight = rows.find((r) => r.name === 'plate.right~plate.top');
    check('the plate right top edge is listed', !!topRight, [...nameSet(rows)].join(','));
    check('its face keys are the list_faces keys of plate.right and plate.top', sameKey(topRight?.faceKeyA, faceByName.get('plate.right')?.key) && sameKey(topRight?.faceKeyB, faceByName.get('plate.top')?.key), JSON.stringify({ a: topRight?.faceKeyA, b: topRight?.faceKeyB, right: faceByName.get('plate.right')?.key, top: faceByName.get('plate.top')?.key }).slice(0, 400));
    check('the plate top side has normal +Z, not -Z', Math.abs((topRight?.faceKeyB?.n?.[2] ?? 0) - 1) < 1e-6, JSON.stringify(topRight?.faceKeyB?.n));
    const keysSeen = new Set(rows.flatMap((r) => [JSON.stringify(r.faceKeyA), JSON.stringify(r.faceKeyB)]));
    check('rows do not all repeat the same couple of face keys', keysSeen.size >= 8, String(keysSeen.size));
    check('every row carries two face keys', rows.every((r) => r.faceKeyA && r.faceKeyB), JSON.stringify(rows.filter((r) => !r.faceKeyA || !r.faceKeyB).map((r) => r.name)).slice(0, 200));
    const hookRows = rows.filter((r) => r.name.includes('hook.'));
    check('the hook edges are listed', hookRows.length >= 4, hookRows.map((r) => r.name).join(','));
    const raw = (await agentCall('list_edges', {})).result?.edges || [];
    const rawNames = nameSet(raw);
    check('list_feature_edges names are the names list_edges reports', [...nameSet(rows)].every((n) => rawNames.has(n.replace(/\[\d+\]$/, '')) || rawNames.has(n)), [...nameSet(rows)].filter((n) => !rawNames.has(n.replace(/\[\d+\]$/, '')) && !rawNames.has(n)).join(','));

    // B11: a chamfer on the plate's left top edge, then more edges picked into the open card by name.
    const picked = await agentCall('pick_edges', { tool: 'chamferEdges', kind: 'edge', keys: ['plate.left~plate.top'], params: { chamfer: 1 }, accept: true });
    check('pick_edges by name on a Chamfer card accepts', picked.ok === true && picked.result?.accepted === true && picked.result?.ok === true, JSON.stringify(picked.result || picked.error).slice(0, 300));
    const src1 = await script();
    check('the chamfer is written as edgesNamed', /edgesNamed\(part, "plate\.left~plate\.top"\)/.test(src1), src1.slice(-400));
    const tree = (await agentCall('feature_tree', {})).result;
    const chamferChip = (tree?.features || []).find((f) => f.kind === 'chamfer');
    check('feature_tree lists the chamfer', !!chamferChip);
    const opened = await agentCall('open_feature', { id: chamferChip?.id });
    check('open_feature on the chamfer', opened.ok === true, JSON.stringify(opened).slice(0, 200));
    await page.waitForTimeout(800);
    const begun = await agentCall('pick_begin', { kind: 'edge' });
    check('pick_begin on the open chamfer card is seeded with its edge', begun.ok === true && begun.result?.tool === 'chamferEdges' && (begun.result?.seeded ?? 0) >= 1, JSON.stringify(begun.result || begun.error).slice(0, 300));
    const next = await agentCall('pick_next', { keys: ['plate.right~plate.top'] });
    check('pick_next by name on the open card is accepted (B11)', next.ok === true && (next.result?.count ?? 0) >= 2, JSON.stringify(next.result || next.error).slice(0, 300));
    const done = await agentCall('pick_done', { accept: true });
    check('pick_done accept on the edit card writes both edges', done.ok === true && done.result?.accepted === true && done.result?.ok === true, JSON.stringify(done.result || done.error).slice(0, 300));
    const src2 = await script();
    check('the chamfer block now names both edges', /edgesNamed\(part, "plate\.left~plate\.top"\)/.test(src2) && /edgesNamed\(part, "plate\.right~plate\.top"\)/.test(src2), src2.slice(-600));
    check('still one chamfer block', (await agentCall('feature_tree', {})).result?.features?.filter((f) => f.kind === 'chamfer').length === 1);
    const afterRows = (await agentCall('list_feature_edges', {})).result?.edges || [];
    check('the chamfer surface is a named face on the edge list', afterRows.some((r) => /\.bevel/.test(r.name)), [...nameSet(afterRows)].filter((n) => /bevel/.test(n)).join(','));

    // B13: with the rollback bar before the chamfer, list_feature_edges agrees with list_edges and lists the hook.
    const rolled = await agentCall('rollback_to', { id: 'hook' });
    check('rollback_to the hook', rolled.ok === true && rolled.result?.rollbackAnchor === 'hook', JSON.stringify(rolled).slice(0, 200));
    await page.waitForTimeout(600);
    const rolledRows = (await agentCall('list_feature_edges', {})).result?.edges || [];
    const rolledRaw = (await agentCall('list_edges', {})).result?.edges || [];
    const rolledRawNames = nameSet(rolledRaw);
    check('rolled back: no bevel edges in either list', ![...nameSet(rolledRows)].some((n) => /bevel/.test(n)) && ![...rolledRawNames].some((n) => /bevel/.test(n)));
    check('rolled back: the hook edges are listed', rolledRows.filter((r) => r.name.includes('hook.')).length >= 4, rolledRows.filter((r) => r.name.includes('hook.')).map((r) => r.name).join(','));
    check('rolled back: feature edge names agree with list_edges', [...nameSet(rolledRows)].every((n) => rolledRawNames.has(n.replace(/\[\d+\]$/, '')) || rolledRawNames.has(n)), [...nameSet(rolledRows)].filter((n) => !rolledRawNames.has(n.replace(/\[\d+\]$/, '')) && !rolledRawNames.has(n)).join(','));
    const rolledRight = rolledRows.find((r) => r.name === 'plate.right~plate.top');
    check('rolled back: the plate edge keeps its +Z face key', !!rolledRight && Math.abs((rolledRight.faceKeyB?.n?.[2] ?? 0) - 1) < 1e-6, JSON.stringify(rolledRight?.faceKeyB));
    check('rollback_to clear restores the chamfer', (await agentCall('rollback_to', { clear: true })).ok === true);
    await page.waitForTimeout(600);
    note(`${rows.length} named edges before the chamfer, ${afterRows.length} after, ${rolledRows.length} rolled back`);

    check('no page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
  } finally {
    await browser.close();
  }
}

stop();
if (failed) {
  console.log(`agent edges named golden: FAIL (${failed})`);
  process.exit(1);
}
console.log('agent edges named golden: ok');
process.exit(0);

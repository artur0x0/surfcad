#!/usr/bin/env node
/**
 * Face identity, part 2: picking by name through the bridge. `select_faces
 * { names }` picks the stamped face itself, `insert_hole` and
 * `insert_chamfer_edges` with `use_selection` write `facesNamed` / `edgesOf`
 * into the script and touch only that face, `list_faces` filters by
 * feature and role, `select_edges { names }` picks the edge between two
 * named faces, and a rounded box top is picked without its band (bug M5).
 *
 * Vite dev server, Chrome from CHROME_PATH or the usual paths, the agent
 * bridge in-page (`window.surfcad.call`).
 */
/* global window */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { attachConsentPresetToBrowser } from './lib/presetConsentInit.mjs';

const PORT = Number(process.env.SMOKE_PORT || 4382);
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

console.log('face identity select golden');

const exe = CHROME_CANDIDATES.find((p) => p && existsSync(p));
if (!exe) {
  console.log('  ❌ no system Chrome found (set CHROME_PATH)');
  console.log('face identity select golden: FAIL (no Chrome)');
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

// The bike seat boss, in miniature: a plate with a boss whose top faces the
// same way as the plate top and 24 roller ends, the shape that made the
// normal filter take hundreds of edges (bug M3).
const PLATE_BOSS = `// --- cube begin id=plate ---
let part = Manifold.cube([120, 60, 8], true);
// --- cube end id=plate ---
// --- cube begin id=boss ---
part = part.add(Manifold.cube([20, 12, 10], true).translate([30, 0, 9]));
// --- cube end id=boss ---
// --- cylinder begin id=rollers ---
for (let i = 0; i < 12; i++) {
  part = part.add(Manifold.cylinder(6, 2.5, 2.5, 16, false).translate([-50 + i * 8, 20, 4]));
  part = part.add(Manifold.cylinder(6, 2.5, 2.5, 16, false).translate([-50 + i * 8, -20, 4]));
}
// --- cylinder end id=rollers ---
return part;
`;
const PLATE_BOSS_VOLUME = 120 * 60 * 8 + 20 * 12 * 10 + 24 * Math.PI * 2.5 * 2.5 * 6 * (Math.sin(Math.PI / 16) / (Math.PI / 16)) * (Math.cos(Math.PI / 16));

const ROUNDED = `// --- roundedBox begin id=boss ---
let part = roundedBox([80, 44, 16], 6, 8);
// --- roundedBox end id=boss ---
return part;
`;

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
      body: JSON.stringify({ authenticated: true, user: { _id: 'user-face-identity-select', email: 'agent@test.local' } }),
    }));
    await page.route('**/api/config', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));

    const agentCall = (name, args) => page.evaluate(
      async ({ name, argsJson }) => window.surfcad.call(name, argsJson),
      { name, argsJson: JSON.stringify(args ?? {}) },
    );
    const script = async () => (await agentCall('get_script', {})).result?.source || '';
    const volume = async () => (await agentCall('status', {})).result?.volume;

    await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForFunction(() => typeof window.surfcad?.call === 'function', null, { timeout: 30000 });
    await page.waitForSelector('canvas', { timeout: 30000 });

    check('create_assembly', (await agentCall('create_assembly', {})).ok === true);
    const partId = (await agentCall('parts', {})).result?.activeId;
    check('active part', typeof partId === 'string');
    const set = await agentCall('set_script', { part_id: partId, source: PLATE_BOSS, return: 'status' });
    check('plate with boss and rollers builds', set.ok === true && set.result?.status?.runState === 'ok', JSON.stringify(set).slice(0, 300));
    const v0 = await volume();
    note(`volume ${v0?.toFixed(1)} (expected about ${PLATE_BOSS_VOLUME.toFixed(1)})`);

    // list_faces filters by feature and role.
    const bossFaces = (await agentCall('list_faces', { filter: { feature: 'boss' } })).result;
    // Five, not six: the boss bottom is buried in the plate.
    check('filter { feature: "boss" } lists the five boss faces', bossFaces?.total === 5 && (bossFaces.faces || []).every((r) => r.feature === 'boss'), JSON.stringify(bossFaces?.total));
    const tops = (await agentCall('list_faces', { filter: { role: 'top' } })).result;
    const topNames = (tops?.faces || []).map((r) => r.name).sort();
    check('filter { role: "top" } lists the plate, boss and roller tops', topNames.includes('plate.top') && topNames.includes('boss.top') && topNames.some((n) => n.startsWith('rollers.top')), topNames.join(','));
    // The face graph shows the 24 coplanar roller tops as one pickable patch;
    // the label without its [k] still names every piece.
    const rollerTops = await agentCall('select_faces', { names: ['rollers.top'] });
    check('select_faces { names: ["rollers.top"] } takes all 24 roller tops', rollerTops.ok === true && rollerTops.result?.count === 24, JSON.stringify(rollerTops.result || rollerTops.error).slice(0, 200));
    check('select_clear', (await agentCall('select_clear', {})).ok === true);

    // Chamfer by name: select the boss top, chamfer with use_selection.
    const sel = await agentCall('select_faces', { names: ['boss.top'] });
    check('select_faces { names: ["boss.top"] }', sel.ok === true && sel.result?.count === 1 && sel.result?.names?.[0] === 'boss.top', JSON.stringify(sel).slice(0, 200));
    const selection = (await agentCall('selection', {})).result;
    check('the selection carries the name', selection?.face?.name === 'boss.top', JSON.stringify(selection?.face).slice(0, 200));
    const chamfer = await agentCall('insert_chamfer_edges', { use_selection: true, chamfer: 2, return: 'status' });
    check('insert_chamfer_edges with the named pick', chamfer.ok === true && chamfer.result?.usedSelection === true && chamfer.result?.status?.runState === 'ok', JSON.stringify(chamfer.result?.errors || chamfer.error).slice(0, 300));
    const src1 = await script();
    check('the script chamfers edgesOf(part, "boss.top")', /edgesOf\(part, "boss\.top"\)/.test(src1), src1.slice(-400));
    check('the script does not filter convexEdges by normal', !/convexEdges\(part\)\.filter/.test(src1));
    const v1 = await volume();
    const removed = v0 - v1;
    const expectBoss = 0.5 * 2 * 2 * (20 + 20 + 12 + 12);
    check('only the boss top was chamfered', Number.isFinite(removed) && Math.abs(removed - expectBoss) < expectBoss * 0.2, `removed ${removed?.toFixed(2)} expected about ${expectBoss}`);

    // A hole by name on the plate top (whose label is now plate.top, unchanged by the chamfer).
    const sel2 = await agentCall('select_faces', { names: ['plate.top'] });
    check('select_faces plate.top after the rebuild', sel2.ok === true && sel2.result?.count === 1, JSON.stringify(sel2).slice(0, 200));
    const hole = await agentCall('insert_hole', { use_selection: true, holeType: 'clearance', size: 'M6', fit: 'normal', return: 'status' });
    check('insert_hole with the named pick', hole.ok === true && hole.result?.usedSelection === true && hole.result?.status?.runState === 'ok', JSON.stringify(hole.result?.errors || hole.error).slice(0, 300));
    const src2 = await script();
    check('the script resolves the hole face with facesNamed(part, "plate.top")', /facesNamed\(part, "plate\.top"\)/.test(src2), src2.slice(-600));
    const v2 = await volume();
    // M6 normal-fit clearance is 6.6 mm through the 8 mm plate.
    const holeVol = Math.PI * 3.3 * 3.3 * 8;
    check('the hole went through the plate', Number.isFinite(v2) && Math.abs((v1 - v2) - holeVol) < holeVol * 0.2, `removed ${(v1 - v2)?.toFixed(2)} expected about ${holeVol.toFixed(2)}`);

    // Edges by name.
    // The plate's right top edge, untouched so far (the boss top edges are now chamfer seams).
    const edgesList = (await agentCall('list_edges', { filter: { bbox: { min: [59, -31, 3], max: [61, 31, 5] } } })).result;
    const namedRows = (edgesList?.edges || []).filter((e) => e.name);
    check('list_edges rows on the plate edge carry names', namedRows.length > 0 && namedRows.every((e) => e.name === 'plate.right~plate.top'), JSON.stringify((edgesList?.edges || []).map((e) => e.name)).slice(0, 200));
    const selEdge = await agentCall('select_edges', { names: ['plate.top~plate.right'] });
    // Names come back canonical: the two faces in name order.
    check('select_edges { names: ["plate.top~plate.right"] }', selEdge.ok === true && selEdge.result?.count >= 1 && selEdge.result?.names?.[0] === 'plate.right~plate.top', JSON.stringify(selEdge).slice(0, 200));
    const fillet = await agentCall('insert_fillet_edges', { use_selection: true, radius: 2, return: 'status' });
    check('insert_fillet_edges with the named edge', fillet.ok === true && fillet.result?.usedSelection === true && fillet.result?.status?.runState === 'ok', JSON.stringify(fillet.result?.errors || fillet.error).slice(0, 300));

    // An unknown name fails loudly, naming what exists.
    const bad = await agentCall('select_faces', { names: ['boss.lid'] });
    check('an unknown face name is unknown_face and lists the names', bad.ok === false && bad.error?.code === 'unknown_face' && /boss\.top/.test(bad.error?.message || ''), JSON.stringify(bad.error).slice(0, 200));

    // Bug M5: a rounded box top is picked without its band and takes a hole.
    const setR = await agentCall('set_script', { part_id: partId, source: ROUNDED, return: 'status' });
    check('rounded box builds', setR.ok === true && setR.result?.status?.runState === 'ok');
    const rows = (await agentCall('list_faces', { filter: { name: 'boss.top' } })).result;
    check('list_faces finds boss.top on the rounded box', rows?.total === 1, JSON.stringify(rows?.total));
    const selR = await agentCall('select_faces', { names: ['boss.top'] });
    check('select_faces boss.top on the rounded box', selR.ok === true && selR.result?.count === 1, JSON.stringify(selR).slice(0, 200));
    const faceR = (await agentCall('selection', {})).result?.face;
    check('the named pick is the flat top (planar, +Z, the flat area only)', faceR?.type === 'planar' && Math.abs((faceR?.normal?.[2] ?? 0) - 1) < 1e-6 && Math.abs((faceR?.area ?? 0) - (80 - 12) * (44 - 12)) < 1, JSON.stringify({ type: faceR?.type, area: faceR?.area }));
    const vR0 = await volume();
    const holeR = await agentCall('insert_hole', { use_selection: true, holeType: 'clearance', size: 'M5', fit: 'normal', return: 'status' });
    check('insert_hole on the rounded box top by name', holeR.ok === true && holeR.result?.status?.runState === 'ok', JSON.stringify(holeR.result?.errors || holeR.error).slice(0, 300));
    const vR1 = await volume();
    // M5 normal-fit clearance is 5.5 mm through the 16 mm box.
    const expectR = Math.PI * 2.75 * 2.75 * 16;
    check('the hole goes straight through the rounded box', Number.isFinite(vR1) && Math.abs((vR0 - vR1) - expectR) < expectR * 0.25, `removed ${(vR0 - vR1)?.toFixed(2)} expected about ${expectR.toFixed(2)}`);

    check('no page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
  } finally {
    await browser.close();
  }
}

stop();
if (failed) {
  console.log(`face identity select golden: FAIL (${failed})`);
  process.exit(1);
}
console.log('face identity select golden: ok');

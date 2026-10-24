#!/usr/bin/env node
/**
 * Face identity, part 3: a named face pick survives the rebuild. Pick a
 * face by name, insert a hole with use_selection, then insert a second
 * hole with use_selection WITHOUT picking again: the pick was found again
 * on the new mesh by its name, so the second insert lands on the same face
 * (the bike session's second hole fell back to the default face, then #679
 * made that a no_selection refusal). A pick on unstamped geometry (a hull)
 * still clears, so no_selection stays for a face that was never named.
 * Sweep and loft faces are named too.
 */
/* global window, document */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { attachConsentPresetToBrowser } from './lib/presetConsentInit.mjs';

const PORT = Number(process.env.SMOKE_PORT || 4383);
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

console.log('face identity rebuild golden');

const exe = CHROME_CANDIDATES.find((p) => p && existsSync(p));
if (!exe) {
  console.log('  ❌ no system Chrome found (set CHROME_PATH)');
  console.log('face identity rebuild golden: FAIL (no Chrome)');
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

const PLATE = `// --- cube begin id=plate ---
let part = Manifold.cube([80, 40, 8], true);
// --- cube end id=plate ---
return part;
`;
const HULL = 'let part = Manifold.hull([Manifold.cube([40, 40, 8], true), Manifold.sphere(3, 12).translate([0, 0, 12])]); return part;\n';
const SWEEP_LOFT = `const pl = { center: [0, 0, 0], normal: [0, 0, 1], x: [1, 0, 0], y: [0, 1, 0] };
// --- contour-mode sweep begin id=rail ---
const c1 = makeCrossSection(pl, profileRectangle(6, 4));
let part = sweepPoints(new CrossSection(c1.contours), [[0, 0, 0], [20, 0, 5], [40, 10, 10]], { closed: false, initialNormal: [1, 0, 0] });
// --- contour-mode sweep end id=rail ---
// --- contour-mode loft begin id=neck ---
const a = makeCrossSection(pl, profileRectangle(40, 20));
const c = makeCrossSection(pl, profileCircle(6, 32));
part = part.add(makeLoft([a, { ...c, plane: offsetPlaneFrame(c.plane, 30) }]).translate([-60, 0, 0]));
// --- contour-mode loft end id=neck ---
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
      body: JSON.stringify({ authenticated: true, user: { _id: 'user-face-identity-rebuild', email: 'agent@test.local' } }),
    }));
    await page.route('**/api/config', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));

    const agentCall = (name, args) => page.evaluate(
      async ({ name, argsJson }) => window.surfcad.call(name, argsJson),
      { name, argsJson: JSON.stringify(args ?? {}) },
    );
    const volume = async () => (await agentCall('status', {})).result?.volume;
    const selectedFace = async () => (await agentCall('selection', {})).result?.face ?? null;
    const picksMarker = () => page.evaluate(() => document.querySelector('[data-feature-picks]')?.getAttribute('data-feature-picks') ?? null);

    await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForFunction(() => typeof window.surfcad?.call === 'function', null, { timeout: 30000 });
    await page.waitForSelector('canvas', { timeout: 30000 });

    check('create_assembly', (await agentCall('create_assembly', {})).ok === true);
    const partId = (await agentCall('parts', {})).result?.activeId;
    check('active part', typeof partId === 'string');
    const set = await agentCall('set_script', { part_id: partId, source: PLATE, return: 'status' });
    check('plate builds', set.ok === true && set.result?.status?.runState === 'ok', JSON.stringify(set).slice(0, 200));
    const v0 = await volume();

    // One pick, two holes.
    const sel = await agentCall('select_faces', { names: ['plate.top'] });
    check('select_faces plate.top', sel.ok === true && sel.result?.count === 1, JSON.stringify(sel).slice(0, 200));
    const hole1 = await agentCall('insert_hole', { use_selection: true, holeType: 'clearance', size: 'M6', u: 20, v: 0, return: 'status' });
    check('first hole with the named pick', hole1.ok === true && hole1.result?.usedSelection === true && hole1.result?.status?.runState === 'ok', JSON.stringify(hole1.result?.errors || hole1.error).slice(0, 300));
    const after1 = await selectedFace();
    check('the pick is still there after the rebuild, by name', after1?.name === 'plate.top', JSON.stringify(after1).slice(0, 200));
    check('the viewport marks the re-found pick', (await picksMarker()) === 'renamed', String(await picksMarker()));
    const hole2 = await agentCall('insert_hole', { use_selection: true, holeType: 'clearance', size: 'M6', u: -20, v: 0, return: 'status' });
    check('second hole with the same pick, no re-pick', hole2.ok === true && hole2.result?.usedSelection === true && hole2.result?.status?.runState === 'ok', JSON.stringify(hole2.result?.errors || hole2.error).slice(0, 300));
    const v2 = await volume();
    const holeVol = Math.PI * 3.3 * 3.3 * 8;
    check('two holes went through the plate top', Number.isFinite(v2) && Math.abs((v0 - v2) - 2 * holeVol) < holeVol * 0.3, `removed ${(v0 - v2)?.toFixed(2)} expected about ${(2 * holeVol).toFixed(2)}`);
    const src = (await agentCall('get_script', {})).result?.source || '';
    check('both holes resolve the face by name', (src.match(/facesNamed\(part, "plate\.top"\)/g) || []).length === 2, src.slice(-500));
    check('select_clear drops the pick', (await agentCall('select_clear', {})).ok === true && (await selectedFace()) === null);
    const none = await agentCall('insert_hole', { use_selection: true, holeType: 'clearance', size: 'M6', return: 'status' });
    check('with nothing ever picked, use_selection is still no_selection', none.ok === false && none.error?.code === 'no_selection', JSON.stringify(none.error).slice(0, 200));

    // Unstamped geometry: the pick clears after the rebuild as before.
    const setH = await agentCall('set_script', { part_id: partId, source: HULL, return: 'status' });
    check('hull builds', setH.ok === true && setH.result?.status?.runState === 'ok');
    const topRow = ((await agentCall('list_faces', { filter: { kind: 'planar', normalWithin: { n: [0, 0, -1], deg: 5 } } })).result?.faces || [])[0];
    check('the hull bottom has a key and no name', !!topRow?.key && topRow?.name === undefined, JSON.stringify(topRow).slice(0, 200));
    const selK = await agentCall('select_faces', { keys: [topRow.key] });
    check('select_faces by key on the hull', selK.ok === true && selK.result?.count === 1, JSON.stringify(selK).slice(0, 200));
    const holeH = await agentCall('insert_hole', { use_selection: true, holeType: 'clearance', size: 'M4', return: 'status' });
    check('a hole on the unnamed pick', holeH.ok === true && holeH.result?.usedSelection === true && holeH.result?.status?.runState === 'ok', JSON.stringify(holeH.result?.errors || holeH.error).slice(0, 300));
    check('the unnamed pick cleared with the rebuild', (await selectedFace()) === null);
    const againH = await agentCall('insert_hole', { use_selection: true, holeType: 'clearance', size: 'M4', return: 'status' });
    check('a second insert on the cleared pick is no_selection', againH.ok === false && againH.error?.code === 'no_selection', JSON.stringify(againH.error).slice(0, 200));

    // Sweep and loft faces are named.
    const setS = await agentCall('set_script', { part_id: partId, source: SWEEP_LOFT, return: 'status' });
    check('sweep and loft build', setS.ok === true && setS.result?.status?.runState === 'ok', JSON.stringify(setS.result?.errors || setS.error).slice(0, 300));
    const rows = (await agentCall('list_faces', {})).result?.faces || [];
    const got = rows.map((r) => r.name).filter(Boolean);
    note(`names: ${[...new Set(got)].sort().join(', ')}`);
    check('sweep caps and walls are named', ['rail.cap0', 'rail.cap1', 'rail.wall[0]', 'rail.wall[3]'].every((n) => got.includes(n)), got.join(','));
    check('loft caps and spans are named', ['neck.cap0', 'neck.cap1', 'neck.span[0][0]', 'neck.span[3][0]'].every((n) => got.includes(n)), got.join(','));
    const selL = await agentCall('select_faces', { names: ['neck.cap1'] });
    check('select_faces neck.cap1', selL.ok === true && selL.result?.count === 1);
    const holeL = await agentCall('insert_hole', { use_selection: true, holeType: 'clearance', size: 'M3', return: 'status' });
    check('a hole by name on the loft cap', holeL.ok === true && holeL.result?.status?.runState === 'ok', JSON.stringify(holeL.result?.errors || holeL.error).slice(0, 300));

    check('no page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
  } finally {
    await browser.close();
  }
}

stop();
if (failed) {
  console.log(`face identity rebuild golden: FAIL (${failed})`);
  process.exit(1);
}
console.log('face identity rebuild golden: ok');

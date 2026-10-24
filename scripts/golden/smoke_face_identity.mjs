#!/usr/bin/env node
/**
 * Face identity, part 1: `list_faces` rows carry the names the helpers
 * stamped at construction, the names survive an edit and a rebuild, the
 * active part's named-face table lists edges between named faces, and
 * `facesNamed` places a feature by name in the kernel.
 *
 * Vite dev server, Chrome from CHROME_PATH or the usual paths, the agent
 * bridge in-page (`window.surfcad.call`) and the dev-only
 * `__VIEWPORT__.faceTable()` hook.
 */
/* global window */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { attachConsentPresetToBrowser } from './lib/presetConsentInit.mjs';

const PORT = Number(process.env.SMOKE_PORT || 4381);
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

console.log('face identity golden');

const exe = CHROME_CANDIDATES.find((p) => p && existsSync(p));
if (!exe) {
  console.log('  ❌ no system Chrome found (set CHROME_PATH)');
  console.log('face identity golden: FAIL (no Chrome)');
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

const SCRIPT = (height) => `// --- cube begin id=base ---
let part = Manifold.cube([40, 24, ${height}], true);
// --- cube end id=base ---
// --- cylinder begin id=boss ---
part = part.add(Manifold.cylinder(12, 5, 5, 32, false).translate([8, 0, ${height / 2}]));
// --- cylinder end id=boss ---
// --- hole begin id=pin ---
part = part.subtract(Manifold.cylinder(100, 2, 2, 24, true).translate([-12, 0, 0]));
// --- hole end id=pin ---
return part;
`;

const BY_NAME = `// --- cube begin id=plate ---
let part = Manifold.cube([40, 24, 6], true);
// --- cube end id=plate ---
// --- hole begin id=h1 ---
part = hole(part, workplaneFromFace(part, facesNamed(part, 'plate.top')[0]), 10, 0, 4, 6);
// --- hole end id=h1 ---
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
      body: JSON.stringify({ authenticated: true, user: { _id: 'user-face-identity', email: 'agent@test.local' } }),
    }));
    await page.route('**/api/config', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));

    const agentCall = (name, args) => page.evaluate(
      async ({ name, argsJson }) => window.surfcad.call(name, argsJson),
      { name, argsJson: JSON.stringify(args ?? {}) },
    );
    const faceTable = () => page.evaluate(() => window.__VIEWPORT__?.faceTable?.() ?? null);

    await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForFunction(() => typeof window.surfcad?.call === 'function', null, { timeout: 30000 });
    await page.waitForSelector('canvas', { timeout: 30000 });

    const created = await agentCall('create_assembly', {});
    check('create_assembly', created.ok === true, JSON.stringify(created).slice(0, 200));
    const partId = (await agentCall('parts', {})).result?.activeId;
    check('active part', typeof partId === 'string');

    const set1 = await agentCall('set_script', { part_id: partId, source: SCRIPT(10), return: 'status' });
    check('set_script builds', set1.ok === true && set1.result?.status?.runState === 'ok', JSON.stringify(set1).slice(0, 300));

    const list1 = await agentCall('list_faces', {});
    const rows1 = list1.result?.faces || [];
    check('list_faces returns the nine stamped faces', rows1.length === 9, `rows ${rows1.length}`);
    const named1 = rows1.filter((r) => typeof r.name === 'string');
    check('every row carries a name on an all-stamped part', named1.length === rows1.length, `${named1.length} of ${rows1.length}`);
    const names1 = named1.map((r) => r.name).sort();
    note(`names: ${names1.join(', ')}`);
    for (const want of ['base.top', 'base.bottom', 'base.front', 'boss.side', 'boss.top', 'pin.side']) {
      check(`list_faces names ${want}`, names1.includes(want), names1.join(','));
    }
    const top = named1.find((r) => r.name === 'base.top');
    check('base.top row has feature and role', top?.feature === 'base' && top?.role === 'top');
    check('base.top row still has its fingerprint key', !!top?.key && Array.isArray(top.key.at) && top.key.area > 0);
    check('base.top row is planar with +Z normal', top?.type === 'planar' && Math.abs((top?.normal?.[2] ?? 0) - 1) < 1e-6);
    const boss = named1.find((r) => r.name === 'boss.side');
    check('boss.side row is cylindrical with radius 5', boss?.type === 'cylindrical' && Math.abs((boss?.radius ?? 0) - 5) < 0.05, JSON.stringify({ type: boss?.type, radius: boss?.radius }));

    const filtered = await agentCall('list_faces', { filter: { kind: 'planar', normalWithin: { n: [0, 0, 1], deg: 5 } } });
    const topNames = (filtered.result?.faces || []).map((r) => r.name).sort();
    check('filter keeps names on the rows', topNames.includes('base.top') && topNames.includes('boss.top'), topNames.join(','));

    const table1 = await faceTable();
    check('faceTable hook answers', !!table1 && Array.isArray(table1.faces) && Array.isArray(table1.edges), JSON.stringify(table1).slice(0, 200));
    const tableNames = (table1?.faces || []).map((f) => f.name).sort();
    check('faceTable names match list_faces names', JSON.stringify(tableNames) === JSON.stringify([...new Set(names1)].sort()), `${tableNames.length} vs ${new Set(names1).size}`);
    const edgeNames = (table1?.edges || []).map((e) => e.name);
    check('faceTable has the top edges of the base', edgeNames.includes('base.right~base.top') && edgeNames.includes('base.front~base.top'), edgeNames.slice(0, 12).join(', '));
    check('faceTable has the boss seam on the top', edgeNames.includes('base.top~boss.side'), edgeNames.filter((n) => n.includes('boss')).join(', '));
    const bossEdge = (table1?.edges || []).find((e) => e.name === 'base.top~boss.side');
    check('boss seam is a closed loop of about 2πr', !!bossEdge && bossEdge.closed === true && Math.abs(bossEdge.length - 2 * Math.PI * 5) < 0.5, JSON.stringify(bossEdge));
    const topFace = (table1?.faces || []).find((f) => f.name === 'base.top');
    check('faceTable record for base.top is a plane', topFace?.record?.kind === 'plane', JSON.stringify(topFace?.record));

    // Edit the base height and rebuild: every name is the same.
    const set2 = await agentCall('set_script', { part_id: partId, source: SCRIPT(16), return: 'status' });
    check('rebuild after edit', set2.ok === true && set2.result?.status?.runState === 'ok');
    const rows2 = (await agentCall('list_faces', {})).result?.faces || [];
    const names2 = rows2.map((r) => r.name).filter(Boolean).sort();
    check('names unchanged across the edit', JSON.stringify(names1) === JSON.stringify(names2), `before ${names1.length} after ${names2.length}: ${names2.join(',')}`);
    const top2 = rows2.find((r) => r.name === 'base.top');
    check('base.top moved up with the edit', Math.abs((top2?.center?.[2] ?? 0) - 8) < 1e-3, JSON.stringify(top2?.center));

    // A hole placed by name in the kernel.
    const set3 = await agentCall('set_script', { part_id: partId, source: BY_NAME, return: 'status' });
    check('facesNamed places a hole by name', set3.ok === true && set3.result?.status?.runState === 'ok', JSON.stringify(set3.result?.errors || set3.error).slice(0, 300));
    const vol = set3.result?.status?.volume;
    check('hole by name removed material', Number.isFinite(vol) && vol < 40 * 24 * 6 - 50 && vol > 40 * 24 * 6 - 100, `volume ${vol}`);
    const rows3 = (await agentCall('list_faces', {})).result?.faces || [];
    check('the plate keeps its names after the hole', rows3.some((r) => r.name === 'plate.top') && rows3.some((r) => r.name === 'plate.bottom'), rows3.map((r) => r.name).join(','));

    // A freehand hull has no names and the rows still work on their keys.
    const set4 = await agentCall('set_script', { part_id: partId, source: 'let part = Manifold.hull([Manifold.sphere(4, 12), Manifold.sphere(4, 12).translate([20, 0, 0])]); return part;\n', return: 'status' });
    check('hull builds', set4.ok === true && set4.result?.status?.runState === 'ok');
    const rows4 = (await agentCall('list_faces', {})).result?.faces || [];
    check('unstamped faces have no name and keep their key', rows4.length > 0 && rows4.every((r) => r.name === undefined && r.key), `rows ${rows4.length}`);

    check('no page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
  } finally {
    await browser.close();
  }
}

stop();
if (failed) {
  console.log(`face identity golden: FAIL (${failed})`);
  process.exit(1);
}
console.log('face identity golden: ok');

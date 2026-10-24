/* eslint-env node */
/* global document, window, requestAnimationFrame */
/**
 * GPU upload cache golden (rendering roadmap PR 4).
 *
 * Solid geometries are cached per (partId, mesh content hash): a run that
 * returns the same mesh keeps the BufferGeometry it already shows, so no
 * new GPU buffers are built. This golden drives a three-part assembly over
 * the agent bridge and reads `window.__VIEWPORT__.gpuStats()`:
 *
 *   1. a rerun of part A with only a comment changed builds nothing;
 *   2. a size change on part A builds exactly one geometry (B and C keep theirs);
 *   3. a part switch and back builds nothing;
 *   4. deleting part C disposes one geometry and the renderer holds one less.
 *
 * Dev server on SMOKE_PORT (default 4391); Chrome from CHROME_PATH.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { attachConsentPresetToBrowser } from './lib/presetConsentInit.mjs';

const PORT = Number(process.env.SMOKE_PORT || 4391);
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

console.log('gpu upload cache');

const exe = CHROME_CANDIDATES.find((p) => p && existsSync(p));
if (!exe) {
  console.log('  ❌ no system Chrome found (set CHROME_PATH)');
  console.log('gpu upload cache: FAIL (no Chrome)');
  process.exit(1);
}

const server = spawn('npx', ['vite', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, BROWSER: 'none' },
});
let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d.toString(); });
server.stderr.on('data', (d) => { serverLog += d.toString(); });
const stop = () => {
  try { server.kill('SIGTERM'); } catch { /* already gone */ }
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

const cube = (size, comment = '') => `${comment}const part = Manifold.cube([${size}, ${size}, ${size}], true);\nreturn part;\n`;

if (!(await waitForServer())) {
  check('dev server started', false, serverLog.slice(-400));
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
      body: JSON.stringify({ authenticated: true, user: { _id: 'user-gpu-cache', email: 'agent@test.local' } }),
    }));
    await page.route('**/api/config', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));

    const agentCall = (name, args) => page.evaluate(
      async ({ name, argsJson }) => window.surfcad.call(name, argsJson),
      { name, argsJson: JSON.stringify(args ?? {}) },
    );
    const stats = async () => {
      // Two frames so a geometry freed this turn leaves the renderer's count.
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      return page.evaluate(() => window.__VIEWPORT__?.gpuStats?.() ?? null);
    };
    const fmt = (s) => (s ? `builds=${s.builds} reuses=${s.reuses} disposed=${s.disposed} live=${s.live} renderer=${s.rendererGeometries} scene=${s.sceneGeometries}` : 'null');
    const partIdOf = (res) => res?.partId ?? res?.result?.partId ?? null;
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      () => typeof window.surfcad?.call === 'function' && !document.querySelector('[data-app-loading]'),
      null,
      { timeout: 60000 },
    );
    await page.waitForFunction(() => !!window.__VIEWPORT__?.ready?.(), null, { timeout: 30000 });

    // Three parts: A (active), B, C.
    const created = await agentCall('create_assembly', {});
    check('create_assembly', created?.ok === true, JSON.stringify(created).slice(0, 300));
    const parts = await agentCall('parts', {});
    const aId = parts?.result?.activeId ?? null;
    check('active part A exists', typeof aId === 'string', JSON.stringify(parts).slice(0, 300));
    const aSet = await agentCall('set_script', { part_id: aId, source: cube(20) });
    check('A set_script ok', aSet?.ok === true, JSON.stringify(aSet).slice(0, 300));
    const madeB = await agentCall('create_part', { name: 'B', script: cube(14) });
    const bId = partIdOf(madeB);
    check('create_part B', madeB?.ok === true && typeof bId === 'string', JSON.stringify(madeB).slice(0, 300));
    const madeC = await agentCall('create_part', { name: 'C', script: cube(8) });
    const cId = partIdOf(madeC);
    check('create_part C', madeC?.ok === true && typeof cId === 'string', JSON.stringify(madeC).slice(0, 300));
    const backToA = await agentCall('set_active_part', { part_id: aId });
    check('set_active_part A', backToA?.ok === true, JSON.stringify(backToA).slice(0, 300));

    const s0 = await stats();
    check('gpuStats readable', !!s0 && Number.isFinite(s0.builds) && Number.isFinite(s0.rendererGeometries), fmt(s0));
    note(`after setup: ${fmt(s0)}`);

    // 1. Same geometry, different text: no new geometry.
    const aComment = await agentCall('set_script', { part_id: aId, source: cube(20, '// unchanged geometry\n') });
    check('A rerun (comment only) ok', aComment?.ok === true, JSON.stringify(aComment).slice(0, 300));
    const s1 = await stats();
    note(`after comment rerun: ${fmt(s1)}`);
    check('comment-only rerun builds no geometry', s1.builds === s0.builds, `${s0.builds} -> ${s1.builds}`);
    check('comment-only rerun reuses the cached geometry', s1.reuses > s0.reuses, `${s0.reuses} -> ${s1.reuses}`);
    check('renderer geometry count is steady after a no-op rerun', s1.rendererGeometries === s0.rendererGeometries, `${s0.rendererGeometries} -> ${s1.rendererGeometries}`);

    // 2. A real change on A: exactly one geometry built, B and C untouched.
    const aBigger = await agentCall('set_script', { part_id: aId, source: cube(26) });
    check('A size change ok', aBigger?.ok === true, JSON.stringify(aBigger).slice(0, 300));
    const s2 = await stats();
    note(`after size change: ${fmt(s2)}`);
    check('size change builds exactly one geometry', s2.builds === s1.builds + 1, `${s1.builds} -> ${s2.builds}`);
    check('live geometry count is steady after the change (old A disposed)', s2.live === s1.live, `${s1.live} -> ${s2.live}`);

    // 3. Switch to B and back: the parked solids are handed over, nothing built.
    const toB = await agentCall('set_active_part', { part_id: bId });
    check('switch to B ok', toB?.ok === true, JSON.stringify(toB).slice(0, 300));
    const toA = await agentCall('set_active_part', { part_id: aId });
    check('switch back to A ok', toA?.ok === true, JSON.stringify(toA).slice(0, 300));
    const s3 = await stats();
    note(`after switch and back: ${fmt(s3)}`);
    check('part switches build no geometry', s3.builds === s2.builds, `${s2.builds} -> ${s3.builds}`);
    check('renderer geometry count is steady across a change and a switch', s3.rendererGeometries === s1.rendererGeometries, `${s1.rendererGeometries} -> ${s3.rendererGeometries}`);

    // 4. Delete C: its geometry is disposed and the renderer holds one less.
    const del = await agentCall('delete_part', { part_id: cId, scope: 'assembly' });
    check('delete_part C ok', del?.ok === true, JSON.stringify(del).slice(0, 300));
    const s4 = await stats();
    note(`after delete: ${fmt(s4)}`);
    check('deleting a part disposes its geometry', s4.disposed === s3.disposed + 1 && s4.live === s3.live - 1, `disposed ${s3.disposed} -> ${s4.disposed}, live ${s3.live} -> ${s4.live}`);
    check('renderer holds one geometry less after the delete', s4.rendererGeometries === s3.rendererGeometries - 1, `${s3.rendererGeometries} -> ${s4.rendererGeometries}`);
    check('delete builds no geometry', s4.builds === s3.builds, `${s3.builds} -> ${s4.builds}`);

    check('no page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
  } catch (err) {
    check('golden threw', false, err?.stack || String(err));
  } finally {
    await browser.close();
  }
}

stop();
if (failed) {
  console.log(`gpu upload cache: ${failed} failed`);
  process.exit(1);
}
console.log('gpu upload cache golden: ok');
// The dev server child is killed above; exit explicitly so CI's step returns.
process.exit(0);

#!/usr/bin/env node
/**
 * Adjacent parts stay on screen when another part is selected.
 *
 * Bike session (MVP-1 rendering 2): the Fork vanished when the Front Wheel
 * was selected. Two touching cubes on the Vite dev server, A at the origin
 * and B placed next to it; the active part is switched A → B through the
 * agent bridge (set_active_part, select_parts) and by a click on B, and the
 * part meshes are sampled every 50 ms through the dev-only
 * __VIEWPORT__.partMeshStates hook: which meshes the scene holds, whether
 * they are visible, culled, empty, where their bounds sit, and what the
 * renderer drew. Every scenario must end with both parts drawn, and the
 * time the deselected part spends off screen is printed.
 * Chrome from CHROME_PATH or the usual paths.
 */
/* global document, window */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { attachConsentPresetToBrowser } from './lib/presetConsentInit.mjs';

const PORT = Number(process.env.SMOKE_PORT || 4371);
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

console.log('adjacent part visible');

const exe = CHROME_CANDIDATES.find((p) => p && existsSync(p));
if (!exe) {
  console.log('  ❌ no system Chrome found (set CHROME_PATH)');
  console.log('adjacent part visible: FAIL (no Chrome)');
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
      body: JSON.stringify({ authenticated: true, user: { _id: 'user-adjacent-part', email: 'agent@test.local' } }),
    }));
    await page.route('**/api/config', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));

    const agentCall = (name, args) => page.evaluate(
      async ({ name, argsJson }) => window.surfcad.call(name, argsJson),
      { name, argsJson: JSON.stringify(args ?? {}) },
    );
    const states = () => page.evaluate(() => window.__VIEWPORT__?.partMeshStates?.() ?? null);
    const renderInfo = () => page.evaluate(() => window.__VIEWPORT__?.renderInfo?.() ?? null);
    const drawn = (s) => !!s && s.inScene && s.visible && s.parentVisible && s.material?.visible !== false
      && s.vertices > 0 && (s.material?.opacity ?? 1) > 0;
    // Which part ids are on screen right now: the active mesh counts for the
    // active id, an extra for its own id.
    // (the active entry carries the viewport's own active part id, which a
    // select_parts or a click can move away from the document's activeId.)
    const drawnIds = (list) => {
      const ids = new Set();
      for (const s of list || []) {
        if (drawn(s) && s.partId) ids.add(String(s.partId));
      }
      return ids;
    };
    const summary = (list) => (list || []).map((s) => `${s.role}${s.partId ? ':' + String(s.partId).slice(-4) : ''}${s.leftover ? '(leftover)' : ''} v=${s.vertices} vis=${s.visible ? 1 : 0}/${s.parentVisible ? 1 : 0} cull=${s.frustumCulled ? 1 : 0} pos=[${(s.position || []).map((v) => v.toFixed(1))}] bs=${s.boundingSphere ? s.boundingSphere.r.toFixed(1) : '-'}`).join(' | ');

    // Sample the scene for `ms` and report how long each id was off screen.
    const sample = async (activeId, ids, ms = 4000, step = 50) => {
      const t0 = Date.now();
      const absent = Object.fromEntries(ids.map((id) => [id, 0]));
      const lastSeen = Object.fromEntries(ids.map((id) => [id, null]));
      let last = null;
      let samples = 0;
      while (Date.now() - t0 < ms) {
        last = await states();
        const on = drawnIds(last);
        samples += 1;
        for (const id of ids) {
          if (!on.has(id)) absent[id] += step;
          else lastSeen[id] = Date.now() - t0;
        }
        await page.waitForTimeout(step);
      }
      return { absent, lastSeen, last, samples, final: drawnIds(last) };
    };

    await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(
      () => typeof window.surfcad?.call === 'function' && !document.querySelector('[data-app-loading]'),
      { timeout: 120000 },
    );
    await page.waitForSelector('[data-cad-run]', { state: 'attached', timeout: 120000 });
    check('dev hook partMeshStates exists', (await states()) !== null);

    const CUBE = '// --- cube begin ---\nlet part = Manifold.cube([20, 20, 10], true);\n// --- cube end ---\n';
    const created = await agentCall('create_assembly', {});
    check('create_assembly', created.ok === true, JSON.stringify(created));
    const aId = (await agentCall('parts', {})).result?.activeId;
    const aSet = await agentCall('set_script', { part_id: aId, source: `${CUBE}return part;\n` });
    check('part A builds at the origin', aSet.ok === true && aSet.result?.status?.runState === 'ok', JSON.stringify(aSet.result?.status));
    const made = await agentCall('create_part', { name: 'B' });
    const bId = made.result?.partId;
    check('create_part B', made.ok === true && typeof bId === 'string', JSON.stringify(made));
    check('set_active_part B', (await agentCall('set_active_part', { part_id: bId })).ok === true);
    const bSet = await agentCall('set_script', { part_id: bId, source: `${CUBE}return part;\n` });
    check('part B builds', bSet.ok === true && bSet.result?.status?.runState === 'ok', JSON.stringify(bSet.result?.status));
    // Touching along X: B's -X face on A's +X face.
    const placed = await agentCall('part_set_transform', { part_id: bId, position: [20, 0, 0], rotation: [0, 0, 0] });
    check('B placed next to A', placed.ok === true, JSON.stringify(placed));
    check('set_active_part A (baseline)', (await agentCall('set_active_part', { part_id: aId })).ok === true);
    const base = await sample(aId, [aId, bId], 3000);
    note(`baseline: ${summary(base.last)}`);
    check('baseline: both parts drawn with A active', base.final.has(aId) && base.final.has(bId), summary(base.last));
    const ri0 = await renderInfo();
    note(`renderer drew ${ri0?.triangles} triangles in ${ri0?.calls} calls, near ${ri0?.near} far ${ri0?.far}`);

    // S1: set_active_part A → B through the bridge, watch for 4 s.
    const s1 = await agentCall('set_active_part', { part_id: bId });
    check('S1 set_active_part B', s1.ok === true, JSON.stringify(s1));
    const r1 = await sample(bId, [aId, bId]);
    note(`S1 A off screen ${r1.absent[aId]} ms, B off screen ${r1.absent[bId]} ms over ${r1.samples} samples; final ${summary(r1.last)}`);
    check('S1 A still drawn after B is selected', r1.final.has(aId), summary(r1.last));
    check('S1 B drawn', r1.final.has(bId), summary(r1.last));
    check('S1 A was never off screen for more than one build (< 1500 ms)', r1.absent[aId] < 1500, `${r1.absent[aId]} ms`);
    const ri1 = await renderInfo();
    check('S1 renderer draws both cubes (24 triangles)', (ri1?.triangles ?? 0) >= 24, JSON.stringify(ri1));

    // S2: switch back to A, then B again right away (a second switch while
    // the first one's rebuild is in flight), watch for 4 s.
    check('S2 set_active_part A', (await agentCall('set_active_part', { part_id: aId })).ok === true);
    await page.waitForTimeout(30);
    check('S2 set_active_part B (30 ms later)', (await agentCall('set_active_part', { part_id: bId })).ok === true);
    const r2 = await sample(bId, [aId, bId]);
    note(`S2 A off screen ${r2.absent[aId]} ms, B off screen ${r2.absent[bId]} ms; final ${summary(r2.last)}`);
    check('S2 A drawn after two quick switches', r2.final.has(aId), summary(r2.last));
    check('S2 B drawn after two quick switches', r2.final.has(bId), summary(r2.last));

    // S3: a script edit on A, then a switch to B before A's rebuild lands.
    check('S3 set_active_part A', (await agentCall('set_active_part', { part_id: aId })).ok === true);
    await sample(aId, [aId, bId], 2500);
    const CUBE2 = '// --- cube begin ---\nlet part = Manifold.cube([20, 20, 12], true);\n// --- cube end ---\n';
    const fired = page.evaluate(async ({ a, b, src }) => {
      const p = window.surfcad.call('set_script', JSON.stringify({ part_id: a, source: src }));
      await new Promise((r) => setTimeout(r, 40));
      const sw = await window.surfcad.call('set_active_part', JSON.stringify({ part_id: b }));
      const set = await p;
      return { set: set?.ok, sw: sw?.ok };
    }, { a: aId, b: bId, src: `${CUBE2}return part;\n` });
    const f3 = await fired;
    note(`S3 set_script ok=${f3.set} switch ok=${f3.sw}`);
    const r3 = await sample(bId, [aId, bId], 5000);
    note(`S3 A off screen ${r3.absent[aId]} ms, B off screen ${r3.absent[bId]} ms; final ${summary(r3.last)}`);
    check('S3 A drawn after edit-then-switch', r3.final.has(aId), summary(r3.last));
    check('S3 B drawn after edit-then-switch', r3.final.has(bId), summary(r3.last));
    const a3 = (r3.last || []).find((s) => s.role === 'extra' && String(s.partId) === String(aId));
    check('S3 A shows the edited solid (12 mm tall)', !!a3?.boundingSphere && Math.abs(a3.boundingSphere.r - Math.hypot(10, 10, 6)) < 0.2, JSON.stringify(a3?.boundingSphere));

    // S4: select_parts (highlight, no script switch) and a viewport click on B.
    check('S4 set_active_part A', (await agentCall('set_active_part', { part_id: aId })).ok === true);
    await sample(aId, [aId, bId], 2500);
    const sel = await agentCall('select_parts', { part_ids: [bId] });
    check('S4 select_parts B', sel.ok === true, JSON.stringify(sel));
    const r4 = await sample((await agentCall('parts', {})).result?.activeId, [aId, bId], 2500);
    note(`S4 after select_parts: ${summary(r4.last)}`);
    check('S4 both parts drawn after select_parts', r4.final.has(aId) && r4.final.has(bId), summary(r4.last));
    const fit = await agentCall('camera_set', { view: 'iso' });
    check('S4 camera iso', fit.ok === true);
    const bScreen = await page.evaluate(() => window.__VIEWPORT__?.stageProject?.([20, 0, 8]) ?? null);
    note(`S4 B top projects to ${JSON.stringify(bScreen)}`);
    if (bScreen && Number.isFinite(bScreen.x) && Number.isFinite(bScreen.y)) {
      const canvas = await page.$('canvas');
      const box = await canvas.boundingBox();
      await page.mouse.click(box.x + bScreen.x, box.y + bScreen.y);
      const activeNow = (await agentCall('parts', {})).result?.activeId;
      const r5 = await sample(activeNow, [aId, bId], 3000);
      note(`S4 after click on B (active ${String(activeNow).slice(-4)}): ${summary(r5.last)}`);
      check('S4 both parts drawn after a click on B', r5.final.has(aId) && r5.final.has(bId), summary(r5.last));
    }
    // S5: a heavy third part. A part switch rebuilds the whole assembly on
    // the pool; the part being left must not wait for that rebuild to be
    // drawn again (the bike: the Fork vanished while the wheel was selected).
    check('S5 set_active_part A', (await agentCall('set_active_part', { part_id: aId })).ok === true);
    await sample(aId, [aId, bId], 2000);
    const madeC = await agentCall('create_part', { name: 'C' });
    const cId = madeC.result?.partId;
    check('S5 create_part C', madeC.ok === true && typeof cId === 'string', JSON.stringify(madeC));
    check('S5 set_active_part C', (await agentCall('set_active_part', { part_id: cId })).ok === true);
    const SLOW = [
      '// --- cube begin ---',
      'let part = Manifold.sphere(8, 200).translate([0, 40, 0]);',
      'for (let i = 1; i < 16; i++) part = part.add(Manifold.sphere(8, 200).translate([i * 2.5, 40, i % 2]));',
      '// --- cube end ---',
      'return part;',
      '',
    ].join('\n');
    const tC0 = Date.now();
    const cSet = await agentCall('set_script', { part_id: cId, source: SLOW });
    const cBuildMs = Date.now() - tC0;
    check('S5 part C builds', cSet.ok === true && cSet.result?.status?.runState === 'ok', JSON.stringify(cSet.result?.status));
    note(`S5 part C set_script took ${cBuildMs} ms`);
    check('S5 set_active_part A', (await agentCall('set_active_part', { part_id: aId })).ok === true);
    const r5a = await sample(aId, [aId, bId, cId], Math.max(4000, cBuildMs * 3));
    check('S5 all three drawn with A active', r5a.final.has(aId) && r5a.final.has(bId) && r5a.final.has(cId), summary(r5a.last));
    const t5 = Date.now();
    check('S5 set_active_part B', (await agentCall('set_active_part', { part_id: bId })).ok === true);
    const r5 = await sample(bId, [aId, bId, cId], Math.max(6000, cBuildMs * 3));
    note(`S5 switch A→B with a heavy C: A off screen ${r5.absent[aId]} ms, B ${r5.absent[bId]} ms, C ${r5.absent[cId]} ms (switch call ${Date.now() - t5} ms ago); final ${summary(r5.last)}`);
    check('S5 all three drawn after the switch', r5.final.has(aId) && r5.final.has(bId) && r5.final.has(cId), summary(r5.last));
    check('S5 the part being left is back within 300 ms, not after the assembly rebuild', r5.absent[aId] <= 300, `${r5.absent[aId]} ms off screen (C builds in ~${cBuildMs} ms)`);
    check('no page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
  } finally {
    await browser.close();
  }
}

stop();
console.log(failed ? `adjacent part visible: FAIL (${failed})` : 'adjacent part visible golden: ok');
process.exit(failed ? 1 : 0);

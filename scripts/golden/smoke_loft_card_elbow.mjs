#!/usr/bin/env node
/**
 * 90° elbow loft built from the Loft card.
 *
 * Station 1 is a new contour on the default plane (offset 0). Station 2 is
 * a new contour on the saved side workplane, offset 0, because the contour
 * owns that frame. Confirm writes makeLoft by those names. The solid must
 * be a manifold with positive volume and no self-intersection. The
 * offset-only path still emits offsetPlaneFrame.
 *
 * Screenshots (390px) go to GOLDEN_SHOT_DIR or os.tmpdir() only.
 */
/* global document, window, localStorage, Event */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { loftMeshSelfIntersects } from '../../src/utils/makeLoftAngled.js';
import { runScript } from '../../src/lib/surfcad/index.js';
import {
  composeContourLoft,
  defaultLoftProfiles,
  enterContourState,
  selectLoftProfile,
  setLoftProfileOffset,
  setLoftStationPlane,
  writeLoftSelected,
} from '../../src/utils/contourMode.js';

const PORT = Number(process.env.SMOKE_PORT || 5233);
const APP_URL = `http://127.0.0.1:${PORT}/`;
const SHOT_DIR = process.env.GOLDEN_SHOT_DIR || tmpdir();
const SIDE = {
  center: [25, 0, 25],
  normal: [1, 0, 0],
  x: [0, 0, -1],
  y: [0, 1, 0],
};
const PLANE_SCRIPT = `const side = { center: [25, 0, 25], normal: [1, 0, 0], x: [0, 0, -1], y: [0, 1, 0] };
`;
const XY = {
  type: 'planar',
  center: [0, 0, 0],
  normal: [0, 0, 1],
  area: 400,
  planeFrame: {
    center: [0, 0, 0],
    normal: [0, 0, 1],
    x: [1, 0, 0],
    y: [0, 1, 0],
  },
};

let failed = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed += 1;
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function statusOk(status) {
  return status == null || status === 0 || status === 'NoError';
}

console.log('loft card elbow');
mkdirSync(SHOT_DIR, { recursive: true });
check('shot dir is not the artifacts folder', !String(SHOT_DIR).startsWith('/opt/cursor/artifacts'), SHOT_DIR);

{
  const face = XY;
  const parallel = composeContourLoft('', {
    face,
    loft: { profiles: defaultLoftProfiles(), selected: 0 },
  });
  check('offset-only loft composes', parallel.ok, parallel.message || '');
  const owned = parallel.buffer || '';
  check(
    'offset-only still emits offsetPlaneFrame(…, 20)',
    /offsetPlaneFrame\s*\([^,]+,\s*20\)/.test(owned),
    owned.slice(0, 400),
  );
  check(
    'offset-only does not emit the side-plane normal',
    !/normal:\s*\[\s*1,\s*0,\s*0\s*\]/.test(owned),
  );

  let state = enterContourState('makeLoft', face);
  state = selectLoftProfile(state, 0);
  state = setLoftProfileOffset(state, 0);
  state.loft.profiles[0] = {
    ...state.loft.profiles[0],
    params: { ...state.loft.profiles[0].params, radius: 5 },
  };
  state = selectLoftProfile(state, 1);
  state = writeLoftSelected(state, { params: { radius: 5 } });
  state = setLoftStationPlane(state, SIDE, { kind: 'workplane', ref: 'side@0', label: 'side' });
  check('P2 owns the side plane', state.loft.profiles[1].planeKind === 'workplane');
  check('P1 stays on the offset plane', state.loft.profiles[0].planeKind !== 'workplane');
  const elbow = composeContourLoft('', { face, loft: state.loft, tool: state.tool, params: state.params });
  check('angled card loft composes', elbow.ok, elbow.message || '');
  const script = elbow.buffer || '';
  check('card emits the side-plane normal', /normal:\s*\[\s*1,\s*0,\s*0\s*\]/.test(script), script);
  check('card emits makeLoft and placeInFrame', /makeLoft\s*\(/.test(script) && /placeInFrame\s*\(/.test(script));
  check(
    'placement frame is the first station, not a +20 offset',
    /let\s+part\s*=\s*placeInFrame\(\s*c1\.plane\s*,/.test(script) && !/\[\s*0,\s*0,\s*20\s*\]/.test(script),
    script,
  );
  if (elbow.ok) {
    const run = await runScript(script);
    const genus = typeof run.manifold.genus === 'function' ? run.manifold.genus() : null;
    const mesh = run.mesh;
    const crosses = loftMeshSelfIntersects(mesh.vertProperties, mesh.triVerts, mesh.numProp || 3);
    const bb = run.boundingBox;
    check('card elbow is a manifold', statusOk(run.status) && run.bodyCount === 1 && genus === 0, `status=${run.status} bodies=${run.bodyCount} genus=${genus}`);
    check('card elbow volume is positive', run.volume > 100, `vol=${run.volume}`);
    check('card elbow does not self-intersect', crosses === false);
    check(
      'card elbow meets XY and the side plane',
      bb.min[2] > -0.2 && bb.min[2] < 0.2 && bb.max[0] > 24.5 && bb.max[0] < 25.2,
      `bb ${bb.min.map((v) => v.toFixed(2))} ${bb.max.map((v) => v.toFixed(2))}`,
    );
    if (typeof run.manifold.delete === 'function') run.manifold.delete();
  }
}

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].filter(Boolean);
const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!exe) {
  console.log('loft card elbow: no system Chrome — set CHROME_PATH');
  process.exit(failed ? 1 : 1);
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
  try { process.kill(-server.pid, 'SIGTERM'); } catch { /* already gone */ }
  try { server.kill('SIGKILL'); } catch { /* already gone */ }
};
process.on('exit', stop);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { stop(); process.exit(1); });

async function waitForServer(timeoutMs = 40000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(APP_URL);
      if (res.ok) return true;
    } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

const up = await waitForServer();
if (!up) {
  console.log('  ❌ vite did not start');
  stop();
  process.exit(1);
}

const browser = await chromium.launch({
  executablePath: exe,
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'],
});

try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 1,
    colorScheme: 'dark',
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(String(err).slice(0, 240)));
  await page.addInitScript(() => {
    try { localStorage.removeItem('surfcad.displayUnit'); } catch { /* private */ }
  });
  await page.route('**/api/**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ authenticated: false }),
  }));
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => {
    const canvas = document.querySelector('.viewport-shell > canvas');
    return !!(canvas && canvas.clientWidth > 0 && window.__VIEWPORT__?.ready?.() && window.__MANIFOLD_CONTEXT__?.isReady);
  }, null, { timeout: 90000 });
  await page.waitForFunction(() => (window.monaco?.editor?.getModels?.() || []).length > 0, null, { timeout: 30000 });
  await page.evaluate((src) => {
    const model = window.monaco.editor.getModels()[0];
    model.setValue(src);
  }, PLANE_SCRIPT);
  await page.waitForFunction(() => {
    const models = window.monaco?.editor?.getModels?.() || [];
    return models.some((m) => String(m.getValue()).includes('const side'));
  }, null, { timeout: 10000 });

  const planesBefore = await page.locator('[data-overlay-toggle="plane"]').getAttribute('aria-pressed').catch(() => null);
  await page.locator('button[aria-label^="Insert Loft"]').click();
  await page.locator('[data-feature-slot-card="makeLoft"]').waitFor({ timeout: 8000 });
  await page.waitForTimeout(400);
  const planesAfter = await page.locator('[data-overlay-toggle="plane"]').getAttribute('aria-pressed').catch(() => null);
  check(
    'opening Loft turns plane overlays on',
    planesBefore !== 'true' && planesAfter === 'true',
    `before=${planesBefore} after=${planesAfter}`,
  );
  check(
    'loft card is titled Loft',
    (await page.locator('[data-feature-card-title]').innerText()).trim() === 'Loft',
  );

  const drawStation = async (index, workplane) => {
    await page.locator(`[data-new-contour-role="station"][data-new-contour-index="${index}"]`).click();
    await page.locator('[data-contour-chip]').waitFor({ timeout: 8000 });
    if (workplane) {
      const picked = await page.evaluate((name) => {
        const sel = document.querySelector('[aria-label="Pick a saved workplane"]');
        if (!sel) return { ok: false, reason: 'no select' };
        const option = [...sel.options].find((o) => o.textContent.trim() === name);
        if (!option) {
          return { ok: false, reason: 'options ' + [...sel.options].map((o) => o.textContent.trim()).join('|') };
        }
        sel.value = option.value;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        return { ok: true, value: sel.value };
      }, workplane);
      check(`station ${index + 1} workplane is ${workplane}`, picked.ok, picked.reason || '');
    }
    await page.locator('[data-feature-card-confirm]').click();
    await page.waitForFunction(() => (
      document.querySelector('.viewport-shell')?.getAttribute('data-contour-face-aim') === 'done'
      && !document.querySelector('[data-contour-chip]')
    ), null, { timeout: 8000 });
    await page.locator('[data-contour-confirm]').click();
    await page.locator('[data-feature-slot-card="makeLoft"]').waitFor({ timeout: 8000 });
  };
  await drawStation(0, null);
  await drawStation(1, 'side');
  const offset = page.locator('[data-popup-number="loft-offset-1"]');
  await offset.fill('0');
  await offset.blur();

  const cardShot = join(SHOT_DIR, 'loft-card-elbow-390.png');
  await page.screenshot({ path: cardShot });
  check('390 card screenshot written', existsSync(cardShot), cardShot);

  const rendersBefore = await page.evaluate(() => window.__VIEWPORT__?._renderCount || 0);
  await page.locator('[data-feature-card-confirm]').click();
  try {
    await page.waitForFunction((before) => {
      const text = (window.monaco?.editor?.getModels?.() || []).map((m) => m.getValue()).join('\n');
      if (!/makeLoft\s*\(/.test(text) || !/normal:\s*\[\s*1,\s*0,\s*0\s*\]/.test(text)) return false;
      return (window.__VIEWPORT__?._renderCount || 0) > before;
    }, rendersBefore, { timeout: 30000 });
  } catch (err) {
    const dump = await page.evaluate(() => ({
      error: document.querySelector('[data-execution-error]')?.innerText || '',
      script: (window.monaco?.editor?.getModels?.() || []).map((m) => m.getValue()).join('\n'),
      renders: window.__VIEWPORT__?._renderCount || 0,
    }));
    console.log('  script after confirm:\n' + dump.script);
    console.log('  execution error: ' + dump.error);
    console.log('  renders ' + dump.renders);
    throw err;
  }
  let info = null;
  for (let i = 0; i < 40; i++) {
    try {
      info = await page.evaluate(() => window.__MANIFOLD_CONTEXT__.getModelInfo());
      if (info && info.volume > 100 && info.boundingBox?.max?.[0] > 20) break;
    } catch {
      info = null;
    }
    await page.waitForTimeout(250);
  }
  check(
    'browser elbow volume is positive',
    !!(info && info.volume > 100 && info.boundingBox?.max?.[0] > 20),
    info ? `vol=${info.volume} maxX=${info.boundingBox?.max?.[0]}` : 'no model info',
  );
  const script = await page.evaluate(() => (
    (window.monaco?.editor?.getModels?.() || []).map((m) => m.getValue()).join('\n')
  ));
  const run = await runScript(script);
  const genus = typeof run.manifold.genus === 'function' ? run.manifold.genus() : null;
  const crosses = loftMeshSelfIntersects(run.mesh.vertProperties, run.mesh.triVerts, run.mesh.numProp || 3);
  check(
    'browser script is a manifold elbow',
    statusOk(run.status) && run.bodyCount === 1 && genus === 0 && run.volume > 100 && crosses === false,
    `status=${run.status} bodies=${run.bodyCount} genus=${genus} vol=${run.volume} cross=${crosses}`,
  );
  if (typeof run.manifold.delete === 'function') run.manifold.delete();

  const resultShot = join(SHOT_DIR, 'loft-card-elbow-result-390.png');
  await page.screenshot({ path: resultShot });
  check('390 result screenshot written', existsSync(resultShot), resultShot);
  check('no uncaught page errors', errors.length === 0, errors.join(' | '));
  await context.close();
} finally {
  await browser.close();
  stop();
}

if (failed) {
  console.log(`loft card elbow: ${failed} failed`);
  process.exit(1);
}
console.log('loft card elbow passed');

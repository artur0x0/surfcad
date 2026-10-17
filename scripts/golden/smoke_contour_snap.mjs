#!/usr/bin/env node
/**
 * Snap a sketch point onto a part edge while drawing and while dragging.
 *
 * A finger drag (pointerType touch) pulls a rectangle corner onto an edge.
 * A tap on the edge adds a new point. Both store a two-target coincident.
 * The amber ring is data-contour-snap. Dimension mode does not show it.
 *
 * Cube and Sheet Metallica, each at 390 and 1280.
 * Screenshots go to GOLDEN_SHOT_DIR or os.tmpdir().
 */
/* global document, window, MouseEvent, PointerEvent */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { attachConsentPresetToBrowser } from './lib/presetConsentInit.mjs';
import { emitSolveContour } from '../../src/utils/contourScript.js';
import { emitNamedContourLine } from '../../src/utils/namedContour.js';
import { parseSolveContour } from '../../src/utils/contourScript.js';

const PORT = Number(process.env.SMOKE_PORT || 5266);
const APP_URL = `http://127.0.0.1:${PORT}/`;
const SHOT_DIR = process.env.GOLDEN_SHOT_DIR || tmpdir();

const CUBE_FRAME = { center: [0, 0, 10], normal: [0, 0, 1], x: [1, 0, 0], y: [0, 1, 0] };
const CUBE_RECT = {
  points: [
    { id: 'p0', at: [-8, -6] },
    { id: 'p1', at: [8, -6] },
    { id: 'p2', at: [8, 6] },
    { id: 'p3', at: [-8, 6] },
  ],
  lines: [
    { id: 'e0', a: 'p0', b: 'p1' },
    { id: 'e1', a: 'p1', b: 'p2' },
    { id: 'e2', a: 'p2', b: 'p3' },
    { id: 'e3', a: 'p3', b: 'p0' },
  ],
  arcs: [],
  dimensions: [],
  constraints: [],
};

function namedContour(frame, profile) {
  return emitNamedContourLine({
    name: 'c1',
    id: 'c1',
    frame,
    profileExpr: emitSolveContour(profile),
  });
}

const CUBE_SCRIPT = `${namedContour(CUBE_FRAME, CUBE_RECT)}
const box = Manifold.cube([40, 30, 20], true);
return box;
`;

const SHEET_FRAME = { center: [0, 0, 0], normal: [0, 1, 0], x: [1, 0, 0], y: [0, 0, -1] };
const SHEET_RECT = {
  points: [
    { id: 'p0', at: [-20, -15] },
    { id: 'p1', at: [20, -15] },
    { id: 'p2', at: [20, 15] },
    { id: 'p3', at: [-20, 15] },
  ],
  lines: [
    { id: 'e0', a: 'p0', b: 'p1' },
    { id: 'e1', a: 'p1', b: 'p2' },
    { id: 'e2', a: 'p2', b: 'p3' },
    { id: 'e3', a: 'p3', b: 'p0' },
  ],
  arcs: [],
  dimensions: [],
  constraints: [],
};
const SHEET_SPEC = {
  v: 1,
  sku: 'SST316-125',
  material: 'Stainless Steel (316 Series)',
  t: 3.175,
  r: 3.81,
  k: 0.38,
  plane: 'XZ',
  width: 100,
  height: 60,
  bends: [
    { id: 'b1', panel: 'base', edge: 'u-', angle: 90, length: 28.2, flip: true },
    { id: 'b2', panel: 'b1', edge: 'u+', angle: 90, length: 28.2, flip: false },
    { id: 'b3', panel: 'base', edge: 'u+', angle: 90, length: 28.2, flip: true },
    { id: 'b4', panel: 'b3', edge: 'u+', angle: 90, length: 28.2, flip: false },
  ],
  tabs: [{ id: 't1', panel: 'base', edge: 'v+', width: 25, depth: 10, centered: true, offset: 37.5 }],
  holes: [{ id: 'h1', panel: 'base', u: -23.93, v: 1.91, d: 5, type: 'hole' }],
};
const SHEET_SCRIPT = `${namedContour(SHEET_FRAME, SHEET_RECT)}
const sheetSpec = ${JSON.stringify(SHEET_SPEC)};
let part = sheetMetalSolid(sheetSpec);
return part;
`;

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
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

console.log('contour snap (cube + sheet, 390 / 1280)');
mkdirSync(SHOT_DIR, { recursive: true });
check('shot dir is not the artifacts folder', !String(SHOT_DIR).startsWith('/opt/cursor/artifacts'), SHOT_DIR);

const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!exe) {
  console.log('contour snap: no system Chrome — set CHROME_PATH');
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

async function clickSel(page, selector) {
  const clicked = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    el.click();
    return true;
  }, selector);
  if (!clicked) throw new Error(`missing ${selector}`);
}

async function editorScript(page) {
  return page.evaluate(() => (
    (window.monaco?.editor?.getModels?.() || []).map((m) => m.getValue()).join('\n')
  ));
}

function pointOf(model, id) {
  return model.points.find((p) => p.id === id)?.at || null;
}

function onSegment(at, geom, tol = 0.2) {
  if (!at || geom?.kind !== 'line' || !geom.a || !geom.b) return false;
  const dx = geom.b[0] - geom.a[0];
  const dy = geom.b[1] - geom.a[1];
  const len2 = dx * dx + dy * dy;
  if (!(len2 > 1e-8)) return false;
  let t = ((at[0] - geom.a[0]) * dx + (at[1] - geom.a[1]) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const x = geom.a[0] + t * dx;
  const y = geom.a[1] + t * dy;
  return Math.hypot(at[0] - x, at[1] - y) <= tol;
}

async function boot(page, script) {
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
    window.monaco.editor.getModels()[0].setValue(src);
  }, script);
  const ran = await page.evaluate(async (src) => window.__VIEWPORT__.executeScript(src), script);
  if (ran?.error) throw new Error(ran.error);
  await page.waitForFunction(() => (window.__VIEWPORT__.stageVerifyFraming?.().tris || 0) > 10, null, { timeout: 30000 });
  if (await page.locator('[data-part-row]').count() === 0) {
    await clickSel(page, '[data-cad-run]');
    await page.waitForFunction(() => document.querySelectorAll('[data-part-row]').length > 0, null, { timeout: 20000 });
  }
  const partsBtn = page.locator('[data-stage-btn="parts"]');
  const phone = await partsBtn.isVisible().catch(() => false);
  if (phone) {
    await partsBtn.click();
    await page.waitForFunction(() => (
      document.querySelector('[data-mobile-stage]')?.getAttribute('data-mobile-stage') === 'parts'
    ), null, { timeout: 8000 });
  }
  await page.evaluate(() => document.querySelector('[data-part-row]')?.click());
  await page.waitForFunction(() => (
    document.querySelector('[data-part-row]')?.getAttribute('data-part-selected') === 'true'
  ), null, { timeout: 8000 });
  if (phone) await page.locator('[data-stage-btn="cad"]').click();
  await page.evaluate((src) => window.monaco.editor.getModels()[0].setValue(src), script);
  const again = await page.evaluate(async (src) => window.__VIEWPORT__.executeScript(src), script);
  if (again?.error) throw new Error(again.error);
  await page.waitForFunction(() => (window.__VIEWPORT__.stageVerifyFraming?.().tris || 0) > 10, null, { timeout: 30000 });
  await page.locator('[data-cad-feature-strip] [data-contour-id="c1"]').waitFor({ timeout: 8000 });
}

async function openContour(page) {
  await clickSel(page, '[data-cad-feature-strip] [data-contour-id="c1"]');
  await page.locator('[data-contour-edit]').waitFor({ timeout: 8000 });
  await page.waitForFunction(() => (
    document.querySelector('.viewport-shell')?.getAttribute('data-contour-face-aim') === 'done'
  ), null, { timeout: 8000 });
  await page.waitForTimeout(200);
}

async function project(page, world) {
  return page.evaluate((w) => {
    const p = window.__VIEWPORT__.project(w[0], w[1], w[2]);
    if (!p || p.behind) return null;
    return { x: p.x, y: p.y };
  }, world);
}

async function aim(page, world, dolly = 0.55) {
  await page.evaluate(({ world, dolly }) => {
    window.__VIEWPORT__.stageRetarget(world, dolly);
  }, { world, dolly });
  await page.waitForTimeout(220);
}

function pointer(page, type, x, y) {
  return page.evaluate(({ type, x, y }) => {
    const canvas = document.querySelector('.viewport-shell > canvas');
    if (!canvas) return false;
    canvas.dispatchEvent(new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      pointerType: 'touch',
      isPrimary: true,
      button: 0,
      buttons: type === 'pointerup' ? 0 : 1,
      clientX: x,
      clientY: y,
    }));
    return true;
  }, { type, x, y });
}

async function drawOnEdge(page, samples, key, avoidWorld) {
  const handles = await page.evaluate(() => window.__VIEWPORT__.sketchPoints() || []);
  const handleScreens = [];
  for (const handle of handles) {
    const screen = await project(page, handle.world);
    if (screen) handleScreens.push(screen);
  }
  const avoid = avoidWorld ? await project(page, avoidWorld) : null;
  let last = null;
  const skipped = [];
  for (const world of samples) {
    const pt = await project(page, world);
    if (!pt) {
      skipped.push(`${world.join(',')} offscreen`);
      continue;
    }
    if (avoid && Math.hypot(avoid.x - pt.x, avoid.y - pt.y) < 24) {
      skipped.push(`${world.join(',')} near drag`);
      continue;
    }
    const nearHandle = handleScreens.find((screen) => Math.hypot(screen.x - pt.x, screen.y - pt.y) < 48);
    if (nearHandle) {
      skipped.push(`${world.join(',')} near handle`);
      continue;
    }
    await page.evaluate(({ x, y }) => {
      const canvas = document.querySelector('.viewport-shell > canvas');
      const opts = { bubbles: true, button: 0, clientX: x, clientY: y };
      canvas.dispatchEvent(new MouseEvent('mousedown', { ...opts, buttons: 1 }));
      canvas.dispatchEvent(new MouseEvent('mousemove', { ...opts, buttons: 0 }));
    }, pt);
    await page.waitForTimeout(40);
    const marker = await page.evaluate(() => {
      const el = document.querySelector('[data-contour-snap]');
      if (!el) return null;
      return {
        role: el.getAttribute('data-contour-snap'),
        key: el.getAttribute('data-contour-snap-target') || '',
      };
    });
    last = marker || { role: 'none', at: world, skipped };
    if (marker?.role !== 'edge') {
      skipped.push(`${world.join(',')} ${marker ? marker.role + ':' + marker.key : 'no ring'}`);
      continue;
    }
    if (key && !(marker.key || '').includes(key)) {
      skipped.push(`${world.join(',')} key ${marker.key}`);
      continue;
    }
    await page.evaluate(({ x, y }) => {
      const canvas = document.querySelector('.viewport-shell > canvas');
      canvas.dispatchEvent(new MouseEvent('mouseup', {
        bubbles: true,
        button: 0,
        buttons: 0,
        clientX: x,
        clientY: y,
      }));
    }, pt);
    await page.waitForTimeout(200);
    const after = await page.evaluate(() => ({
      points: (window.__VIEWPORT__.sketchPoints() || []).map((item) => item.id),
      toast: document.querySelector('[data-contour-toast]')?.textContent || '',
    }));
    return { ...marker, skipped, after };
  }
  return last ? { ...last, skipped } : { role: 'none', skipped };
}

async function dragPoint(page, pointId, world) {
  const handles = await page.evaluate(() => window.__VIEWPORT__.sketchPoints());
  const handle = (handles || []).find((item) => item.id === pointId);
  if (!handle) throw new Error(`missing handle ${pointId}`);
  const from = await project(page, handle.world);
  const to = await project(page, world);
  if (!from || !to) throw new Error(`drag off screen ${pointId}`);
  await pointer(page, 'pointerdown', from.x, from.y);
  await page.waitForTimeout(40);
  const steps = 6;
  let marker = null;
  for (let i = 1; i <= steps; i += 1) {
    const x = from.x + ((to.x - from.x) * i) / steps;
    const y = from.y + ((to.y - from.y) * i) / steps;
    await pointer(page, 'pointermove', x, y);
    await page.waitForTimeout(30);
    marker = await page.evaluate(() => {
      const el = document.querySelector('[data-contour-snap]');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        role: el.getAttribute('data-contour-snap'),
        key: el.getAttribute('data-contour-snap-target') || '',
        x: r.x + r.width / 2,
        y: r.y + r.height / 2,
      };
    });
  }
  await pointer(page, 'pointerup', to.x, to.y);
  await page.waitForTimeout(120);
  return { marker, to };
}

async function runCase(browser, label, script, spec) {
  const context = await browser.newContext({
    viewport: spec.viewport,
    hasTouch: true,
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(String(err).slice(0, 400)));
  const tag = `${spec.name} ${label}`;
  try {
    await boot(page, script);
    await openContour(page);
    await clickSel(page, '[data-contour-tool="dimension"]');
    await page.locator('[data-contour-card="dimension"]').waitFor({ timeout: 8000 });
    const edgePt = await project(page, spec.dragTo);
    if (edgePt) {
      await page.evaluate(({ x, y }) => {
        const canvas = document.querySelector('.viewport-shell > canvas');
        canvas.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: x, clientY: y }));
      }, edgePt);
      await page.waitForTimeout(40);
    }
    const duringDimension = await page.evaluate(() => !!document.querySelector('[data-contour-snap]'));
    check(`${tag} dimension does not snap`, !duringDimension);
    await clickSel(page, '[data-contour-tool="dimension"]');
    await page.waitForFunction(() => !document.querySelector('[data-contour-card="dimension"]'), null, { timeout: 4000 });

    const dolly = spec.viewport.width < 500 ? (spec.dolly || 0.55) : 0.55;
    await aim(page, spec.dragTo, dolly);
    const drawn = await drawOnEdge(page, spec.drawSamples, spec.drawKey, spec.dragTo);
    check(`${tag} drawing shows an edge snap`, drawn?.role === 'edge', JSON.stringify(drawn));
    if (drawn?.role === 'edge') {
      check(`${tag} the drawn point stays in the sketch`, (drawn.after?.points || []).includes('p4'), JSON.stringify(drawn.after));
    }
    if (spec.drawKey) {
      check(`${tag} the draw snap names the edge`, (drawn?.key || '').includes(spec.drawKey), drawn?.key || '');
    }
    const dragged = await dragPoint(page, 'p2', spec.dragTo);
    check(`${tag} dragging shows an edge snap`, dragged.marker?.role === 'edge', JSON.stringify(dragged.marker));
    if (spec.dragKey) {
      check(
        `${tag} the drag snap names the edge`,
        (dragged.marker?.key || '').includes(spec.dragKey),
        dragged.marker?.key || '',
      );
    }
    if (dragged.marker && dragged.to) {
      const gap = Math.hypot(dragged.marker.x - dragged.to.x, dragged.marker.y - dragged.to.y);
      check(`${tag} the snap ring sits on the edge`, gap < 28, String(Math.round(gap)));
    }

    await clickSel(page, '[data-contour-confirm]');
    await page.waitForFunction(() => !document.querySelector('[data-contour-edit]'), null, { timeout: 15000 });
    const saved = await editorScript(page);
    let model = null;
    try { model = parseSolveContour(saved); } catch (err) { check(`${tag} script parses`, false, String(err)); }
    if (model) {
      const coincidents = (model.constraints || []).filter((con) => con.kind === 'coincident' && (con.items || []).length === 2);
      check(`${tag} snap added two-target coincidents`, coincidents.length >= 2, `count ${coincidents.length}`);
      const draggedPoint = pointOf(model, 'p2');
      const dragRefId = coincidents.find((con) => con.items.includes('p2'))?.items.find((id) => id !== 'p2');
      const dragRef = (model.refs || []).find((ref) => ref.id === dragRefId);
      check(`${tag} the dragged point is on the edge`, onSegment(draggedPoint, dragRef?.geom), JSON.stringify(draggedPoint));
      if (spec.dragKey) {
        check(`${tag} the drag reference keeps its refKey`, dragRef?.refKey === spec.dragKey, dragRef?.refKey || '');
      }
      const drawnCon = coincidents.find((con) => con.items.includes('p4'));
      const drawnRef = (model.refs || []).find((ref) => ref.id === drawnCon?.items?.find((id) => id !== 'p4'));
      const drawnPoint = pointOf(model, 'p4');
      check(`${tag} the drawn point is on an edge`, !!drawnCon && onSegment(drawnPoint, drawnRef?.geom), JSON.stringify(drawnPoint));
      if (spec.drawKey) {
        check(`${tag} the drawn reference keeps its refKey`, drawnRef?.refKey === spec.drawKey, drawnRef?.refKey || '');
      }
    }
    await page.screenshot({ path: join(SHOT_DIR, `contour-snap-${spec.name}-${label}.png`) });
    check(`${tag} no page error`, errors.length === 0, errors.join(' | '));
  } finally {
    await context.close();
  }
}

const browser = await chromium.launch({
  executablePath: exe,
  headless: true,
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
attachConsentPresetToBrowser(browser);
const cases = [
  {
    name: 'cube',
    script: CUBE_SCRIPT,
    dragTo: [0, 15, 10],
    drawSamples: [[-12, 15, 10], [-6, 15, 10], [6, 15, 10], [12, 15, 10], [0, 15, 10]],
  },
  {
    name: 'sheet',
    script: SHEET_SCRIPT,
    dragTo: [0, 0, -30],
    dragKey: 'wall:base:v-:w0',
    // Phone framing leaves the rectangle corners close to this edge. Samples
    // sit far enough from those corners, from the drag target, and from the
    // edge ends that the snap is the edge itself.
    dolly: 0.22,
    drawSamples: [[-42, 0, -30], [42, 0, -30], [-34, 0, -30], [34, 0, -30], [-26, 0, -30], [26, 0, -30]],
    drawKey: 'wall:base:v-:w0',
  },
];
try {
  if (!await waitForServer()) throw new Error('vite did not start');
  for (const spec of cases) {
    for (const [label, viewport] of [['390', { width: 390, height: 844 }], ['1280', { width: 1280, height: 800 }]]) {
      try {
        await runCase(browser, label, spec.script, { ...spec, viewport });
      } catch (err) {
        failed += 1;
        console.log(`  ❌ ${spec.name} ${label} — ${err?.stack || err}`);
      }
    }
  }
} catch (err) {
  failed += 1;
  console.log(`  ❌ ${err?.stack || err}`);
} finally {
  await browser.close();
  stop();
}
if (failed) process.exit(1);
console.log('contour snap: ok');

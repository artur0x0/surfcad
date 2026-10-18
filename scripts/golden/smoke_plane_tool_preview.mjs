#!/usr/bin/env node
/**
 * Plane tool. Opening it shows the reference planes and existing user
 * planes even when the rail was off. A face tap hides XY/YZ/ZX and
 * leaves the user plane plus a translucent preview. Deselecting the
 * face (World X) shows the reference planes again. X without a rail
 * tap puts the rail back. Offset moves the preview.
 *
 * 390×844 and 1280×800. Screenshots go to GOLDEN_SHOT_DIR or os.tmpdir().
 */
/* global window */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { attachConsentPresetToBrowser } from './lib/presetConsentInit.mjs';
import { CONSTRUCTION_PLANE_SIZE } from '../../src/utils/jointPlanes.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = Number(process.env.SMOKE_PORT || 5318);
const APP_URL = `http://127.0.0.1:${PORT}/`;
const SHOT_DIR = process.env.GOLDEN_SHOT_DIR || tmpdir();
const SCRIPT = `const deck = { center: [0, 70, 0], normal: [0, 1, 0], x: [1, 0, 0], y: [0, 0, 1] };
let part = Manifold.cube([40, 30, 20], true);
return part;
`;
const FACE_POINTS = [[8, 6, 10], [12, 8, 10], [4, 4, 10], [14, 4, 10]];

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

const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

console.log('plane tool preview');
mkdirSync(SHOT_DIR, { recursive: true });
check('shot dir is not the artifacts folder', !String(SHOT_DIR).startsWith('/opt/cursor/artifacts'), SHOT_DIR);

{
  const view = read('src/components/Viewport.jsx');
  const planes = read('src/utils/jointPlanes.js');
  const arch = read('docs/architecture.md');
  const map = read('docs/ui-map.md');
  check('Plane tool paints reference planes with user planes',
    /planesForWorkplaneTool\(entry, \{ references: !planeFaceSelected \}\)/.test(view)
      && /export function planesForWorkplaneTool/.test(planes));
  check('a selected face drops the reference planes',
    /references: false/.test(planes) && /planeFaceSelected/.test(view));
  check('preview uses the confirmed quad size',
    /paintPlaneToolPreview\(/.test(view) && /CONSTRUCTION_PLANE_SIZE/.test(view) && CONSTRUCTION_PLANE_SIZE === 48);
  check('sketch plane square stays undrawn',
    !/paintWorkplaneOverlay\(/.test(view) && /The sketch plane square is not drawn/.test(view));
  check('docs name the Plane tool preview',
    /golden:plane-tool/.test(arch) && /golden:plane-tool/.test(map));
}

const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!exe) {
  console.log('plane tool preview: no system Chrome — set CHROME_PATH');
  process.exit(failed ? 1 : 1);
}

const server = spawn('npx', ['vite', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], {
  cwd: ROOT,
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

function near(a, b, tol = 1.5) {
  return Math.abs(a - b) <= tol;
}

async function boot(page) {
  await page.route('**/api/**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ authenticated: false }),
  }));
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => {
    const canvas = window.document.querySelector('.viewport-shell > canvas');
    return !!(canvas && canvas.clientWidth > 0 && window.__VIEWPORT__?.ready?.() && window.__MANIFOLD_CONTEXT__?.isReady);
  }, null, { timeout: 90000 });
  await page.waitForFunction(() => (window.monaco?.editor?.getModels?.() || []).length > 0, null, { timeout: 30000 });
  await page.evaluate((src) => {
    window.monaco.editor.getModels()[0].setValue(src);
  }, SCRIPT);
  const ran = await page.evaluate(async (src) => (
    window.__VIEWPORT__.executeScript(src, { partId: 'plane' })
  ), SCRIPT);
  if (ran?.error) throw new Error(ran.error);
  await page.waitForFunction(() => (window.__VIEWPORT__.stageVerifyFraming?.().tris || 0) > 10, null, { timeout: 30000 });
  await page.evaluate(() => window.__VIEWPORT__.stageFit({ az: 18, el: 68, margin: 1.8 }));
  await page.waitForTimeout(250);
}

async function planeState(page) {
  return page.evaluate(() => window.__VIEWPORT__.stagePlaneTool());
}

async function clickWorld(page, world) {
  const hit = await page.evaluate((w) => {
    const p = window.__VIEWPORT__.stageProject(w);
    const canvas = window.document.querySelector('.viewport-shell > canvas');
    if (!p || !canvas || p.behind) return { ok: false, behind: !!p?.behind };
    const el = window.document.elementFromPoint(p.x, p.y);
    return { ok: el === canvas, x: p.x, y: p.y, tag: el ? el.tagName : '' };
  }, world);
  if (!hit?.ok) return hit;
  const canvas = page.locator('.viewport-shell > canvas');
  const box = await canvas.boundingBox();
  await canvas.click({ position: { x: hit.x - box.x, y: hit.y - box.y } });
  return hit;
}

async function runView(browser, vp) {
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    hasTouch: vp.touch,
    isMobile: vp.touch,
    deviceScaleFactor: 1,
    colorScheme: 'dark',
    userAgent: vp.touch
      ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
      : undefined,
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(String(err).slice(0, 300)));
  await boot(page);

  const before = await planeState(page);
  const pressed = await page.evaluate(() => (
    window.document.querySelector('[data-overlay-toggle="plane"]')?.getAttribute('aria-pressed') || ''
  ));
  check(`${vp.name} planes start hidden`,
    pressed === 'false' && before.toggle === false && !before.planes.includes('origin:xy'),
    JSON.stringify({ pressed, toggle: before.toggle, planes: before.planes }));

  await page.locator('button[aria-label^="Insert Workplane"]').click();
  await page.locator('[data-plane-editor]').waitFor({ timeout: 8000 });
  await page.waitForFunction(() => {
    const state = window.__VIEWPORT__.stagePlaneTool();
    return state.toggle === true
      && state.planes.includes('origin:xy')
      && state.planes.includes('origin:yz')
      && state.planes.includes('origin:zx')
      && state.planes.includes('workplane:deck');
  }, null, { timeout: 8000 });
  const opened = await planeState(page);
  check(`${vp.name} opening the Plane tool shows reference and user planes`,
    opened.preview.present === false
      && opened.planes.includes('origin:xy')
      && opened.planes.includes('workplane:deck'),
    JSON.stringify(opened));
  const openShot = join(SHOT_DIR, `plane-tool-open-${vp.name}.png`);
  await page.screenshot({ path: openShot });
  check(`${vp.name} open shot saved outside artifacts`,
    existsSync(openShot) && !openShot.startsWith('/opt/cursor/artifacts'), openShot);

  let faceHit = null;
  for (const world of FACE_POINTS) {
    faceHit = await clickWorld(page, world);
    if (!faceHit?.ok) continue;
    try {
      await page.waitForFunction(() => {
        const sketch = window.__VIEWPORT__.stageContourSketch();
        const tool = window.__VIEWPORT__.stagePlaneTool();
        return sketch.planePreset === 'face'
          && sketch.highlights > 0
          && tool.preview.present === true
          && !tool.planes.includes('origin:xy')
          && !tool.planes.includes('origin:yz')
          && !tool.planes.includes('origin:zx')
          && tool.planes.includes('workplane:deck');
      }, null, { timeout: 2500 });
      break;
    } catch {
      faceHit = { ...faceHit, ok: false, reason: 'no face preview' };
    }
  }
  const faced = await planeState(page);
  const sketch = await page.evaluate(() => window.__VIEWPORT__.stageContourSketch());
  console.log(`  ${vp.name} face ${JSON.stringify({ hit: faceHit, sketch: sketch.planePreset, preview: faced.preview })}`);
  check(`${vp.name} a face tap shows the preview mesh`,
    faceHit?.ok === true
      && sketch.planePreset === 'face'
      && sketch.highlights > 0
      && faced.preview.present === true
      && faced.preview.transparent === true
      && faced.preview.depthWrite === false
      && faced.preview.opacity > 0.2
      && faced.preview.opacity < 0.6
      && faced.preview.size === CONSTRUCTION_PLANE_SIZE
      && near(faced.preview.center[2], 10),
    JSON.stringify(faced.preview));
  check(`${vp.name} a selected face hides the reference planes`,
    faced.toggle === true
      && !faced.planes.includes('origin:xy')
      && !faced.planes.includes('origin:yz')
      && !faced.planes.includes('origin:zx')
      && faced.planes.includes('workplane:deck'),
    JSON.stringify(faced.planes));
  const faceShot = join(SHOT_DIR, `plane-tool-face-${vp.name}.png`);
  await page.screenshot({ path: faceShot });

  await page.locator('button[title="World X plane"]').click();
  await page.waitForFunction(() => {
    const tool = window.__VIEWPORT__.stagePlaneTool();
    const live = window.__VIEWPORT__.stageContourSketch();
    return tool.preview.present === true
      && tool.preview.normal
      && tool.preview.normal[0] > 0.9
      && tool.planes.includes('origin:xy')
      && tool.planes.includes('origin:yz')
      && tool.planes.includes('origin:zx')
      && live.highlights === 0
      && live.planePreset === 'x';
  }, null, { timeout: 4000 });
  const axis = await planeState(page);
  const axisSketch = await page.evaluate(() => window.__VIEWPORT__.stageContourSketch());
  check(`${vp.name} an X pick shows the preview mesh`,
    axis.preview.present === true
      && axis.preview.transparent === true
      && axis.preview.size === CONSTRUCTION_PLANE_SIZE
      && axis.preview.normal[0] > 0.9
      && near(axis.preview.center[0], 0)
      && near(axis.preview.center[2], 10),
    JSON.stringify(axis.preview));
  check(`${vp.name} deselecting the face shows the reference planes`,
    axisSketch.highlights === 0
      && axisSketch.planePreset === 'x'
      && axis.toggle === true
      && axis.planes.includes('origin:xy')
      && axis.planes.includes('origin:yz')
      && axis.planes.includes('origin:zx')
      && axis.planes.includes('workplane:deck'),
    JSON.stringify({ highlights: axisSketch.highlights, planes: axis.planes }));
  const axisShot = join(SHOT_DIR, `plane-tool-axis-${vp.name}.png`);
  await page.screenshot({ path: axisShot });

  const beforeOffset = axis.preview.center.slice();
  await page.evaluate(() => {
    const el = window.document.querySelector('[data-popup-number="workplane-offset"]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, '8');
    el.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
  await page.waitForFunction((x0) => {
    const center = window.__VIEWPORT__.stagePlaneTool().preview.center;
    return center && Math.abs(center[0] - x0) > 4;
  }, beforeOffset[0], { timeout: 4000 });
  const shifted = await planeState(page);
  check(`${vp.name} offset moves the preview`,
    shifted.preview.present === true
      && near(shifted.preview.center[0], beforeOffset[0] + 8, 1.5)
      && near(shifted.preview.center[1], beforeOffset[1])
      && near(shifted.preview.center[2], beforeOffset[2])
      && shifted.preview.size === CONSTRUCTION_PLANE_SIZE,
    JSON.stringify({ before: beforeOffset, after: shifted.preview.center }));

  await page.locator('[data-feature-card-cancel]').click();
  await page.waitForFunction(() => !window.document.querySelector('[data-plane-editor]'), null, { timeout: 8000 });
  const closed = await planeState(page);
  const pressedAfter = await page.evaluate(() => (
    window.document.querySelector('[data-overlay-toggle="plane"]')?.getAttribute('aria-pressed') || ''
  ));
  const script = await page.evaluate(() => (
    (window.monaco?.editor?.getModels?.() || []).map((model) => model.getValue()).join('\n')
  ));
  check(`${vp.name} closing without a change restores hidden planes`,
    pressedAfter === 'false'
      && closed.toggle === false
      && closed.preview.present === false
      && !closed.planes.includes('origin:xy')
      && !closed.planes.includes('workplane:deck'),
    JSON.stringify({ pressedAfter, closed }));
  check(`${vp.name} cancel writes no plane`, !script.includes('workplane begin'), script.slice(0, 180));
  check(`${vp.name} no page errors`, errors.length === 0, errors.join(' | '));
  await context.close();
}

let browser;
try {
  if (!await waitForServer()) {
    check('dev server started', false, APP_URL);
    process.exit(1);
  }
  check('dev server started', true);
  browser = await chromium.launch({
    executablePath: exe,
    args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
  });
attachConsentPresetToBrowser(browser);
  for (const vp of [
    { name: '390', width: 390, height: 844, touch: true },
    { name: '1280', width: 1280, height: 800, touch: false },
  ]) {
    await runView(browser, vp);
  }
} catch (err) {
  check('plane tool browser pass', false, String(err && err.message ? err.message : err));
} finally {
  if (browser) await browser.close().catch(() => {});
  stop();
}

if (failed) {
  console.error(`\n${failed} plane-tool check(s) failed`);
  process.exit(1);
}
console.log('\nplane tool preview golden passed');

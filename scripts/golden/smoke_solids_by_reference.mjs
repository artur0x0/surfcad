#!/usr/bin/env node
/**
 * Extrude, Revolve, and Sweep reference named contours.
 *
 *   const c1 = makeCrossSection(frame, profile); // @contour id=c1
 *   // --- contour-mode extrude begin id=extrude1 ---
 *   part = part.add(placeInFrame(c1.plane, makeExtrude(c1.contours, 10), [0, 0, 0]));
 *   // --- contour-mode extrude end id=extrude1 ---
 *
 * A Sweep also names a path contour. The block id survives a prepended
 * comment. A second Confirm appends. Confirm at 390 and 1280 writes the
 * extrude block, then a revolve that leaves it in place. Screenshots go to
 * GOLDEN_SHOT_DIR or os.tmpdir(), never the artifacts dir.
 */
/* global document, window */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import {
  composeContourExtrude,
  composeContourRevolve,
  composeContourSweep,
  contourExtrudeOwnedRegion,
  contourSweepOwnedRegion,
} from '../../src/utils/contourMode.js';
import { parseFeatureMarkers } from '../../src/utils/featureMarkers.js';

const PORT = Number(process.env.SMOKE_PORT || 5254);
const APP_URL = `http://127.0.0.1:${PORT}/`;
const SHOT_DIR = process.env.GOLDEN_SHOT_DIR || tmpdir();
const SCRIPT = 'let part = Manifold.cube([40, 30, 20], true);\nreturn part;\n';

const FACE = {
  type: 'planar',
  center: [0, 0, 10],
  normal: [0, 0, 1],
  area: 1200,
  triangleCount: 2,
  selectionMode: 'coplanar',
  planeFrame: {
    center: [0, 0, 10],
    normal: [0, 0, 1],
    x: [1, 0, 0],
    y: [0, 1, 0],
  },
};

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

function nodeChecks() {
  console.log('solids by reference (script)');
  const extruded = composeContourExtrude(SCRIPT, {
    face: FACE,
    tool: 'circle',
    params: { radius: 5, segments: 32 },
    extrude: { distance: 10, direction: 'normal', sense: 'positive' },
  });
  check('extrude emits extrude1', extruded.ok && extruded.featureId === 'extrude1', extruded.message || '');
  check('extrude contour sits outside the block', /@contour id=c1/.test(extruded.buffer)
    && !/makeCrossSection/.test(contourExtrudeOwnedRegion(extruded.buffer, 'extrude1')));
  check('makeExtrude names c1', /makeExtrude\(c1\.contours, 10\)/.test(extruded.buffer));
  const shifted = parseFeatureMarkers(`// moved\n${extruded.buffer}`).find((f) => f.kind === 'extrude');
  check('extrude id survives a byte shift', shifted?.id === 'extrude1');

  const revolved = composeContourRevolve(extruded.buffer, {
    face: FACE,
    tool: 'circle',
    params: { radius: 4, segments: 24 },
    revolve: { angle: 360, axis: 'v', sense: 'positive' },
  });
  check('revolve appends revolve1 and leaves the extrude', revolved.ok && revolved.featureId === 'revolve1'
    && /id=extrude1/.test(revolved.buffer) && /makeRevolve\(c2\.contours\.map/.test(revolved.buffer));

  const swept = composeContourSweep(revolved.buffer, {
    face: null,
    tool: 'circle',
    params: { radius: 2, segments: 16 },
    edges: [{ a: 0, b: 1, va: [0, 0, 0], vb: [0, 0, 20], length: 20, key: 'e0' }],
    sweep: { reverse: false },
  });
  check('sweep appends sweep1 with a path contour', swept.ok && swept.featureId === 'sweep1'
    && /type: 'path'/.test(swept.buffer)
    && /sweepPoints\(new CrossSection\(c3\.contours\)/.test(contourSweepOwnedRegion(swept.buffer, 'sweep1'))
    && /id=extrude1/.test(swept.buffer) && /id=revolve1/.test(swept.buffer));
  const again = composeContourExtrude(extruded.buffer, {
    face: FACE,
    tool: 'circle',
    params: { radius: 5, segments: 32 },
    extrude: { distance: 10, direction: 'normal', sense: 'positive' },
  });
  check('extrude confirm with no id appends extrude2', again.ok && again.featureId === 'extrude2'
    && /id=extrude1/.test(again.buffer));
}

nodeChecks();
if (failed) {
  console.log(`solids by reference: ${failed} failed`);
  process.exit(1);
}

console.log('solids by reference (390 / 1280)');
mkdirSync(SHOT_DIR, { recursive: true });
check('shot dir is not the artifacts folder', !String(SHOT_DIR).startsWith('/opt/cursor/artifacts'), SHOT_DIR);

const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!exe) {
  console.log('solids by reference: no system Chrome — set CHROME_PATH');
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

async function editorScript(page) {
  return page.evaluate(() => (
    (window.monaco?.editor?.getModels?.() || []).map((m) => m.getValue()).join('\n')
  ));
}

async function boot(page) {
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
  }, SCRIPT);
  await page.waitForFunction((needle) => {
    const model = window.monaco?.editor?.getModels?.()?.[0];
    return !!model && model.getValue().includes(needle) && !model.getValue().includes('makeExtrude');
  }, 'return part;', { timeout: 8000 });
  const ran = await page.evaluate(async (src) => (
    window.__VIEWPORT__.executeScript(src)
  ), SCRIPT);
  if (ran?.error) throw new Error(ran.error);
  await page.waitForFunction(() => (window.__VIEWPORT__.stageVerifyFraming?.().tris || 0) > 10, null, { timeout: 30000 });
  await page.evaluate(() => window.__VIEWPORT__.stageFit({ az: 28, el: 18, margin: 1.02 }));
  await page.waitForTimeout(200);
}

async function newContour(page, role, index) {
  await page.locator(`[data-new-contour-role="${role}"][data-new-contour-index="${index}"]`).click();
  await page.locator('[data-contour-chip]').waitFor({ timeout: 8000 });
  await page.locator('[data-feature-card-confirm]').click();
  await page.waitForFunction(() => (
    document.querySelector('.viewport-shell')?.getAttribute('data-contour-face-aim') === 'done'
    && !document.querySelector('[data-contour-chip]')
  ), null, { timeout: 8000 });
  await page.locator('[data-contour-confirm]').click();
  await page.locator('[data-feature-slot-card]').waitFor({ timeout: 8000 });
}

async function confirmFeature(page, label) {
  const button = page.locator(`button[aria-label^="Insert ${label}"]`);
  await button.scrollIntoViewIfNeeded();
  await button.click();
  await page.locator('[data-feature-slot-card]').waitFor({ timeout: 8000 });
  await newContour(page, 'profile', 0);
  await page.locator('[data-feature-card-confirm]').click();
  await page.waitForFunction(() => !document.querySelector('[data-feature-slot-card]'), null, { timeout: 15000 });
}

async function runSize(browser, label, contextOptions) {
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(String(err).slice(0, 300)));
  await boot(page);

  await confirmFeature(page, 'Extrude');
  const first = await editorScript(page);
  console.log(`  ${label} ${(first.split('\n').find((row) => row.includes('makeExtrude')) || '').trim().slice(0, 220)}`);
  check(`${label} writes contour c1`, /@contour id=c1\b/.test(first));
  check(`${label} extrude block is extrude1`, /contour-mode extrude begin id=extrude1/.test(first)
    && /contour-mode extrude end id=extrude1/.test(first));
  check(`${label} makeExtrude names c1`, /makeExtrude\(c1\.contours/.test(first));
  check(`${label} the block does not inline a profile`, !/makeCrossSection/.test(
    first.slice(first.indexOf('contour-mode extrude begin'), first.indexOf('contour-mode extrude end')),
  ));
  check(`${label} starter cube stays`, /let part = Manifold\.cube\(\[40, 30, 20\], true\)/.test(first));
  await page.screenshot({ path: join(SHOT_DIR, `solids-by-reference-${label}.png`) });

  await confirmFeature(page, 'Revolve');
  const both = await editorScript(page);
  check(`${label} revolve appends revolve1`, /contour-mode revolve begin id=revolve1/.test(both)
    && /makeRevolve\(c2\.contours/.test(both));
  check(`${label} extrude1 stays`, /id=extrude1/.test(both));

  await confirmFeature(page, 'Extrude');
  const third = await editorScript(page);
  check(`${label} second Extrude appends extrude2`, /id=extrude1/.test(third) && /id=extrude2/.test(third));
  check(`${label} extrude1 is still one block`, (third.match(/contour-mode extrude begin id=extrude1/g) || []).length === 1);
  check(`${label} no page errors`, errors.length === 0, errors.join(' | '));
  await context.close();
}

const up = await waitForServer();
if (!up) {
  console.log('solids by reference: vite did not start');
  stop();
  process.exit(1);
}

const browser = await chromium.launch({
  executablePath: exe,
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
try {
  await runSize(browser, '390', {
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 1,
    colorScheme: 'dark',
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });
  await runSize(browser, '1280', {
    viewport: { width: 1280, height: 800 },
    hasTouch: false,
    isMobile: false,
    deviceScaleFactor: 1,
    colorScheme: 'dark',
  });
} catch (err) {
  failed += 1;
  console.log(`  ❌ run — ${err?.stack || err}`);
} finally {
  await browser.close();
  stop();
}

if (failed) {
  console.log(`solids by reference: ${failed} failed`);
  process.exit(1);
}
console.log('solids by reference: ok');

#!/usr/bin/env node
/**
 * Hole card, plane, dashed sketch, Accept. 390 and 1280.
 *
 * The card has type, size, fit, diameter, through, side, and ends.
 * Next opens the plane card and the XY / YZ / ZX quads. Select plane aims
 * the camera. The rail is Cursor, Polyline, Arc, Dimension, Constraints.
 * Sketch lines are dashed and stay the free-status colour. Accept writes
 * the centres contour and the hole block and parks the bar on hole1.
 * X, Esc, and an empty sketch write nothing.
 *
 * Screenshots go to GOLDEN_SHOT_DIR or os.tmpdir(), never the artifacts dir.
 */
/* global document, window */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const PORT = Number(process.env.SMOKE_PORT || 5243);
const APP_URL = `http://127.0.0.1:${PORT}/`;
const SHOT_DIR = process.env.GOLDEN_SHOT_DIR || tmpdir();
const SCRIPT = 'let part = Manifold.cube([40, 30, 20], true);\nreturn part;\n';

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

console.log('hole contour card');
mkdirSync(SHOT_DIR, { recursive: true });
check('shot dir is not the artifacts folder', !String(SHOT_DIR).startsWith('/opt/cursor/artifacts'), SHOT_DIR);

const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!exe) {
  console.log('hole contour card: no system Chrome — set CHROME_PATH');
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

function dotView(cam, normal) {
  if (!cam?.position || !cam?.target) return null;
  const d = [
    cam.position[0] - cam.target[0],
    cam.position[1] - cam.target[1],
    cam.position[2] - cam.target[2],
  ];
  const len = Math.hypot(d[0], d[1], d[2]);
  if (!(len > 1e-9)) return null;
  return (d[0] * normal[0] + d[1] * normal[1] + d[2] * normal[2]) / len;
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
    window.monaco.editor.getModels()[0].setValue(src);
  }, SCRIPT);
  const ran = await page.evaluate(async (src) => (
    window.__VIEWPORT__.executeScript(src)
  ), SCRIPT);
  if (ran?.error) throw new Error(ran.error);
  await page.waitForFunction(() => (window.__VIEWPORT__.stageVerifyFraming?.().tris || 0) > 10, null, { timeout: 30000 });
  await page.evaluate(() => window.__VIEWPORT__.stageFit({ az: 28, el: 18, margin: 1.02 }));
  await page.waitForTimeout(200);
}

async function editorScript(page) {
  return page.evaluate(() => window.monaco.editor.getModels()[0].getValue());
}

async function openHole(page) {
  await page.locator('button[aria-label^="Insert Hole"]').click();
  await page.locator('[data-hole-card]').waitFor({ timeout: 8000 });
}

async function openPlane(page) {
  await openHole(page);
  await page.locator('[data-hole-card] [data-feature-card-confirm]').click();
  await page.locator('[data-plane-editor]').waitFor({ timeout: 8000 });
}

async function selectPlane(page) {
  await page.locator('[data-contour-tool="polyline"]').click();
  await page.locator('[data-feature-card-confirm]').click();
  await page.waitForFunction(() => (
    document.querySelector('.viewport-shell')?.getAttribute('data-contour-face-aim') === 'done'
    && !document.querySelector('[data-contour-chip]')
    && !document.querySelector('[data-hole-card]')
  ), null, { timeout: 8000 });
}

async function projectHitsCanvas(page, world) {
  return page.evaluate((w) => {
    const p = window.__VIEWPORT__.stageProject(w);
    const canvas = document.querySelector('.viewport-shell > canvas');
    if (!p || !canvas) return { ok: false, reason: 'no project' };
    const el = document.elementFromPoint(p.x, p.y);
    return { ok: el === canvas, x: p.x, y: p.y, tag: el ? el.tagName : '' };
  }, world);
}

async function runSize(browser, label, contextOptions) {
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(String(err).slice(0, 300)));
  await boot(page);
  const before = await editorScript(page);

  await openHole(page);
  const title = (await page.locator('[data-hole-card] [data-feature-card-title]').innerText()).trim();
  const nextLabel = (await page.locator('[data-hole-card] [data-feature-card-confirm]').innerText()).trim();
  const fields = await page.locator('[data-hole-field]').evaluateAll((nodes) => (
    nodes.map((node) => node.getAttribute('data-hole-field'))
  ));
  const ends = await page.locator('[data-hole-end]').evaluateAll((nodes) => (
    nodes.map((node) => node.getAttribute('data-hole-end'))
  ));
  const cardText = await page.locator('[data-hole-card]').innerText();
  check(`${label} card is Hole`, title === 'Hole', title);
  check(`${label} Next is the card action`, nextLabel === 'Next', nextLabel);
  check(`${label} card has type size fit dia through side`,
    ['type', 'size', 'fit', 'dia', 'through', 'side'].every((name) => fields.includes(name)),
    fields.join(','));
  check(`${label} card has near and far ends`, ends.includes('near') && ends.includes('far'), ends.join(','));
  check(`${label} card has no U V or n×m`,
    !fields.includes('u') && !fields.includes('v') && !/n×m|pattern/i.test(cardText),
    cardText.slice(0, 180));
  await page.screenshot({ path: join(SHOT_DIR, `hole-card-${label}.png`) });

  await page.keyboard.press('Escape');
  await page.locator('[data-hole-card]').waitFor({ state: 'detached', timeout: 4000 });
  check(`${label} Esc on the card writes nothing`, (await editorScript(page)) === before);

  await openHole(page);
  await page.locator('[data-hole-card] [data-feature-card-cancel]').click();
  await page.locator('[data-hole-card]').waitFor({ state: 'detached', timeout: 4000 });
  check(`${label} X on the card writes nothing`, (await editorScript(page)) === before);

  await openPlane(page);
  const planeTitle = (await page.locator('[data-contour-chip] [data-feature-card-title]').innerText()).trim();
  const planeAction = (await page.locator('[data-feature-card-confirm]').innerText()).trim();
  check(`${label} plane card is the contour plane editor`, planeTitle === 'Contour', planeTitle);
  check(`${label} Select plane is the plane action`, planeAction.includes('Select plane'), planeAction);
  for (const axis of ['X', 'Y', 'Z']) {
    check(`${label} ${axis} quad button`, await page.locator(`[data-plane-editor] button[title="World ${axis} plane"]`).count() === 1);
  }
  await page.waitForFunction(() => (window.__VIEWPORT__.stageContourSketch().planePreview || []).length >= 3, null, { timeout: 4000 });
  const quads = await page.evaluate(() => window.__VIEWPORT__.stageContourSketch().planePreview.length);
  check(`${label} XY YZ ZX quads are drawn`, quads >= 3, String(quads));
  const tools = ['cursor', 'polyline', 'arc', 'dimension', 'constraints'];
  for (const id of tools) {
    check(`${label} rail has ${id}`, await page.locator(`[data-contour-tool="${id}"]`).count() === 1);
  }
  for (const id of ['circle', 'rectangle', 'polygon']) {
    check(`${label} rail hides ${id}`, await page.locator(`[data-contour-tool="${id}"]`).count() === 0);
  }
  await page.screenshot({ path: join(SHOT_DIR, `hole-plane-${label}.png`) });

  await page.locator('[data-contour-exit]').click();
  await page.locator('[data-contour-exit]').waitFor({ state: 'detached', timeout: 4000 });
  check(`${label} X on the plane writes nothing`, (await editorScript(page)) === before);

  await openPlane(page);
  await selectPlane(page);
  const cam = await page.evaluate(() => window.__VIEWPORT__.stageCamera());
  const align = dotView(cam, [0, 0, 1]);
  check(`${label} camera looks along +Z`, align != null && align > 0.98, String(align));
  await page.keyboard.press('Escape');
  await page.locator('[data-contour-exit]').waitFor({ state: 'detached', timeout: 4000 });
  check(`${label} Esc on the sketch writes nothing`, (await editorScript(page)) === before);

  await openPlane(page);
  await selectPlane(page);
  const first = await projectHitsCanvas(page, [4, -3, 10]);
  const second = await projectHitsCanvas(page, [12, 4, 10]);
  check(`${label} centre taps land on the canvas`, !!first?.ok && !!second?.ok, JSON.stringify({ first, second }));
  if (first?.ok) await page.mouse.click(first.x, first.y);
  await page.waitForFunction(() => window.__VIEWPORT__.stageContourSketch().points === 1, null, { timeout: 4000 });
  if (second?.ok) await page.mouse.click(second.x, second.y);
  await page.waitForFunction(() => {
    const sketch = window.__VIEWPORT__.stageContourSketch();
    return sketch.points === 2 && sketch.sketchLines.some((line) => line.dashed);
  }, null, { timeout: 4000 });
  const sketch = await page.evaluate(() => window.__VIEWPORT__.stageContourSketch());
  const dashed = (sketch.sketchLines || []).filter((line) => line.dashed);
  console.log(`  ${label} sketch ${JSON.stringify(sketch.sketchLines)}`);
  check(`${label} sketch lines are dashed`, dashed.length > 0, JSON.stringify(sketch.sketchLines));
  check(`${label} dashed lines keep the free colour`,
    dashed.every((line) => line.color === 0x22d3ee),
    dashed.map((line) => line.color).join(','));
  await page.screenshot({ path: join(SHOT_DIR, `hole-sketch-${label}.png`) });

  await page.locator('[data-contour-confirm]').click();
  await page.waitForFunction(() => (
    window.monaco.editor.getModels()[0].getValue().includes('holesOnContour')
  ), null, { timeout: 15000 });
  await page.waitForFunction(() => document.querySelector('[data-part-row]'), null, { timeout: 15000 });
  await page.evaluate(() => document.querySelector('[data-part-row]')?.click());
  await page.waitForFunction(() => (
    document.querySelector('[data-part-selected="true"]')
  ), null, { timeout: 8000 });
  await page.waitForFunction(() => {
    const bars = [...document.querySelectorAll('[data-rollback-bar]')];
    return bars.length > 0
      && bars.every((bar) => bar.getAttribute('data-rollback-anchor') === 'hole1');
  }, null, { timeout: 8000 });
  const written = await editorScript(page);
  check(`${label} Accept writes centres and the hole`,
    written.includes('centers: true')
      && written.includes('construction: true')
      && written.includes('holesOnContour(part, c1,')
      && !written.includes('part = hole('),
    written.slice(0, 500));
  check(`${label} the frame is baked`, /center:\s*\[/.test(written) && !written.includes('workplaneFromFace'));
  const chip = await page.evaluate(() => {
    const hole = document.querySelector('[data-feature-id="hole1"]');
    const contour = document.querySelector('[data-feature-id="contour:c1"]');
    return {
      hole: !!hole,
      rolled: hole?.getAttribute('data-feature-rolled-back') || '',
      contour: !!contour,
    };
  });
  check(`${label} bar is on the hole chip`, chip.hole && chip.rolled !== '1' && chip.contour, JSON.stringify(chip));
  await page.screenshot({ path: join(SHOT_DIR, `hole-done-${label}.png`) });

  const accepted = await editorScript(page);
  await openPlane(page);
  await selectPlane(page);
  await page.locator('[data-contour-confirm]').click();
  await page.locator('[data-contour-exit]').waitFor({ state: 'detached', timeout: 8000 });
  check(`${label} zero centres writes nothing`, (await editorScript(page)) === accepted);

  check(`${label} no page errors`, errors.length === 0, errors.join(' | '));
  await context.close();
}

const up = await waitForServer();
if (!up) {
  console.log('hole contour card: vite did not start');
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
  console.log(`hole contour card: ${failed} failed`);
  process.exit(1);
}
console.log('hole contour card: ok');

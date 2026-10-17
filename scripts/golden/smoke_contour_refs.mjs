#!/usr/bin/env node
/**
 * Dimension a sketch point to a part edge, then constrain a sketch line
 * parallel to a part edge. References draw dashed under the sketch.
 *
 * Picks are finger taps: a touch pointer down, a few pixels of movement,
 * then up, while the sketch-normal camera is still aimed. A mouse click
 * after an angled fit does not catch the orbit that used to carry part
 * edges off the finger.
 *
 * Screenshots at 390 and 1280 go to GOLDEN_SHOT_DIR or os.tmpdir().
 */
/* global document, window, MouseEvent */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { attachConsentPresetToBrowser } from './lib/presetConsentInit.mjs';

const PORT = Number(process.env.SMOKE_PORT || 5258);
const APP_URL = `http://127.0.0.1:${PORT}/`;
const SHOT_DIR = process.env.GOLDEN_SHOT_DIR || tmpdir();

const SCRIPT = `const box = Manifold.cube([40, 30, 20], true);
const c1 = makeCrossSection({ center: [0, 0, 10], normal: [0, 0, 1], x: [1, 0, 0], y: [0, 1, 0] }, solveContour({ points: [{ id: 'p0', at: [-8, -6] }, { id: 'p1', at: [8, -6] }, { id: 'p2', at: [8, 6] }, { id: 'p3', at: [-8, 6] }], lines: [{ id: 'e0', a: 'p0', b: 'p1' }, { id: 'e1', a: 'p1', b: 'p2' }, { id: 'e2', a: 'p2', b: 'p3' }, { id: 'e3', a: 'p3', b: 'p0' }], arcs: [], dimensions: [], constraints: [] })); // @contour id=c1
return box;
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

console.log('contour references (390 / 1280)');
mkdirSync(SHOT_DIR, { recursive: true });
check('shot dir is not the artifacts folder', !String(SHOT_DIR).startsWith('/opt/cursor/artifacts'), SHOT_DIR);

const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!exe) {
  console.log('contour refs: no system Chrome — set CHROME_PATH');
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

async function clickSel(page, selector) {
  const clicked = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    el.click();
    return true;
  }, selector);
  if (!clicked) throw new Error(`missing ${selector}`);
}

async function viewAlign(page) {
  const cam = await page.evaluate(() => window.__VIEWPORT__.stageCamera());
  if (!cam?.position || !cam?.target) return null;
  const d = [
    cam.position[0] - cam.target[0],
    cam.position[1] - cam.target[1],
    cam.position[2] - cam.target[2],
  ];
  const len = Math.hypot(d[0], d[1], d[2]);
  if (!(len > 1e-9)) return null;
  return d[2] / len;
}

/** Finger tap. Moves a few pixels so a rotate-on-pointerdown cannot hide. */
async function touchWorld(page, client, world) {
  const pt = await page.evaluate((w) => {
    const p = window.__VIEWPORT__.project(w[0], w[1], w[2]);
    if (!p || p.behind) return { error: `off screen ${JSON.stringify(w)}` };
    const el = document.elementFromPoint(p.x, p.y);
    const blocked = el?.closest('[data-contour-card], [data-feature-sheet], [data-contour-tool], [data-cad-feature-strip], [data-part-row]');
    return {
      ...p,
      top: el ? `${el.tagName}` : 'none',
      blocked: blocked ? (blocked.getAttribute('data-contour-card') || blocked.getAttribute('data-contour-tool') || 'chrome') : '',
    };
  }, world);
  if (pt.error) throw new Error(pt.error);
  if (pt.blocked) throw new Error(`tap covered by ${pt.blocked} at ${Math.round(pt.x)},${Math.round(pt.y)}`);
  // Stay on the canvas. The phone silhouette can sit a few pixels from the edge.
  const dx = pt.x < 24 ? 0 : 6;
  const dy = pt.y < 24 ? 0 : 4;
  const start = { x: pt.x, y: pt.y, id: 1 };
  const moved = { x: pt.x + dx, y: pt.y + dy, id: 1 };
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
  await page.waitForTimeout(40);
  await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [moved] });
  await page.waitForTimeout(70);
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(40);
  return pt;
}

/** A real finger tap. When the dimension card covers the edge, the same mouseup is delivered to the canvas. */
async function tapEdge(page, client, world) {
  try {
    return await touchWorld(page, client, world);
  } catch (err) {
    if (!/covered/.test(String(err.message || err))) throw err;
    await page.evaluate((w) => {
      const p = window.__VIEWPORT__.project(w[0], w[1], w[2]);
      const canvas = document.querySelector('.viewport-shell > canvas');
      if (!p || !canvas) return;
      canvas.dispatchEvent(new MouseEvent('mouseup', {
        clientX: p.x,
        clientY: p.y,
        button: 0,
        bubbles: true,
        cancelable: true,
      }));
    }, world);
    await page.waitForTimeout(50);
    return null;
  }
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
  const ran = await page.evaluate(async (src) => window.__VIEWPORT__.executeScript(src), SCRIPT);
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
  await page.evaluate((src) => window.monaco.editor.getModels()[0].setValue(src), SCRIPT);
  const again = await page.evaluate(async (src) => window.__VIEWPORT__.executeScript(src), SCRIPT);
  if (again?.error) throw new Error(again.error);
  await page.waitForFunction(() => (window.__VIEWPORT__.stageVerifyFraming?.().tris || 0) > 10, null, { timeout: 30000 });
  await page.locator('[data-cad-feature-strip] [data-contour-id="c1"]').waitFor({ timeout: 8000 });
}

async function runSize(browser, label, contextOptions) {
  const context = await browser.newContext({
    ...contextOptions,
    hasTouch: true,
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(String(err).slice(0, 400)));
  let client = null;
  try {
    await boot(page);
    await clickSel(page, '[data-cad-feature-strip] [data-contour-id="c1"]');
    await page.locator('[data-contour-edit]').waitFor({ timeout: 8000 });
    await page.waitForFunction(() => (
      document.querySelector('.viewport-shell')?.getAttribute('data-contour-face-aim') === 'done'
    ), null, { timeout: 8000 });
    const aimed = await viewAlign(page);
    check(`${label} sketch-normal camera looks along +Z`, aimed != null && aimed > 0.98, String(aimed));
    await clickSel(page, '[data-contour-tool="dimension"]');
    await page.locator('[data-contour-card="dimension"]').waitFor({ timeout: 8000 });
    await page.waitForTimeout(700);
    client = await context.newCDPSession(page);

    await touchWorld(page, client, [8, 6, 10]);
    await tapEdge(page, client, [0, 15, 10]);
    const still = await viewAlign(page);
    check(`${label} the tap leaves the sketch-normal camera`, still != null && still > 0.98, String(still));
    await page.waitForFunction(() => {
      const card = document.querySelector('[data-contour-card="dimension"]');
      return card && card.innerText.includes('Distance');
    }, null, { timeout: 8000 });
    check(`${label} a sketch point and a part edge offer distance`, true);
    await clickSel(page, '[data-contour-card="dimension"] [data-feature-card-confirm]');
    await page.waitForFunction(() => document.querySelector('[data-contour-tag]'), null, { timeout: 8000 });

    await clickSel(page, '[data-contour-tool="constraints"]');
    await page.locator('[data-contour-card="constraint"]').waitFor({ timeout: 8000 });
    await page.waitForTimeout(500);
    await touchWorld(page, client, [0, 6, 10]);
    await tapEdge(page, client, [-6, 15, 10]);
    await page.waitForFunction(() => {
      const card = document.querySelector('[data-contour-card="constraint"]');
      return card && /Parallel/i.test(card.innerText);
    }, null, { timeout: 8000 });
    check(`${label} a sketch line and a part edge offer parallel`, true);
    await clickSel(page, '[data-contour-card="constraint"] [data-feature-card-confirm]');
    await page.waitForFunction(() => document.querySelector('[data-contour-tag]'), null, { timeout: 8000 });
    await page.screenshot({ path: join(SHOT_DIR, `contour-refs-${label}.png`) });

    await clickSel(page, '[data-contour-confirm]');
    await page.waitForFunction(() => !document.querySelector('[data-contour-edit]'), null, { timeout: 15000 });
    const saved = await editorScript(page);
    check(`${label} the statement stores the reference`, /refs:/.test(saved) && /kind: 'edge'/.test(saved), saved.slice(0, 500));
    check(`${label} the dimension is a distance to that reference`, /kind: 'distance'/.test(saved) && /b: 'r0'/.test(saved));
    check(`${label} the constraint is parallel to that reference`, /kind: 'parallel'/.test(saved) && /'e2'/.test(saved) && /'r0'/.test(saved));
    check(`${label} no page error`, errors.length === 0, errors.join(' | '));
  } finally {
    if (client) await client.detach().catch(() => {});
    await context.close();
  }
}

const browser = await chromium.launch({
  executablePath: exe,
  headless: true,
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
attachConsentPresetToBrowser(browser);
try {
  if (!await waitForServer()) throw new Error('vite did not start');
  await runSize(browser, '390', { viewport: { width: 390, height: 844 } });
  await runSize(browser, '1280', { viewport: { width: 1280, height: 800 } });
} catch (err) {
  failed += 1;
  console.log(`  ❌ ${err?.stack || err}`);
} finally {
  await browser.close();
  stop();
}

if (failed) {
  console.log(`\n${failed} failed`);
  process.exit(1);
}
console.log('\ncontour refs golden passed');

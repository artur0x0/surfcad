#!/usr/bin/env node
/**
 * A plane move reprojects a part-edge reference. A part edit that removes
 * the edge shows it broken, keeps the last solid, and leaves the statement.
 *
 * Screenshots at 390 and 1280 go to GOLDEN_SHOT_DIR or os.tmpdir().
 */
/* global document, window, MouseEvent */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const PORT = Number(process.env.SMOKE_PORT || 5259);
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

console.log('contour reference resolve (390 / 1280)');
mkdirSync(SHOT_DIR, { recursive: true });
check('shot dir is not the artifacts folder', !String(SHOT_DIR).startsWith('/opt/cursor/artifacts'), SHOT_DIR);

const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!exe) {
  console.log('contour ref resolve: no system Chrome — set CHROME_PATH');
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

function lineEnds(script) {
  const m = String(script || '').match(/kind: 'line', a: \[([^,]+), ([^\]]+)\], b: \[([^,]+), ([^\]]+)\]/);
  if (!m) return null;
  return { au: Number(m[1]), av: Number(m[2]), bu: Number(m[3]), bv: Number(m[4]) };
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

async function clickWorld(page, world) {
  const pt = await page.evaluate((w) => {
    const p = window.__VIEWPORT__.project(w[0], w[1], w[2]);
    if (!p || p.behind) return { error: `off screen ${JSON.stringify(w)}` };
    const el = document.elementFromPoint(p.x, p.y);
    const blocked = el?.closest('[data-contour-card], [data-feature-sheet], [data-contour-tool], [data-cad-feature-strip], [data-part-row]');
    return {
      ...p,
      blocked: blocked ? (blocked.getAttribute('data-contour-card') || blocked.getAttribute('data-contour-tool') || 'chrome') : '',
    };
  }, world);
  if (pt.error) throw new Error(pt.error);
  if (pt.blocked) throw new Error(`click covered by ${pt.blocked} at ${Math.round(pt.x)},${Math.round(pt.y)}`);
  await page.evaluate(({ x, y }) => {
    const canvas = document.querySelector('.viewport-shell > canvas');
    const opts = { clientX: x, clientY: y, button: 0, bubbles: true, cancelable: true };
    canvas.dispatchEvent(new MouseEvent('mousedown', opts));
    canvas.dispatchEvent(new MouseEvent('mouseup', opts));
  }, pt);
}

async function runScript(page, src) {
  return page.evaluate(async (text) => window.__VIEWPORT__.executeScript(text), src);
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
  const ran = await runScript(page, SCRIPT);
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
  const again = await runScript(page, SCRIPT);
  if (again?.error) throw new Error(again.error);
  await page.waitForFunction(() => (window.__VIEWPORT__.stageVerifyFraming?.().tris || 0) > 10, null, { timeout: 30000 });
  await page.locator('[data-cad-feature-strip] [data-contour-id="c1"]').waitFor({ timeout: 8000 });
}

async function idle(page) {
  await page.waitForFunction(() => {
    const run = document.querySelector('[data-cad-run]');
    return !run || run.getAttribute('data-cad-run') === 'idle';
  }, null, { timeout: 20000 });
}

async function runSize(browser, label, contextOptions) {
  const context = await browser.newContext({ ...contextOptions, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(String(err).slice(0, 400)));
  await boot(page);
  await clickSel(page, '[data-cad-feature-strip] [data-contour-id="c1"]');
  await page.locator('[data-contour-edit]').waitFor({ timeout: 8000 });
  await page.waitForTimeout(400);
  await page.evaluate(() => window.__VIEWPORT__.stageFit({ az: 20, el: 70, margin: 1.2 }));
  await page.waitForTimeout(200);
  await clickSel(page, '[data-contour-tool="dimension"]');
  await page.locator('[data-contour-card="dimension"]').waitFor({ timeout: 8000 });
  await page.waitForTimeout(700);
  await clickWorld(page, [8, 6, 10]);
  await clickWorld(page, [0, 15, 10]);
  await page.waitForFunction(() => {
    const card = document.querySelector('[data-contour-card="dimension"]');
    return card && card.innerText.includes('Distance');
  }, null, { timeout: 8000 });
  await clickSel(page, '[data-contour-card="dimension"] [data-feature-card-confirm]');
  await page.waitForFunction(() => document.querySelector('[data-contour-tag]'), null, { timeout: 8000 });
  await clickSel(page, '[data-contour-confirm]');
  await page.waitForFunction(() => !document.querySelector('[data-contour-edit]'), null, { timeout: 15000 });
  await idle(page);
  const seeded = await editorScript(page);
  const before = lineEnds(seeded);
  check(`${label} the edge reference is stored`, !!before && /kind: 'distance'/.test(seeded) && /b: 'r0'/.test(seeded), seeded.slice(0, 240));

  const moved = seeded.replace(/center:\s*\[\s*0\s*,\s*0\s*,\s*10\s*\]/, 'center: [3, 0, 10]');
  check(`${label} the sketch plane can move`, moved !== seeded);
  await page.evaluate((src) => window.monaco.editor.getModels()[0].setValue(src), moved);
  const movedRun = await runScript(page, moved);
  check(`${label} the move run keeps the solid`, !movedRun?.error && movedRun?.bounds?.max?.[0] > 15, JSON.stringify(movedRun?.bounds));
  await idle(page);
  const shifted = lineEnds(await editorScript(page));
  const du = shifted && before ? shifted.au - before.au : NaN;
  const dv = shifted && before ? shifted.bu - before.bu : NaN;
  check(`${label} the move rewrites the reference geom`, Math.abs(du + 3) < 0.05 && Math.abs(dv + 3) < 0.05, JSON.stringify({ before, shifted }));

  await page.evaluate(() => window.__VIEWPORT__.stageFit({ az: 20, el: 70, margin: 1.2 }));
  await clickSel(page, '[data-cad-feature-strip] [data-contour-id="c1"]');
  await page.locator('[data-contour-edit]').waitFor({ timeout: 8000 });
  await page.waitForTimeout(500);
  const liveBroken = await page.locator('[data-contour-ref-broken]').count();
  check(`${label} a matched reference is not broken`, liveBroken === 0, String(liveBroken));

  const current = await editorScript(page);
  const cut = current.replace('Manifold.cube([40, 30, 20], true)', 'Manifold.cylinder(20, 8, 8, 24, true)');
  check(`${label} the part edit removes the cube`, cut !== current);
  await page.evaluate((src) => window.monaco.editor.getModels()[0].setValue(src), cut);
  const cutRun = await runScript(page, cut);
  check(`${label} the run names the contour`, /c1 reference is broken/.test(cutRun?.error || ''), cutRun?.error || '');
  check(`${label} the last solid is kept`, cutRun?.bounds?.max?.[0] > 15 && cutRun?.bounds?.min?.[0] < -15, JSON.stringify(cutRun?.bounds));
  await page.waitForFunction(() => {
    const tag = document.querySelector('[data-contour-ref-broken]');
    return tag && tag.getAttribute('data-contour-tag-visible') === '1';
  }, null, { timeout: 8000 });
  const kept = await editorScript(page);
  check(`${label} the statement is not rewritten`, /Manifold\.cylinder/.test(kept) && /refs:/.test(kept) && /kind: 'distance'/.test(kept) && /b: 'r0'/.test(kept));
  await page.screenshot({ path: join(SHOT_DIR, `contour-ref-resolve-${label}.png`) });
  check(`${label} no page error`, errors.length === 0, errors.join(' | '));
  await context.close();
}

const browser = await chromium.launch({
  executablePath: exe,
  headless: true,
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
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
console.log('\ncontour reference resolve golden passed');

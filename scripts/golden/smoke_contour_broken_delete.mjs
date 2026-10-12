#!/usr/bin/env node
/**
 * Delete a broken coincident from the Constrain edit card.
 *
 * Touch at 390 and 1280. The constraint has one target. Delete removes it,
 * the solver toast does not stay up, and Confirm writes the contour without it.
 *
 * Screenshots go to GOLDEN_SHOT_DIR or os.tmpdir().
 */
/* global document, window */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { specFromSolved } from '../../src/utils/contourGesture.js';
import { emitSolveContour } from '../../src/utils/contourScript.js';
import { solveContour } from '../../src/utils/contourSolve.js';

const PORT = Number(process.env.SMOKE_PORT || 5274);
const APP_URL = `http://127.0.0.1:${PORT}/`;
const SHOT_DIR = process.env.GOLDEN_SHOT_DIR || tmpdir();

const fixture = solveContour({
  points: [
    { id: 'p0', at: [-20, -12] },
    { id: 'p1', at: [20, -12] },
    { id: 'p2', at: [20, 12] },
    { id: 'p3', at: [-20, 12] },
    { id: 'pC', at: [0, 0] },
  ],
  lines: [
    { id: 'e0', a: 'p0', b: 'p1' },
    { id: 'e1', a: 'p1', b: 'p2' },
    { id: 'e2', a: 'p2', b: 'p3' },
    { id: 'e3', a: 'p3', b: 'p0' },
  ],
  arcs: [],
  dimensions: [{ id: 'd0', kind: 'length', edge: 'e0', value: 40 }],
  constraints: [
    { id: 'k0', kind: 'horizontal', items: ['e0'] },
    { id: 'kBad', kind: 'coincident', items: ['pC'] },
  ],
});
if (!fixture.constraints.some((item) => item.id === 'kBad' && item.broken)) {
  throw new Error('fixture did not keep the broken coincident');
}
const SCRIPT = `const box = Manifold.cube([40, 30, 20], true);
const c1 = makeCrossSection({ center: [0, 0, 10], normal: [0, 0, 1], x: [1, 0, 0], y: [0, 1, 0] }, ${emitSolveContour(specFromSolved(fixture))}); // @contour id=c1
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

console.log('broken coincident delete (390 / 1280, touch)');
mkdirSync(SHOT_DIR, { recursive: true });
check('shot dir is not the artifacts folder', !String(SHOT_DIR).startsWith('/opt/cursor/artifacts'), SHOT_DIR);

const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!exe) {
  console.log('broken coincident delete: no system Chrome — set CHROME_PATH');
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

async function touchSel(page, selector) {
  const loc = page.locator(selector).first();
  await loc.waitFor({ state: 'visible', timeout: 8000 });
  const box = await loc.boundingBox();
  if (!box) throw new Error(`no box ${selector}`);
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
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
    await touchSel(page, '[data-stage-btn="parts"]');
    await page.waitForFunction(() => (
      document.querySelector('[data-mobile-stage]')?.getAttribute('data-mobile-stage') === 'parts'
    ), null, { timeout: 8000 });
  }
  await clickSel(page, '[data-part-row]');
  await page.waitForFunction(() => (
    document.querySelector('[data-part-row]')?.getAttribute('data-part-selected') === 'true'
  ), null, { timeout: 8000 });
  if (phone) await touchSel(page, '[data-stage-btn="cad"]');
  await page.evaluate((src) => window.monaco.editor.getModels()[0].setValue(src), SCRIPT);
  const again = await runScript(page, SCRIPT);
  if (again?.error) throw new Error(again.error);
  await page.waitForFunction(() => (window.__VIEWPORT__.stageVerifyFraming?.().tris || 0) > 10, null, { timeout: 30000 });
  await page.locator('[data-cad-feature-strip] [data-contour-id="c1"]').waitFor({ timeout: 8000 });
}

async function runSize(browser, label, viewport) {
  const context = await browser.newContext({
    viewport,
    hasTouch: true,
    isMobile: label === '390',
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(String(err).slice(0, 400)));
  await boot(page);
  await touchSel(page, '[data-cad-feature-strip] [data-contour-id="c1"]');
  await page.locator('[data-contour-edit]').waitFor({ timeout: 8000 });
  await page.waitForFunction(() => {
    const tag = document.querySelector('[data-contour-tag="kBad"]');
    return tag?.parentElement?.getAttribute('data-contour-tag-visible') === '1';
  }, null, { timeout: 8000 });
  const poses = [
    { az: 0, el: 89 },
    { az: -30, el: 62 },
    { az: 30, el: 62 },
    { az: 180, el: 70 },
    { az: -70, el: 45 },
  ];
  let framed = false;
  for (const pose of poses) {
    await page.evaluate((p) => window.__VIEWPORT__.stageFit({ ...p, margin: 1.6 }), pose);
    await page.waitForTimeout(250);
    framed = await page.evaluate(() => {
      const tag = document.querySelector('[data-contour-tag="kBad"]');
      if (!tag || tag.parentElement?.getAttribute('data-contour-tag-visible') !== '1') return false;
      const rect = tag.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const top = document.elementFromPoint(x, y);
      return top === tag || tag.contains(top);
    });
    if (framed) break;
  }
  if (!framed) throw new Error(`${label} constraint tag stays under the chrome`);
  await touchSel(page, '[data-contour-tag="kBad"]');
  await page.locator('[data-contour-constraint-mode="edit"]').waitFor({ timeout: 8000 });
  await page.locator('[data-contour-constraint-delete]').waitFor({ timeout: 8000 });
  const cardText = await page.locator('[data-contour-card="constraint"]').innerText();
  check(`${label} the edit card shows the one target`, /pC/.test(cardText) && /1 OF 2/.test(cardText), cardText.replace(/\s+/g, ' ').slice(0, 180));
  await page.screenshot({ path: join(SHOT_DIR, `broken-constraint-card-${label}.png`) });
  await touchSel(page, '[data-contour-constraint-delete]');
  await page.waitForFunction(() => !document.querySelector('[data-contour-constraint-mode="edit"]'), null, { timeout: 8000 });
  const toast = await page.locator('[data-contour-toast]').innerText().catch(() => '');
  check(`${label} delete does not toast the solver refusal`, !/solveContour:/.test(toast), toast);
  check(`${label} the broken tag is gone`, await page.locator('[data-contour-tag="kBad"]').count() === 0);
  await touchSel(page, '[data-contour-confirm]');
  await page.waitForFunction(() => !document.querySelector('[data-contour-edit]'), null, { timeout: 15000 });
  const saved = await editorScript(page);
  check(`${label} the statement dropped the broken coincident`, /solveContour\(/.test(saved) && !/kBad/.test(saved) && /kind: 'horizontal'/.test(saved), saved.slice(0, 280));
  const rerun = await runScript(page, saved);
  check(`${label} the remaining contour runs`, !rerun?.error, rerun?.error || '');
  await page.screenshot({ path: join(SHOT_DIR, `broken-constraint-delete-${label}.png`) });
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
  await runSize(browser, '390', { width: 390, height: 844 });
  await runSize(browser, '1280', { width: 1280, height: 800 });
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
console.log('\nbroken coincident delete golden passed');

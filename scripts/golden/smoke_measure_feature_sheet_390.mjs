#!/usr/bin/env node
/**
 * Measure on the shared feature card, at 390px.
 *
 * Two face taps show distance and ΔX ΔY ΔZ. Tapping the first face again
 * removes it. A circular-edge tap shows radius. The header toggle converts
 * mm to inches. Clear drops the picks. X closes and the camera pose comes back.
 *
 * Screenshots go to GOLDEN_SHOT_DIR or os.tmpdir(), never the artifacts dir.
 */
/* global document, window, localStorage */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { attachConsentPresetToBrowser } from './lib/presetConsentInit.mjs';

const PORT = Number(process.env.SMOKE_PORT || 5221);
const APP_URL = `http://127.0.0.1:${PORT}/`;
const SHOT_DIR = process.env.GOLDEN_SHOT_DIR || tmpdir();
const SCRIPT = `let part = Manifold.cube([50, 36, 24], true);
part = part.add(Manifold.cylinder(16, 7, 7, 48, true).translate([0, 0, 20]));
return part;
`;
const FACE_X = [25, 0, 0];
const FACE_Y = [0, 18, 0];
const RIM_ANG = (41.25 * Math.PI) / 180;
const RIM = [7 * Math.cos(RIM_ANG), 7 * Math.sin(RIM_ANG), 28];

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

function numIn(text) {
  const match = String(text || '').match(/([+-]?\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : null;
}

function near(actual, expected, eps) {
  return actual != null && Math.abs(actual - expected) <= eps;
}

console.log('measure feature sheet');
mkdirSync(SHOT_DIR, { recursive: true });
check('shot dir is not the artifacts folder', !String(SHOT_DIR).startsWith('/opt/cursor/artifacts'), SHOT_DIR);

const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!exe) {
  console.log('measure feature sheet: no system Chrome — set CHROME_PATH');
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

function poseDelta(a, b) {
  if (!a || !b || !a.position || !b.position || !a.target || !b.target) return Infinity;
  const d = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
  return d(a.position, b.position) + d(a.target, b.target);
}

async function boot(page) {
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
  const ran = await page.evaluate(async (src) => window.__VIEWPORT__.executeScript(src), SCRIPT);
  if (ran?.error) throw new Error(ran.error);
  await page.waitForFunction(() => (window.__VIEWPORT__.stageVerifyFraming?.().tris || 0) > 10, null, { timeout: 30000 });
  await page.evaluate(() => window.__VIEWPORT__.stageFit({ az: 42, el: 32, margin: 1.5 }));
  await page.waitForTimeout(250);
}

async function readout(page) {
  return page.evaluate(() => {
    const card = document.querySelector('[data-measure-mode]');
    const rows = [...document.querySelectorAll('[data-measure-id]')].map((el) => ({
      id: el.getAttribute('data-measure-id'),
      kind: el.querySelector('[data-measure-value]')?.getAttribute('data-measure-value') || '',
      caption: el.querySelector('[data-measure-caption]')?.textContent.replace(/\s+/g, ' ').trim() || '',
      text: el.innerText.replace(/\s+/g, ' ').trim(),
    }));
    return {
      open: !!card,
      unit: card?.getAttribute('data-measure-unit') || '',
      picks: card?.getAttribute('data-measure-picks') || '',
      kinds: [...document.querySelectorAll('[data-measure-pick]')].map((el) => el.getAttribute('data-measure-pick')),
      labels: [...document.querySelectorAll('[data-measure-pick]')].map((el) => el.textContent.trim()),
      confirm: !!card?.querySelector('[data-feature-card-confirm]'),
      empty: !!card?.querySelector('[data-measure-empty]'),
      featureCard: card?.getAttribute('data-feature-card') != null || !!card,
      rows,
    };
  });
}

function row(info, id) {
  return info.rows.find((item) => item.id === id) || null;
}

async function tapWorld(page, world, label) {
  const point = await page.evaluate((w) => {
    const p = window.__VIEWPORT__.stageProject(w);
    const canvas = document.querySelector('.viewport-shell > canvas');
    if (!p || !canvas) return { ok: false, reason: 'no project' };
    const el = document.elementFromPoint(p.x, p.y);
    return {
      ok: el === canvas,
      x: p.x,
      y: p.y,
      tag: el ? el.tagName : '',
      attr: el?.getAttribute?.('data-feature-card') != null ? 'card' : (el?.getAttribute?.('data-measure-toggle') != null ? 'toggle' : ''),
    };
  }, world);
  check(`${label} lands on the canvas`, !!point?.ok, JSON.stringify(point));
  if (!point?.ok) return false;
  await page.mouse.click(point.x, point.y);
  await page.waitForTimeout(700);
  return true;
}

async function runPhone(browser) {
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
  await boot(page);
  const before = await page.evaluate(() => window.__VIEWPORT__.stageCamera());
  await page.locator('[data-measure-toggle]').click();
  await page.locator('[data-measure-mode="1"]').waitFor({ timeout: 8000 });
  await page.waitForTimeout(800);
  const opened = await page.evaluate(() => window.__VIEWPORT__.stageCamera());
  const slid = poseDelta(before, opened);
  console.log(`  390 camera slide ${slid.toFixed(2)}`);
  check('390 opening the card slides the camera', slid > 0.05, slid.toFixed(3));

  const cardBox = await page.locator('[data-feature-card]').boundingBox();
  check('390 card is the shared feature card', !!cardBox && cardBox.width > 80 && cardBox.width < 390, JSON.stringify(cardBox));

  await tapWorld(page, FACE_X, '390 +X face');
  await tapWorld(page, FACE_Y, '390 +Y face');
  let info = await readout(page);
  console.log(`  390 two faces ${JSON.stringify(info)}`);
  const distance = numIn(row(info, 'distance')?.text);
  const angle = numIn(row(info, 'angle')?.text);
  const dx = numIn(row(info, 'pair:dX')?.text);
  const dy = numIn(row(info, 'pair:dY')?.text);
  const dz = numIn(row(info, 'pair:dZ')?.text);
  check('390 two faces show distance', near(distance, 30.81, 0.15), String(distance));
  check('390 two faces show the right angle', near(angle, 90, 0.6), String(angle));
  check('390 two faces show ΔX', near(dx, -25, 0.15), String(dx));
  check('390 two faces show ΔY', near(dy, 18, 0.15), String(dy));
  check('390 two faces show ΔZ', near(dz, 0, 0.15), String(dz));
  check('390 measure has no Confirm', info.confirm === false);
  const mmCaptions = info.rows.filter((item) => item.kind !== 'angle');
  check('390 length captions end with mm',
    mmCaptions.length > 0 && mmCaptions.every((item) => item.caption.endsWith(' mm'))
      && !info.rows.find((item) => item.kind === 'angle')?.caption.endsWith(' mm'),
    JSON.stringify(info.rows.map((item) => item.caption)));
  const shotFaces = join(SHOT_DIR, 'measure-390-faces.png');
  await page.screenshot({ path: shotFaces });
  check('390 face shot saved outside artifacts', existsSync(shotFaces) && !shotFaces.startsWith('/opt/cursor/artifacts'), shotFaces);

  await tapWorld(page, FACE_X, '390 remove +X');
  info = await readout(page);
  console.log(`  390 after remove ${JSON.stringify(info)}`);
  check('390 tapping a face again removes it', info.picks === '1' && !row(info, 'distance'), JSON.stringify(info));

  await tapWorld(page, RIM, '390 circular edge');
  info = await readout(page);
  console.log(`  390 radius ${JSON.stringify(info)}`);
  const radius = numIn(info.rows.find((item) => item.kind === 'radius')?.text);
  const diameter = numIn(info.rows.find((item) => item.kind === 'diameter')?.text);
  check('390 circular edge shows radius', near(radius, 7, 0.15), String(radius));
  check('390 circular edge shows diameter', near(diameter, 14, 0.2), String(diameter));

  const mmRows = info.rows.filter((item) => item.kind !== 'angle');
  const angleBefore = info.rows.find((item) => item.kind === 'angle')?.text || '';
  await page.locator('[data-measure-unit-choice="in"]').click();
  await page.waitForTimeout(150);
  info = await readout(page);
  console.log(`  390 inches ${JSON.stringify(info)}`);
  check('390 unit toggle is inches', info.unit === 'in');
  let converted = mmRows.length > 0;
  for (const prev of mmRows) {
    const next = info.rows.find((item) => item.id === prev.id);
    const from = numIn(prev.text);
    const to = numIn(next?.text);
    if (!next || from == null || to == null || !near(to, from / 25.4, 0.002)) {
      converted = false;
      console.log(`  convert fail ${prev.id} ${prev.text} -> ${next?.text}`);
    }
  }
  const angleAfter = info.rows.find((item) => item.kind === 'angle')?.text || '';
  check('390 mm values convert to inches', converted && info.unit === 'in', JSON.stringify(info.rows));
  check('390 angle stays degrees', angleAfter === angleBefore);
  const inCaptions = info.rows.filter((item) => item.kind !== 'angle');
  check('390 length captions end with in',
    inCaptions.length > 0 && inCaptions.every((item) => item.caption.endsWith(' in'))
      && !(info.rows.find((item) => item.kind === 'angle')?.caption || '').endsWith(' in'),
    JSON.stringify(info.rows.map((item) => item.caption)));
  const shotIn = join(SHOT_DIR, 'measure-390-inches.png');
  await page.screenshot({ path: shotIn });
  check('390 inch shot saved outside artifacts', existsSync(shotIn) && !shotIn.startsWith('/opt/cursor/artifacts'), shotIn);

  await page.locator('[data-measure-clear]').click();
  await page.waitForTimeout(200);
  info = await readout(page);
  check('390 Clear drops the picks and leaves the card', info.open && info.picks === '0' && info.empty, JSON.stringify(info));

  await page.locator('[data-feature-card-cancel]').click();
  await page.waitForTimeout(900);
  const closed = await page.evaluate(() => ({
    card: !!document.querySelector('[data-measure-mode]'),
    pose: window.__VIEWPORT__.stageCamera(),
  }));
  const restored = poseDelta(before, closed.pose);
  console.log(`  390 camera restore ${restored.toFixed(3)}`);
  check('390 X closes the card', closed.card === false);
  check('390 X restores the camera pose', restored < 1, restored.toFixed(3));
  check('390 no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await context.close();
}

async function runDesktop(browser) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    colorScheme: 'dark',
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(String(err).slice(0, 240)));
  await boot(page);
  await page.locator('[data-measure-toggle]').click();
  await page.locator('[data-measure-mode="1"]').waitFor({ timeout: 8000 });
  await page.waitForTimeout(800);
  await tapWorld(page, FACE_X, 'desktop +X face');
  await tapWorld(page, FACE_Y, 'desktop +Y face');
  const info = await readout(page);
  console.log(`  desktop two faces ${JSON.stringify(info)}`);
  check('desktop two faces show distance', near(numIn(row(info, 'distance')?.text), 30.81, 0.15), row(info, 'distance')?.text || '');
  check('desktop two faces show ΔY', near(numIn(row(info, 'pair:dY')?.text), 18, 0.15), row(info, 'pair:dY')?.text || '');
  check('desktop measure has no Confirm', info.confirm === false);
  const shot = join(SHOT_DIR, 'measure-desktop-faces.png');
  await page.screenshot({ path: shot });
  check('desktop shot saved outside artifacts', existsSync(shot) && !shot.startsWith('/opt/cursor/artifacts'), shot);
  check('desktop no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await context.close();
}

const up = await waitForServer();
check('dev server started', up, APP_URL);
if (!up) {
  stop();
  process.exit(1);
}

const browser = await chromium.launch({
  executablePath: exe,
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
attachConsentPresetToBrowser(browser);
try {
  await runPhone(browser);
  await runDesktop(browser);
} finally {
  await browser.close();
  stop();
}

if (failed) {
  console.log(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nmeasure feature sheet passed');

#!/usr/bin/env node
/**
 * Planes as joint references.
 *
 * Opening the Joints card turns plane overlays on. A pick of an origin
 * plane plus a face, then a workplane, suggests coincident or parallel.
 * Closing the card restores the overlay unless it was toggled.
 *
 * 390 and 1280. Screenshots go to GOLDEN_SHOT_DIR or os.tmpdir().
 */
/* global document, indexedDB, localStorage, sessionStorage */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { attachConsentPresetToBrowser } from './lib/presetConsentInit.mjs';

const PORT = Number(process.env.SMOKE_PORT || 5246);
const APP_URL = `http://127.0.0.1:${PORT}/`;
const SHOT_DIR = process.env.GOLDEN_SHOT_DIR || tmpdir();
const ASM = 'JointsPlanes';
const SURF_A = '2026-10-11-15-30-00-0001-a1b2';
const SURF_B = '2026-10-11-15-30-00-0002-c3d4';
const DOC = {
  version: 1,
  source: 'git',
  name: ASM,
  activeId: 'shaft.js',
  parts: [
    { id: 'shaft.js', name: 'Shaft', visible: true, order: 0, surfId: SURF_A, position: [0, 0, 0] },
    {
      id: 'housing.js',
      name: 'Housing',
      visible: true,
      order: 1,
      surfId: SURF_B,
      position: [80, 0, 0],
      placement: { t: [80, 0, 0], q: [0, 0, 0, 1] },
    },
  ],
};
const shaftScript = (id) => `// @surf-id ${id}\nlet part = Manifold.cube([30, 30, 30], true);\nreturn part;\n`;
const housingScript = (id) => `// @surf-id ${id}
const deck = { center: [0, -36, 0], normal: [0, 1, 0], x: [1, 0, 0], y: [0, 0, 1] };
let part = Manifold.cube([30, 30, 30], true);
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

const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

console.log('joints planes');
mkdirSync(SHOT_DIR, { recursive: true });
check('shot dir is not the artifacts folder', !String(SHOT_DIR).startsWith('/opt/cursor/artifacts'), SHOT_DIR);
{
  const ui = read('src/joints/jointUi.js');
  const resolve = read('src/utils/jointResolve.js');
  const view = read('src/components/Viewport.jsx');
  check('a plane suggests coincident or parallel',
    ui.includes("return 'parallel'") && ui.includes("return 'coincident'"));
  check('a plane resolves by id',
    resolve.includes('matchJointPlane') && resolve.includes("ref.kind === 'plane'"));
  check('the joints card holds plane overlays',
    view.includes('holdJointPlanes') && view.includes('releaseJointPlanes'));
}

const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!exe) {
  console.log('joints planes: no system Chrome — set CHROME_PATH');
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

async function seedAssembly(page) {
  await page.evaluate(async ({ doc, shaft, housing }) => {
    localStorage.setItem('surfcad.github.tokenBundle', JSON.stringify({
      accessToken: '',
      refreshToken: 'ghr_staging',
      expiresAt: 1,
      refreshExpiresAt: Date.now() + 86_400_000,
    }));
    localStorage.removeItem('surfcad.github.token');
    sessionStorage.removeItem('surfcad.github.token');
    localStorage.setItem('surfcad.lastAssembly', JSON.stringify({
      'user-ar': { name: doc.name, activeId: doc.activeId, source: 'git', savedAt: Date.now() },
    }));
    await new Promise((resolve, reject) => {
      const req = indexedDB.deleteDatabase('surfcad-assembly');
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
      req.onblocked = () => resolve();
    });
    await new Promise((resolve, reject) => {
      const req = indexedDB.open('surfcad-assembly', 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('assembly')) db.createObjectStore('assembly');
        if (!db.objectStoreNames.contains('parts')) db.createObjectStore('parts');
      };
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction(['assembly', 'parts'], 'readwrite');
        tx.objectStore('assembly').put(doc, 'current');
        tx.objectStore('parts').put({ id: 'shaft.js', script: shaft, savedAt: Date.now() }, 'shaft.js');
        tx.objectStore('parts').put({ id: 'housing.js', script: housing, savedAt: Date.now() }, 'housing.js');
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
    });
  }, { doc: DOC, shaft: shaftScript(SURF_A), housing: housingScript(SURF_B) });
}

async function boot(browser, vp) {
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
  await context.addInitScript(() => { globalThis.open = () => null; });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(String(err).slice(0, 240)));
  await page.route('**/api/**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ authenticated: false }),
  }));
  await page.route('**/api/auth/me', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      authenticated: true,
      user: { id: 'user-ar', firstName: 'Artur', lastName: 'Ross', email: 'artur@example.com', vaultName: null },
    }),
  }));
  await page.route('**/api/config', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ githubAppClientId: 'Iv1.golden' }),
  }));
  await page.route('**/api/github/oauth/refresh', (route) => route.fulfill({
    status: 404,
    contentType: 'application/json',
    body: JSON.stringify({ error: 'not found' }),
  }));
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await seedAssembly(page);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-viewer-title]', { timeout: 40000 });
  await page.waitForFunction((name) => {
    const text = document.querySelector('[data-viewer-title]')?.getAttribute('data-viewer-title-text') || '';
    return text.includes(name);
  }, ASM, { timeout: 20000 });
  await page.waitForSelector('[data-joints-button]', { state: 'attached', timeout: 20000 });
  await page.waitForFunction(() => {
    const framed = globalThis.__VIEWPORT__?.stageVisibleFraming?.();
    return !!(framed && framed.parts && framed.parts.length >= 2);
  }, null, { timeout: 60000 });
  await page.evaluate(() => globalThis.__VIEWPORT__?.stageZoomToFit?.());
  await page.waitForTimeout(300);
  return { context, page, errors };
}

async function cardState(page) {
  return page.evaluate(() => {
    const card = document.querySelector('[data-joint-card]');
    const picks = card?.querySelector('[data-sticky-picks]');
    return {
      open: !!card,
      n: Number(picks?.getAttribute('data-sticky-picks') || 0),
      subtitle: (card?.querySelector('[data-feature-card-subtitle]')?.textContent || '').replace(/\s+/g, ' ').trim(),
      type: card?.getAttribute('data-joint-type') || '',
      suggestion: card?.getAttribute('data-joint-suggestion') || '',
      planes: document.querySelector('[data-overlay-toggle="plane"]')?.getAttribute('aria-pressed') || '',
    };
  });
}

async function clickCanvas(page, world) {
  const point = await page.evaluate((w) => {
    const p = globalThis.__VIEWPORT__?.stageProject?.(w);
    const canvas = document.querySelector('.viewport-shell > canvas');
    if (!p || !canvas || p.behind) return { ok: false, behind: !!p?.behind };
    const el = document.elementFromPoint(p.x, p.y);
    return { ok: el === canvas, x: p.x, y: p.y, tag: el?.tagName || '' };
  }, world);
  if (!point.ok) return point;
  await page.mouse.click(point.x, point.y);
  await page.waitForTimeout(500);
  return point;
}

async function pickUntil(page, worlds, pred) {
  let last = await cardState(page);
  let click = null;
  for (const world of worlds) {
    click = await clickCanvas(page, world);
    last = await cardState(page);
    if (pred(last)) return { ok: true, state: last, click, world };
  }
  return { ok: false, state: last, click };
}

async function look(page, el, az) {
  await page.evaluate(({ elevation, azimuth }) => {
    globalThis.__VIEWPORT__?.stageFit?.({ az: azimuth, el: elevation, margin: 2.4, assembly: true });
  }, { elevation: el, azimuth: az });
  await page.waitForTimeout(250);
}

async function clickSel(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    el.click();
    return true;
  }, selector);
}

async function chipRows(page) {
  return page.evaluate(() => {
    const seen = new Map();
    for (const el of document.querySelectorAll('[data-assembly-joints] [data-joint-id]')) {
      const id = el.getAttribute('data-joint-id');
      if (seen.has(id)) continue;
      seen.set(id, {
        id,
        type: el.getAttribute('data-joint-type') || '',
        status: el.getAttribute('data-joint-status') || '',
        value: el.getAttribute('data-joint-value'),
      });
    }
    return [...seen.values()];
  });
}

// Off the other origin planes, and on the camera side of them, so the
// ray hits this quad or this face instead of a plane through the middle.
const ORIGIN = [[20, -8, 0], [22, -6, 0], [18, -10, 0], [16, -8, 0]];
const HOUSING_TOP = [[88, -8, 15], [86, -6, 15], [90, -10, 15], [84, -4, 15]];
const WORKPLANE = [[80, -36, 8], [90, -36, 6], [70, -36, 4], [88, -36, 12], [72, -36, -8]];
const SHAFT_TOP = [[8, -6, 15], [6, -8, 15], [10, -4, 15], [4, -10, 15]];

async function runView(browser, vp) {
  const { context, page, errors } = await boot(browser, vp);
  const before = await page.evaluate(() => (
    document.querySelector('[data-overlay-toggle="plane"]')?.getAttribute('aria-pressed') || ''
  ));
  check(`${vp.name} planes start off`, before === 'false', before);
  await page.locator('[data-joints-button]').click();
  await page.waitForSelector('[data-joint-card]', { timeout: 8000 });
  await page.waitForFunction(() => (
    document.querySelector('[data-overlay-toggle="plane"]')?.getAttribute('aria-pressed') === 'true'
  ), null, { timeout: 8000 });
  const opened = await cardState(page);
  check(`${vp.name} the joints card shows planes`, opened.open && opened.planes === 'true', JSON.stringify(opened));

  await look(page, 32, -50);
  const origin = await pickUntil(page, ORIGIN, (state) => state.n >= 1 && state.subtitle.includes('plane'));
  const face = await pickUntil(page, HOUSING_TOP, (state) => (
    state.n >= 2 && state.subtitle.includes('Housing') && state.suggestion === 'parallel'
  ));
  console.log(`  ${vp.name} origin ${JSON.stringify(origin.state || origin)}`);
  check(`${vp.name} an origin plane plus a face suggests parallel`,
    origin.ok && face.ok && face.state.type === 'angle' && face.state.suggestion === 'parallel',
    JSON.stringify(face.state || face));
  const originShot = join(SHOT_DIR, `joints-planes-origin-${vp.name}.png`);
  await page.screenshot({ path: originShot });
  check(`${vp.name} origin shot saved outside artifacts`, existsSync(originShot) && !originShot.startsWith('/opt/cursor/artifacts'), originShot);

  await clickSel(page, '[data-feature-card-confirm]');
  await page.waitForTimeout(700);
  const afterOrigin = await chipRows(page);
  const parallel = afterOrigin.find((row) => row.type === 'angle');
  check(`${vp.name} the origin-plane joint is on the strip`,
    parallel?.status === 'ok' && parallel?.value === '0',
    JSON.stringify(afterOrigin));

  const work = await pickUntil(page, WORKPLANE, (state) => state.n >= 1 && state.subtitle.includes('plane'));
  const other = await pickUntil(page, SHAFT_TOP, (state) => (
    state.n >= 2 && state.subtitle.includes('Shaft') && (state.suggestion === 'coincident' || state.suggestion === 'parallel')
  ));
  console.log(`  ${vp.name} workplane ${JSON.stringify(other.state || other)}`);
  check(`${vp.name} a workplane plus a face suggests coincident or parallel`,
    work.ok && other.ok && (other.state.suggestion === 'coincident' || other.state.suggestion === 'parallel'),
    JSON.stringify({ work: work.state, other: other.state }));
  const workShot = join(SHOT_DIR, `joints-planes-workplane-${vp.name}.png`);
  await page.screenshot({ path: workShot });
  check(`${vp.name} workplane shot saved outside artifacts`, existsSync(workShot) && !workShot.startsWith('/opt/cursor/artifacts'), workShot);

  await clickSel(page, '[data-feature-card-confirm]');
  await page.waitForTimeout(700);
  const written = await chipRows(page);
  const second = written.find((row) => row.id !== parallel?.id);
  check(`${vp.name} the workplane joint is on the strip`,
    written.length >= 2 && second?.status === 'ok',
    JSON.stringify(written));

  await clickSel(page, '[data-feature-card-cancel]');
  await page.waitForFunction(() => !document.querySelector('[data-joint-card]'), null, { timeout: 8000 });
  const closed = await page.evaluate(() => (
    document.querySelector('[data-overlay-toggle="plane"]')?.getAttribute('aria-pressed') || ''
  ));
  check(`${vp.name} closing the card hides planes again`, closed === 'false', closed);
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
  check('joints planes browser pass', false, String(err && err.message ? err.message : err));
} finally {
  if (browser) await browser.close().catch(() => {});
  stop();
}

if (failed) {
  console.error(`\n${failed} joints-planes check(s) failed`);
  process.exit(1);
}
console.log('\njoints planes golden passed');

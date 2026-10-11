#!/usr/bin/env node
/**
 * Parallel, Perpendicular, and Symmetric on the joint card.
 *
 * Picks group by part in any order. A third part asks which side to
 * replace. Parallel and Perpendicular write an angle joint in one tap.
 * Two faces on each part suggest symmetric, and Add solves the center
 * planes together.
 *
 * 390 and 1280. Screenshots go to GOLDEN_SHOT_DIR or os.tmpdir().
 */
/* global document, indexedDB, localStorage, sessionStorage, window, Event, Node */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const PORT = Number(process.env.SMOKE_PORT || 5245);
const APP_URL = `http://127.0.0.1:${PORT}/`;
const SHOT_DIR = process.env.GOLDEN_SHOT_DIR || tmpdir();
const ASM = 'JointsTypes';
const SURF_A = '2026-10-10-15-30-00-0001-a1b2';
const SURF_B = '2026-10-10-15-30-00-0002-c3d4';
const SURF_C = '2026-10-10-15-30-00-0003-e5f6';
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
      position: [80, 0, 20],
      placement: { t: [80, 0, 20], q: [0, 0, 0, 1] },
    },
    {
      id: 'bracket.js',
      name: 'Bracket',
      visible: true,
      order: 2,
      surfId: SURF_C,
      position: [0, 80, 0],
      placement: { t: [0, 80, 0], q: [0, 0, 0, 1] },
    },
  ],
};
const scriptFor = (id) => `// @surf-id ${id}\nlet part = Manifold.cube([30, 30, 30], true);\nreturn part;\n`;

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

console.log('joints types');
mkdirSync(SHOT_DIR, { recursive: true });
check('shot dir is not the artifacts folder', !String(SHOT_DIR).startsWith('/opt/cursor/artifacts'), SHOT_DIR);
{
  const card = read('src/components/JointCard.jsx');
  const equations = read('src/joints/equations.js');
  check('Parallel and Perpendicular are one-tap buttons',
    card.includes('data-joint-parallel') && card.includes('data-joint-perpendicular') && card.includes('onQuickAngle?.(0)') && card.includes('onQuickAngle?.(90)'));
  check('a third part asks which part to change',
    card.includes('Change one of the parts?') && card.includes('Discard last pick') && card.includes('Replace part 1') && card.includes('Replace part 2'));
  check('symmetric has a center-plane residual', equations.includes("joint.type === 'symmetric'") && equations.includes('centerPlane'));
  check('an angle joint can be edited from the reopened card',
    card.includes('data-joint-angle') && card.includes('data-joint-delete'));
}

const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!exe) {
  console.log('joints types: no system Chrome — set CHROME_PATH');
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
  await page.evaluate(async ({ doc, shaft, housing, bracket }) => {
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
        tx.objectStore('parts').put({ id: 'bracket.js', script: bracket, savedAt: Date.now() }, 'bracket.js');
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
    });
  }, { doc: DOC, shaft: scriptFor(SURF_A), housing: scriptFor(SURF_B), bracket: scriptFor(SURF_C) });
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
    return !!(framed && framed.parts && framed.parts.length >= 3);
  }, null, { timeout: 60000 });
  await page.evaluate(() => globalThis.__VIEWPORT__?.stageZoomToFit?.());
  await page.waitForTimeout(300);
  return { context, page, errors };
}

async function cardState(page) {
  return page.evaluate(() => {
    const card = document.querySelector('[data-joint-card]');
    const picks = card?.querySelector('[data-sticky-picks]');
    const popup = card?.querySelector('[data-joint-part-change]');
    return {
      open: !!card,
      n: Number(picks?.getAttribute('data-sticky-picks') || 0),
      subtitle: (card?.querySelector('[data-feature-card-subtitle]')?.textContent || '').replace(/\s+/g, ' ').trim(),
      type: card?.getAttribute('data-joint-type') || '',
      suggestion: card?.getAttribute('data-joint-suggestion') || '',
      popup: (popup?.textContent || '').replace(/\s+/g, ' ').trim(),
      highlights: globalThis.__VIEWPORT__?.jointHighlightCount?.() ?? -1,
    };
  });
}

async function clickCanvas(page, world) {
  const point = await page.evaluate((w) => {
    const p = globalThis.__VIEWPORT__?.stageProject?.(w);
    const canvas = document.querySelector('.viewport-shell > canvas');
    if (!p || !canvas || p.behind) return { ok: false, behind: !!p?.behind };
    const el = document.elementFromPoint(p.x, p.y);
    return { ok: el === canvas, x: p.x, y: p.y };
  }, world);
  if (!point.ok) return point;
  await page.mouse.click(point.x, point.y);
  await page.waitForTimeout(500);
  return point;
}

async function pickUntil(page, worlds, pred) {
  let last = await cardState(page);
  for (const world of worlds) {
    const click = await clickCanvas(page, world);
    last = await cardState(page);
    if (pred(last)) return { ok: true, state: last, click };
  }
  return { ok: false, state: last };
}

async function look(page, el, az = 35) {
  await page.evaluate(({ elevation, azimuth }) => {
    globalThis.__VIEWPORT__?.stageFit?.({ az: azimuth, el: elevation, margin: 1.6, assembly: true });
  }, { elevation: el, azimuth: az });
  await page.waitForTimeout(250);
}

async function clearPicks(page) {
  for (let i = 0; i < 6; i += 1) {
    const n = await page.evaluate(() => document.querySelectorAll('[data-joint-card] [data-sticky-pick]').length);
    if (!n) return;
    await page.evaluate(() => document.querySelector('[data-joint-card] [data-sticky-pick]')?.click());
    await page.waitForTimeout(150);
  }
}

async function chipRows(page) {
  return page.evaluate(() => {
    const seen = new Map();
    for (const el of document.querySelectorAll('[data-assembly-joints] [data-joint-id]')) {
      const id = el.getAttribute('data-joint-id');
      if (!id || seen.has(id)) continue;
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

async function origins(page) {
  return page.evaluate(() => {
    const rows = globalThis.__VIEWPORT__?.assemblyPartPositions?.() || [];
    const by = {};
    for (const row of rows) by[row.surfId] = row.t;
    return by;
  });
}

async function clickSel(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    el.click();
    return true;
  }, selector);
}

async function openCard(page) {
  const open = await page.locator('[data-joint-card]').count();
  if (!open) {
    await page.locator('[data-joints-button]').click();
    await page.waitForSelector('[data-joint-card]', { timeout: 8000 });
  }
}

const SHAFT_TOP = [[0, 0, 15], [4, 0, 15], [0, 4, 15], [-4, 2, 15]];
const HOUSING_TOP = [[80, 0, 35], [84, 0, 35], [80, 4, 35], [76, 2, 35]];
const BRACKET_TOP = [[0, 80, 15], [4, 80, 15], [0, 84, 15], [-4, 82, 15]];
const SHAFT_BOTTOM = [[0, 0, -15], [4, 0, -15], [0, 4, -15], [-4, 2, -15]];
const HOUSING_BOTTOM = [[80, 0, 5], [84, 0, 5], [80, 4, 5], [76, 2, 5]];
const HOUSING_SIDE = [[95, 0, 20], [95, 4, 20], [95, 0, 24], [95, -4, 22]];

async function runView(browser, vp) {
  const { context, page, errors } = await boot(browser, vp);
  await openCard(page);
  const grouped = await page.evaluate(() => {
    const parallel = document.querySelector('[data-joint-parallel]');
    const perpendicular = document.querySelector('[data-joint-perpendicular]');
    const coincident = document.querySelector('[data-sticky-property="coincident"]');
    const fixed = document.querySelector('[data-sticky-property="fixed"]');
    const name = document.querySelector('[data-joint-name]');
    if (!parallel || !perpendicular || !coincident || !fixed || !name) return false;
    const group = coincident.parentElement;
    const same = parallel.parentElement === group
      && perpendicular.parentElement === group
      && fixed.parentElement === group
      && group.getAttribute('role') === 'group';
    const nameAfter = (group.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    return same && nameAfter;
  });
  check(`${vp.name} Parallel and Perpendicular share the type-button group`, grouped);
  const groupShot = join(SHOT_DIR, `joints-type-group-${vp.name}.png`);
  await page.screenshot({ path: groupShot });
  check(`${vp.name} type-group shot saved outside artifacts`, existsSync(groupShot) && !groupShot.startsWith('/opt/cursor/artifacts'), groupShot);
  await look(page, 24);

  const housingFirst = await pickUntil(page, HOUSING_TOP, (state) => state.n >= 1 && state.subtitle.includes('Housing'));
  const shaftSecond = await pickUntil(page, SHAFT_TOP, (state) => state.n >= 2 && state.subtitle.includes('Shaft') && state.subtitle.includes('Housing'));
  console.log(`  ${vp.name} order ${JSON.stringify(shaftSecond.state || shaftSecond)}`);
  check(`${vp.name} picks in either order still name both parts`,
    housingFirst.ok && shaftSecond.ok && shaftSecond.state.suggestion === 'coincident',
    JSON.stringify(shaftSecond.state || shaftSecond));

  const beforeThird = shaftSecond.state?.n;
  const third = await pickUntil(page, BRACKET_TOP, (state) => state.popup.includes('Change one of the parts?'));
  console.log(`  ${vp.name} third ${JSON.stringify(third.state || third)}`);
  check(`${vp.name} a third part asks which part to change`,
    third.ok && third.state.n === beforeThird && third.state.popup.includes('Discard last pick')
      && third.state.popup.includes('Replace part 1') && third.state.popup.includes('Replace part 2'),
    JSON.stringify(third.state || third));

  await clickSel(page, '[data-joint-part-discard]');
  await page.waitForTimeout(200);
  const discarded = await cardState(page);
  check(`${vp.name} discard last pick leaves the two parts`,
    !discarded.popup && discarded.n === beforeThird && discarded.subtitle.includes('Housing') && discarded.subtitle.includes('Shaft'),
    JSON.stringify(discarded));

  const again = await pickUntil(page, BRACKET_TOP, (state) => state.popup.includes('Change one of the parts?'));
  await clickSel(page, '[data-joint-part-replace="2"]');
  await page.waitForTimeout(200);
  const replaced = await cardState(page);
  console.log(`  ${vp.name} replaced ${JSON.stringify(replaced)}`);
  check(`${vp.name} replace part 2 swaps in the third part`,
    again.ok && !replaced.popup && replaced.subtitle.includes('Bracket')
      && replaced.subtitle.includes('Housing') && !replaced.subtitle.includes('Shaft'),
    JSON.stringify(replaced));

  await clearPicks(page);
  await look(page, 24);
  const hTop = await pickUntil(page, HOUSING_TOP, (state) => state.n >= 1 && state.subtitle.includes('Housing'));
  const sTop = await pickUntil(page, SHAFT_TOP, (state) => state.n >= 2 && state.subtitle.includes('Shaft'));
  await look(page, -28);
  const hBot = await pickUntil(page, HOUSING_BOTTOM, (state) => state.n >= 3 && state.subtitle.includes('×2'));
  const sBot = await pickUntil(page, SHAFT_BOTTOM, (state) => state.n >= 4 && state.suggestion === 'symmetric');
  console.log(`  ${vp.name} symmetric picks ${JSON.stringify(sBot.state || sBot)}`);
  check(`${vp.name} out-of-order faces suggest symmetric`,
    hTop.ok && sTop.ok && hBot.ok && sBot.ok && sBot.state.highlights === 4,
    JSON.stringify(sBot.state || sBot));

  const before = await origins(page);
  await clickSel(page, '[data-feature-card-confirm]');
  await page.waitForTimeout(600);
  const afterAdd = await cardState(page);
  const written = await chipRows(page);
  const after = await origins(page);
  const zA = before[SURF_A]?.[2];
  const zB = before[SURF_B]?.[2];
  const zA2 = after[SURF_A]?.[2];
  const zB2 = after[SURF_B]?.[2];
  const symmetric = written.find((row) => row.type === 'symmetric');
  console.log(`  ${vp.name} solve ${JSON.stringify({ before, after, written, afterAdd })}`);
  check(`${vp.name} symmetric solves and stays on the strip`,
    !!symmetric && symmetric.status === 'ok' && afterAdd.open && afterAdd.n === 0
      && Number.isFinite(zA) && Number.isFinite(zB) && Math.abs(zB - zA) > 10
      && Number.isFinite(zA2) && Number.isFinite(zB2) && Math.abs(zB2 - zA2) < 1,
    JSON.stringify({ zA, zB, zA2, zB2, symmetric, afterAdd }));

  await clickSel(page, `[data-assembly-joints] [data-joint-id="${symmetric?.id || ''}"]`);
  await page.waitForTimeout(200);
  await clickSel(page, '[data-joint-delete]');
  await page.waitForTimeout(400);
  const posed = await origins(page);
  const shift = (points, from, surf) => {
    const to = posed[surf];
    if (!to) return points;
    const d = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
    return points.map(([x, y, z]) => [x + d[0], y + d[1], z + d[2]]);
  };
  const shaftTop = shift(SHAFT_TOP, [0, 0, 0], SURF_A);
  const housingTop = shift(HOUSING_TOP, [80, 0, 20], SURF_B);
  const housingSide = shift(HOUSING_SIDE, [80, 0, 20], SURF_B);

  await look(page, 24);
  await openCard(page);
  const pShaft = await pickUntil(page, shaftTop, (state) => state.n >= 1 && state.subtitle.includes('Shaft'));
  const pHousing = await pickUntil(page, housingTop, (state) => state.n >= 2 && state.subtitle.includes('Housing'));
  await clickSel(page, '[data-joint-parallel]');
  await page.waitForTimeout(500);
  const parallelRows = await chipRows(page);
  const parallel = parallelRows.find((row) => row.type === 'angle' && row.value === '0');
  console.log(`  ${vp.name} parallel ${JSON.stringify({ pShaft: !!pShaft.ok, pHousing: !!pHousing.ok, parallelRows })}`);
  check(`${vp.name} Parallel writes an angle joint at 0`,
    pShaft.ok && pHousing.ok && !!parallel && parallel.status === 'ok',
    JSON.stringify(parallelRows));

  await clickSel(page, `[data-assembly-joints] [data-joint-id="${parallel?.id || ''}"]`);
  await page.waitForTimeout(200);
  const angleShown = await page.evaluate(() => document.querySelector('[data-joint-angle]')?.value || '');
  check(`${vp.name} the reopened card shows that angle`, angleShown === '0', angleShown);
  await clickSel(page, '[data-joint-delete]');
  await page.waitForTimeout(400);

  await openCard(page);
  await clearPicks(page);
  await look(page, 24);
  const sideShaft = await pickUntil(page, shaftTop, (state) => state.n >= 1 && state.subtitle.includes('Shaft'));
  await look(page, 6, 0);
  const sideHousing = await pickUntil(page, housingSide, (state) => state.n >= 2 && state.subtitle.includes('Housing'));
  await clickSel(page, '[data-joint-perpendicular]');
  await page.waitForTimeout(500);
  const perp = (await chipRows(page)).find((row) => row.type === 'angle' && row.value === '90');
  console.log(`  ${vp.name} perpendicular ${JSON.stringify({ sideShaft: !!sideShaft.ok, sideHousing: !!sideHousing.ok, perp })}`);
  check(`${vp.name} Perpendicular writes an angle joint at 90`,
    sideShaft.ok && sideHousing.ok && !!perp && perp.status === 'ok',
    JSON.stringify(perp));
  await clickSel(page, `[data-assembly-joints] [data-joint-id="${perp?.id || ''}"]`);
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    const input = document.querySelector('[data-joint-angle]');
    if (!input) return;
    const proto = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
    proto.set.call(input, '60');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await clickSel(page, '[data-feature-card-confirm]');
  await page.waitForTimeout(500);
  const edited = (await chipRows(page)).find((row) => row.id === perp?.id);
  check(`${vp.name} the strip chip writes a new angle`, edited?.value === '60' && edited?.status === 'ok', JSON.stringify(edited));

  const shot = join(SHOT_DIR, `joints-types-${vp.name}.png`);
  await page.screenshot({ path: shot });
  check(`${vp.name} shot saved outside artifacts`, existsSync(shot) && !shot.startsWith('/opt/cursor/artifacts'), shot);
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
  for (const vp of [
    { name: '390', width: 390, height: 844, touch: true },
    { name: '1280', width: 1280, height: 800, touch: false },
  ]) {
    await runView(browser, vp);
  }
} catch (err) {
  check('joints types browser pass', false, String(err && err.message ? err.message : err));
} finally {
  if (browser) await browser.close().catch(() => {});
  stop();
}

if (failed) {
  console.error(`\n${failed} joints-types check(s) failed`);
  process.exit(1);
}
console.log('\njoints types golden passed');

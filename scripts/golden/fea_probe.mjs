#!/usr/bin/env node
/**
 * Probe taps on a solved cantilever.
 *
 * 40×10×10 mm beam, fixed on the −X face, 200 N in −Z on the +X face.
 * 390×844 and 1280×800. A probe near the fixed root and one at the tip
 * are checked against the solver nodal values mixed by the element shape
 * functions. FEA_VIEW=390 or FEA_VIEW=desktop runs one of them.
 *
 * Screenshots go to GOLDEN_SHOT_DIR or os.tmpdir() only.
 */
/* global document, indexedDB, localStorage, window */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { attachConsentPresetToBrowser } from './lib/presetConsentInit.mjs';
import { feaStudyBlock } from '../../src/fea/studyScript.js';

const PORT = Number(process.env.SMOKE_PORT || 4347);
const APP_URL = `http://127.0.0.1:${PORT}/`;
const SHOT_DIR = process.env.GOLDEN_SHOT_DIR || tmpdir();
const SURF = '2026-10-09-04-24-00-0001-ab12';
const STUDY = feaStudyBlock({ mesh: { target: 4 } });
const CUBE = `// @surf-id ${SURF}\nconst part = Manifold.cube([40, 10, 10], false);\nreturn part;\n${STUDY}`;
const PART_ID = 'fea-block';
const USER_ID = 'user-fea';
const SHELL = '[data-fea-sheet="1"]';

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

console.log('FEA probe');

const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!exe) {
  console.log('FEA probe: no system Chrome — set CHROME_PATH. Skipping.');
  process.exit(0);
}

if (String(SHOT_DIR).startsWith('/opt/cursor/artifacts')) {
  console.log(`  ❌ screenshots must not use /opt/cursor/artifacts (${SHOT_DIR})`);
  process.exit(1);
}

mkdirSync(SHOT_DIR, { recursive: true });

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

async function seed(page) {
  await page.evaluate(async ({ script, partId, userId, surf }) => {
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
        tx.objectStore('assembly').put({
          version: 1,
          source: 'git',
          name: 'Study',
          activeId: partId,
          parts: [{ id: partId, name: 'Block', visible: true, order: 0, surfId: surf }],
          colors: { [surf]: { part: '#ef4444' } },
        }, 'current');
        tx.objectStore('parts').put({ id: partId, script, savedAt: Date.now() }, partId);
        localStorage.setItem('surfcad.github.tokenBundle', JSON.stringify({
          accessToken: 'ghu_fea',
          refreshToken: '',
          expiresAt: Date.now() + 86_400_000,
          refreshExpiresAt: 0,
        }));
        localStorage.setItem('surfcad.lastAssembly', JSON.stringify({
          [userId]: {
            name: 'Study',
            activeId: partId,
            source: 'git',
            savedAt: Date.now(),
          },
        }));
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
    });
  }, { script: CUBE, partId: PART_ID, userId: USER_ID, surf: SURF });
}

async function boot(page) {
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
      user: { id: USER_ID, email: 'fea@surfcad.test', vaultName: null },
    }),
  }));
  const marker = `${JSON.stringify({ kind: 'surfcad-vault', version: 1 }, null, 2)}\n`;
  await page.route('https://api.github.com/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    const send = (status, body) => route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
    if (path === '/user') return send(200, { login: 'fea-user' });
    if (path === '/repos/fea-user/surfcad-vault') {
      return send(200, {
        name: 'surfcad-vault',
        private: true,
        size: 1,
        default_branch: 'main',
        owner: { login: 'fea-user' },
      });
    }
    if (path === '/repos/fea-user/surfcad-vault/branches/main') {
      return send(200, { name: 'main', commit: { sha: 'a'.repeat(40) } });
    }
    if (path.startsWith('/repos/fea-user/surfcad-vault/contents/surfcad.json')) {
      return send(200, { type: 'file', encoding: 'utf-8', content: marker, sha: 'b'.repeat(40) });
    }
    return send(404, { message: 'not found' });
  });
  const errors = [];
  page.on('pageerror', (err) => errors.push(String(err).slice(0, 400)));
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForSelector('canvas', { timeout: 40000 });
  return errors;
}

async function solidReady(page) {
  await page.waitForFunction(() => {
    const spinner = document.querySelector('[data-assembly-open-spinner]');
    const solids = document.querySelector('[data-assembly-solids]')?.getAttribute('data-assembly-solids');
    const ctx = window.__MANIFOLD_CONTEXT__;
    const pending = ctx?.worker?.pendingRequests?.size || 0;
    const booted = !ctx || ctx.isReady === true;
    return !spinner && solids === '1' && pending === 0 && booted;
  }, null, { timeout: 40000 });
  await page.waitForTimeout(300);
}

// Looking down the beam, the default snap margin parks a wide camera
// inside the solid. A larger margin backs up past the root and tip faces.
const END_SNAP_MARGIN = 3;

async function snap(page, key, margin = 1.8) {
  const ok = await page.evaluate(({ name, margin: snapMargin }) => {
    if (typeof window.__VIEWPORT__?.stageSnap !== 'function') return false;
    return !!window.__VIEWPORT__.stageSnap(name, snapMargin);
  }, { name: key, margin });
  await page.waitForTimeout(250);
  return ok;
}

async function tap(page, touch, point) {
  if (touch) await page.touchscreen.tap(point.x, point.y);
  else await page.mouse.click(point.x, point.y);
}

async function probeCount(page) {
  const raw = await page.locator('[data-fea-probes]').getAttribute('data-fea-probe-count').catch(() => null);
  return raw == null ? 0 : Number(raw);
}

async function readProbes(page) {
  return page.locator('[data-fea-probe]').evaluateAll((rows) => rows.map((row) => ({
    id: row.getAttribute('data-fea-probe-id') || '',
    value: Number(row.getAttribute('data-fea-probe-value')),
    unit: row.getAttribute('data-fea-probe-unit') || '',
    quantity: row.getAttribute('data-fea-probe-quantity') || '',
    mix: row.getAttribute('data-fea-probe-mix') || '',
    x: Number(row.getAttribute('data-fea-probe-x')),
    y: Number(row.getAttribute('data-fea-probe-y')),
    z: Number(row.getAttribute('data-fea-probe-z')),
    weights: (row.getAttribute('data-fea-probe-weights') || '').split(/\s+/).filter(Boolean).map(Number),
    nodal: (row.getAttribute('data-fea-probe-nodal') || '').split(/\s+/).filter(Boolean).map(Number),
    text: (row.innerText || '').replace(/\s+/g, ' ').trim(),
  })));
}

function mixedValue(row) {
  const weights = row.weights;
  const nodal = row.nodal;
  if (!weights.length || !nodal.length) return NaN;
  if (row.mix === 'magnitude') {
    const dot = (offset) => weights.reduce((sum, weight, index) => sum + weight * nodal[offset + index], 0);
    return Math.hypot(dot(0), dot(6), dot(12));
  }
  return weights.reduce((sum, weight, index) => sum + weight * nodal[index], 0);
}

function nearNodal(row) {
  const got = mixedValue(row);
  if (!Number.isFinite(got) || !Number.isFinite(row.value)) return false;
  const scale = Math.max(1, Math.abs(row.value));
  return Math.abs(got - row.value) <= Math.max(1e-3, scale * 1e-3);
}

async function projectedGrid(page) {
  return page.evaluate(() => {
    const project = window.__VIEWPORT__?.project;
    const canvas = document.querySelector('.viewport-shell > canvas');
    if (!project || !canvas) return [];
    const points = [];
    for (let xi = 0; xi < 7; xi += 1) {
      for (let zi = 0; zi < 3; zi += 1) {
        const x = 3 + xi * 5.5;
        const z = 2 + zi * 3;
        const hit = project(x, 0, z);
        if (!hit || hit.behind) continue;
        if (document.elementFromPoint(hit.x, hit.y) !== canvas) continue;
        points.push({ x: hit.x, y: hit.y, wx: x, wz: z });
      }
    }
    return points;
  });
}

async function runCase(browser, vp) {
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    hasTouch: vp.touch,
    isMobile: vp.touch,
    deviceScaleFactor: vp.touch ? 2 : 1,
    colorScheme: 'dark',
    userAgent: vp.touch
      ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
      : undefined,
  });
  const page = await context.newPage();
  const errors = await boot(page);
  await seed(page);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('canvas', { timeout: 40000 });
  await solidReady(page);
  check(`${vp.name} front snap`, await snap(page, 'front'));

  await page.locator('[data-analyze-chip]').click();
  await page.locator(SHELL).waitFor({ timeout: 8000 });
  await page.locator('[data-fea-material]').selectOption('pla-ultimaker');
  await solidReady(page);
  check(`${vp.name} left snap`, await snap(page, 'left', END_SNAP_MARGIN));
  const rootFace = await page.evaluate(() => {
    const project = window.__VIEWPORT__?.project;
    const canvas = document.querySelector('.viewport-shell > canvas');
    if (!project || !canvas) return [];
    const points = [];
    for (const y of [3, 5, 7]) {
      for (const z of [3, 5, 7]) {
        const hit = project(0, y, z);
        if (!hit || hit.behind) continue;
        if (document.elementFromPoint(hit.x, hit.y) !== canvas) continue;
        points.push(hit);
      }
    }
    return points;
  });
  await page.locator('[data-fea-target="fixture"]').click();
  let fixed = false;
  for (const point of rootFace) {
    await tap(page, vp.touch, point);
    await page.waitForTimeout(350);
    const count = await page.locator('[data-fea-fixture-count]').getAttribute('data-fea-fixture-count').catch(() => null);
    if (count === '1') { fixed = true; break; }
  }
  check(`${vp.name} fixture`, fixed, `points=${rootFace.length}`);
  await page.locator('[data-fea-target="force"]').click();
  const down = page.locator(`${SHELL} button`, { hasText: '\u2212Z' });
  await down.scrollIntoViewIfNeeded();
  await down.click();
  check(`${vp.name} right snap`, await snap(page, 'right', END_SNAP_MARGIN));
  const tipFace = await page.evaluate(() => {
    const project = window.__VIEWPORT__?.project;
    const canvas = document.querySelector('.viewport-shell > canvas');
    if (!project || !canvas) return [];
    const points = [];
    for (const y of [3, 5, 7]) {
      for (const z of [3, 5, 7]) {
        const hit = project(40, y, z);
        if (!hit || hit.behind) continue;
        if (document.elementFromPoint(hit.x, hit.y) !== canvas) continue;
        points.push(hit);
      }
    }
    return points;
  });
  let loaded = false;
  for (const point of tipFace) {
    await tap(page, vp.touch, point);
    await page.waitForTimeout(350);
    const count = await page.locator('[data-fea-load-count]').getAttribute('data-fea-load-count').catch(() => null);
    if (count === '1') { loaded = true; break; }
  }
  check(`${vp.name} force`, loaded, `points=${tipFace.length}`);

  await page.locator('[data-fea-run]').click();
  const started = Date.now();
  let solved = false;
  while (Date.now() - started < 120000) {
    const source = await page.locator('[data-fea-source]').getAttribute('data-fea-source').catch(() => '');
    const view = await page.locator(SHELL).getAttribute('data-fea-view').catch(() => '');
    if (source === 'tet10' && view === 'results') { solved = true; break; }
    await page.waitForTimeout(80);
  }
  check(`${vp.name} solved`, solved);
  await page.waitForTimeout(300);
  check(`${vp.name} front snap for probes`, await snap(page, 'front'));

  const grid = await projectedGrid(page);
  console.log(`  grid points ${vp.name} ${grid.map((point) => point.wx.toFixed(1)).join(', ')}`);
  check(`${vp.name} probe points on the beam`, grid.length >= 2, `points=${grid.length}`);
  const span = grid.slice().sort((a, b) => a.wx - b.wx || b.wz - a.wz);
  const picks = [];
  const want = Math.min(6, span.length);
  for (let i = 0; i < want; i += 1) {
    const index = want === 1 ? 0 : Math.round((i * (span.length - 1)) / (want - 1));
    const point = span[index];
    if (!picks.some((picked) => picked.x === point.x && picked.y === point.y)) picks.push(point);
  }
  const byHeight = new Map();
  for (const point of grid) {
    const key = String(point.wz);
    if (!byHeight.has(key)) byHeight.set(key, []);
    byHeight.get(key).push(point);
  }
  let ends = null;
  for (const points of byHeight.values()) {
    const sorted = points.slice().sort((a, b) => a.wx - b.wx);
    const reach = sorted[sorted.length - 1].wx - sorted[0].wx;
    if (!ends || reach > ends.reach || (reach === ends.reach && sorted[0].wz > ends.root.wz)) {
      ends = { reach, root: sorted[0], tip: sorted[sorted.length - 1] };
    }
  }
  const placed = [];
  for (const point of picks) {
    const before = await probeCount(page);
    await tap(page, vp.touch, point);
    await page.waitForTimeout(250);
    const after = await probeCount(page);
    if (after === before + 1) placed.push(point);
  }
  const many = await readProbes(page);
  console.log(`  grid ${vp.name} ${many.map((row) => row.x.toFixed(1)).join(', ')}`);
  if (many.length >= 5) {
    const scroll = await page.locator('[data-fea-probe-list]').evaluate((el) => {
      const row = el.querySelector('[data-fea-probe]');
      const rowH = row ? row.getBoundingClientRect().height : 0;
      return { client: el.clientHeight, scroll: el.scrollHeight, rowH };
    });
    check(
      `${vp.name} probe list scrolls inside about four rows`,
      scroll.scroll > scroll.client + 1 && scroll.rowH > 0 && scroll.client <= scroll.rowH * 4.8,
      JSON.stringify(scroll),
    );
  } else {
    check(`${vp.name} enough probes to scroll`, false, `count=${many.length}`);
  }
  const rootTap = ends?.root || null;
  const tipTap = ends?.tip || null;

  await page.locator('[data-fea-probe-clear]').click();
  await page.waitForTimeout(200);
  check(`${vp.name} clear removes probes`, await probeCount(page) === 0);

  if (rootTap) await tap(page, vp.touch, rootTap);
  await page.waitForTimeout(250);
  if (tipTap && (tipTap.x !== rootTap?.x || tipTap.y !== rootTap?.y)) await tap(page, vp.touch, tipTap);
  await page.waitForTimeout(250);
  let probes = await readProbes(page);
  probes.sort((a, b) => a.x - b.x);
  console.log(`  probes ${vp.name} ${probes.map((row) => `${row.x.toFixed(1)}:${row.value.toFixed(2)} ${row.unit}`).join(' | ')}`);
  check(`${vp.name} root and tip probes`, probes.length >= 2, `count=${probes.length}`);
  const root = probes[0];
  const tip = probes[probes.length - 1];
  if (root && tip) {
    check(`${vp.name} root is nearer the wall`, root.x < 12 && tip.x > 28 && tip.x > root.x + 15, `${root.x} vs ${tip.x}`);
    check(`${vp.name} stress units`, root.unit === 'MPa' && tip.unit === 'MPa' && root.quantity === 'stress');
    check(`${vp.name} root stress above the tip`, root.value > tip.value + 5, `${root.value} vs ${tip.value}`);
    check(`${vp.name} root matches nodal stress`, nearNodal(root), `got ${root.value} mix ${mixedValue(root)}`);
    check(`${vp.name} tip matches nodal stress`, nearNodal(tip), `got ${tip.value} mix ${mixedValue(tip)}`);
    check(`${vp.name} row shows the value`, /MPa/.test(root.text) && root.text.includes(String(Math.round(root.x * 10) / 10).slice(0, 2)));
  }

  const beforeList = await page.locator('[data-fea-probe-list]').boundingBox();
  await page.locator(`${SHELL} [data-fea-plot="displacement"]`).click();
  await page.locator(`${SHELL} [data-fea-displacement]`).waitFor({ timeout: 8000 });
  await page.waitForTimeout(200);
  const disp = await readProbes(page);
  disp.sort((a, b) => a.x - b.x);
  const afterList = await page.locator('[data-fea-probe-list]').boundingBox();
  console.log(`  disp ${vp.name} ${disp.map((row) => `${row.x.toFixed(1)}:${row.value.toFixed(3)}`).join(' | ')}`);
  if (disp.length >= 2) {
    const dRoot = disp[0];
    const dTip = disp[disp.length - 1];
    check(`${vp.name} displacement units`, dRoot.unit === 'mm' && dTip.quantity === 'displacement');
    check(`${vp.name} tip moves more than the root`, dTip.value > dRoot.value + 0.2, `${dTip.value} vs ${dRoot.value}`);
    check(`${vp.name} root matches nodal displacement`, nearNodal(dRoot), `got ${dRoot.value} mix ${mixedValue(dRoot)}`);
    check(`${vp.name} tip matches nodal displacement`, nearNodal(dTip), `got ${dTip.value} mix ${mixedValue(dTip)}`);
  } else {
    check(`${vp.name} displacement probes stay`, false, `count=${disp.length}`);
  }
  check(
    `${vp.name} tab change keeps the probe list`,
    !!beforeList && !!afterList
      && Math.abs(beforeList.height - afterList.height) <= 2
      && Math.abs(beforeList.y - afterList.y) <= 2
      && disp.length === probes.length,
    JSON.stringify({ beforeList, afterList, probes: probes.length, disp: disp.length }),
  );
  const sheet = await page.locator(SHELL).boundingBox();
  check(
    `${vp.name} card stays in the viewport`,
    !!sheet && sheet.x >= -1 && sheet.y >= -1 && sheet.x + sheet.width <= vp.width + 1 && sheet.y + sheet.height <= vp.height + 1,
    JSON.stringify(sheet),
  );

  const stressShot = join(SHOT_DIR, vp.touch ? 'fea-probe-390.png' : 'fea-probe-1280.png');
  await page.locator(`${SHELL} [data-fea-plot="stress"]`).click();
  await page.waitForTimeout(200);
  check(`${vp.name} shot dir`, !stressShot.startsWith('/opt/cursor/artifacts'), stressShot);
  await page.screenshot({ path: stressShot });
  check(`${vp.name} shot saved`, existsSync(stressShot), stressShot);
  console.log(`  shot ${stressShot}`);
  const dispShot = join(SHOT_DIR, vp.touch ? 'fea-probe-disp-390.png' : 'fea-probe-disp-1280.png');
  await page.locator(`${SHELL} [data-fea-plot="displacement"]`).click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: dispShot });
  check(`${vp.name} displacement shot saved`, existsSync(dispShot), dispShot);
  console.log(`  shot ${dispShot}`);

  const beforeRemove = await probeCount(page);
  await page.locator('[data-fea-probe-remove]').first().click();
  await page.waitForTimeout(200);
  check(`${vp.name} row removes a probe`, await probeCount(page) === beforeRemove - 1);
  const left = await readProbes(page);
  if (left[0]) {
    const marker = await page.evaluate(({ x, y, z }) => window.__VIEWPORT__?.project?.(x, y, z) || null, left[0]);
    if (marker && !marker.behind) {
      await tap(page, vp.touch, marker);
      await page.waitForTimeout(300);
    }
  }
  check(`${vp.name} marker tap removes the probe`, await probeCount(page) === 0, `left=${await probeCount(page)}`);

  await page.locator('[data-fea-back]').click();
  await page.locator(`${SHELL}[data-fea-view="setup"]`).waitFor({ timeout: 8000 });
  check(`${vp.name} back clears probes`, await page.locator('[data-fea-probes]').count() === 0);
  check(`${vp.name} back keeps the fixture`, await page.locator('[data-fea-fixture-count]').getAttribute('data-fea-fixture-count') === '1');
  check(`${vp.name} back keeps the load`, await page.locator('[data-fea-load-count]').getAttribute('data-fea-load-count') === '1');
  check(`${vp.name} targets are back`, await page.locator('[data-fea-target="fixture"]').count() === 1);

  await page.locator('[data-fea-run]').click();
  await page.waitForTimeout(400);
  check(`${vp.name} a new solve clears probes`, await probeCount(page) === 0);
  const cancel = page.locator('[data-fea-cancel]');
  if (await cancel.count()) await cancel.click();

  check(`${vp.name} no page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await context.close();
}

const viewArg = process.env.FEA_VIEW || '';
const viewports = [
  { name: '390', width: 390, height: 844, touch: true },
  { name: 'desktop', width: 1280, height: 800, touch: false },
].filter((vp) => !viewArg || vp.name === viewArg || (viewArg === '1280' && vp.name === 'desktop'));

let browser;
try {
  if (!await waitForServer()) {
    check('server started', false, `no response on ${APP_URL}`);
    process.exit(1);
  }
  check('server started', true);
  browser = await chromium.launch({
    executablePath: exe,
    args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
  });
attachConsentPresetToBrowser(browser);
  for (const vp of viewports) {
    console.log(` ${vp.name}`);
    await runCase(browser, vp);
  }
} finally {
  if (browser) await browser.close();
  stop();
}

if (failed) {
  console.log(`FEA probe: ${failed} failed`);
  process.exit(1);
}
console.log('FEA probe: ok');

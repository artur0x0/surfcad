#!/usr/bin/env node
/**
 * Contour title and the perpendicular chip at 390 and 1280.
 *
 * The part-in-assembly pills (Bracket in Metallll) hide while contour mode
 * is open, and the status legend is centred on that box within 1px.
 * Leaving contour mode shows the pills again. A perpendicular sketch chip
 * uses Lucide angle. Polyline and arc keep waypoints and spline.
 *
 * Screenshots go to GOLDEN_SHOT_DIR or os.tmpdir(), never the artifacts dir.
 */
/* global document, indexedDB, localStorage, sessionStorage, window */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const PORT = Number(process.env.SMOKE_PORT || 5341);
const APP_URL = `http://127.0.0.1:${PORT}/`;
const SHOT_DIR = process.env.GOLDEN_SHOT_DIR || tmpdir();
const ASM = 'Metallll';
const DOC = {
  version: 1,
  source: 'git',
  name: ASM,
  activeId: 'bracket',
  parts: [{ id: 'bracket', name: 'Bracket', visible: true, order: 0 }],
};
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

console.log('contour legend');
mkdirSync(SHOT_DIR, { recursive: true });
check('shot dir is not the artifacts folder', !String(SHOT_DIR).startsWith('/opt/cursor/artifacts'), SHOT_DIR);

const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!exe) {
  console.log('contour legend: no system Chrome — set CHROME_PATH');
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
  await page.evaluate(async ({ doc, script }) => {
    localStorage.setItem('surfcad.github.tokenBundle', JSON.stringify({
      accessToken: '',
      refreshToken: 'ghr_staging',
      expiresAt: 1,
      refreshExpiresAt: Date.now() + 86_400_000,
    }));
    localStorage.removeItem('surfcad.github.token');
    sessionStorage.removeItem('surfcad.github.token');
    localStorage.setItem('surfcad.lastAssembly', JSON.stringify({
      'user-ar': {
        name: doc.name,
        activeId: doc.activeId,
        source: 'git',
        savedAt: Date.now(),
      },
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
        tx.objectStore('parts').put({ id: 'bracket', script, savedAt: Date.now() }, 'bracket');
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
    });
  }, { doc: DOC, script: SCRIPT });
}

async function boot(browser, vp) {
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    hasTouch: vp.mobile,
    isMobile: vp.mobile,
    deviceScaleFactor: 1,
    colorScheme: 'dark',
    userAgent: vp.mobile
      ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
      : undefined,
  });
  await context.addInitScript(() => {
    window.__SURFCAD_NO_TUTORIAL = true;
    globalThis.open = () => null;
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(String(err).slice(0, 300)));
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
  await page.waitForFunction(() => {
    const canvas = document.querySelector('.viewport-shell > canvas');
    const text = document.querySelector('[data-viewer-title]')?.getAttribute('data-viewer-title-text') || '';
    return !!(canvas && canvas.clientWidth > 0 && window.__VIEWPORT__?.ready?.()
      && window.__MANIFOLD_CONTEXT__?.isReady && text.includes('Metallll'));
  }, null, { timeout: 90000 });
  return { context, page, errors };
}

async function selectPart(page, mobile) {
  if (mobile) {
    await page.locator('[data-stage-btn="parts"]').click();
    await page.waitForTimeout(200);
  }
  const row = page.locator('[data-part-row="bracket"]');
  await row.waitFor({ state: 'visible', timeout: 15000 });
  await row.click({ position: { x: 12, y: 12 } });
  if (mobile) {
    await page.locator('[data-stage-btn="cad"]').click();
    await page.waitForTimeout(200);
  }
}

function centerOf(rect) {
  return {
    cx: rect.left + rect.width / 2,
    cy: rect.top + rect.height / 2,
    w: rect.width,
    h: rect.height,
  };
}

async function titleLayout(page) {
  return page.evaluate(() => {
    const box = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return {
        left: r.left,
        top: r.top,
        width: r.width,
        height: r.height,
        visibility: style.visibility,
        display: style.display,
        text: (el.textContent || '').replace(/\s+/g, ' ').trim(),
      };
    };
    const title = document.querySelector('[data-viewer-title]');
    const pills = document.querySelector('[data-viewer-title-pills]');
    const chips = document.querySelector('[data-viewer-title-chips]');
    const part = document.querySelector('[data-title-role="part"]');
    const inn = document.querySelector('[data-title-in]');
    const assembly = document.querySelector('[data-title-role="assembly"]');
    const legend = document.querySelector('[data-contour-status-legend]');
    const nodes = [part, inn, assembly].filter(Boolean);
    let union = null;
    if (nodes.length) {
      const rects = nodes.map((el) => el.getBoundingClientRect());
      const left = Math.min(...rects.map((r) => r.left));
      const top = Math.min(...rects.map((r) => r.top));
      const right = Math.max(...rects.map((r) => r.right));
      const bottom = Math.max(...rects.map((r) => r.bottom));
      union = { left, top, width: right - left, height: bottom - top };
    }
    return {
      hiddenAttr: !!title?.hasAttribute('data-viewer-title-hidden'),
      text: title?.getAttribute('data-viewer-title-text') || '',
      title: box(title),
      pills: box(pills),
      chips: box(chips),
      legend: box(legend),
      union,
      legendLabels: legend
        ? [...legend.querySelectorAll('[data-contour-status]')].map((el) => (el.textContent || '').trim())
        : [],
    };
  });
}

function centred(layout) {
  if (!layout?.legend || !layout?.union || layout.union.width < 8 || layout.legend.width < 8) {
    return { ok: false, dx: Infinity, dy: Infinity };
  }
  const pill = centerOf(layout.union);
  const legend = centerOf(layout.legend);
  const dx = Math.abs(legend.cx - pill.cx);
  const dy = Math.abs(legend.cy - pill.cy);
  return { ok: dx <= 1 && dy <= 1, dx, dy, pill, legend };
}

async function muteTags(page) {
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('[data-contour-tag], [data-contour-tags] *')) {
      el.style.pointerEvents = 'none';
    }
  });
}

async function waitCameraStill(page) {
  let prev = null;
  for (let i = 0; i < 25; i += 1) {
    const pos = await page.evaluate(() => window.__VIEWPORT__.stageCamera().position);
    const still = prev && Math.hypot(pos[0] - prev[0], pos[1] - prev[1], pos[2] - prev[2]) < 1e-3;
    if (still) return;
    prev = pos;
    await page.waitForTimeout(40);
  }
}

async function tapCanvas(page, spot) {
  await page.mouse.move(spot.x, spot.y);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(80);
}

/** A sketch line, or the part edge under it. Either can take Perpendicular. */
async function addEdgePick(page, pointA, pointB) {
  await muteTags(page);
  await waitCameraStill(page);
  const spots = await page.evaluate(([idA, idB]) => {
    const dots = window.__VIEWPORT__.stageContourSketch().dots || [];
    const a = dots.find((dot) => dot.id === idA);
    const b = dots.find((dot) => dot.id === idB);
    if (!a || !b) return [];
    const out = [];
    for (let s = 1; s < 12; s += 1) {
      const t = s / 12;
      const x = a.x + (b.x - a.x) * t;
      const y = a.y + (b.y - a.y) * t;
      const near = dots.some((dot) => Math.hypot(dot.x - x, dot.y - y) < 14);
      const node = document.elementFromPoint(x, y);
      const canvas = node && (node.tagName === 'CANVAS' || node.closest?.('canvas'));
      if (!near && canvas) out.push({ x, y, rank: Math.abs(t - 0.5) });
    }
    out.sort((p, q) => p.rank - q.rank);
    return out;
  }, [pointA, pointB]);
  for (const spot of spots) {
    const before = await page.evaluate(() => (
      window.__VIEWPORT__.stageContourSketch().picked.map((p) => `${p.kind}:${p.id}`)
    ));
    await tapCanvas(page, spot);
    const after = await page.evaluate(() => (
      window.__VIEWPORT__.stageContourSketch().picked.map((p) => `${p.kind}:${p.id}`)
    ));
    const added = after.find((id) => !before.includes(id));
    if (!added) continue;
    if (added.startsWith('line:') || added.startsWith('ref:')) return added;
    await tapCanvas(page, spot);
  }
  return '';
}

async function runSize(browser, vp) {
  const { context, page, errors } = await boot(browser, vp);
  try {
    await selectPart(page, vp.mobile);
    await page.waitForFunction(() => {
      const part = document.querySelector('[data-title-role="part"]');
      const style = part ? window.getComputedStyle(part) : null;
      return (part?.textContent || '').trim() === 'Bracket' && style?.visibility === 'visible';
    }, null, { timeout: 10000 });
    await page.waitForFunction(() => (window.__VIEWPORT__.stageVerifyFraming?.().tris || 0) > 10, null, { timeout: 30000 });
    const shown = await titleLayout(page);
    check(`${vp.name} pill reads Bracket in Metallll`,
      shown.text === `Bracket in ${ASM}` && shown.chips?.visibility === 'visible' && !shown.hiddenAttr && !shown.legend,
      JSON.stringify({ text: shown.text, chips: shown.chips?.visibility, legend: !!shown.legend }));

    await page.locator('button[aria-label^="Insert Create contour"]').click();
    await page.locator('[data-contour-chip]').waitFor({ timeout: 8000 });
    await page.locator('[data-contour-tool="rectangle"]').click();
    await page.locator('[data-feature-card-confirm]').click();
    await page.waitForFunction(() => (
      document.querySelector('.viewport-shell')?.getAttribute('data-contour-face-aim') === 'done'
      && !document.querySelector('[data-contour-chip]')
      && document.querySelector('[data-contour-status-legend]')
    ), null, { timeout: 8000 });
    await page.waitForFunction(() => (window.__VIEWPORT__.stageContourSketch().dots || []).length === 4, null, { timeout: 8000 });

    const laid = await titleLayout(page);
    const place = centred(laid);
    console.log(`  ${vp.name} legend ${JSON.stringify({ dx: place.dx, dy: place.dy, labels: laid.legendLabels })}`);
    check(`${vp.name} pill is hidden in contour mode`,
      laid.hiddenAttr
      && laid.chips?.visibility === 'hidden'
      && laid.chips.width > 8
      && laid.chips.height > 8
      && laid.text === `Bracket in ${ASM}`
      && laid.legend?.visibility === 'visible',
      JSON.stringify({ hidden: laid.hiddenAttr, chips: laid.chips, legend: laid.legend?.visibility }));
    check(`${vp.name} legend is centred on the pill within 1px`,
      place.ok && laid.legendLabels.join(',') === 'Free,Locked,Conflict,Repeated',
      `dx ${place.dx} dy ${place.dy} labels ${laid.legendLabels.join(',')}`);

    const railIcons = await page.evaluate(() => {
      const cls = (sel) => document.querySelector(sel)?.querySelector('svg')?.getAttribute('class') || '';
      return {
        polyline: cls('[data-contour-tool="polyline"]'),
        arc: cls('[data-contour-tool="arc"]'),
      };
    });
    check(`${vp.name} polyline and arc icons remain`,
      railIcons.polyline.includes('lucide-waypoints') && railIcons.arc.includes('lucide-spline'),
      JSON.stringify(railIcons));

    await page.locator('[data-contour-tool="constraints"]').click();
    await page.locator('[data-contour-card="constraint"]').waitFor({ timeout: 8000 });
    const first = await addEdgePick(page, 'p0', 'p1');
    const second = await addEdgePick(page, 'p1', 'p2');
    check(`${vp.name} two adjacent edges are picked`, !!first && !!second, `${first} ${second}`);
    if (!first || !second) throw new Error(`edges not picked ${first} ${second}`);
    await page.locator('[data-sticky-property="perpendicular"]').click();
    await page.waitForFunction(() => {
      const btn = document.querySelector('[data-feature-card-confirm]');
      return btn && !btn.disabled && /Add/.test(btn.textContent || '');
    }, null, { timeout: 4000 });
    await page.locator('[data-feature-card-confirm]').click();
    await page.waitForFunction(() => {
      const chip = [...document.querySelectorAll('[data-cad-feature-strip] [data-sketch-kind="constraint"]')]
        .find((el) => (el.getAttribute('aria-label') || '') === 'Perpendicular');
      return !!chip?.querySelector('svg.lucide-angle');
    }, null, { timeout: 8000 });
    const icon = await page.evaluate(() => {
      const chip = [...document.querySelectorAll('[data-cad-feature-strip] [data-sketch-kind="constraint"]')]
        .find((el) => (el.getAttribute('aria-label') || '') === 'Perpendicular');
      const svg = chip?.querySelector('svg');
      const rect = svg?.getBoundingClientRect();
      return {
        className: svg?.getAttribute('class') || '',
        plus: !!chip?.querySelector('svg.lucide-plus'),
        w: rect?.width || 0,
        h: rect?.height || 0,
      };
    });
    check(`${vp.name} perpendicular chip uses the angle icon`,
      icon.className.includes('lucide-angle') && !icon.plus && icon.w > 8 && icon.h > 8,
      JSON.stringify(icon));
    await page.screenshot({ path: join(SHOT_DIR, `contour-legend-${vp.name}.png`) });

    const still = centred(await titleLayout(page));
    check(`${vp.name} legend stays centred after the constraint`, still.ok, `dx ${still.dx} dy ${still.dy}`);

    await page.locator('[data-contour-card-cancel], [data-feature-card-cancel]').first().click();
    await page.locator('[data-contour-exit]').click();
    await page.waitForFunction(() => (
      !document.querySelector('[data-contour-exit]')
      && !document.querySelector('[data-contour-status-legend]')
      && !document.querySelector('[data-viewer-title]')?.hasAttribute('data-viewer-title-hidden')
    ), null, { timeout: 8000 });
    const back = await titleLayout(page);
    check(`${vp.name} pill returns after contour mode`,
      back.chips?.visibility === 'visible'
      && back.text === `Bracket in ${ASM}`
      && !back.legend
      && (back.chips?.text || '').includes('Bracket')
      && (back.chips?.text || '').includes(ASM),
      JSON.stringify({ text: back.text, chips: back.chips?.visibility, legend: !!back.legend }));
    check(`${vp.name} page stays quiet`, errors.length === 0, errors.join(' | '));
  } finally {
    await context.close();
  }
}

if (!(await waitForServer())) {
  console.log('contour legend: vite did not start');
  stop();
  process.exit(1);
}

const browser = await chromium.launch({
  executablePath: exe,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
try {
  await runSize(browser, { name: '390', width: 390, height: 844, mobile: true });
  await runSize(browser, { name: '1280', width: 1280, height: 800, mobile: false });
} catch (err) {
  failed += 1;
  console.log(`  ❌ contour legend threw — ${err?.stack || err}`);
} finally {
  await browser.close();
  stop();
}

if (failed) {
  console.log(`contour legend: ${failed} failed`);
  process.exit(1);
}
console.log('contour legend: ok');

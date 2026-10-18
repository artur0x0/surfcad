#!/usr/bin/env node
/**
 * Load direction arrows and triad-colored direction buttons.
 *
 * A force set to −Z draws yellow arrows on the loaded face, pointing in
 * that screen direction. +X retargets them. Normal removes them. The X/Y/Z
 * buttons use the viewport triad constant: filled when selected, outlined
 * when not, with readable contrast. The force box ends in an N|lb toggle.
 * The study stays in newtons; imperial is the global display unit.
 *
 * 390×844 touch and 1280×800. FEA_VIEW=390 or FEA_VIEW=1280 runs one.
 * FEA_PREVIEW=1 serves dist. Screenshots go to GOLDEN_SHOT_DIR or
 * os.tmpdir() only. Never spark staging, and never /opt/cursor/artifacts.
 */
/* global document, getComputedStyle, indexedDB, localStorage, window */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { attachConsentPresetToBrowser } from './lib/presetConsentInit.mjs';
import { MPA_PER_PSI, N_PER_LBF, formatLoadDisplay } from '../../src/fea/loadUnits.js';
import { TRIAD_AXIS_COLORS, contrastRatio } from '../../src/utils/triadAxis.js';

const PORT = Number(process.env.SMOKE_PORT || 4343);
const APP_URL = `http://127.0.0.1:${PORT}/`;
const SHOT_DIR = process.env.GOLDEN_SHOT_DIR || tmpdir();
const PREVIEW = process.env.FEA_PREVIEW === '1';
const PART_ID = '2026-10-18-12-00-00-0003-cc03';
const CUBE = `// @surf-id ${PART_ID}\nconst part = Manifold.cube([40, 40, 40], false);\nreturn part;\n`;
const USER_ID = 'user-fea-arrows';
const YELLOW = { r: 234, g: 179, b: 8 };

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

console.log('FEA load direction arrows');

const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!exe) {
  console.log('FEA load arrows: no system Chrome — set CHROME_PATH. Skipping.');
  process.exit(0);
}

if (String(SHOT_DIR).startsWith('/opt/cursor/artifacts')) {
  console.log(`  ❌ screenshots must not use /opt/cursor/artifacts (${SHOT_DIR})`);
  process.exit(1);
}

mkdirSync(SHOT_DIR, { recursive: true });

const serverArgs = PREVIEW
  ? ['vite', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort']
  : ['vite', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'];
const server = spawn('npx', serverArgs, {
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

async function waitForServer(timeoutMs = 90000) {
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
  await page.evaluate(async ({ script, partId, userId }) => {
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
          name: 'Arrows',
          activeId: partId,
          parts: [{ id: partId, name: 'Block', visible: true, order: 0 }],
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
            name: 'Arrows',
            activeId: partId,
            source: 'git',
            savedAt: Date.now(),
          },
        }));
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
    });
  }, { script: CUBE, partId: PART_ID, userId: USER_ID });
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
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console ${msg.text().slice(0, 300)}`);
  });
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
  await page.waitForTimeout(400);
}

function installProbe(page) {
  return page.evaluate(() => {
    window.__feaProbe = {
      bits() {
        const canvas = document.querySelector('.viewport-shell > canvas');
        const root = document.getElementById('root');
        const key = Object.keys(root).find((k) => k.startsWith('__reactContainer'));
        const start = root[key].current || root[key];
        const seen = new Set();
        let renderer = null;
        function walk(fiber) {
          if (!fiber || seen.has(fiber) || renderer) return;
          seen.add(fiber);
          let hook = fiber.memoizedState;
          for (let guard = 0; hook && guard < 900; guard += 1) {
            const cur = hook.memoizedState && hook.memoizedState.current;
            if (cur && typeof cur.setPixelRatio === 'function' && typeof cur.render === 'function' && cur.domElement === canvas) {
              renderer = cur;
            }
            hook = hook.next;
          }
          walk(fiber.child);
          walk(fiber.sibling);
        }
        walk(start);
        return { canvas, renderer };
      },
    };
  });
}

async function snap(page, key) {
  const viaHook = await page.evaluate((name) => {
    if (typeof window.__VIEWPORT__?.stageSnap === 'function') return !!window.__VIEWPORT__.stageSnap(name, 2.4);
    return false;
  }, key);
  if (viaHook) {
    await page.waitForTimeout(300);
    return true;
  }
  const labels = { iso: 'Snap to Isometric', front: 'Snap to Front', top: 'Snap to Top' };
  if (!labels[key]) return false;
  await page.locator('[aria-label="View snaps"]').click();
  await page.locator(`[aria-label="${labels[key]}"]`).click();
  await page.waitForTimeout(400);
  return true;
}

async function withScene(page, readerSource, arg) {
  return page.evaluate(({ readerSource: source, arg: input }) => new Promise((resolve) => {
    const probe = window.__feaProbe?.bits?.();
    const canvas = probe?.canvas;
    const renderer = probe?.renderer;
    if (!canvas || !renderer) {
      resolve(null);
      return;
    }
    const readScene = new Function('scene', 'camera', 'canvas', 'renderer', 'input', source);
    const orig = renderer.render.bind(renderer);
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      renderer.render = orig;
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), 2500);
    renderer.render = function hooked(scene, camera) {
      const out = orig(scene, camera);
      try {
        const value = readScene(scene, camera, canvas, renderer, input);
        clearTimeout(timer);
        finish(value);
      } catch (err) {
        clearTimeout(timer);
        finish({ error: String(err && err.message ? err.message : err) });
      }
      return out;
    };
  }), { readerSource, arg });
}

const FACE_POINTS_SOURCE = `
  let mesh = null;
  let best = 0;
  scene.traverse((obj) => {
    const count = obj.geometry?.attributes?.position?.count || 0;
    if (obj.isMesh && count > best && obj.name !== 'fea-face-highlight') {
      best = count;
      mesh = obj;
    }
  });
  if (!mesh) return [];
  mesh.updateWorldMatrix(true, false);
  const position = mesh.geometry.attributes.position;
  const index = mesh.geometry.index?.array;
  if (!position || !index) return [];
  const rect = canvas.getBoundingClientRect();
  const scratch = camera.position.clone();
  const points = [];
  const step = Math.max(1, Math.floor(index.length / 3 / 24));
  for (let t = 0; t < index.length / 3; t += step) {
    const a = index[t * 3];
    const b = index[t * 3 + 1];
    const c = index[t * 3 + 2];
    const ax = position.getX(a);
    const ay = position.getY(a);
    const az = position.getZ(a);
    const bx = position.getX(b);
    const by = position.getY(b);
    const bz = position.getZ(b);
    const cx = position.getX(c);
    const cy = position.getY(c);
    const cz = position.getZ(c);
    const centroid = scratch.clone().set((ax + bx + cx) / 3, (ay + by + cy) / 3, (az + bz + cz) / 3);
    centroid.applyMatrix4(mesh.matrixWorld);
    const world = { x: centroid.x, y: centroid.y, z: centroid.z };
    const projected = centroid.project(camera);
    if (projected.z < -1 || projected.z > 1) continue;
    const x = rect.left + (projected.x * 0.5 + 0.5) * rect.width;
    const y = rect.top + (-projected.y * 0.5 + 0.5) * rect.height;
    if (x < rect.left + 4 || x > rect.right - 4 || y < rect.top + 4 || y > rect.bottom - 4) continue;
    const nz = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
    points.push({ x, y, nz, world });
  }
  points.sort((p, q) => q.nz - p.nz);
  return points.slice(0, 12);
`;

const ARROW_SOURCE = `
  const rect = canvas.getBoundingClientRect();
  const gl = renderer.getContext();
  const scaleX = gl.drawingBufferWidth / Math.max(1, rect.width);
  const scaleY = gl.drawingBufferHeight / Math.max(1, rect.height);
  const arrows = [];
  scene.updateMatrixWorld(true);
  scene.traverse((obj) => {
    if (obj.name !== 'fea-load-arrow' || !obj.userData?.dir) return;
    const part = obj.parent?.parent?.parent;
    const tip = camera.position.clone().set(obj.userData.tip[0], obj.userData.tip[1], obj.userData.tip[2]);
    const tail = camera.position.clone().set(obj.userData.tail[0], obj.userData.tail[1], obj.userData.tail[2]);
    if (typeof obj.localToWorld === 'function') {
      obj.localToWorld(tip);
      obj.localToWorld(tail);
    }
    const dir = camera.position.clone().set(obj.userData.dir[0], obj.userData.dir[1], obj.userData.dir[2]);
    if (part?.matrixWorld) dir.transformDirection(part.matrixWorld);
    const project = (point) => {
      const p = point.clone().project(camera);
      return {
        x: (p.x * 0.5 + 0.5) * rect.width,
        y: (-p.y * 0.5 + 0.5) * rect.height,
      };
    };
    const tipS = project(tip);
    const tailS = project(tail);
    const screen = { x: tipS.x - tailS.x, y: tipS.y - tailS.y };
    const origin = tip.clone();
    const ahead = tip.clone().addScaledVector(dir, 12);
    const expected = {
      x: project(ahead).x - project(origin).x,
      y: project(ahead).y - project(origin).y,
    };
    const samples = [];
    for (const t of [0.35, 0.62, 0.82]) {
      samples.push({
        x: tailS.x + (tipS.x - tailS.x) * t,
        y: tailS.y + (tipS.y - tailS.y) * t,
      });
    }
    let best = null;
    let yellow = 0;
    for (const sample of samples) {
      const cx = Math.round(sample.x * scaleX);
      const cy = Math.round((rect.height - sample.y) * scaleY);
      const radius = 5;
      const x0 = Math.max(0, cx - radius);
      const y0 = Math.max(0, cy - radius);
      const x1 = Math.min(gl.drawingBufferWidth, cx + radius);
      const y1 = Math.min(gl.drawingBufferHeight, cy + radius);
      const w = Math.max(1, x1 - x0);
      const h = Math.max(1, y1 - y0);
      const buf = new Uint8Array(w * h * 4);
      gl.readPixels(x0, y0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      for (let i = 0; i < buf.length; i += 4) {
        const r = buf[i];
        const g = buf[i + 1];
        const b = buf[i + 2];
        const dist = Math.hypot(r - input.yellow.r, g - input.yellow.g, b - input.yellow.b);
        if (!best || dist < best.dist) best = { r, g, b, dist };
        if (dist < 80 && r > 180 && b < 80) yellow += 1;
      }
    }
    arrows.push({
      dir: [dir.x, dir.y, dir.z],
      screen,
      expected,
      yellow,
      best,
      span: Math.hypot(screen.x, screen.y),
    });
  });
  return { count: arrows.length, arrows };
`;

function dot2(a, b) {
  const al = Math.hypot(a.x, a.y);
  const bl = Math.hypot(b.x, b.y);
  if (!(al > 0.5) || !(bl > 0.5)) return 0;
  return (a.x * b.x + a.y * b.y) / (al * bl);
}

function parseRgb(text) {
  const match = String(text || '').match(/rgba?\(([^)]+)\)/);
  if (!match) return null;
  const parts = match[1].split(',').map((item) => Number(item.trim()));
  return {
    r: parts[0],
    g: parts[1],
    b: parts[2],
    a: parts.length > 3 ? parts[3] : 1,
  };
}

function nearHex(parsed, hex) {
  if (!parsed) return false;
  return Math.abs(parsed.r - ((hex >> 16) & 255)) <= 1
    && Math.abs(parsed.g - ((hex >> 8) & 255)) <= 1
    && Math.abs(parsed.b - (hex & 255)) <= 1;
}

function hexOf(parsed) {
  if (!parsed) return 0;
  return ((parsed.r & 255) << 16) | ((parsed.g & 255) << 8) | (parsed.b & 255);
}

async function unitToggleBox(page, vp) {
  return page.locator('[data-fea-load-units]').evaluate((el, size) => {
    const box = el.getBoundingClientRect();
    const buttons = [...el.querySelectorAll('[data-fea-load-unit-choice]')].map((button) => {
      const b = button.getBoundingClientRect();
      const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      return {
        label: button.getAttribute('data-fea-load-unit-choice'),
        pressed: button.getAttribute('aria-pressed'),
        className: button.className,
        top: b.top,
        left: b.left,
        right: b.right,
        bottom: b.bottom,
        hit: hit === button || button.contains(hit),
      };
    });
    return {
      unit: el.getAttribute('data-fea-load-unit'),
      top: box.top,
      left: box.left,
      right: box.right,
      bottom: box.bottom,
      vw: size.width,
      vh: size.height,
      buttons,
    };
  }, { width: vp.width, height: vp.height });
}

function toggleFits(box) {
  if (!box || box.buttons.length < 2) return false;
  const inside = box.top >= -1 && box.left >= -1 && box.right <= box.vw + 1 && box.bottom <= box.vh + 1;
  return inside && box.buttons.every((button) => button.hit
    && button.top >= -1
    && button.left >= -1
    && button.right <= box.vw + 1
    && button.bottom <= box.vh + 1);
}

async function directionButtons(page) {
  await page.locator('[data-fea-direction="-z"]').scrollIntoViewIfNeeded();
  return page.locator('[data-fea-direction]').evaluateAll((els) => els.map((el) => {
    const style = getComputedStyle(el);
    const box = el.getBoundingClientRect();
    return {
      value: el.getAttribute('data-fea-direction'),
      axis: el.getAttribute('data-fea-axis'),
      pressed: el.getAttribute('aria-pressed'),
      bg: style.backgroundColor,
      color: style.color,
      border: style.borderTopColor,
      width: box.width,
      height: box.height,
      top: box.top,
      left: box.left,
    };
  }));
}

function checkButtons(vp, rows, selected) {
  const selectedRow = rows.find((row) => row.value === selected);
  const axis = selected === '+x' || selected === '-x' ? 'x' : (selected === '+z' || selected === '-z' ? 'z' : null);
  check(`${vp.name} ${selected} is pressed`, selectedRow?.pressed === 'true', JSON.stringify(selectedRow));
  if (axis && selectedRow) {
    const fill = TRIAD_AXIS_COLORS[axis];
    const bg = parseRgb(selectedRow.bg);
    const ink = parseRgb(selectedRow.color);
    check(
      `${vp.name} ${selected} fill matches the triad`,
      nearHex(bg, fill),
      `bg=${selectedRow.bg} triad=${fill.toString(16)}`,
    );
    check(
      `${vp.name} ${selected} text contrast`,
      bg && ink && contrastRatio(hexOf(ink), hexOf(bg)) >= 4.5,
      `color=${selectedRow.color} bg=${selectedRow.bg}`,
    );
  }
  for (const name of ['x', 'y', 'z']) {
    const off = rows.find((row) => row.axis === name && row.pressed !== 'true');
    if (!off) continue;
    const fill = TRIAD_AXIS_COLORS[name];
    check(
      `${vp.name} unselected ${name} uses the triad outline`,
      nearHex(parseRgb(off.color), fill) && nearHex(parseRgb(off.border), fill),
      `color=${off.color} border=${off.border}`,
    );
    const bg = parseRgb(off.bg);
    check(
      `${vp.name} unselected ${name} is not filled`,
      !bg || bg.a < 0.2 || !nearHex(bg, fill),
      off.bg,
    );
    check(
      `${vp.name} ${name} button is on screen`,
      off.width > 8 && off.height > 8 && off.left >= -1 && off.top >= -1 && off.left < vp.width,
      JSON.stringify(off),
    );
  }
}

async function tap(page, touch, point) {
  if (touch) await page.touchscreen.tap(point.x, point.y);
  else await page.mouse.click(point.x, point.y);
}

async function loadCount(page) {
  return page.locator('[data-fea-load-count]').getAttribute('data-fea-load-count').catch(() => null);
}

async function pickFace(page, touch) {
  const points = await withScene(page, FACE_POINTS_SOURCE, null);
  const list = Array.isArray(points) ? points : [];
  for (const point of list) {
    if (documentHit(point)) {
      const hit = await page.evaluate(({ x, y }) => {
        const canvas = document.querySelector('.viewport-shell > canvas');
        return document.elementFromPoint(x, y) === canvas;
      }, point);
      if (!hit) continue;
    }
    await tap(page, touch, point);
    try {
      await page.waitForFunction(() => (
        document.querySelector('[data-fea-load-count]')?.getAttribute('data-fea-load-count') === '1'
      ), null, { timeout: 2500 });
      return point;
    } catch { /* try the next centroid */ }
  }
  return null;
}

function documentHit() {
  return true;
}

async function readArrows(page) {
  return withScene(page, ARROW_SOURCE, { yellow: YELLOW });
}

async function waitArrows(page, predicate, timeoutMs = 6000) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeoutMs) {
    last = await readArrows(page);
    if (last && predicate(last)) return last;
    await page.waitForTimeout(200);
  }
  return last;
}

function describeArrows(reading) {
  if (!reading) return 'null';
  if (reading.error) return reading.error;
  const first = reading.arrows?.[0];
  const yellow = (reading.arrows || []).reduce((sum, arrow) => sum + (arrow.yellow || 0), 0);
  const best = (reading.arrows || []).reduce((winner, arrow) => {
    if (!arrow.best) return winner;
    if (!winner || arrow.best.dist < winner.dist) return arrow.best;
    return winner;
  }, null);
  const align = first ? dot2(first.screen, first.expected) : 0;
  return `count=${reading.count} yellow=${yellow} align=${align.toFixed(2)} best=${best ? `(${best.r},${best.g},${best.b}) d=${best.dist.toFixed(0)}` : 'none'}`;
}

function arrowsPoint(reading, minDot = 0.8) {
  if (!reading?.arrows?.length) return false;
  return reading.arrows.every((arrow) => dot2(arrow.screen, arrow.expected) >= minDot && arrow.span > 4);
}

function arrowsYellow(reading) {
  if (!reading?.arrows?.length) return false;
  return reading.arrows.some((arrow) => arrow.yellow >= 4 && arrow.best && arrow.best.dist < 80);
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
  await installProbe(page);
  await page.locator('[data-analyze-chip]').click();
  const shell = '[data-fea-sheet="1"]';
  await page.locator(shell).waitFor({ timeout: 8000 });
  await page.locator('[data-fea-target="force"]').click();
  await page.waitForTimeout(700);
  check(`${vp.name} iso snap`, await snap(page, 'iso'));
  const forceField = page.locator('[data-popup-number="fea-force"]');
  await forceField.scrollIntoViewIfNeeded();
  check(`${vp.name} force field is newtons`, await forceField.getAttribute('data-unit') === 'N');
  check(`${vp.name} force label stays Force`, await forceField.getAttribute('data-field-label') === 'Force');
  check(`${vp.name} default force is 200 N`, await forceField.inputValue() === formatLoadDisplay(200, 'N'));
  const newtonToggle = await unitToggleBox(page, vp);
  const newtonButton = newtonToggle?.buttons?.find((button) => button.label === 'N');
  const poundButton = newtonToggle?.buttons?.find((button) => button.label === 'lb');
  check(`${vp.name} N|lb toggle is on screen`, toggleFits(newtonToggle), JSON.stringify(newtonToggle));
  check(
    `${vp.name} N is the selected segment`,
    newtonToggle?.unit === 'N' && newtonButton?.pressed === 'true' && /bg-cyan-600/.test(newtonButton?.className || '') && /text-white/.test(newtonButton?.className || ''),
    JSON.stringify(newtonButton),
  );
  check(
    `${vp.name} lb is the idle segment`,
    poundButton?.pressed === 'false' && /text-gray-300/.test(poundButton?.className || '') && !/bg-cyan-600/.test(poundButton?.className || ''),
    JSON.stringify(poundButton),
  );
  await page.locator('[data-fea-load-unit-choice="lb"]').click();
  check(`${vp.name} lb shows the converted force`, await forceField.inputValue() === formatLoadDisplay(200, 'lb'));
  check(`${vp.name} lb uses the lbf factor`, Math.abs(Number(await forceField.inputValue()) * N_PER_LBF - 200) < 0.001);
  check(`${vp.name} field unit follows the toggle`, await forceField.getAttribute('data-unit') === 'lb');
  const poundToggle = await unitToggleBox(page, vp);
  check(`${vp.name} lb segment selected`, poundToggle?.unit === 'lb' && toggleFits(poundToggle), JSON.stringify(poundToggle));
  const unitsShot = join(SHOT_DIR, `fea-load-units-${vp.name}-lb.png`);
  check(`${vp.name} unit shot dir`, !unitsShot.startsWith('/opt/cursor/artifacts'), unitsShot);
  await page.screenshot({ path: unitsShot });
  await page.locator('[data-fea-load-unit-choice="N"]').click();
  check(`${vp.name} back to N restores 200`, await forceField.inputValue() === formatLoadDisplay(200, 'N'));
  await page.locator('[data-fea-target="pressure"]').click();
  const pressureField = page.locator('[data-popup-number="fea-pressure"]');
  await pressureField.scrollIntoViewIfNeeded();
  check(`${vp.name} pressure field is megapascals`, await pressureField.getAttribute('data-unit') === 'MPa');
  check(`${vp.name} default pressure is 1 MPa`, await pressureField.inputValue() === formatLoadDisplay(1, 'MPa'));
  const pascalToggle = await unitToggleBox(page, vp);
  check(
    `${vp.name} MPa|psi toggle is on screen`,
    toggleFits(pascalToggle) && pascalToggle.buttons.map((button) => button.label).join(',') === 'MPa,psi',
    JSON.stringify(pascalToggle),
  );
  await page.locator('[data-fea-load-unit-choice="psi"]').click();
  check(`${vp.name} psi shows the converted pressure`, await pressureField.inputValue() === formatLoadDisplay(1, 'psi'));
  check(`${vp.name} psi uses the psi factor`, Math.abs(Number(await pressureField.inputValue()) * MPA_PER_PSI - 1) < 0.001);
  const psiShot = join(SHOT_DIR, `fea-load-units-${vp.name}-psi.png`);
  await page.screenshot({ path: psiShot });
  await page.locator('[data-fea-load-unit-choice="MPa"]').click();
  check(`${vp.name} back to MPa restores 1`, await pressureField.inputValue() === formatLoadDisplay(1, 'MPa'));
  await page.locator('[data-fea-target="force"]').click();
  await page.locator('[data-fea-direction="-z"]').click();
  const picked = await pickFace(page, vp.touch);
  check(`${vp.name} force on a face`, !!picked && await loadCount(page) === '1', `loads=${await loadCount(page)}`);
  const stored = ((await page.locator('[data-fea-load="0"]').innerText()) || '').replace(/\s+/g, ' ');
  check(`${vp.name} stored force is newtons`, /0,\s*0,\s*-200 N/.test(stored), stored);
  await page.locator('[data-fea-load-unit-choice="lb"]').click();
  const storedLb = ((await page.locator('[data-fea-load="0"]').innerText()) || '').replace(/\s+/g, ' ');
  check(`${vp.name} toggling lb keeps the stored newtons`, storedLb === stored, storedLb);
  check(`${vp.name} displayed pounds match 200 N`, await forceField.inputValue() === formatLoadDisplay(200, 'lb'));
  await page.locator('[data-fea-load-unit-choice="N"]').click();
  check(`${vp.name} iso snap for -Z`, await snap(page, 'iso'));
  const down = await waitArrows(page, (reading) => arrowsPoint(reading) && arrowsYellow(reading));
  check(`${vp.name} -Z arrows are yellow and point -Z`, arrowsPoint(down) && arrowsYellow(down) && down.count >= 3 && down.count <= 9, describeArrows(down));
  const downButtons = await directionButtons(page);
  checkButtons(vp, downButtons, '-z');
  const shotZ = join(SHOT_DIR, `fea-load-arrows-${vp.name}-z.png`);
  check(`${vp.name} -Z shot dir`, !shotZ.startsWith('/opt/cursor/artifacts'), shotZ);
  await page.screenshot({ path: shotZ });

  await page.locator('[data-fea-direction="+x"]').click();
  check(`${vp.name} iso snap for +X`, await snap(page, 'iso'));
  const side = await waitArrows(page, (reading) => {
    if (!arrowsPoint(reading) || !arrowsYellow(reading)) return false;
    const dir = reading.arrows[0]?.dir;
    return dir && dir[0] > 0.9 && Math.abs(dir[2]) < 0.2;
  });
  check(`${vp.name} +X updates the arrows`, arrowsPoint(side) && arrowsYellow(side) && side?.arrows?.[0]?.dir?.[0] > 0.9, describeArrows(side));
  check(`${vp.name} load count stays one`, await loadCount(page) === '1', await loadCount(page));
  const sideButtons = await directionButtons(page);
  checkButtons(vp, sideButtons, '+x');
  const shotX = join(SHOT_DIR, `fea-load-arrows-${vp.name}-x.png`);
  await page.screenshot({ path: shotX });

  await page.locator('[data-fea-direction="normal"]').click();
  const cleared = await waitArrows(page, (reading) => reading && reading.count === 0);
  check(`${vp.name} Normal removes the arrows`, cleared?.count === 0, describeArrows(cleared));
  check(`${vp.name} the load remains`, await loadCount(page) === '1', await loadCount(page));
  const shotN = join(SHOT_DIR, `fea-load-arrows-${vp.name}-normal.png`);
  await page.screenshot({ path: shotN });
  check(`${vp.name} no page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  console.log(`GOLDEN ${vp.name} ${JSON.stringify({
    down: describeArrows(down),
    side: describeArrows(side),
    cleared: describeArrows(cleared),
  })}`);
  await context.close();
}

const viewArg = process.env.FEA_VIEW || '';
const viewports = [
  { name: '390', width: 390, height: 844, touch: true },
  { name: '1280', width: 1280, height: 800, touch: false },
].filter((vp) => !viewArg || vp.name === viewArg || (viewArg === 'desktop' && vp.name === '1280'));

let browser;
try {
  if (!await waitForServer()) {
    check('server started', false, `no response on ${APP_URL}`);
    process.exit(1);
  }
  browser = await chromium.launch({
    executablePath: exe,
    headless: true,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl'],
  });
attachConsentPresetToBrowser(browser);
  for (const vp of viewports) {
    console.log(`— ${vp.name}`);
    await runCase(browser, vp);
  }
} catch (err) {
  check('golden run', false, String(err && err.stack ? err.stack : err).slice(0, 800));
} finally {
  if (browser) await browser.close();
  stop();
}

if (failed) {
  console.log(`FEA load arrows: ${failed} failed`);
  process.exit(1);
}
console.log('FEA load arrows: ok');

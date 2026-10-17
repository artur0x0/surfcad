#!/usr/bin/env node
/**
 * Analyze face highlights. Tapping a face toggles one overlay. Three taps
 * on the same face leave a single overlay whose pixel brightness matches
 * the first tap, not a stacked brighter copy. Two faces, then Clear
 * (the fixture remove buttons), leave overlay count 0 and the base color.
 * Close drops the overlays. Opening the saved study puts back exactly one.
 *
 * 390×844 touch and 1280×800 desktop. FEA_VIEW=390 or FEA_VIEW=1280 runs
 * one of them. FEA_PREVIEW=1 serves the existing dist. Screenshots go to
 * GOLDEN_SHOT_DIR or os.tmpdir() only.
 */
/* global document, indexedDB, localStorage, window */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { attachConsentPresetToBrowser } from './lib/presetConsentInit.mjs';

const PORT = Number(process.env.SMOKE_PORT || 4333);
const APP_URL = `http://127.0.0.1:${PORT}/`;
const SHOT_DIR = process.env.GOLDEN_SHOT_DIR || tmpdir();
const PREVIEW = process.env.FEA_PREVIEW === '1';
const CUBE = 'const part = Manifold.cube([40, 10, 10], false);\nreturn part;\n';
const PART_ID = 'fea-highlight';
const USER_ID = 'user-fea-highlight';
const END_SNAP_MARGIN = 3;
const SAME_TOGGLE_MAX = 18;
const BASE_MAX = 18;
const HIGHLIGHT_MIN = 8;

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

console.log('FEA face highlight');

const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!exe) {
  console.log('FEA face highlight: no system Chrome — set CHROME_PATH. Skipping.');
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
          name: 'Highlight',
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
            name: 'Highlight',
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

async function snap(page, key, margin) {
  const viaHook = await page.evaluate(({ name, margin: pad }) => {
    window.__feaView = name;
    if (typeof window.__VIEWPORT__?.stageSnap === 'function') return !!window.__VIEWPORT__.stageSnap(name, pad);
    return false;
  }, { name: key, margin });
  if (viaHook) {
    await page.waitForTimeout(250);
    return true;
  }
  const fitted = await page.evaluate(({ name, margin: pad }) => new Promise((resolve) => {
    const presets = {
      front: { dir: [0, -1, 0], up: [0, 0, 1] },
      right: { dir: [1, 0, 0], up: [0, 0, 1] },
      left: { dir: [-1, 0, 0], up: [0, 0, 1] },
      top: { dir: [0, 0, 1], up: [0, -1, 0] },
      iso: { dir: [1, 1, 1], up: [0, 0, 1] },
    };
    const preset = presets[name];
    const canvas = document.querySelector('.viewport-shell > canvas');
    const root = document.getElementById('root');
    const reactKey = root && Object.keys(root).find((k) => k.startsWith('__reactContainer'));
    const start = reactKey ? (root[reactKey].current || root[reactKey]) : null;
    const seen = new Set();
    let renderer = null;
    let controls = null;
    function walk(fiber) {
      if (!fiber || seen.has(fiber) || (renderer && controls)) return;
      seen.add(fiber);
      let hook = fiber.memoizedState;
      for (let guard = 0; hook && guard < 900; guard += 1) {
        const cur = hook.memoizedState && hook.memoizedState.current;
        if (cur && cur.domElement === canvas && typeof cur.render === 'function') renderer = cur;
        if (cur && cur.target && typeof cur.update === 'function' && typeof cur.rotateSpeed === 'number') controls = cur;
        hook = hook.next;
      }
      walk(fiber.child);
      walk(fiber.sibling);
    }
    if (!preset || !start) {
      resolve(false);
      return;
    }
    walk(start);
    if (!renderer || !controls) {
      resolve(false);
      return;
    }
    const orig = renderer.render.bind(renderer);
    renderer.render = function hooked(scene, camera) {
      const out = orig(scene, camera);
      renderer.render = orig;
      let mesh = null;
      let best = 0;
      scene.traverse((obj) => {
        const count = obj.geometry?.attributes?.position?.count || 0;
        if (obj.isMesh && count > best && obj.name !== 'fea-face-highlight') {
          best = count;
          mesh = obj;
        }
      });
      const geometry = mesh?.geometry;
      if (!geometry?.attributes?.position) {
        resolve(false);
        return out;
      }
      geometry.computeBoundingBox();
      const box = geometry.boundingBox;
      if (!box || box.isEmpty()) {
        resolve(false);
        return out;
      }
      const vec = () => camera.position.clone();
      const center = box.getCenter(vec());
      const d = vec().set(preset.dir[0], preset.dir[1], preset.dir[2]);
      if (d.lengthSq() < 1e-12) d.set(1, 1, 1);
      d.normalize();
      let u = vec().set(preset.up[0], preset.up[1], preset.up[2]);
      if (u.lengthSq() < 1e-12) u.set(0, 0, 1);
      if (Math.abs(u.dot(d)) > 1 - 1e-6) u.set(0, 0, 1);
      u.sub(d.clone().multiplyScalar(u.dot(d))).normalize();
      const zAxis = d.clone();
      const xAxis = vec().crossVectors(u, zAxis).normalize();
      const yAxis = vec().crossVectors(zAxis, xAxis);
      const tanY = Math.tan(((camera.fov || 45) * Math.PI) / 360) || 1e-6;
      const tanX = tanY * (camera.aspect > 0 ? camera.aspect : 1);
      let dist = 0;
      const corner = vec();
      for (let i = 0; i < 8; i += 1) {
        corner.set(
          i & 1 ? box.max.x : box.min.x,
          i & 2 ? box.max.y : box.min.y,
          i & 4 ? box.max.z : box.min.z,
        ).sub(center);
        dist = Math.max(dist, Math.abs(corner.dot(xAxis)) / tanX, Math.abs(corner.dot(yAxis)) / tanY);
      }
      const marginPad = Number.isFinite(pad) && pad > 0 ? pad : 1.35;
      dist = (dist || 1) * marginPad;
      camera.near = Math.max(dist / 1000, 1e-4);
      camera.far = Math.max(dist * 10, camera.far || 2000);
      camera.up.copy(u);
      camera.position.copy(center).addScaledVector(d, dist);
      camera.updateProjectionMatrix();
      camera.lookAt(center);
      controls.target.copy(center);
      controls.update();
      resolve(true);
      return out;
    };
  }), { name: key, margin });
  if (fitted) {
    await page.waitForTimeout(250);
    return true;
  }
  const labels = { front: 'Snap to Front', right: 'Snap to Right', left: 'Snap to Left', top: 'Snap to Top', iso: 'Snap to Isometric' };
  if (!labels[key]) return false;
  await page.locator('[aria-label="View snaps"]').click();
  await page.locator(`[aria-label="${labels[key]}"]`).click();
  await page.waitForTimeout(300);
  return true;
}

function endFacePoints(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector('.viewport-shell > canvas');
    if (!canvas) return [];
    const rect = canvas.getBoundingClientRect();
    const pts = [];
    const spots = [
      [0.5, 0.28],
      [0.5, 0.34],
      [0.42, 0.36],
      [0.58, 0.36],
      [0.5, 0.42],
      [0.5, 0.46],
    ];
    for (const [fx, fy] of spots) {
      const x = rect.left + rect.width * fx;
      const y = rect.top + rect.height * fy;
      if (document.elementFromPoint(x, y) === canvas) pts.push({ x, y });
    }
    return pts;
  });
}

async function tap(page, touch, point) {
  if (touch) await page.touchscreen.tap(point.x, point.y);
  else await page.mouse.click(point.x, point.y);
}

async function fixtureCount(page) {
  return page.locator('[data-fea-fixture-count]').getAttribute('data-fea-fixture-count').catch(() => null);
}

async function waitFixtures(page, expected) {
  try {
    await page.waitForFunction((value) => (
      document.querySelector('[data-fea-fixture-count]')?.getAttribute('data-fea-fixture-count') === value
    ), expected, { timeout: 4000 });
    return true;
  } catch {
    return false;
  }
}

async function sampleAt(page, point) {
  return page.evaluate(({ x, y }) => new Promise((resolve) => {
    const probe = window.__feaProbe?.bits?.();
    const canvas = probe?.canvas;
    const renderer = probe?.renderer;
    if (!canvas || !renderer) {
      resolve(null);
      return;
    }
    const orig = renderer.render.bind(renderer);
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      renderer.render = orig;
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), 2000);
    renderer.render = function hooked(scene, camera) {
      const out = orig(scene, camera);
      try {
        const gl = renderer.getContext();
        const rect = canvas.getBoundingClientRect();
        const scaleX = gl.drawingBufferWidth / Math.max(1, rect.width);
        const scaleY = gl.drawingBufferHeight / Math.max(1, rect.height);
        const cx = Math.round((x - rect.left) * scaleX);
        const cy = Math.round((rect.bottom - y) * scaleY);
        const radius = Math.max(2, Math.round(6 * Math.max(scaleX, scaleY)));
        const x0 = Math.max(0, cx - radius);
        const y0 = Math.max(0, cy - radius);
        const x1 = Math.min(gl.drawingBufferWidth, cx + radius);
        const y1 = Math.min(gl.drawingBufferHeight, cy + radius);
        const w = Math.max(1, x1 - x0);
        const h = Math.max(1, y1 - y0);
        const buf = new Uint8Array(w * h * 4);
        gl.readPixels(x0, y0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
        let n = 0;
        let sr = 0;
        let sg = 0;
        let sb = 0;
        for (let i = 0; i < buf.length; i += 4) {
          const r = buf[i];
          const g = buf[i + 1];
          const b = buf[i + 2];
          if (r < 45 && g < 45 && b < 45) continue;
          n += 1;
          sr += r;
          sg += g;
          sb += b;
        }
        let overlays = 0;
        scene.traverse((obj) => {
          if (obj.name === 'fea-face-highlight') overlays += 1;
        });
        clearTimeout(timer);
        finish({
          n,
          r: n ? sr / n : 0,
          g: n ? sg / n : 0,
          b: n ? sb / n : 0,
          overlays,
        });
      } catch {
        clearTimeout(timer);
        finish(null);
      }
      return out;
    };
  }), { x: point.x, y: point.y });
}

function rgbDist(a, b) {
  if (!a || !b || !(a.n >= 8) || !(b.n >= 8)) return Infinity;
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
}

function lum(sample) {
  if (!sample) return NaN;
  return 0.2126 * sample.r + 0.7152 * sample.g + 0.0722 * sample.b;
}

function describe(sample) {
  if (!sample) return 'null';
  return `n=${sample.n} rgb=(${sample.r.toFixed(1)},${sample.g.toFixed(1)},${sample.b.toFixed(1)}) lum=${lum(sample).toFixed(1)} overlays=${sample.overlays}`;
}

async function tapUntilCount(page, touch, points, expected) {
  for (const point of points) {
    await tap(page, touch, point);
    const ok = await waitFixtures(page, expected);
    if (ok) return point;
  }
  return null;
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
  await page.locator('[data-fea-target="fixture"]').click();
  // The sheet camera eases the part into place after the card opens. A snap
  // during that ease reads a shaded side instead of the lit end face.
  await page.waitForTimeout(800);
  let points = [];
  let point = null;
  let base = null;
  let snapped = false;
  for (let attempt = 0; attempt < 3 && !(base && lum(base) >= 180); attempt += 1) {
    snapped = await snap(page, 'left', END_SNAP_MARGIN);
    points = await endFacePoints(page);
    point = null;
    base = null;
    for (const candidate of points) {
      const sample = await sampleAt(page, candidate);
      if (!sample || sample.n < 8) continue;
      if (!base || lum(sample) > lum(base)) {
        point = candidate;
        base = sample;
      }
    }
  }
  check(`${vp.name} left snap`, snapped);
  check(`${vp.name} end face has a tap target`, !!point && lum(base) >= 180, describe(base));

  if (point) {
    await tap(page, vp.touch, point);
    if (!await waitFixtures(page, '1')) point = null;
  }
  check(`${vp.name} first tap selects a face`, !!point, `fixtures=${await fixtureCount(page)}`);
  const on1 = point ? await sampleAt(page, point) : null;
  check(`${vp.name} one overlay after the first tap`, on1?.overlays === 1, describe(on1));

  if (point) {
    await tap(page, vp.touch, point);
    const cleared = await waitFixtures(page, '0');
    check(`${vp.name} second tap clears the fixture`, cleared, `fixtures=${await fixtureCount(page)}`);
    const off = await sampleAt(page, point);
    check(
      `${vp.name} second tap removes the overlay`,
      off?.overlays === 0 && rgbDist(off, base) <= BASE_MAX,
      `off=${describe(off)} base=${describe(base)} dist=${rgbDist(off, base).toFixed(1)}`,
    );
    await tap(page, vp.touch, point);
    const selected = await waitFixtures(page, '1');
    check(`${vp.name} third tap selects the face again`, selected, `fixtures=${await fixtureCount(page)}`);
  }
  const on3 = point ? await sampleAt(page, point) : null;
  const sameDist = rgbDist(on3, on1);
  const baseDist = rgbDist(on1, base);
  const lumDelta = Math.abs(lum(on3) - lum(on1));
  check(
    `${vp.name} three taps match one toggle`,
    on3?.overlays === 1 && on1?.overlays === 1 && sameDist <= SAME_TOGGLE_MAX && lumDelta <= 12 && baseDist >= HIGHLIGHT_MIN,
    `on1=${describe(on1)} on3=${describe(on3)} off=${describe(base)} dist=${Number.isFinite(sameDist) ? sameDist.toFixed(1) : 'inf'} lumΔ=${Number.isFinite(lumDelta) ? lumDelta.toFixed(1) : 'inf'}`,
  );
  const onShot = join(SHOT_DIR, `fea-face-highlight-${vp.name}-on.png`);
  check(`${vp.name} on shot dir`, !onShot.startsWith('/opt/cursor/artifacts'), onShot);
  await page.screenshot({ path: onShot });

  check(`${vp.name} right snap`, await snap(page, 'right', END_SNAP_MARGIN));
  const rightPoints = await endFacePoints(page);
  let second = null;
  let secondBase = null;
  for (const candidate of rightPoints) {
    const before = await fixtureCount(page);
    const sample = await sampleAt(page, candidate);
    await tap(page, vp.touch, candidate);
    await page.waitForTimeout(250);
    const after = await fixtureCount(page);
    if (after === '2') {
      second = candidate;
      secondBase = sample;
      break;
    }
    if (before === '1' && after === '0') {
      await tap(page, vp.touch, candidate);
      await waitFixtures(page, '1');
    }
  }
  const two = second ? await sampleAt(page, second) : null;
  check(`${vp.name} second face adds one overlay`, !!second && two?.overlays === 2, `fixtures=${await fixtureCount(page)} ${describe(two)}`);

  for (let i = 0; i < 4 && await fixtureCount(page) !== '0'; i += 1) {
    const button = page.locator('[data-fea-remove="fixture-0"]');
    if (await button.count() === 0) break;
    await button.click();
    await page.waitForTimeout(200);
  }
  const clearedCount = await fixtureCount(page);
  check(`${vp.name} clear removes both fixtures`, clearedCount === '0', clearedCount || '');
  check(`${vp.name} left snap after clear`, await snap(page, 'left', END_SNAP_MARGIN));
  const clearedLeft = point ? await sampleAt(page, point) : null;
  check(
    `${vp.name} clear leaves no overlay and the base color`,
    clearedLeft?.overlays === 0 && rgbDist(clearedLeft, base) <= BASE_MAX,
    `cleared=${describe(clearedLeft)} base=${describe(base)} dist=${rgbDist(clearedLeft, base).toFixed(1)}`,
  );
  if (second) {
    check(`${vp.name} right snap after clear`, await snap(page, 'right', END_SNAP_MARGIN));
    const clearedRight = await sampleAt(page, second);
    check(
      `${vp.name} second face is back to its base color`,
      clearedRight?.overlays === 0 && rgbDist(clearedRight, secondBase) <= BASE_MAX,
      `cleared=${describe(clearedRight)} base=${describe(secondBase)} dist=${rgbDist(clearedRight, secondBase).toFixed(1)}`,
    );
  }
  const clearShot = join(SHOT_DIR, `fea-face-highlight-${vp.name}-clear.png`);
  await page.screenshot({ path: clearShot });
  check(`${vp.name} clear shot saved`, existsSync(clearShot), clearShot);

  check(`${vp.name} left snap to save one face`, await snap(page, 'left', END_SNAP_MARGIN));
  const saved = point ? await tapUntilCount(page, vp.touch, [point], '1') : null;
  const savedSample = saved ? await sampleAt(page, saved) : null;
  check(`${vp.name} saved face is one overlay`, savedSample?.overlays === 1, describe(savedSample));
  await page.locator('[data-analyze-chip]').click();
  await page.locator(shell).waitFor({ state: 'detached', timeout: 8000 });
  const closed = point ? await sampleAt(page, point) : null;
  check(`${vp.name} close removes the highlight`, closed?.overlays === 0, describe(closed));
  await page.locator('[data-analyze-chip]').click();
  await page.locator(shell).waitFor({ timeout: 8000 });
  await waitFixtures(page, '1');
  // The sheet camera eases in after the card mounts. Snap once it has
  // settled, then read a point that is actually on the end face.
  await page.waitForTimeout(700);
  check(`${vp.name} left snap after load`, await snap(page, 'left', END_SNAP_MARGIN));
  let loaded = null;
  const fresh = await endFacePoints(page);
  for (const candidate of fresh.length ? fresh : (point ? [point] : [])) {
    const sample = await sampleAt(page, candidate);
    if (!sample) continue;
    if (!loaded || sample.n > loaded.n) loaded = sample;
    if (sample.n >= 8 && rgbDist(sample, on1) <= SAME_TOGGLE_MAX) {
      loaded = sample;
      break;
    }
  }
  check(
    `${vp.name} loading the study restores one overlay`,
    (await fixtureCount(page)) === '1' && loaded?.overlays === 1 && loaded?.n >= 8 && rgbDist(loaded, on1) <= SAME_TOGGLE_MAX,
    `fixtures=${await fixtureCount(page)} ${describe(loaded)}`,
  );
  console.log(`GOLDEN ${vp.name} ${JSON.stringify({
    on1: describe(on1),
    on3: describe(on3),
    base: describe(base),
    sameDist: Number.isFinite(sameDist) ? Number(sameDist.toFixed(2)) : null,
    lum1: Number.isFinite(lum(on1)) ? Number(lum(on1).toFixed(2)) : null,
    lum3: Number.isFinite(lum(on3)) ? Number(lum(on3).toFixed(2)) : null,
    cleared: describe(clearedLeft),
    loaded: describe(loaded),
  })}`);
  check(`${vp.name} no page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
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
  console.log(`\n${failed} failed`);
  process.exit(1);
}
console.log('\nFEA face highlight: ok');

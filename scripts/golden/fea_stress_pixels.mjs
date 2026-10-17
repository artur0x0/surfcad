#!/usr/bin/env node
/**
 * Stress skin and legend for a real TET10 cantilever.
 *
 * 40×10×10 mm beam, fixed on the −X face, 200 N in −Z on the +X face,
 * mesh target 4 mm. Beam-theory peak is 48 MPa. Adaptive refine resolves
 * the clamped corner, so the legend max may sit within 30% of that peak.
 * p95 of a bending field is not the peak.
 *
 * 390×844 touch (iPhone UA, DPR 2) and 1280×800 desktop. FEA_VIEW=desktop
 * or FEA_VIEW=390 runs one of them.
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

const PORT = Number(process.env.SMOKE_PORT || 4333);
const APP_URL = `http://127.0.0.1:${PORT}/`;
const SHOT_DIR = process.env.GOLDEN_SHOT_DIR || tmpdir();
const SURF = '2026-10-09-04-24-00-0001-ab12';
const STUDY = feaStudyBlock({ mesh: { target: 4 } });
const CUBE = `// @surf-id ${SURF}\nconst part = Manifold.cube([40, 10, 10], false);\nreturn part;\n${STUDY}`;
const WIDE = `// @surf-id ${SURF}\nconst part = Manifold.cube([50, 10, 10], false);\nreturn part;\n${STUDY}`;
const PART_ID = 'fea-block';
const USER_ID = 'user-fea';
// σ = F L (h/2) / I, I = width * height³ / 12, force along Z, length along X.
const BEAM_PEAK_MPA = 48;
// δ = F L³ / (3 E I), PLA E = 3250 MPa, I = 10 * 10³ / 12.
const BEAM_TIP_MM = (200 * 40 ** 3) / (3 * 3250 * (10 * 10 ** 3 / 12));

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

console.log('FEA stress skin');

const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!exe) {
  console.log('FEA stress skin: no system Chrome — set CHROME_PATH. Skipping.');
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

// Looking down the beam, the default snap margin parks a wide desktop camera
// inside the solid. A larger margin backs up past the root and tip faces.
const END_SNAP_MARGIN = 3;

async function snap(page, key, margin) {
  const viaHook = await page.evaluate(({ name, margin }) => {
    window.__feaView = name;
    if (typeof window.__VIEWPORT__?.stageSnap === 'function') return !!window.__VIEWPORT__.stageSnap(name, margin);
    return false;
  }, { name: key, margin });
  if (viaHook) {
    await page.waitForTimeout(250);
    return true;
  }
  // vite preview does not publish __VIEWPORT__. Fit the same way from the
  // live camera so a left or right end view still lands outside the beam.
  const fitted = await page.evaluate(({ name, margin }) => new Promise((resolve) => {
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
        if (obj.isMesh && count > best) {
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
      const pad = Number.isFinite(margin) && margin > 0 ? margin : 1.35;
      dist = (dist || 1) * pad;
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
  const labels = { front: 'Snap to Front', right: 'Snap to Right', top: 'Snap to Top', iso: 'Snap to Isometric' };
  if (!labels[key]) return false;
  await page.locator('[aria-label="View snaps"]').click();
  await page.locator(`[aria-label="${labels[key]}"]`).click();
  await page.waitForTimeout(300);
  return true;
}

async function sampleSides(page) {
  return page.evaluate(() => new Promise((resolve) => {
    const { canvas, renderer } = window.__feaProbe.bits();
    if (!canvas || !renderer) {
      resolve(null);
      return;
    }
    const orig = renderer.render.bind(renderer);
    let best = null;
    let timer = 0;
    renderer.render = function hooked(scene, camera) {
      const out = orig(scene, camera);
      const gl = renderer.getContext();
      const w = gl.drawingBufferWidth;
      const h = gl.drawingBufferHeight;
      const buf = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      let minX = Infinity;
      let maxX = -Infinity;
      const pts = [];
      for (let y = 0; y < h; y += 2) {
        for (let x = 0; x < w; x += 2) {
          const i = (y * w + x) * 4;
          const r = buf[i];
          const g = buf[i + 1];
          const b = buf[i + 2];
          if (r < 45 && g < 45 && b < 45) continue;
          pts.push({ x, r, g, b });
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
        }
      }
      const sample = { model: 0, red: 0, leftN: 0, rightN: 0, leftHeat: 0, rightHeat: 0 };
      if (pts.length) {
        const span = Math.max(1, maxX - minX);
        const leftCut = minX + span * 0.33;
        const rightCut = minX + span * 0.67;
        let red = 0;
        let leftN = 0;
        let rightN = 0;
        let leftHeat = 0;
        let rightHeat = 0;
        for (const p of pts) {
          // #ef4444 stays red-dominant under the viewport lights. Viridis purple
          // sits near that swatch in raw distance, so distance alone is not a paint test.
          if (p.r >= 140 && p.g < 160 && p.b < 160 && p.r > p.g + 40 && p.r > p.b + 40) red += 1;
          // Above yield the skin is pure magenta, which scores about 0 on
          // r+g−b. Rank that overflow above yellow so a root past the PLA
          // yield still reads hotter than the tip.
          const overflow = p.r > 170 && p.b > 170 && p.g < 50;
          const heat = overflow ? (600 + p.r) : (p.r + p.g - p.b);
          if (p.x <= leftCut) {
            leftN += 1;
            leftHeat += heat;
          } else if (p.x >= rightCut) {
            rightN += 1;
            rightHeat += heat;
          }
        }
        sample.model = pts.length;
        sample.red = red;
        sample.leftN = leftN;
        sample.rightN = rightN;
        sample.leftHeat = leftN ? leftHeat / leftN : 0;
        sample.rightHeat = rightN ? rightHeat / rightN : 0;
      }
      if (!best || sample.model > best.model) best = sample;
      if (!timer) {
        timer = setTimeout(() => {
          const key = window.__feaView || 'front';
          if (typeof window.__VIEWPORT__?.stageSnap === 'function') window.__VIEWPORT__.stageSnap(key);
          renderer.render = orig;
          resolve(best);
        }, 100);
      }
      return out;
    };
    const key = window.__feaView || 'front';
    if (typeof window.__VIEWPORT__?.stageSnap === 'function') window.__VIEWPORT__.stageSnap(key);
  }));
}

async function readColors(page) {
  return sampleSides(page);
}

function endFacePoints(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector('.viewport-shell > canvas');
    if (!canvas) return [];
    const rect = canvas.getBoundingClientRect();
    const pts = [];
    // The Analyze card sits on the bottom of the pane. Upper-center and
    // either side still land on the end face. Points under the card drop.
    const spots = [
      [0.5, 0.28],
      [0.5, 0.34],
      [0.28, 0.5],
      [0.72, 0.5],
      [0.5, 0.46],
      [0.5, 0.5],
      [0.5, 0.42],
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

async function tapUntil(page, touch, points, attr, expected) {
  for (const point of points) {
    await tap(page, touch, point);
    await page.waitForTimeout(500);
    const count = await page.locator(`[${attr}]`).getAttribute(attr).catch(() => null);
    if (count === expected) return true;
  }
  return false;
}

function heatChanged(before, after) {
  if (!before || !after || before.model < 10 || after.model < 10) return false;
  return Math.abs(before.leftHeat - after.leftHeat) > 15
    || Math.abs(before.rightHeat - after.rightHeat) > 15;
}

const FEA_SHELL = '[data-fea-sheet="1"]';

/**
 * The Analyze card has no voxel-preview chrome and no empty slot where the
 * magnitude, direction, and material sliders used to sit.
 */
async function assertNoVoxelPreview(page, vp, shell) {
  const report = await page.locator(shell).evaluate((card) => {
    const selectors = [
      '[data-fea-preview-sliders]',
      '[data-fea-preview-slider]',
      '[data-fea-preview-badge]',
      '[data-fea-preview]',
      '[data-fea-load-select]',
      '[data-fea-source="preview"]',
    ];
    const counts = {};
    for (const sel of selectors) counts[sel] = card.querySelectorAll(sel).length;
    const loads = card.querySelector('[data-fea-loads]');
    let gap = null;
    let nextTag = '';
    let nextHeight = 0;
    if (loads) {
      let node = loads;
      while (node.parentElement && node.parentElement !== card && !/\bgap-1\.5\b/.test(node.parentElement.className || '')) {
        node = node.parentElement;
      }
      const next = node.nextElementSibling;
      if (!next) gap = 0;
      else {
        const a = node.getBoundingClientRect();
        const b = next.getBoundingClientRect();
        gap = b.top - a.bottom;
        nextHeight = b.height;
        if (next.hasAttribute('data-fea-notice')) nextTag = 'notice';
        else if (next.hasAttribute('data-fea-preview-sliders')) nextTag = 'preview';
        else nextTag = next.tagName;
      }
    }
    return {
      counts,
      gap,
      nextTag,
      nextHeight,
      labelled: /\bPreview\b/.test(card.innerText || ''),
    };
  });
  const absent = Object.values(report.counts).every((count) => count === 0) && !report.labelled;
  check(
    `${vp.name} analyze card has no preview UI`,
    absent,
    JSON.stringify(report.counts) + (report.labelled ? ' labelled Preview' : ''),
  );
  if (report.gap != null) {
    const parked = report.nextTag === '' || report.nextTag === 'notice';
    check(
      `${vp.width} analyze card has no preview layout gap`,
      report.gap <= 10 && parked,
      `gap ${report.gap} next ${report.nextTag || 'end'} h ${report.nextHeight}`,
    );
  }
}

async function assertFeaSheet(page, vp, text) {
  await page.waitForFunction((touch) => {
    const el = document.querySelector('[data-fea-sheet="1"]');
    return !!el && el.getAttribute('data-feature-card-compact') === (touch ? '1' : '0');
  }, vp.touch, { timeout: 8000 });
  const chrome = await page.locator(FEA_SHELL).evaluate((el) => ({
    text: (el.innerText || '').replace(/\s+/g, ' ').trim(),
    featureCard: el.hasAttribute('data-feature-card'),
    top14: /(^|\s)top-14(\s|$)/.test(el.className),
    compact: el.getAttribute('data-feature-card-compact') || '',
    confirm: el.querySelector('[data-feature-card-confirm]') ? 'yes' : 'no',
  }));
  check(
    `${vp.name} sheet keyed by data-fea-sheet and “${text}”`,
    chrome.featureCard && !chrome.top14 && chrome.text.includes(text),
    JSON.stringify(chrome),
  );
  check(
    `${vp.name} card size`,
    chrome.compact === (vp.touch ? '1' : '0'),
    chrome.compact,
  );
  check(`${vp.name} footer is not Confirm`, chrome.confirm === 'no', chrome.confirm);
  await assertNoVoxelPreview(page, vp, FEA_SHELL);
}

async function assertResultsPlots(page, vp, shell, sample) {
  await assertFeaSheet(page, vp, 'Back to Setup');
  const view = await page.locator(shell).getAttribute('data-fea-view');
  check(`${vp.name} results view`, view === 'results', view || '');
  check(`${vp.name} setup hidden`, await page.locator(`${shell} [data-fea-material]`).count() === 0);
  check(`${vp.name} targets hidden`, await page.locator(`${shell} [data-fea-target="fixture"]`).count() === 0);
  await assertNoVoxelPreview(page, vp, shell);
  const stressPressed = await page.locator(`${shell} [data-fea-plot="stress"]`).getAttribute('aria-pressed');
  check(`${vp.name} stress tab`, stressPressed === 'true', stressPressed || '');
  check(`${vp.name} displacement tab`, await page.locator(`${shell} [data-fea-plot="displacement"]`).count() === 1);
  check(
    `${vp.name} timing under the plot`,
    await page.locator(`${shell} [data-fea-timing]`).count() === 1
      && await page.locator(`${shell} [data-fea-timing-details]`).count() === 1,
  );
  const stressPx = await sample(page);
  const stressShot = join(SHOT_DIR, vp.touch ? 'fea-results-stress-390.png' : 'fea-results-stress-1280.png');
  check(`${vp.name} stress shot dir`, !stressShot.startsWith('/opt/cursor/artifacts'), stressShot);
  await page.screenshot({ path: stressShot });
  check(`${vp.name} stress shot saved`, existsSync(stressShot), stressShot);
  console.log(`  shot ${stressShot}`);

  await page.locator(`${shell} [data-fea-plot="displacement"]`).click();
  await page.locator(`${shell} [data-fea-displacement]`).waitFor({ timeout: 8000 });
  await page.waitForTimeout(400);
  const dispPx = await sample(page);
  const dispText = ((await page.locator(`${shell} [data-fea-displacement]`).innerText()) || '').replace(/\s+/g, ' ').trim();
  const maxMatch = dispText.match(/max ([0-9.]+) mm/);
  const minMatch = dispText.match(/min ([0-9.]+) mm/);
  const maxMm = maxMatch ? Number(maxMatch[1]) : NaN;
  const minMm = minMatch ? Number(minMatch[1]) : NaN;
  const tipError = Number.isFinite(maxMm) ? Math.abs(maxMm - BEAM_TIP_MM) / BEAM_TIP_MM : Infinity;
  console.log(`  displacement ${vp.name} ${dispText} theory ${BEAM_TIP_MM.toFixed(3)} mm`);
  check(`${vp.name} pixels change`, heatChanged(stressPx, dispPx), JSON.stringify({ stressPx, dispPx }));
  check(`${vp.name} displacement legend`, /min .+ mm/.test(dispText) && /max .+ mm/.test(dispText), dispText);
  check(`${vp.name} tip within 10% of beam theory`, tipError <= 0.1, `max ${maxMm} vs ${BEAM_TIP_MM}`);
  check(`${vp.name} displacement min is below the tip`, Number.isFinite(minMm) && minMm >= 0 && minMm < maxMm, dispText);
  const dispShot = join(SHOT_DIR, vp.touch ? 'fea-results-displacement-390.png' : 'fea-results-displacement-1280.png');
  check(`${vp.name} displacement shot dir`, !dispShot.startsWith('/opt/cursor/artifacts'), dispShot);
  await page.screenshot({ path: dispShot });
  check(`${vp.name} displacement shot saved`, existsSync(dispShot), dispShot);
  console.log(`  shot ${dispShot}`);

  await page.locator(`${shell} [data-fea-back]`).click();
  await page.locator(`${shell}[data-fea-view="setup"]`).waitFor({ timeout: 8000 });
  check(`${vp.name} back restores material`, await page.locator(`${shell} [data-fea-material]`).count() === 1);
  check(`${vp.name} back restores targets`, await page.locator(`${shell} [data-fea-target="force"]`).count() === 1);
  check(`${vp.name} back hides plots`, await page.locator(`${shell} [data-fea-plot="stress"]`).count() === 0);
  check(`${vp.name} back restores run`, await page.locator(`${shell} [data-fea-run]`).count() === 1);
}

async function legendBox(page) {
  return page.locator('[data-fea-legend]').evaluate((el) => {
    const box = el.getBoundingClientRect();
    return {
      x: box.x,
      y: box.y,
      right: box.right,
      bottom: box.bottom,
      width: box.width,
      height: box.height,
    };
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
  await installProbe(page);
  check(`${vp.name} front snap`, await snap(page, 'front'));

  const painted = await readColors(page);
  check(
    `${vp.name} paint skin is red`,
    !!painted && painted.model > 20 && painted.red > painted.model * 0.45,
    JSON.stringify(painted),
  );

  await page.locator('[data-analyze-chip]').click();
  const shell = FEA_SHELL;
  await page.locator(shell).waitFor({ timeout: 8000 });
  await assertFeaSheet(page, vp, 'Run');
  await page.locator('[data-fea-material]').selectOption('pla-ultimaker');
  await solidReady(page);
  check(`${vp.name} left snap`, await snap(page, 'left', END_SNAP_MARGIN));
  const root = await endFacePoints(page);
  check(`${vp.name} root face is tappable`, root.length > 0, `points=${root.length}`);
  await page.locator('[data-fea-target="fixture"]').click();
  const fixed = await tapUntil(page, vp.touch, root, 'data-fea-fixture-count', '1');
  const fixNotice = fixed ? '' : await page.locator('[data-fea-notice]').textContent().catch(() => '');
  check(`${vp.name} fixture`, fixed, fixNotice);
  await page.locator('[data-fea-target="force"]').click();
  const down = page.locator(`${shell} button`, { hasText: '\u2212Z' });
  await down.scrollIntoViewIfNeeded();
  await down.click();
  check(`${vp.name} right snap`, await snap(page, 'right', END_SNAP_MARGIN));
  const tip = await endFacePoints(page);
  check(`${vp.name} tip face is tappable`, tip.length > 0, `points=${tip.length}`);
  check(`${vp.name} force`, await tapUntil(page, vp.touch, tip, 'data-fea-load-count', '1'));
  check(`${vp.name} front snap after picks`, await snap(page, 'front'));
  await assertNoVoxelPreview(page, vp, shell);

  await page.locator('[data-fea-run]').click();
  const stages = new Set();
  const started = Date.now();
  let legendReady = false;
  while (Date.now() - started < 120000) {
    const state = await page.evaluate(() => ({
      progress: document.querySelector('[data-fea-progress]')?.getAttribute('data-fea-progress') || '',
      legend: !!document.querySelector('[data-fea-legend]'),
    }));
    if (state.progress) stages.add(state.progress);
    if (state.legend) {
      legendReady = true;
      break;
    }
    await page.waitForTimeout(40);
  }
  check(`${vp.name} legend appeared`, legendReady, `stages=${[...stages].join(',')}`);
  check(
    `${vp.name} progress stage`,
    [...stages].some((stage) => stage === 'meshing' || stage === 'solving' || stage === 'post-processing'),
    [...stages].join(',') || 'none',
  );
  await page.waitForTimeout(300);
  const legend = await page.evaluate(() => ({
    stub: document.querySelector('[data-fea-legend] [data-fea-stub="1"]') ? 'yes' : 'no',
    source: document.querySelector('[data-fea-source]')?.getAttribute('data-fea-source') || '',
    stress: document.querySelector('[data-fea-stress]')?.textContent || '',
    fos: document.querySelector('[data-fea-fos]')?.getAttribute('data-fea-fos') || '',
    warning: document.querySelector('[data-fea-warning]')?.textContent || '',
    ticks: document.querySelector('[data-fea-legend-ticks]')?.textContent || '',
    bar: document.querySelector('[data-fea-legend-bar]')?.style?.backgroundImage || document.querySelector('[data-fea-legend-bar]')?.style?.background || '',
    stale: document.querySelector('[data-fea-stale]')?.getAttribute('data-fea-stale') || '',
    ms: document.querySelector('[data-fea-solve-ms]')?.getAttribute('data-fea-solve-ms') || '',
    peak: document.querySelector('[data-fea-peak-bytes]')?.getAttribute('data-fea-peak-bytes') || '',
  }));
  const maxMatch = legend.stress.match(/max ([0-9.]+) MPa/);
  const maxMPa = maxMatch ? Number(maxMatch[1]) : NaN;
  const peakError = Number.isFinite(maxMPa) ? Math.abs(maxMPa - BEAM_PEAK_MPA) / BEAM_PEAK_MPA : Infinity;
  console.log(`  solve ${vp.name} ${legend.ms} ms peak ${legend.peak} bytes max ${maxMPa} MPa`);
  check(`${vp.name} no stub badge`, legend.stub === 'no', JSON.stringify(legend));
  check(`${vp.name} tet10 source`, legend.source === 'tet10', legend.source);
  check(`${vp.name} legend ticks`, (legend.ticks.match(/\d/g) || []).length >= 5, legend.ticks);
  check(`${vp.name} legend gradient`, /linear-gradient/.test(legend.bar), legend.bar.slice(0, 80));
  check(`${vp.name} min p95 max`, /min .+ MPa/.test(legend.stress) && /p95 /.test(legend.stress) && /max /.test(legend.stress), legend.stress);
  check(`${vp.name} peak within 30% of beam theory`, peakError <= 0.3, `max ${maxMPa} vs ${BEAM_PEAK_MPA}`);
  check(`${vp.name} safety factor`, legend.fos !== '' && legend.fos !== 'n/a', legend.fos);
  check(`${vp.name} no stub warning`, !/STUB/.test(legend.warning), legend.warning);
  check(`${vp.name} solve time recorded`, Number(legend.ms) > 0, legend.ms);
  check(`${vp.name} peak memory recorded`, Number(legend.peak) > 0, legend.peak);
  check(`${vp.name} result is current`, legend.stale === '0', legend.stale);

  const box = await legendBox(page);
  check(
    `${vp.name} legend fits`,
    box.width > 40 && box.height > 20 && box.x >= -1 && box.y >= -1 && box.right <= vp.width + 1 && box.bottom <= vp.height + 1,
    JSON.stringify(box),
  );

  const stressed = await readColors(page);
  check(
    `${vp.name} stress colours replace paint`,
    !!stressed
      && stressed.red < stressed.model * 0.2
      && stressed.leftN > 10
      && stressed.rightN > 10
      && stressed.leftHeat > stressed.rightHeat + 20,
    JSON.stringify(stressed),
  );

  const shot = join(SHOT_DIR, vp.touch ? 'fea-stress-390.png' : 'fea-stress-desktop.png');
  check(`${vp.name} shot dir`, !shot.startsWith('/opt/cursor/artifacts'), shot);
  await page.screenshot({ path: shot });
  check(`${vp.name} shot saved`, existsSync(shot), shot);
  console.log(`  shot ${shot}`);

  await assertResultsPlots(page, vp, shell, readColors);

  await page.locator('[data-paint-chip]').click();
  await page.locator('[data-paint-mode="1"]').waitFor({ timeout: 8000 });
  check(`${vp.name} paint closes analyze`, await page.locator(shell).count() === 0);
  await page.waitForTimeout(300);
  const paintedAgain = await readColors(page);
  check(
    `${vp.name} opening paint restores the skin`,
    !!paintedAgain && paintedAgain.red > paintedAgain.model * 0.45,
    JSON.stringify(paintedAgain),
  );
  await page.locator('[data-paint-mode="1"] [data-feature-card-cancel]').click();
  await page.locator('[data-paint-mode="1"]').waitFor({ state: 'detached', timeout: 8000 });

  await page.locator('[data-analyze-chip]').click();
  await page.locator(shell).waitFor({ timeout: 8000 });
  await page.locator('[data-fea-run]').click();
  await page.locator('[data-fea-stale="0"]').waitFor({ timeout: 120000 });
  const edited = await page.evaluate(async (script) => {
    if (typeof window.__VIEWPORT__?.executeScript !== 'function') return { skipped: true };
    return window.__VIEWPORT__.executeScript(script);
  }, WIDE);
  if (!edited?.skipped && !edited?.error && edited?.onScreen) {
    await page.locator('[data-fea-rerun]').waitFor({ timeout: 15000 });
    check(`${vp.name} geometry edit is stale`, true);
  } else {
    if (await page.locator(`${shell}[data-fea-view="results"]`).count()) {
      await page.locator('[data-fea-back]').click();
    }
    await page.locator('[data-fea-material]').selectOption('al-6061-t6');
    await page.locator('[data-fea-rerun]').waitFor({ timeout: 8000 });
    check(`${vp.name} material edit is stale`, true, JSON.stringify(edited));
  }
  await page.waitForTimeout(300);
  const staleColors = await readColors(page);
  check(
    `${vp.name} stale colours are not shown`,
    !!staleColors && staleColors.red > staleColors.model * 0.35,
    JSON.stringify(staleColors),
  );
  check(`${vp.name} analyze still open`, await page.locator(shell).count() === 1);

  await page.locator(`${shell} [data-feature-card-cancel]`).click();
  await page.locator(shell).waitFor({ state: 'detached', timeout: 8000 });
  await page.waitForTimeout(300);
  const closed = await readColors(page);
  check(
    `${vp.name} close keeps the paint skin`,
    !!closed && closed.red > closed.model * 0.35,
    JSON.stringify(closed),
  );
  check(`${vp.name} no page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await context.close();
}

const viewArg = process.env.FEA_VIEW || '';
const viewports = [
  { name: '390', width: 390, height: 844, touch: true },
  { name: 'desktop', width: 1280, height: 800, touch: false },
].filter((vp) => !viewArg || vp.name === viewArg);

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
console.log('\nFEA stress skin: ok');

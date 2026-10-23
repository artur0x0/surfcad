#!/usr/bin/env node
/**
 * Analyze: open the study, fix the root of a small cantilever, load the
 * tip, run TET10, and reload. The study comment is still in the part script.
 * The legend max stays near the beam-theory peak (48 MPa). Adaptive
 * refine resolves the clamped corner, so the check allows 30%.
 * After that solve, the material changes and Run goes again: the mesh is
 * reused, the second run is much faster, and the legend matches the new yield.
 * Doubling the force re-solves on that mesh and doubles the stress. Pointing
 * the same force along +X re-solves again and leaves the bending stress.
 *
 * 390×844 touch (iPhone UA, DPR 2) and 1280×800 desktop. FEA_VIEW=desktop
 * or FEA_VIEW=390 runs one of them. FEA_PREVIEW=1 serves the existing
 * dist with vite preview; otherwise this starts the dev server.
 *
 * Screenshots go to GOLDEN_SHOT_DIR or os.tmpdir() only.
 */
/* global Event, document, indexedDB, localStorage, window */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { attachConsentPresetToBrowser } from './lib/presetConsentInit.mjs';
import { SHEET_METALLICA_SCRIPT } from '../../src/fea/fixtures/sheetMetallica.js';
import { feaStudyBlock } from '../../src/fea/studyScript.js';

const PORT = Number(process.env.SMOKE_PORT || 4327);
const APP_URL = `http://127.0.0.1:${PORT}/`;
const SHOT_DIR = process.env.GOLDEN_SHOT_DIR || tmpdir();
const PREVIEW = process.env.FEA_PREVIEW === '1';
const STUDY = feaStudyBlock({ mesh: { target: 4, refine: 'auto' } });
const CUBE = `const part = Manifold.cube([40, 10, 10], false);\nreturn part;\n${STUDY}`;
const BEAM_PEAK_MPA = 48;
const ALUMINUM_YIELD_MPA = 276;
// δ = F L³ / (3 E I), PLA E = 3250 MPa, I = 10 * 10³ / 12.
const BEAM_TIP_MM = (200 * 40 ** 3) / (3 * 3250 * (10 * 10 ** 3 / 12));
const PART_ID = 'fea-block';
const USER_ID = 'user-fea';

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

console.log('FEA study panel');

const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!exe) {
  console.log('FEA study panel: no system Chrome — set CHROME_PATH. Skipping.');
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
          name: 'Study',
          activeId: partId,
          parts: [{ id: partId, name: 'Block', visible: true, order: 0 }],
        }, 'current');
        tx.objectStore('parts').put({ id: partId, script, savedAt: Date.now() }, partId);
        // A signed-in /me with no GitHub token is reauth and read-only, so
        // the study save is skipped. A still-valid access token (no refresh)
        // is connected. The part id is not a vault path, and source git
        // reopens this cache without a repo lookup.
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
  // A connected session looks up the vault. Answer that lookup so the
  // boot does not toast "Upload Error" over the study. Anything else 404s.
  const marker = `${JSON.stringify({ kind: 'surfcad-vault', version: 2 }, null, 2)}\n`;
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
    // The vault-layout check on connect lists the branch tree (commit, then
    // tree). An empty v2 vault answers both; a 404 here is a console error.
    if (path.startsWith('/repos/fea-user/surfcad-vault/git/commits/')) {
      return send(200, { sha: 'a'.repeat(40), tree: { sha: 'c'.repeat(40) } });
    }
    if (path.startsWith('/repos/fea-user/surfcad-vault/git/trees/')) {
      return send(200, { sha: 'c'.repeat(40), tree: [], truncated: false });
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
    // Production preview does not publish the dev worker hook. The solid
    // count and the open spinner are the signals that exist in both builds.
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
      const sample = { model: 0, leftN: 0, rightN: 0, leftHeat: 0, rightHeat: 0 };
      if (pts.length) {
        const span = Math.max(1, maxX - minX);
        const leftCut = minX + span * 0.33;
        const rightCut = minX + span * 0.67;
        let leftN = 0;
        let rightN = 0;
        let leftHeat = 0;
        let rightHeat = 0;
        for (const p of pts) {
          // Viridis: yellow is hot (r+g−b large) and purple is cold. Above
          // yield the skin is pure magenta, which scores about 0 on that
          // sum, so a root past the PLA yield would look colder than the
          // tip. Rank that overflow above yellow.
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

function endFacePoints(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector('.viewport-shell > canvas');
    if (!canvas) return [];
    const rect = canvas.getBoundingClientRect();
    const pts = [];
    // The Analyze card sits on the bottom of the pane. Upper-center and
    // either side still land on the end face. Points under the card are
    // dropped because elementFromPoint is not the canvas.
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

async function canvasPoints(page, points) {
  return page.evaluate((pts) => {
    const canvas = document.querySelector('.viewport-shell > canvas');
    return pts.filter((point) => document.elementFromPoint(point.x, point.y) === canvas);
  }, points);
}

async function tapUntil(page, touch, points, attr, expected) {
  const live = await canvasPoints(page, points);
  if (!live.length) return { ok: false, points: 0, notice: await noticeOf(page) };
  for (const point of live) {
    await tap(page, touch, point);
    await page.waitForTimeout(500);
    const count = await page.locator(`[${attr}]`).getAttribute(attr).catch(() => null);
    if (count === expected) return { ok: true, points: live.length };
  }
  return { ok: false, points: live.length, notice: await noticeOf(page) };
}

function noticeOf(page) {
  return page.locator('[data-fea-notice]').textContent().catch(() => '');
}

const FEA_SHELL = '[data-fea-sheet="1"]';

/**
 * The Analyze card has no voxel-preview chrome and no empty slot where the
 * magnitude, direction, and material sliders used to sit. The load list is
 * the last setup row, or it sits one flex gap above a notice.
 */
async function assertNoVoxelPreview(page, vp, shell = FEA_SHELL) {
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
  if (vp.touch) {
    let place = null;
    for (let i = 0; i < 20; i += 1) {
      place = await page.evaluate(() => {
        const card = document.querySelector('[data-fea-sheet="1"]');
        const pane = card?.closest('.viewport-shell');
        const right = pane?.querySelector('[data-rail-pair="right"]');
        if (!card || !pane || !right) return null;
        const box = card.getBoundingClientRect();
        const paneBox = pane.getBoundingClientRect();
        const rail = right.getBoundingClientRect();
        return {
          left: box.left - paneBox.left,
          rightGap: rail.left - box.right,
          overlap: box.right > rail.left - 0.5,
          leftRail: !!pane.querySelector('[data-rail-pair="left"]'),
          fullLeft: card.getAttribute('data-feature-card-full-left') || '',
          width: box.width,
          paneW: paneBox.width,
        };
      });
      if (place && Math.abs(place.left - 10) <= 2 && !place.overlap) break;
      await page.waitForTimeout(50);
    }
    check(
      `${vp.name} analyze card left edge is 10px from the pane`,
      !!place && Math.abs(place.left - 10) <= 2 && place.fullLeft === '1',
      JSON.stringify(place),
    );
    check(
      `${vp.name} analyze card does not overlap the right rail`,
      !!place && place.rightGap >= 8 && !place.overlap && !place.leftRail,
      JSON.stringify(place),
    );
    const display = await page.evaluate(() => {
      const el = document.querySelector('[data-mobile-stage-home-indicator]');
      return el ? window.getComputedStyle(el).display : 'missing';
    });
    check(`${vp.name} stage switcher hidden`, display === 'none', display);
  }
  await assertNoVoxelPreview(page, vp);
}

function heatChanged(before, after) {
  if (!before || !after || before.model < 10 || after.model < 10) return false;
  return Math.abs(before.leftHeat - after.leftHeat) > 15
    || Math.abs(before.rightHeat - after.rightHeat) > 15;
}

async function assertResultsPlots(page, vp, shell) {
  await assertFeaSheet(page, vp, 'Back to Setup');
  const view = await page.locator(shell).getAttribute('data-fea-view');
  check(`${vp.name} results view`, view === 'results', view || '');
  check(`${vp.name} setup hidden`, await page.locator(`${shell} [data-fea-material]`).count() === 0);
  check(`${vp.name} targets hidden`, await page.locator(`${shell} [data-fea-target="fixture"]`).count() === 0);
  await assertNoVoxelPreview(page, vp, shell);
  const stressPressed = await page.locator(`${shell} [data-fea-plot="stress"]`).getAttribute('aria-pressed');
  check(`${vp.name} stress tab`, stressPressed === 'true', stressPressed || '');
  check(`${vp.name} displacement tab`, await page.locator(`${shell} [data-fea-plot="displacement"]`).count() === 1);
  const backIcon = await page.locator(`${shell} [data-fea-back] svg`).getAttribute('class');
  check(`${vp.name} Back to Setup uses ArrowLeft`, /lucide-arrow-left/.test(backIcon || ''), backIcon || '');
  check(
    `${vp.name} timing under the plot`,
    await page.locator(`${shell} [data-fea-timing]`).count() === 1
      && await page.locator(`${shell} [data-fea-timing-details]`).count() === 1,
  );
  if (vp.touch) {
    await page.locator(`${shell} [data-fea-timing-details] summary`).click();
    await page.locator(`${shell} [data-fea-stage]`).first().waitFor({ timeout: 8000 });
    const back = await page.locator(`${shell} [data-fea-back]`).evaluate((el) => {
      const box = el.getBoundingClientRect();
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return {
        top: box.top,
        bottom: box.bottom,
        height: box.height,
        vh: window.innerHeight,
        display: window.getComputedStyle(el).display,
        visibility: window.getComputedStyle(el).visibility,
        inFooter: !!el.closest('[data-feature-sheet-footer]'),
        hit: hit === el || el.contains(hit),
        plotsInBody: !!document.querySelector('[data-fea-plots]')?.closest('[data-feature-sheet-body]'),
        timingInBody: !!document.querySelector('[data-fea-timing]')?.closest('[data-feature-sheet-body]'),
        legendInBody: !!document.querySelector('[data-fea-legend]')?.closest('[data-feature-sheet-body]'),
      };
    });
    check(
      `${vp.name} Back to Setup stays on screen with Stage times open`,
      back.height > 0
        && back.top >= 0
        && back.bottom <= back.vh + 1
        && back.display !== 'none'
        && back.visibility !== 'hidden'
        && back.inFooter
        && back.hit
        && back.plotsInBody
        && back.timingInBody
        && back.legendInBody,
      JSON.stringify(back),
    );
    const stageShot = join(SHOT_DIR, 'fea-study-results-stage-times-390.png');
    check(`${vp.name} stage times shot dir`, !stageShot.startsWith('/opt/cursor/artifacts'), stageShot);
    await page.screenshot({ path: stageShot });
    await page.locator(`${shell} [data-fea-timing-details]`).evaluate((el) => { el.open = false; });
  }
  const stressPx = await sampleSides(page);
  const stressShot = join(SHOT_DIR, vp.touch ? 'fea-study-results-stress-390.png' : 'fea-study-results-stress-1280.png');
  check(`${vp.name} stress shot dir`, !stressShot.startsWith('/opt/cursor/artifacts'), stressShot);
  await page.screenshot({ path: stressShot });
  check(`${vp.name} stress shot saved`, existsSync(stressShot), stressShot);
  console.log(`  shot ${stressShot}`);

  await page.locator(`${shell} [data-fea-plot="displacement"]`).click();
  await page.locator(`${shell} [data-fea-displacement]`).waitFor({ timeout: 8000 });
  await page.waitForTimeout(400);
  const dispPx = await sampleSides(page);
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
  const dispShot = join(SHOT_DIR, vp.touch ? 'fea-study-results-displacement-390.png' : 'fea-study-results-displacement-1280.png');
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

async function readStudyScripts(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const req = indexedDB.open('surfcad-assembly', 1);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction('parts', 'readonly');
      const all = tx.objectStore('parts').getAll();
      all.onsuccess = () => {
        db.close();
        resolve((all.result || []).map((row) => row?.script || ''));
      };
      all.onerror = () => reject(all.error);
    };
  }));
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
  const timingLogs = [];
  page.on('console', (msg) => {
    const text = msg.text();
    if (text.includes('[fea-timing]')) timingLogs.push(text);
  });
  const errors = await boot(page);
  await seed(page);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('canvas', { timeout: 40000 });
  await solidReady(page);
  await installProbe(page);

  const rail = await page.evaluate(() => [...document.querySelectorAll('[data-palette-section]')]
    .map((el) => (el.querySelector('.truncate')?.textContent || '').trim())
    .filter(Boolean));
  check(`${vp.name} left rail order`, rail.join(',') === 'Block,Build,Shape,Polish,Move', rail.join(','));

  check(`${vp.name} front snap`, await snap(page, 'front'));
  await page.locator('[data-analyze-chip]').click();
  const shell = FEA_SHELL;
  await page.locator(shell).waitFor({ timeout: 8000 });
  await assertFeaSheet(page, vp, 'Run');
  if (!vp.touch) {
    await page.keyboard.press('Escape');
    await page.locator(shell).waitFor({ state: 'detached', timeout: 8000 });
    check(`${vp.name} Escape closes Analyze`, await page.locator(shell).count() === 0);
    await page.locator('[data-analyze-chip]').click();
    await page.locator(shell).waitFor({ timeout: 8000 });
    await assertFeaSheet(page, vp, 'Run');
  }
  check(`${vp.name} analyze open`, true);
  check(
    `${vp.name} paint stays closed`,
    await page.locator('[data-paint-mode]').count() === 0,
  );
  check(
    `${vp.name} inspection group`,
    await page.locator('[data-selector-group="inspection"]').count() === 1,
  );

  await page.locator('[data-fea-material]').selectOption('pla-ultimaker');
  await page.locator('[data-fea-assumed="nu"]').waitFor({ timeout: 8000 });
  await solidReady(page);

  check(`${vp.name} left snap`, await snap(page, 'left', END_SNAP_MARGIN));
  const root = await endFacePoints(page);
  check(`${vp.name} root face is tappable`, root.length > 0, `points=${root.length}`);
  await page.locator('[data-fea-target="fixture"]').click();
  const fixed = await tapUntil(page, vp.touch, root, 'data-fea-fixture-count', '1');
  check(`${vp.name} fixture on a face`, fixed.ok, JSON.stringify(fixed));

  await page.locator('[data-fea-target="force"]').click();
  const down = page.locator(`${shell} button`, { hasText: '\u2212Z' });
  await down.scrollIntoViewIfNeeded();
  await down.click();
  check(`${vp.name} right snap`, await snap(page, 'right', END_SNAP_MARGIN));
  const tip = await endFacePoints(page);
  check(`${vp.name} tip face is tappable`, tip.length > 0, `points=${tip.length}`);
  const loaded = await tapUntil(page, vp.touch, tip, 'data-fea-load-count', '1');
  check(`${vp.name} force on a face`, loaded.ok, JSON.stringify(loaded));
  check(`${vp.name} front snap after picks`, await snap(page, 'front'));

  await assertNoVoxelPreview(page, vp, shell);
  const setupShot = join(SHOT_DIR, vp.touch ? 'fea-card-setup-390.png' : 'fea-card-setup-desktop.png');
  check(`${vp.name} setup shot dir`, !setupShot.startsWith('/opt/cursor/artifacts'), setupShot);
  await page.screenshot({ path: setupShot });
  check(`${vp.name} setup shot saved`, existsSync(setupShot), setupShot);
  console.log(`  shot ${setupShot}`);

  const runIcon = await page.locator(`${shell} [data-fea-run] svg`).getAttribute('class');
  check(`${vp.name} Run keeps its icon`, /lucide-check/.test(runIcon || ''), runIcon || '');
  await page.locator('[data-fea-run]').click();
  await page.locator(`${shell}[data-fea-view="results"]`).waitFor({ timeout: 8000 });
  await page.locator(`${shell}[data-fea-screen="running"]`).waitFor({ timeout: 8000 });
  const bar = page.locator(`${shell} [data-fea-results-frame] [data-fea-progress-bar]`);
  await bar.waitFor({ state: 'visible', timeout: 20000 });
  check(`${vp.name} setup hidden on run`, await page.locator(`${shell} [data-fea-material]`).count() === 0);
  check(`${vp.name} stress tab reserved`, await page.locator(`${shell} [data-fea-plot="stress"]`).count() === 1);
  check(`${vp.name} cancel stays available`, await page.locator(`${shell} [data-fea-cancel]`).count() === 1);
  const progressLabel = (await bar.locator('[data-fea-progress-stage]').innerText()).trim();
  check(
    `${vp.name} progress bar`,
    /Loading mesher|Meshing|Assembling|Solving|Post-processing|Refining \d+\/\d+/.test(progressLabel),
    progressLabel,
  );
  const runningHeight = await page.locator(shell).evaluate((el) => el.getBoundingClientRect().height);
  const progressShot = join(SHOT_DIR, vp.touch ? 'fea-study-390-progress.png' : 'fea-study-1280-progress.png');
  check(`${vp.name} progress shot dir`, !progressShot.startsWith('/opt/cursor/artifacts'), progressShot);
  await page.screenshot({ path: progressShot });
  check(`${vp.name} progress shot saved`, existsSync(progressShot), progressShot);
  console.log(`  shot ${progressShot}`);

  await page.locator('[data-fea-summary]').waitFor({ timeout: 300000 });
  await page.locator(`${shell} [data-fea-timing]`).waitFor({ timeout: 10000 });
  const timingText = ((await page.locator(`${shell} [data-fea-timing]`).innerText()) || '').replace(/\s+/g, ' ').trim();
  check(`${vp.name} timing text`, /Solid mesh in .* solved in .* DOF.*total/.test(timingText), timingText);
  const resultsHeight = await page.locator(shell).evaluate((el) => el.getBoundingClientRect().height);
  const heightDelta = Math.abs(resultsHeight - runningHeight);
  console.log(`  card height ${vp.name} running ${runningHeight.toFixed(2)} results ${resultsHeight.toFixed(2)} delta ${heightDelta.toFixed(2)}`);
  check(
    `${vp.name} card height stable from running to results`,
    heightDelta <= 2,
    `running ${runningHeight} results ${resultsHeight} delta ${heightDelta}`,
  );
  check(`${vp.name} convergence text`, /refined \d+x, (?:converged|not converged)/.test(timingText), timingText);
  check(
    `${vp.name} timing log`,
    timingLogs.some((line) => line.startsWith('[fea-timing]')),
    timingLogs.join(' | '),
  );
  const timingShot = join(SHOT_DIR, vp.touch ? 'fea-study-390-timing.png' : 'fea-study-1280-timing.png');
  check(`${vp.name} timing shot dir`, !timingShot.startsWith('/opt/cursor/artifacts'), timingShot);
  await page.screenshot({ path: timingShot });
  check(`${vp.name} timing shot saved`, existsSync(timingShot), timingShot);
  console.log(`  shot ${timingShot}`);
  const summary = await page.evaluate(() => ({
    stubs: document.querySelectorAll('[data-fea-stub="1"]').length,
    source: document.querySelector('[data-fea-source]')?.getAttribute('data-fea-source') || '',
    stress: document.querySelector('[data-fea-stress]')?.textContent || '',
    fos: document.querySelector('[data-fea-fos]')?.getAttribute('data-fea-fos') || '',
    warning: document.querySelector('[data-fea-warning]')?.textContent || '',
    ms: document.querySelector('[data-fea-solve-ms]')?.getAttribute('data-fea-solve-ms') || '',
    peak: document.querySelector('[data-fea-peak-bytes]')?.getAttribute('data-fea-peak-bytes') || '',
  }));
  const maxMatch = summary.stress.match(/max ([0-9.]+) MPa/);
  const maxMPa = maxMatch ? Number(maxMatch[1]) : NaN;
  const peakError = Number.isFinite(maxMPa) ? Math.abs(maxMPa - BEAM_PEAK_MPA) / BEAM_PEAK_MPA : Infinity;
  console.log(`  solve ${vp.name} ${summary.ms} ms peak ${summary.peak} bytes max ${maxMPa} MPa`);
  // The first frame after the results land can still carry the running
  // skin (every pixel cold), which read as "root colder than the tip" twice
  // on CI with the same numbers. Sample again for up to 3 s until the
  // gradient is there; a real regression still fails after the retries.
  const hotRoot = (c) => !!c && c.leftN > 10 && c.rightN > 10 && c.leftHeat > c.rightHeat + 20;
  let colours = await sampleSides(page);
  for (let attempt = 1; attempt <= 6 && !hotRoot(colours); attempt += 1) {
    await page.waitForTimeout(500);
    colours = await sampleSides(page);
    if (hotRoot(colours)) console.log(`  heat sample settled on retry ${attempt}`);
  }
  check(`${vp.name} no stub badge`, summary.stubs === 0, JSON.stringify(summary));
  check(`${vp.name} tet10 source`, summary.source === 'tet10', summary.source);
  check(`${vp.name} stress summary`, /min .+ MPa/.test(summary.stress) && /p95 /.test(summary.stress) && /max /.test(summary.stress), summary.stress);
  // Adaptive refine resolves the clamped corner, so the nodal max sits
  // above the beam-theory outer fiber. 30% still rejects a broken solve.
  check(`${vp.name} peak within 30% of beam theory`, peakError <= 0.3, `max ${maxMPa} vs ${BEAM_PEAK_MPA}`);
  check(`${vp.name} safety factor`, summary.fos !== '' && summary.fos !== 'n/a', summary.fos);
  check(`${vp.name} no stub warning`, !/STUB/.test(summary.warning), summary.warning);
  check(`${vp.name} solve time recorded`, Number(summary.ms) > 0, summary.ms);
  check(`${vp.name} peak memory recorded`, Number(summary.peak) > 0, summary.peak);
  check(
    `${vp.name} root is hotter than the tip`,
    !!colours && colours.leftN > 10 && colours.rightN > 10 && colours.leftHeat > colours.rightHeat + 20,
    JSON.stringify(colours),
  );

  const uploadError = await page.evaluate(() => {
    const text = document.body?.innerText || '';
    const at = text.indexOf('Upload Error');
    return at < 0 ? '' : text.slice(at, at + 80);
  });
  check(`${vp.name} no upload error`, uploadError === '', uploadError);
  const shot = join(SHOT_DIR, vp.touch ? 'fea-study-390.png' : 'fea-study-desktop.png');
  check(`${vp.name} shot dir`, !shot.startsWith('/opt/cursor/artifacts'), shot);
  await page.screenshot({ path: shot });
  check(`${vp.name} shot saved`, existsSync(shot), shot);
  console.log(`  shot ${shot}`);

  await assertResultsPlots(page, vp, shell);

  const firstSolveMs = Number(summary.ms);
  const firstFos = Number(summary.fos);
  await page.locator(`${shell} [data-fea-material]`).selectOption('al-6061-t6');
  await page.locator(`${shell} [data-fea-stale="1"]`).waitFor({ timeout: 8000 });
  check(`${vp.name} material change marks the result stale`, true);
  await solidReady(page);
  await page.locator(`${shell} [data-fea-run]`).click();
  await page.waitForFunction((sel) => {
    const el = document.querySelector(sel);
    return !!el && /mesh reused/i.test(el.textContent || '');
  }, `${shell} [data-fea-timing]`, { timeout: 120000 });
  const reusedTiming = ((await page.locator(`${shell} [data-fea-timing]`).innerText()) || '').replace(/\s+/g, ' ').trim();
  check(`${vp.name} mesh reused timing`, /Solid mesh reused, solved in .* DOF.*total/.test(reusedTiming), reusedTiming);
  await page.locator(`${shell} [data-fea-timing-details] summary`).click();
  const meshStage = ((await page.locator(`${shell} [data-fea-stage="meshing"]`).innerText()) || '').replace(/\s+/g, ' ').trim();
  check(`${vp.name} stage times say mesh reused`, /Meshing: Mesh reused/.test(meshStage), meshStage);
  const reused = await page.evaluate(() => ({
    stress: document.querySelector('[data-fea-stress]')?.textContent || '',
    fos: document.querySelector('[data-fea-fos]')?.getAttribute('data-fea-fos') || '',
    ms: document.querySelector('[data-fea-solve-ms]')?.getAttribute('data-fea-solve-ms') || '',
    stale: document.querySelector('[data-fea-stale]')?.getAttribute('data-fea-stale') || '',
    source: document.querySelector('[data-fea-source]')?.getAttribute('data-fea-source') || '',
  }));
  const reusedMax = Number((reused.stress.match(/max ([0-9.]+) MPa/) || [])[1]);
  const reusedP95 = Number((reused.stress.match(/p95 ([0-9.]+) MPa/) || [])[1]);
  const reusedFos = Number(reused.fos);
  const reusedMs = Number(reused.ms);
  const fosExpected = ALUMINUM_YIELD_MPA / reusedP95;
  const reusedPeakError = Number.isFinite(reusedMax) ? Math.abs(reusedMax - BEAM_PEAK_MPA) / BEAM_PEAK_MPA : Infinity;
  console.log(`  reuse ${vp.name} first ${firstSolveMs} ms second ${reusedMs} ms max ${reusedMax} MPa p95 ${reusedP95} fos ${reusedFos} (${reusedTiming})`);
  check(`${vp.name} reused run is current`, reused.stale === '0', reused.stale);
  check(`${vp.name} reused tet10 source`, reused.source === 'tet10', reused.source);
  check(`${vp.name} reused peak within 30% of beam theory`, reusedPeakError <= 0.3, `max ${reusedMax} vs ${BEAM_PEAK_MPA}`);
  check(
    `${vp.name} reused safety factor`,
    Number.isFinite(reusedFos) && Number.isFinite(fosExpected) && Math.abs(reusedFos - fosExpected) / fosExpected < 0.02,
    `fos ${reusedFos} vs ${fosExpected} from p95 ${reusedP95}`,
  );
  check(`${vp.name} reused safety factor moved`, Number.isFinite(firstFos) && reusedFos > firstFos * 2, `first ${firstFos} second ${reusedFos}`);
  check(
    `${vp.name} second run much faster`,
    firstSolveMs > 0 && reusedMs > 0 && reusedMs * 2 < firstSolveMs,
    `first ${firstSolveMs} ms, second ${reusedMs} ms`,
  );

  await page.locator(`${shell} [data-fea-plot="displacement"]`).click();
  await page.locator(`${shell} [data-fea-displacement]`).waitFor({ timeout: 8000 });
  const reusedDispText = ((await page.locator(`${shell} [data-fea-displacement]`).innerText()) || '').replace(/\s+/g, ' ');
  const reusedDisp = Number((reusedDispText.match(/max ([0-9.]+) mm/) || [])[1]);
  check(`${vp.name} reused displacement is readable`, reusedDisp > 0, reusedDispText);

  await page.locator(`${shell} [data-fea-back]`).click();
  await page.locator(`${shell}[data-fea-view="setup"]`).waitFor({ timeout: 8000 });
  const forceField = page.locator(`${shell} [data-popup-number="fea-force"]`);
  await forceField.scrollIntoViewIfNeeded();
  await forceField.evaluate((el) => {
    const desc = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
    desc.set.call(el, '400');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.locator(`${shell} [data-fea-load="0"]`).filter({ hasText: '0, 0, -400' }).waitFor({ timeout: 8000 });
  await page.locator(`${shell} [data-fea-stale="1"]`).waitFor({ timeout: 8000 });
  check(`${vp.name} doubled force marks the result stale`, true);
  await page.locator(`${shell} [data-fea-run]`).click();
  await page.waitForFunction((sel) => {
    const el = document.querySelector(sel);
    return !!el && /mesh reused/i.test(el.textContent || '');
  }, `${shell} [data-fea-timing]`, { timeout: 120000 });
  const doubled = await page.evaluate(() => ({
    stress: document.querySelector('[data-fea-stress]')?.textContent || '',
    stale: document.querySelector('[data-fea-stale]')?.getAttribute('data-fea-stale') || '',
    timing: (document.querySelector('[data-fea-timing]')?.textContent || '').replace(/\s+/g, ' ').trim(),
  }));
  const doubledMax = Number((doubled.stress.match(/max ([0-9.]+) MPa/) || [])[1]);
  const doubleError = Number.isFinite(doubledMax) && reusedMax > 0
    ? Math.abs(doubledMax - 2 * reusedMax) / (2 * reusedMax)
    : Infinity;
  console.log(`  load x2 ${vp.name} max ${doubledMax} MPa vs ${reusedMax} (${doubled.timing})`);
  check(`${vp.name} doubled force re-solved`, doubled.stale === '0', doubled.stale);
  check(`${vp.name} doubled force reused the mesh`, /mesh reused/i.test(doubled.timing), doubled.timing);
  check(`${vp.name} doubled force doubles the stress`, doubleError <= 0.08, `max ${doubledMax} vs 2x ${reusedMax}`);
  await page.locator(`${shell} [data-fea-plot="displacement"]`).click();
  await page.locator(`${shell} [data-fea-displacement]`).waitFor({ timeout: 8000 });
  const doubledDispText = ((await page.locator(`${shell} [data-fea-displacement]`).innerText()) || '').replace(/\s+/g, ' ');
  const doubledDisp = Number((doubledDispText.match(/max ([0-9.]+) mm/) || [])[1]);
  const dispError = Number.isFinite(doubledDisp) && reusedDisp > 0
    ? Math.abs(doubledDisp - 2 * reusedDisp) / (2 * reusedDisp)
    : Infinity;
  check(`${vp.name} doubled force doubles the displacement`, dispError <= 0.15, `max ${doubledDisp} vs 2x ${reusedDisp} (${doubledDispText})`);
  const doubleShot = join(SHOT_DIR, vp.touch ? 'fea-study-load-double-390.png' : 'fea-study-load-double-1280.png');
  check(`${vp.name} double shot dir`, !doubleShot.startsWith('/opt/cursor/artifacts'), doubleShot);
  await page.screenshot({ path: doubleShot });

  await page.locator(`${shell} [data-fea-back]`).click();
  await page.locator(`${shell}[data-fea-view="setup"]`).waitFor({ timeout: 8000 });
  await page.locator(`${shell} [data-fea-direction="+x"]`).scrollIntoViewIfNeeded();
  await page.locator(`${shell} [data-fea-direction="+x"]`).click();
  await page.locator(`${shell} [data-fea-load="0"]`).filter({ hasText: '400, 0, 0' }).waitFor({ timeout: 8000 });
  await page.locator(`${shell} [data-fea-run]`).click();
  await page.waitForFunction((sel) => {
    const el = document.querySelector(sel);
    return !!el && /mesh reused/i.test(el.textContent || '');
  }, `${shell} [data-fea-timing]`, { timeout: 120000 });
  const axial = await page.evaluate(() => ({
    stress: document.querySelector('[data-fea-stress]')?.textContent || '',
    timing: (document.querySelector('[data-fea-timing]')?.textContent || '').replace(/\s+/g, ' ').trim(),
  }));
  const axialMax = Number((axial.stress.match(/max ([0-9.]+) MPa/) || [])[1]);
  console.log(`  load +X ${vp.name} max ${axialMax} MPa (${axial.timing})`);
  check(`${vp.name} +X reused the mesh`, /mesh reused/i.test(axial.timing), axial.timing);
  check(`${vp.name} +X stress leaves the bending result`, Number.isFinite(axialMax) && axialMax < doubledMax * 0.25, `axial ${axialMax} vs bend ${doubledMax}`);
  const axialShot = join(SHOT_DIR, vp.touch ? 'fea-study-load-axial-390.png' : 'fea-study-load-axial-1280.png');
  await page.screenshot({ path: axialShot });

  const notice = (await noticeOf(page) || '').trim();
  check(`${vp.name} study write accepted`, notice === '', notice);
  const drawerOpen = await page.locator('[data-script-editor-open="true"]').count();
  check(`${vp.name} script drawer stays closed`, drawerOpen === 0, `open=${drawerOpen}`);
  await page.waitForTimeout(200);
  const scripts = await readStudyScripts(page);
  const stored = scripts.find((script) => script.includes('// @fea-study ') && script.includes('al-6061-t6'));
  check(`${vp.name} study stored`, !!stored, scripts.map((script) => script.slice(0, 80)).join(' | '));

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('canvas', { timeout: 40000 });
  await solidReady(page);
  await page.locator('[data-analyze-chip]').click();
  await page.locator(shell).waitFor({ timeout: 8000 });
  const again = await page.evaluate(() => ({
    material: document.querySelector('[data-fea-material]')?.value || '',
    fixtures: document.querySelector('[data-fea-fixture-count]')?.getAttribute('data-fea-fixture-count') || '',
    loads: document.querySelector('[data-fea-load-count]')?.getAttribute('data-fea-load-count') || '',
    result: document.querySelector('[data-fea-summary]') ? 'present' : 'absent',
  }));
  check(`${vp.name} material persisted`, again.material === 'al-6061-t6', JSON.stringify(again));
  check(`${vp.name} fixture persisted`, again.fixtures === '1', JSON.stringify(again));
  check(`${vp.name} load persisted`, again.loads === '1', JSON.stringify(again));
  check(`${vp.name} result not in the script`, again.result === 'absent');
  await assertRunFailure(page, vp, shell);
  check(`${vp.name} no page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await context.close();
}

async function assertRunFailure(page, vp, shell) {
  await page.locator(`${shell} [data-fea-run]`).click();
  const bar = page.locator(`${shell} [data-fea-results-frame] [data-fea-progress-bar]`);
  await bar.waitFor({ state: 'visible', timeout: 20000 });
  check(`${vp.name} failure run uses the results frame`, await page.locator(`${shell}[data-fea-screen="running"]`).count() === 1);
  await page.locator(`${shell} [data-fea-cancel]`).click();
  await page.locator(`${shell} [data-fea-stopped]`).waitFor({ timeout: 20000 });
  const stopped = ((await page.locator(`${shell} [data-fea-stopped]`).innerText()) || '').replace(/\s+/g, ' ').trim();
  check(`${vp.name} stopped during`, /Stopped during /.test(stopped), stopped);
  check(`${vp.name} failure keeps Back to Setup`, await page.locator(`${shell} [data-fea-back]`).count() === 1);
  const backIcon = await page.locator(`${shell} [data-fea-back] svg`).getAttribute('class');
  check(`${vp.name} failure Back to Setup uses ArrowLeft`, /lucide-arrow-left/.test(backIcon || ''), backIcon || '');
  check(`${vp.name} failure stays on the results frame`, await page.locator(`${shell}[data-fea-view="results"]`).count() === 1);
  const shot = join(SHOT_DIR, vp.touch ? 'fea-study-390-stopped.png' : 'fea-study-1280-stopped.png');
  check(`${vp.name} stopped shot dir`, !shot.startsWith('/opt/cursor/artifacts'), shot);
  await page.screenshot({ path: shot });
  check(`${vp.name} stopped shot saved`, existsSync(shot), shot);
  console.log(`  shot ${shot}`);
}

async function runSheetCase(browser, vp) {
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
  const timingLogs = [];
  page.on('console', (msg) => {
    const text = msg.text();
    if (text.includes('[fea-timing]')) timingLogs.push(text);
  });
  const errors = await boot(page);
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
          name: 'Study',
          activeId: partId,
          parts: [{ id: partId, name: 'Bracket', visible: true, order: 0 }],
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
  }, { script: SHEET_METALLICA_SCRIPT, partId: 'fea-sheet', userId: USER_ID });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('canvas', { timeout: 40000 });
  await solidReady(page);

  const shell = FEA_SHELL;
  await page.locator('[data-analyze-chip]').click();
  await page.locator(shell).waitFor({ timeout: 8000 });
  await assertFeaSheet(page, vp, 'Run');
  const seeded = await page.evaluate(() => ({
    material: document.querySelector('[data-fea-material]')?.value || '',
    fixtures: document.querySelector('[data-fea-fixture-count]')?.getAttribute('data-fea-fixture-count') || '',
    loads: document.querySelector('[data-fea-load-count]')?.getAttribute('data-fea-load-count') || '',
  }));
  check(`${vp.name} sheet material`, seeded.material === 'al-6061-t6', seeded.material);
  check(`${vp.name} sheet fixture`, seeded.fixtures === '1', JSON.stringify(seeded));
  check(`${vp.name} sheet load`, seeded.loads === '1', JSON.stringify(seeded));

  await page.locator('[data-fea-run]').click();
  await page.locator('[data-fea-summary]').waitFor({ timeout: 180000 });
  await page.locator(`${shell} [data-fea-timing]`).waitFor({ timeout: 10000 });
  const timingText = ((await page.locator(`${shell} [data-fea-timing]`).innerText()) || '').replace(/\s+/g, ' ').trim();
  check(`${vp.name} sheet timing text`, /Shell mesh in .* solved in .* DOF.*total/.test(timingText), timingText);
  check(
    `${vp.name} sheet timing log`,
    timingLogs.some((line) => line.startsWith('[fea-timing]')),
    timingLogs.join(' | '),
  );
  const summary = await page.evaluate(() => ({
    stubs: document.querySelectorAll('[data-fea-stub="1"]').length,
    source: document.querySelector('[data-fea-source]')?.getAttribute('data-fea-source') || '',
    stress: document.querySelector('[data-fea-stress]')?.textContent || '',
    warning: document.querySelector('[data-fea-warning]')?.textContent || '',
    notice: document.querySelector('[data-fea-notice]')?.textContent || '',
  }));
  const maxMatch = summary.stress.match(/max ([0-9.]+) MPa/);
  const maxMPa = maxMatch ? Number(maxMatch[1]) : NaN;
  console.log(`  sheet ${vp.name} max ${maxMPa} MPa ${timingText}`);
  check(`${vp.name} sheet no stub`, summary.stubs === 0, JSON.stringify(summary));
  check(`${vp.name} sheet shell`, summary.source === 'shell', summary.source);
  check(`${vp.name} sheet stress finite`, Number.isFinite(maxMPa) && maxMPa > 0.05 && maxMPa < 5000, summary.stress);
  check(`${vp.name} sheet results view`, await page.locator(`${shell}[data-fea-view="results"]`).count() === 1);
  check(`${vp.name} sheet setup hidden`, await page.locator(`${shell} [data-fea-material]`).count() === 0);
  await assertNoVoxelPreview(page, vp, shell);
  check(`${vp.name} sheet no jacobian failure`, !/Jacobian|non-positive/i.test(summary.notice), summary.notice);
  const shot = join(SHOT_DIR, vp.touch ? 'fea-sheet-390.png' : 'fea-sheet-1280.png');
  check(`${vp.name} sheet shot dir`, !shot.startsWith('/opt/cursor/artifacts'), shot);
  await page.screenshot({ path: shot });
  check(`${vp.name} sheet shot saved`, existsSync(shot), shot);
  console.log(`  shot ${shot}`);
  check(`${vp.name} sheet no page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await context.close();
}

async function runModalCase(browser, vp) {
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
  await page.locator('[data-analyze-chip]').click();
  const shell = FEA_SHELL;
  await page.locator(shell).waitFor({ timeout: 8000 });
  await page.locator('[data-fea-material]').selectOption('pla-ultimaker');
  await page.locator('[data-fea-study-type="modal"]').click();
  await page.locator('[data-fea-modal-note]').waitFor({ timeout: 8000 });
  const note = (await page.locator('[data-fea-modal-note]').innerText()).replace(/\s+/g, ' ');
  check(`${vp.name} modal note`, /fixtures only/i.test(note), note);
  check(`${vp.name} modal left snap`, await snap(page, 'left', END_SNAP_MARGIN));
  const root = await endFacePoints(page);
  await page.locator('[data-fea-target="fixture"]').click();
  const fixed = await tapUntil(page, vp.touch, root, 'data-fea-fixture-count', '1');
  check(`${vp.name} modal fixture`, fixed.ok, JSON.stringify(fixed));
  await page.locator('[data-fea-run]').click();
  await page.locator(`${shell} [data-fea-mode="0"]`).waitFor({ timeout: 120000 });
  const label = ((await page.locator(`${shell} [data-fea-mode="0"]`).innerText()) || '').replace(/\s+/g, ' ').trim();
  check(`${vp.name} modal mode list`, /^Mode 1: [0-9.]+ Hz$/.test(label), label);
  check(`${vp.name} modal animate off`, await page.locator(`${shell} [data-fea-animate]`).isChecked() === false);
  const source = await page.locator(`${shell} [data-fea-source]`).getAttribute('data-fea-source');
  check(`${vp.name} modal source`, source === 'modal', source || '');
  const legend = ((await page.locator(`${shell} [data-fea-displacement]`).innerText()) || '').replace(/\s+/g, ' ');
  check(`${vp.name} modal legend has no millimetre unit`, !/mm/.test(legend), legend);
  const shot = join(SHOT_DIR, vp.touch ? 'fea-modal-390.png' : 'fea-modal-1280.png');
  check(`${vp.name} modal shot dir`, !shot.startsWith('/opt/cursor/artifacts'), shot);
  await page.screenshot({ path: shot });
  check(`${vp.name} modal shot saved`, existsSync(shot), shot);
  console.log(`  shot ${shot}`);
  check(`${vp.name} modal no page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
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
    console.log(` ${vp.name} sheet`);
    await runSheetCase(browser, vp);
    console.log(` ${vp.name} modal`);
    await runModalCase(browser, vp);
  }
} finally {
  if (browser) await browser.close();
  stop();
}

if (failed) {
  console.log(`\n${failed} failed`);
  process.exit(1);
}
console.log('\nFEA study panel: ok');

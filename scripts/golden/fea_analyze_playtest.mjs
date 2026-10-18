#!/usr/bin/env node
/**
 * Analyze playtest. Two cubes. With Analyze open on the left part:
 * a tap on the right part must not throw, must not retarget, and must
 * not add a fixture. Only the analyzed part's overlays and list rows
 * show. Switching parts reconciles them. Fixtures read blue and loads
 * yellow, in the overlay pixels and the list chips.
 *
 * 390×844 touch and 1280×800. FEA_VIEW=390 or FEA_VIEW=1280 runs one.
 * FEA_PREVIEW=1 serves dist. Screenshots go to GOLDEN_SHOT_DIR or
 * os.tmpdir() only.
 */
/* global document, getComputedStyle, indexedDB, localStorage, window */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { attachConsentPresetToBrowser } from './lib/presetConsentInit.mjs';

const PORT = Number(process.env.SMOKE_PORT || 4337);
const APP_URL = `http://127.0.0.1:${PORT}/`;
const SHOT_DIR = process.env.GOLDEN_SHOT_DIR || tmpdir();
const PREVIEW = process.env.FEA_PREVIEW === '1';
const USER_ID = 'user-fea-playtest';
const ID_A = '2026-10-18-12-00-00-0001-aaa1';
const ID_B = '2026-10-18-12-00-00-0002-bbb2';
const ASM_ID = '2026-10-18-12-00-00-0000-aa01';
const CUBE_BODY = 'const part = Manifold.cube([40, 40, 40], false);\nreturn part;\n';
const CUBE = `// @surf-id ${ID_A}\n${CUBE_BODY}`;
const B_STUDY = `// @surf-id ${ID_B}\n${CUBE_BODY}// --- fea-study begin ---
// @fea-study {"v":1,"id":"play","name":"B","type":"linear-static","units":{"length":"mm","force":"N","stress":"MPa","note":"Length is mm, force is N, and stress, pressure, modulus, and yield are MPa. Face area is mm^2 and the face point at is mm."},"material":{"id":"al-6061-t6"},"model":"auto","fixtures":[{"kind":"fixed","faces":[{"faceID":1,"at":[1,2,3],"n":[0,0,1],"area":100}]}],"loads":[],"mesh":{"target":"auto"},"result":null}
// --- fea-study end ---
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

console.log('FEA analyze playtest');

const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!exe) {
  console.log('FEA analyze playtest: no system Chrome — set CHROME_PATH. Skipping.');
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
  await page.evaluate(async ({ cube, other, userId, idA, idB, asmId }) => {
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
          id: asmId,
          source: 'git',
          name: 'Playtest',
          activeId: idA,
          parts: [
            { id: idA, name: 'Left', visible: true, order: 0, position: [0, 0, 0] },
            { id: idB, name: 'Right', visible: true, order: 1, position: [80, 0, 0] },
          ],
        }, 'current');
        tx.objectStore('parts').put({ id: idA, script: cube, savedAt: Date.now() }, idA);
        tx.objectStore('parts').put({ id: idB, script: other, savedAt: Date.now() }, idB);
        localStorage.setItem('surfcad.github.tokenBundle', JSON.stringify({
          accessToken: 'ghu_fea',
          refreshToken: '',
          expiresAt: Date.now() + 86_400_000,
          refreshExpiresAt: 0,
        }));
        localStorage.setItem('surfcad.lastAssembly', JSON.stringify({
          [userId]: {
            name: 'Playtest',
            activeId: idA,
            source: 'git',
            savedAt: Date.now(),
          },
        }));
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
    });
  }, { cube: CUBE, other: B_STUDY, userId: USER_ID, idA: ID_A, idB: ID_B, asmId: ASM_ID });
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
  page.on('pageerror', (err) => errors.push(String(err).slice(0, 500)));
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
    return !spinner && solids === '2' && pending === 0 && booted;
  }, null, { timeout: 40000 });
  await page.waitForTimeout(500);
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

function withScene(page, read) {
  return page.evaluate((readerSource) => new Promise((resolve) => {
    const probe = window.__feaProbe?.bits?.();
    const canvas = probe?.canvas;
    const renderer = probe?.renderer;
    if (!canvas || !renderer) {
      resolve(null);
      return;
    }
    const readScene = new Function('scene', 'camera', 'canvas', 'renderer', readerSource);
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
        clearTimeout(timer);
        finish(readScene(scene, camera, canvas, renderer));
      } catch (err) {
        clearTimeout(timer);
        finish({ error: String(err && err.message || err) });
      }
      return out;
    };
  }), read);
}

const READ_PARTS = `
  const rect = canvas.getBoundingClientRect();
  function project(mesh, local) {
    const world = mesh.position.clone().set(local[0], local[1], local[2]);
    mesh.localToWorld(world);
    const q = world.clone().project(camera);
    return {
      x: rect.left + (q.x * 0.5 + 0.5) * rect.width,
      y: rect.top + (-q.y * 0.5 + 0.5) * rect.height,
      z: q.z,
    };
  }
  function hits(mesh, x, y) {
    const ndcX = ((x - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((y - rect.top) / rect.height) * 2 + 1;
    const cursor = camera.position.clone();
    cursor.set(ndcX, ndcY, 0.5).unproject(camera);
    mesh.updateMatrixWorld(true);
    const inv = mesh.matrixWorld.clone().invert();
    const origin = camera.position.clone().applyMatrix4(inv);
    const end = cursor.applyMatrix4(inv);
    const dir = end.sub(origin);
    const index = mesh.geometry?.index?.array;
    const pos = mesh.geometry?.attributes?.position;
    if (!index || !pos || dir.lengthSq() < 1e-12) return null;
    dir.normalize();
    const eps = 1e-6;
    let bestW = Infinity;
    let bestKey = null;
    for (let t = 0; t < index.length; t += 3) {
      const ax = pos.getX(index[t]);
      const ay = pos.getY(index[t]);
      const az = pos.getZ(index[t]);
      const bx = pos.getX(index[t + 1]);
      const by = pos.getY(index[t + 1]);
      const bz = pos.getZ(index[t + 1]);
      const cx = pos.getX(index[t + 2]);
      const cy = pos.getY(index[t + 2]);
      const cz = pos.getZ(index[t + 2]);
      const abx = bx - ax, aby = by - ay, abz = bz - az;
      const acx = cx - ax, acy = cy - ay, acz = cz - az;
      const px = dir.y * acz - dir.z * acy;
      const py = dir.z * acx - dir.x * acz;
      const pz = dir.x * acy - dir.y * acx;
      const det = abx * px + aby * py + abz * pz;
      if (Math.abs(det) < eps) continue;
      const invDet = 1 / det;
      const sx = origin.x - ax, sy = origin.y - ay, sz = origin.z - az;
      const u = (sx * px + sy * py + sz * pz) * invDet;
      if (u < -eps || u > 1 + eps) continue;
      const qx = sy * abz - sz * aby;
      const qy = sz * abx - sx * abz;
      const qz = sx * aby - sy * abx;
      const v = (dir.x * qx + dir.y * qy + dir.z * qz) * invDet;
      if (v < -eps || u + v > 1 + eps) continue;
      const w = (acx * qx + acy * qy + acz * qz) * invDet;
      if (w > eps && w < bestW) {
        bestW = w;
        const nx = aby * acz - abz * acy;
        const ny = abz * acx - abx * acz;
        const nz = abx * acy - aby * acx;
        const nlen = Math.hypot(nx, ny, nz) || 1;
        bestKey = [Math.round((nx / nlen) * 2), Math.round((ny / nlen) * 2), Math.round((nz / nlen) * 2)].join(',');
      }
    }
    return bestKey;
  }
  const parts = [];
  scene.traverse((obj) => {
    if (!obj.isMesh || obj.name === 'fea-face-highlight') return;
    const count = obj.geometry?.attributes?.position?.count || 0;
    if (count < 8 || count > 20000) return;
    const id = obj.userData?.assemblyPartId
      ? String(obj.userData.assemblyPartId)
      : (obj.name === 'assembly-part' ? '' : 'active');
    if (!id) return;
    if (!obj.geometry.boundingBox) obj.geometry.computeBoundingBox();
    const box = obj.geometry.boundingBox;
    if (!box) return;
    const mid = [(box.min.x + box.max.x) / 2, (box.min.y + box.max.y) / 2, (box.min.z + box.max.z) / 2];
    const center = project(obj, mid);
    const index = obj.geometry.index?.array;
    const pos = obj.geometry.attributes.position;
    const faces = [];
    if (index && pos) {
      const seen = new Set();
      const step = Math.max(1, Math.floor(index.length / 3 / 24));
      for (let t = 0; t < index.length / 3; t += step) {
        const a = index[t * 3], b = index[t * 3 + 1], c = index[t * 3 + 2];
        const ax = pos.getX(a), ay = pos.getY(a), az = pos.getZ(a);
        const bx = pos.getX(b), by = pos.getY(b), bz = pos.getZ(b);
        const cx = pos.getX(c), cy = pos.getY(c), cz = pos.getZ(c);
        const nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
        const ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
        const nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
        const len = Math.hypot(nx, ny, nz) || 1;
        const key = [Math.round((nx / len) * 2), Math.round((ny / len) * 2), Math.round((nz / len) * 2)].join(',');
        if (seen.has(key)) continue;
        seen.add(key);
        const at = project(obj, [(ax + bx + cx) / 3, (ay + by + cy) / 3, (az + bz + cz) / 3]);
        if (at.z < -1 || at.z > 1) continue;
        if (at.x < rect.left + 2 || at.y < rect.top + 2 || at.x > rect.right - 2 || at.y > rect.bottom - 2) continue;
        if (document.elementFromPoint(at.x, at.y) !== canvas) continue;
        if (hits(obj, at.x, at.y) !== key) continue;
        faces.push({ x: at.x, y: at.y, key });
        if (faces.length >= 6) break;
      }
    }
    let overlays = 0;
    obj.traverse((child) => {
      if (child !== obj && child.name === 'fea-face-highlight') overlays += 1;
    });
    parts.push({ id, overlays, center, faces });
  });
  return { parts };
`;

async function partTargets(page) {
  const read = await withScene(page, READ_PARTS);
  if (!read || read.error) return [];
  return read.parts || [];
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
    const timer = setTimeout(() => finish(null), 2500);
    renderer.render = function hooked(scene, camera) {
      const out = orig(scene, camera);
      try {
        const gl = renderer.getContext();
        const rect = canvas.getBoundingClientRect();
        const scaleX = gl.drawingBufferWidth / Math.max(1, rect.width);
        const scaleY = gl.drawingBufferHeight / Math.max(1, rect.height);
        const cx = Math.round((x - rect.left) * scaleX);
        const cy = Math.round((rect.bottom - y) * scaleY);
        const radius = Math.max(2, Math.round(8 * Math.max(scaleX, scaleY)));
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
          if (r < 30 && g < 30 && b < 30) continue;
          n += 1;
          sr += r;
          sg += g;
          sb += b;
        }
        const colors = [];
        scene.traverse((obj) => {
          if (obj.name !== 'fea-face-highlight' || !obj.material?.color) return;
          colors.push(obj.material.color.getHexString());
        });
        clearTimeout(timer);
        finish({
          n,
          r: n ? sr / n : 0,
          g: n ? sg / n : 0,
          b: n ? sb / n : 0,
          colors,
        });
      } catch (err) {
        clearTimeout(timer);
        finish({ error: String(err && err.message || err) });
      }
      return out;
    };
  }), { x: point.x, y: point.y });
}

function describe(sample) {
  if (!sample) return 'null';
  if (sample.error) return sample.error;
  return `n=${sample.n} rgb=(${sample.r.toFixed(1)},${sample.g.toFixed(1)},${sample.b.toFixed(1)}) colors=${(sample.colors || []).join(',')}`;
}

async function scanColors(page) {
  return page.evaluate(() => new Promise((resolve) => {
    const probe = window.__feaProbe?.bits?.();
    const renderer = probe?.renderer;
    if (!renderer) {
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
    const timer = setTimeout(() => finish(null), 2500);
    renderer.render = function hooked(scene, camera) {
      const out = orig(scene, camera);
      try {
        const gl = renderer.getContext();
        const w = gl.drawingBufferWidth;
        const h = gl.drawingBufferHeight;
        const buf = new Uint8Array(w * h * 4);
        gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
        let blueN = 0;
        let yellowN = 0;
        let bestB = null;
        let bestY = null;
        for (let i = 0; i < buf.length; i += 16) {
          const r = buf[i];
          const g = buf[i + 1];
          const b = buf[i + 2];
          if (b > g + 8 && b > r + 12 && g + 5 > r) {
            blueN += 1;
            const score = b - r;
            if (!bestB || score > bestB.score) bestB = { r, g, b, score };
          }
          if (r > b + 20 && g > b + 12 && r + 12 >= g && r > g - 30) {
            yellowN += 1;
            const score = r - b;
            if (!bestY || score > bestY.score) bestY = { r, g, b, score };
          }
        }
        clearTimeout(timer);
        finish({ blueN, yellowN, bestB, bestY });
      } catch (err) {
        clearTimeout(timer);
        finish({ error: String(err && err.message || err) });
      }
      return out;
    };
  }));
}

function isBlue(sample) {
  if (!sample || !(sample.n >= 8)) return false;
  return sample.b > sample.g + 8 && sample.b > sample.r + 12 && sample.g + 5 > sample.r;
}

function isYellow(sample) {
  if (!sample || !(sample.n >= 8)) return false;
  return sample.r > sample.b + 20 && sample.g > sample.b + 12 && sample.r + 12 >= sample.g;
}

async function tap(page, touch, point) {
  if (touch) await page.touchscreen.tap(point.x, point.y);
  else await page.mouse.click(point.x, point.y);
}

async function domClick(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    el.click();
    return true;
  }, selector);
}

async function attr(page, selector, name) {
  return page.locator(selector).getAttribute(name).catch(() => null);
}

async function selectedPart(page) {
  return page.evaluate(() => (
    document.querySelector('[data-part-selected="true"]')?.getAttribute('data-part-row') || ''
  ));
}

async function livePartIds(page) {
  return page.evaluate(() => {
    const rows = [...document.querySelectorAll('[data-part-row]')];
    const byName = { left: '', right: '' };
    for (const row of rows) {
      const id = row.getAttribute('data-part-row') || '';
      const label = (row.textContent || '').replace(/\s+/g, ' ');
      if (/\bLeft\b/.test(label)) byName.left = id;
      if (/\bRight\b/.test(label)) byName.right = id;
    }
    return byName;
  });
}

async function listText(page) {
  return page.evaluate(() => document.querySelector('[data-fea-sheet="1"]')?.innerText || '');
}

async function dismissQuote(page) {
  await page.evaluate(() => {
    const modal = document.querySelector('[data-modal-fit]');
    if (!modal) return;
    modal.querySelector('button')?.click();
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
  page.setDefaultTimeout(20000);
  const errors = await boot(page);
  await seed(page);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('canvas', { timeout: 40000 });
  await solidReady(page);
  await installProbe(page);
  const ids = await livePartIds(page);
  check(`${vp.name} found Left and Right by name`, !!(ids.left && ids.right), JSON.stringify(ids));
  const idA = ids.left;
  const idB = ids.right;
  if (!idA || !idB) return;
  await page.locator('[data-analyze-chip]').click();
  await page.locator('[data-fea-sheet="1"]').waitFor({ timeout: 8000 });
  await domClick(page, '[data-fea-target="fixture"]');
  await page.waitForTimeout(700);

  let targets = await partTargets(page);
  const active = () => targets.find((part) => part.id === 'active' && part.faces?.length)
    || targets.find((part) => part.id === 'active');
  const other = () => targets.find((part) => part.id === idB);
  if (!(active()?.faces?.length && other()?.faces?.length)) {
    await page.locator('[aria-label="View snaps"]').click().catch(() => {});
    await page.locator('[aria-label="Snap to Isometric"]').click().catch(() => {});
    await page.waitForTimeout(500);
    targets = await partTargets(page);
  }
  check(`${vp.name} both parts project`, !!(active()?.faces?.length && other()?.faces?.length), JSON.stringify(targets.map((part) => ({
    id: part.id,
    faces: part.faces?.length || 0,
  }))));

  let fixturePoint = null;
  for (const point of active()?.faces || []) {
    await tap(page, vp.touch, point);
    await page.waitForTimeout(250);
    if (await attr(page, '[data-fea-fixture-count]', 'data-fea-fixture-count') === '1') {
      fixturePoint = point;
      break;
    }
  }
  await dismissQuote(page);
  check(`${vp.name} fixture lands on the analyzed part`, !!fixturePoint, await listText(page));

  targets = await partTargets(page);
  const beforeOther = other()?.overlays || 0;
  const beforeActive = active()?.overlays || 0;
  check(
    `${vp.name} only the analyzed part has an overlay`,
    beforeActive >= 1 && beforeOther === 0,
    `active=${beforeActive} other=${beforeOther}`,
  );

  const blue = fixturePoint ? await sampleAt(page, fixturePoint) : null;
  const fixtureTab = await page.locator('[data-fea-target="fixture"]').evaluate((el) => getComputedStyle(el).backgroundColor).catch(() => '');
  const fixtureSwatch = await page.locator('[data-fea-swatch="fixture"]').first().evaluate((el) => getComputedStyle(el).backgroundColor).catch(() => '');
  check(`${vp.name} fixture overlay pixel is blue`, isBlue(blue), describe(blue));
  check(`${vp.name} fixture chip is blue`, fixtureTab === 'rgb(59, 130, 246)' && fixtureSwatch === 'rgb(59, 130, 246)', `tab=${fixtureTab} swatch=${fixtureSwatch}`);

  const errorsBefore = errors.length;
  const selectedBefore = await selectedPart(page);
  const fixturesBefore = await attr(page, '[data-fea-fixture-count]', 'data-fea-fixture-count');
  let hitOther = false;
  for (const point of other()?.faces || []) {
    hitOther = true;
    await tap(page, vp.touch, point);
    await page.waitForTimeout(200);
  }
  if (other()?.center) {
    hitOther = true;
    await tap(page, vp.touch, other().center);
    await page.waitForTimeout(200);
  }
  await dismissQuote(page);
  targets = await partTargets(page);
  const selectedAfter = await selectedPart(page);
  const fixturesAfter = await attr(page, '[data-fea-fixture-count]', 'data-fea-fixture-count');
  const pageErrors = errors.slice(errorsBefore).filter((line) => !line.startsWith('console '));
  check(`${vp.name} off-study tap hits the other part`, hitOther);
  check(`${vp.name} off-study tap does not throw`, pageErrors.length === 0, pageErrors.join(' | '));
  check(
    `${vp.name} off-study tap leaves the study part selected`,
    selectedAfter === selectedBefore && selectedAfter !== idB,
    `before=${selectedBefore} after=${selectedAfter}`,
  );
  check(
    `${vp.name} off-study tap does not add a fixture`,
    fixturesBefore === '1' && fixturesAfter === '1',
    `before=${fixturesBefore} after=${fixturesAfter}`,
  );
  check(
    `${vp.name} off-study tap does not paint the other part`,
    (other()?.overlays || 0) === 0 && (active()?.overlays || 0) >= 1,
    `active=${active()?.overlays} other=${other()?.overlays}`,
  );
  const listOnA = await listText(page);
  check(`${vp.name} other part's study row stays hidden`, !listOnA.includes('1, 2, 3'), listOnA.slice(0, 240));
  await page.screenshot({ path: join(SHOT_DIR, `fea-analyze-playtest-${vp.name}-crash.png`) });

  check(`${vp.name} switch to the other part`, await domClick(page, `[data-part-row="${idB}"]`));
  await page.waitForTimeout(600);
  const onB = await listText(page);
  const selectedB = await selectedPart(page);
  targets = await partTargets(page);
  check(`${vp.name} switching parts shows only that part's rows`, selectedB === idB && onB.includes('1, 2, 3'), `selected=${selectedB} ${onB.slice(0, 240)}`);
  check(
    `${vp.name} switching parts drops the previous overlays`,
    (active()?.overlays || 0) === 0 && (targets.find((part) => part.id === idA)?.overlays || 0) === 0,
    JSON.stringify(targets.map((part) => ({ id: part.id, overlays: part.overlays }))),
  );

  check(`${vp.name} switch back`, await domClick(page, `[data-part-row="${idA}"]`));
  await page.waitForTimeout(600);
  await page.locator('[data-fea-sheet="1"]').waitFor({ timeout: 8000 }).catch(() => {});
  if (!(await page.locator('[data-fea-sheet="1"]').count())) {
    await page.locator('[data-analyze-chip]').click().catch(() => {});
    await page.locator('[data-fea-sheet="1"]').waitFor({ timeout: 8000 }).catch(() => {});
  }
  const backText = await listText(page);
  const backCount = await attr(page, '[data-fea-fixture-count]', 'data-fea-fixture-count');
  check(
    `${vp.name} the analyzed part's fixture returns alone`,
    (await selectedPart(page)) === idA && backCount === '1' && !backText.includes('1, 2, 3'),
    `count=${backCount} ${backText.slice(0, 240)}`,
  );

  targets = await partTargets(page);
  await domClick(page, '[data-fea-target="force"]');
  await page.waitForTimeout(200);
  let loadPoint = null;
  for (const point of (active()?.faces || []).filter((point) => point.key !== fixturePoint?.key)) {
    await tap(page, vp.touch, point);
    await page.waitForTimeout(250);
    if (await attr(page, '[data-fea-load-count]', 'data-fea-load-count') === '1') {
      loadPoint = point;
      break;
    }
  }
  const yellow = loadPoint ? await sampleAt(page, loadPoint) : null;
  const scanned = await scanColors(page);
  const forceTab = await page.locator('[data-fea-target="force"]').evaluate((el) => getComputedStyle(el).backgroundColor).catch(() => '');
  const loadSwatch = await page.locator('[data-fea-swatch="load"]').first().evaluate((el) => getComputedStyle(el).backgroundColor).catch(() => '');
  check(
    `${vp.name} load overlay pixel is yellow`,
    isYellow(yellow) || (scanned?.yellowN || 0) >= 8,
    `${describe(yellow)} scan=${JSON.stringify(scanned)}`,
  );
  check(
    `${vp.name} fixture overlay pixel stays blue`,
    isBlue(blue) || (scanned?.blueN || 0) >= 8,
    `${describe(blue)} scan=${JSON.stringify(scanned)}`,
  );
  check(`${vp.name} load chip is yellow`, forceTab === 'rgb(234, 179, 8)' && loadSwatch === 'rgb(234, 179, 8)', `tab=${forceTab} swatch=${loadSwatch}`);
  check(
    `${vp.name} overlay materials are blue and yellow`,
    (yellow?.colors || []).includes('3b82f6') && (yellow?.colors || []).includes('eab308'),
    describe(yellow),
  );
  await page.screenshot({ path: join(SHOT_DIR, `fea-analyze-playtest-${vp.name}-colors.png`) });
  const realErrors = errors.filter((line) => !line.startsWith('console ') || line.includes('[FEA]'));
  check(`${vp.name} no page errors`, realErrors.length === 0, realErrors.slice(0, 4).join(' | '));
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
console.log('\nFEA analyze playtest: ok');

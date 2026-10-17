#!/usr/bin/env node
/* global window, document */
/**
 * Artur's LoftZilla part, the script as saved (scripts/golden/fixtures/LoftZilla.js).
 * One face tap on a fillet band selects the whole G1 fillet chain:
 * calls (1) r=4, (2) r=4.83 and (4) r=4.83 are one band; call (3) r=1.98
 * on the loft junction is its own band. Flats, the loft wall, the hole,
 * and a real crease stay out.
 *
 * Worker path matches the other face goldens. When Chrome is present, the
 * same script is run in the picker and screenshots go to GOLDEN_SHOT_DIR
 * or the system temp dir.
 */
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSolidGeometry } from '../../src/utils/partSolidCache.js';
import { resolveViewportFaceClick } from '../../src/utils/selectFace.js';
import { loadSandbox } from './scs_sandbox.mjs';

let failed = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`);
  }
}

const script = readFileSync(new URL('./fixtures/LoftZilla.js', import.meta.url), 'utf8');
const { exec } = await loadSandbox();
console.log('LoftZilla fillet bands (verbatim fixture)');
const payload = await exec(script);
const solid = buildSolidGeometry(payload.mesh);
const geometry = solid.geometry;
const pos = geometry.attributes.position.array;
const ix = geometry.index.array;
const src = geometry.userData.triSource;
const nTri = ix.length / 3;

function triOf(t) {
  const v = [0, 1, 2].map((k) => {
    const i = ix[t * 3 + k];
    return [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
  });
  const a = [v[1][0] - v[0][0], v[1][1] - v[0][1], v[1][2] - v[0][2]];
  const b = [v[2][0] - v[0][0], v[2][1] - v[0][1], v[2][2] - v[0][2]];
  const n = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const L = Math.hypot(...n) || 1;
  return {
    n: n.map((x) => x / L),
    area: L / 2,
    c: [0, 1, 2].map((k) => (v[0][k] + v[1][k] + v[2][k]) / 3),
  };
}
const T = Array.from({ length: nTri }, (_, t) => triOf(t));
const axis = (n) => n.some((x) => Math.abs(Math.abs(x) - 1) < 1e-4);
function areaOf(list) {
  let a = 0;
  for (const t of list) a += T[t].area;
  return a;
}
function click(seed) {
  return resolveViewportFaceClick({
    geometry,
    seedFaceIndex: seed,
    faceNormal: T[seed].n,
    clickCount: 1,
    faceIDs: solid.faceIDs,
  });
}
function largest(list) {
  return list.reduce((b, t) => (T[t].area > T[b].area ? t : b), list[0]);
}
function collect(pred) {
  const out = [];
  for (let t = 0; t < nTri; t++) if (T[t].area > 1e-4 && pred(T[t], t)) out.push(t);
  return out;
}

const loftA = [4.634159, 2.780495, 11.230769];
const loftB = [10, 6, 30];
function distLoftEdge(p) {
  const e = loftB.map((x, k) => x - loftA[k]);
  const w = p.map((x, k) => x - loftA[k]);
  const u = (w[0] * e[0] + w[1] * e[1] + w[2] * e[2]) / (e[0] ** 2 + e[1] ** 2 + e[2] ** 2);
  return { u, d: Math.hypot(...w.map((x, k) => x - u * e[k])) };
}

// Box fillets. Fillet 1's arc is cut into strips by the later wraps; the
// strips sit at y≈11–15, z≈6–10. The +X / −X wraps include the vertical edge.
const boxFillet = (t) => !axis(t.n) && t.c[2] < 10.2 && t.c[2] > -6 && (
  (t.c[1] > 11 && t.c[1] < 15.05 && Math.abs(t.c[0]) < 16)
  || (t.c[0] > 15.2 && t.c[1] > -8)
  || (t.c[0] < -15.2 && t.c[1] > -8)
);
const regions = {
  '1 front': (t) => boxFillet(t) && t.c[1] > 13.2 && Math.abs(t.c[0]) < 8 && t.c[2] < 9.2,
  '2 vertical': (t) => boxFillet(t) && t.c[0] > 17 && t.c[1] > 13 && t.c[2] < 2 && t.c[2] > -8,
  '2 corner': (t) => boxFillet(t) && t.c[0] > 16.5 && t.c[1] > 12 && t.c[2] > 6.5 && t.c[2] < 9.5,
  '2 top': (t) => boxFillet(t) && t.c[0] > 16.5 && t.c[1] < 5 && t.c[1] > -8 && t.c[2] > 7,
  '4 vertical': (t) => boxFillet(t) && t.c[0] < -17 && t.c[1] > 13 && t.c[2] < 2 && t.c[2] > -8,
  '4 corner': (t) => boxFillet(t) && t.c[0] < -16.5 && t.c[1] > 12 && t.c[2] > 6.5 && t.c[2] < 9.5,
  '4 top': (t) => boxFillet(t) && t.c[0] < -16.5 && t.c[1] < 5 && t.c[1] > -8 && t.c[2] > 7,
};

const bandTris = collect(boxFillet);
const picks = {};
for (const [name, pred] of Object.entries(regions)) {
  const members = collect(pred);
  check(`${name} has a tap target`, members.length > 0, `n=${members.length}`);
  if (!members.length) continue;
  const seed = largest(members);
  const r = click(seed);
  picks[name] = r;
  const set = new Set(r.indices);
  const cover = areaOf(members.filter((t) => set.has(t))) / areaOf(members);
  const bandCover = areaOf(bandTris.filter((t) => set.has(t))) / areaOf(bandTris);
  check(`${name} tap covers that part of the band`, cover > 0.98, `cover=${(cover * 100).toFixed(1)}%`);
  check(`${name} tap covers the whole box-fillet chain`, bandCover > 0.98, `chain=${(bandCover * 100).toFixed(1)}% of ${areaOf(bandTris).toFixed(1)}`);
  const flat = r.indices.filter((t) => axis(T[t].n) && T[t].area > 1 && (src?.[t] ?? 0) >= 0);
  const loft = r.indices.filter((t) => T[t].c[2] > 12 && T[t].area > 1e-3);
  const hole = r.indices.filter((t) => Math.hypot(T[t].c[0], T[t].c[2] + 2) < 2.2 && T[t].c[1] > 10);
  check(`${name} tap leaves flats out`, flat.length === 0, `flat=${flat.length}`);
  check(`${name} tap leaves the loft out`, loft.length === 0, `loft=${loft.length}`);
  check(`${name} tap leaves the hole out`, hole.length === 0, `hole=${hole.length}`);
}

const names = Object.keys(picks);
if (names.length > 1) {
  const base = new Set(picks[names[0]].indices);
  for (const name of names.slice(1)) {
    const set = picks[name].indices;
    const same = set.length === base.size && set.every((t) => base.has(t));
    check(`${name} tap is the same chain as ${names[0]}`, same, `n=${set.length} vs ${base.size}`);
  }
}

// Loft-junction fillet, call (3). Its own band; the loft wall stays out.
const fillet3 = collect((t, i) => {
  if (src?.[i] >= 0 || axis(t.n)) return false;
  const { u, d } = distLoftEdge(t.c);
  return u > 0.35 && u < 0.65 && d < 1.4 && t.c[2] > 15 && t.c[2] < 24;
});
check('fillet 3 has a tap target on the loft junction', fillet3.length > 0, `n=${fillet3.length}`);
if (fillet3.length) {
  const seed = fillet3.reduce((b, t) => (distLoftEdge(T[t].c).d < distLoftEdge(T[b].c).d ? t : b), fillet3[0]);
  const r = click(seed);
  const set = new Set(r.indices);
  const cover = areaOf(fillet3.filter((t) => set.has(t))) / areaOf(fillet3);
  const a = areaOf(r.indices);
  const wall = r.indices.filter((t) => distLoftEdge(T[t].c).d > 2.6 && T[t].area > 1e-4);
  const box = r.indices.filter((t) => boxFillet(T[t]) && T[t].area > 1e-3);
  const hole = r.indices.filter((t) => Math.hypot(T[t].c[0], T[t].c[2] + 2) < 2.2 && T[t].c[1] > 10);
  check('fillet 3 tap covers that junction band', cover > 0.98, `cover=${(cover * 100).toFixed(1)}%`);
  check('fillet 3 tap is fillet-sized, not the loft wall', a > 30 && a < 55, `area=${a.toFixed(1)}`);
  check('fillet 3 tap leaves the loft wall out', wall.length === 0, `wall=${wall.length}`);
  check('fillet 3 tap leaves the box fillets out', box.length === 0, `box=${box.length}`);
  check('fillet 3 tap leaves the hole out', hole.length === 0, `hole=${hole.length}`);
}

const bottom = collect((t) => t.n[2] < -0.9999 && Math.abs(t.c[2] + 10) < 0.05);
check('the box bottom is one flat', bottom.length > 10, `n=${bottom.length}`);
if (bottom.length) {
  const r = click(largest(bottom));
  const curved = r.indices.filter((t) => !axis(T[t].n) && T[t].area > 0.05);
  check('a flat tap on the box bottom stays off the fillets', curved.length === 0, `curved=${curved.length}`);
}

if (failed) {
  console.log(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nLoftZilla worker checks passed');

const shotDir = process.env.GOLDEN_SHOT_DIR || join(tmpdir(), 'surfcad-golden-shots');
if (process.env.LOFTZILLA_PICKER === '1') {
  const { spawn } = await import('node:child_process');
  const { existsSync, mkdirSync } = await import('node:fs');
  const { chromium } = await import('playwright-core');
  const { attachConsentPresetToBrowser } = await import('./lib/presetConsentInit.mjs');
  const exe = [process.env.CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => p && existsSync(p));
  if (!exe) {
    console.log('picker shots: no Chrome, worker checks already passed');
    process.exit(0);
  }
  mkdirSync(shotDir, { recursive: true });
  const PORT = Number(process.env.SMOKE_PORT || 5199);
  const server = spawn('npx', ['vite', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], {
    cwd: new URL('../../', import.meta.url).pathname,
    stdio: 'ignore',
    detached: true,
  });
  const stop = () => { try { process.kill(-server.pid, 'SIGTERM'); } catch { /* gone */ } };
  try {
    const t0 = Date.now();
    let up = false;
    while (Date.now() - t0 < 40000) {
      try {
        const res = await fetch(`http://127.0.0.1:${PORT}/`);
        if (res.ok) { up = true; break; }
      } catch { /* retry */ }
      await new Promise((r) => setTimeout(r, 250));
    }
    check('picker dev server started', up);
    if (!up) process.exit(1);
    const browser = await chromium.launch({
      executablePath: exe,
      args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
    });
    attachConsentPresetToBrowser(browser);
    try {
      for (const [suffix, width, height] of [['desktop', 1280, 900], ['mobile', 390, 844]]) {
        const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
        await page.route('**/api/auth/me', (route) => route.fulfill({
          status: 200, contentType: 'application/json', body: JSON.stringify({ authenticated: false }),
        }));
        await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load', timeout: 45000 });
        await page.waitForFunction(() => window.__VIEWPORT__?.ready?.() && window.__MANIFOLD_CONTEXT__?.isReady, null, { timeout: 40000 });
        await page.evaluate(async (src) => { await window.__VIEWPORT__.executeScript(src); }, script);
        await page.waitForFunction(() => window.__VIEWPORT__.stageVerifyFraming?.().tris > 1000, null, { timeout: 20000 });
        const faceBtn = page.locator('[aria-label="Face pick mode"]');
        if (await faceBtn.count() && await faceBtn.getAttribute('aria-pressed') !== 'true') await faceBtn.click();
        const logs = [];
        page.on('console', (msg) => logs.push(msg.text()));
        await page.evaluate(() => window.__VIEWPORT__.stageFit({ az: 55, el: 22, margin: 1.3 }));
        await page.waitForTimeout(200);
        const point = await page.evaluate(() => {
          const cam = window.__VIEWPORT__.stageCamera();
          const list = [...document.querySelectorAll('canvas')].map((c) => {
            const r = c.getBoundingClientRect();
            return { x: r.x, y: r.y, width: r.width, height: r.height, area: r.width * r.height };
          }).sort((a, b) => b.area - a.area);
          const rect = list[0];
          const world = [18.5, 14.2, 0];
          const px = cam.position[0]; const py = cam.position[1]; const pz = cam.position[2];
          const tx = cam.target[0]; const ty = cam.target[1]; const tz = cam.target[2];
          let zx = px - tx; let zy = py - ty; let zz = pz - tz;
          const zl = Math.hypot(zx, zy, zz) || 1;
          zx /= zl; zy /= zl; zz /= zl;
          const ux = cam.up[0]; const uy = cam.up[1]; const uz = cam.up[2];
          let xx = uy * zz - uz * zy; let xy = uz * zx - ux * zz; let xz = ux * zy - uy * zx;
          const xl = Math.hypot(xx, xy, xz) || 1;
          xx /= xl; xy /= xl; xz /= xl;
          const yx = zy * xz - zz * xy; const yy = zz * xx - zx * xz; const yz = zx * xy - zy * xx;
          const dx = world[0] - px; const dy = world[1] - py; const dz = world[2] - pz;
          const cx = dx * xx + dy * xy + dz * xz;
          const cy = dx * yx + dy * yy + dz * yz;
          const cz = dx * zx + dy * zy + dz * zz;
          const t = Math.tan((cam.fov * Math.PI) / 180 / 2);
          const ndcX = (cx / -cz) / (t * cam.aspect);
          const ndcY = (cy / -cz) / t;
          return {
            x: rect.x + ((ndcX + 1) / 2) * rect.width,
            y: rect.y + ((1 - ndcY) / 2) * rect.height,
          };
        });
        await page.mouse.click(point.x, point.y);
        await page.waitForTimeout(500);
        const faceLog = logs.find((line) => line.includes('[Face Selection]'));
        const count = Number((faceLog || '').match(/(\d+) triangles/)?.[1] || 0);
        check(`${suffix} picker tap selects the box-fillet chain`, count > 2000, faceLog || 'no face log');
        const file = join(shotDir, `loftzilla-fillet-band-${suffix}.png`);
        await page.screenshot({ path: file });
        console.log(`  shot ${file}`);
        await page.close();
      }
    } finally {
      await browser.close().catch(() => {});
    }
  } finally {
    stop();
  }
}
if (failed) {
  console.log(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nAll LoftZilla fillet-band checks passed');
process.exit(0);

#!/usr/bin/env node
/**
 * Bike acceptance PR 4: named views frame the whole assembly as placed (or
 * the selected part), camera_set with position + target never rolls, and a
 * screenshot is centered on the target with nothing cropped. Vite dev server;
 * Chrome from CHROME_PATH or the usual paths.
 */
/* global document, window, Image */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { attachConsentPresetToBrowser } from './lib/presetConsentInit.mjs';

const PORT = Number(process.env.SMOKE_PORT || 4351);
const APP_URL = `http://127.0.0.1:${PORT}/?agent=1`;
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
    console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`);
  }
}

const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!exe) {
  console.log('agent camera framing golden: no system Chrome found — set CHROME_PATH. Skipping.');
  process.exit(0);
}

const server = spawn('npx', ['vite', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort', '--logLevel', 'error'], {
  cwd: new URL('../../', import.meta.url).pathname,
  stdio: 'ignore',
  detached: true,
});
let stopped = false;
const stop = () => {
  if (stopped) return;
  stopped = true;
  try { process.kill(-server.pid, 'SIGTERM'); } catch { /* gone */ }
};
process.on('exit', stop);
process.on('SIGINT', () => { stop(); process.exit(130); });

async function waitForServer() {
  for (let i = 0; i < 120; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/`);
      if (res.ok) return true;
    } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function agentCall(page, name, args) {
  return page.evaluate(async ({ name, argsJson }) => window.surfcad.call(name, argsJson), {
    name,
    argsJson: JSON.stringify(args ?? {}),
  });
}

const near = (a, b, tol) => Math.abs(a - b) <= tol;

/** Where the model's pixels sit in a PNG: centroid and whether they touch an edge. */
async function modelPixels(page, dataUrl) {
  return page.evaluate(async (url) => {
    const img = new Image();
    await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = url; });
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    // The viewport ground is #1e1e1e; anything clearly brighter is the model.
    let n = 0; let sx = 0; let sy = 0; let minX = Infinity; let minY = Infinity; let maxX = -1; let maxY = -1;
    for (let y = 0; y < canvas.height; y += 1) {
      for (let x = 0; x < canvas.width; x += 1) {
        const i = (y * canvas.width + x) * 4;
        const lum = (data[i] + data[i + 1] + data[i + 2]) / 3;
        if (lum < 60) continue;
        n += 1; sx += x; sy += y;
        if (x < minX) minX = x; if (y < minY) minY = y; if (x > maxX) maxX = x; if (y > maxY) maxY = y;
      }
    }
    return {
      width: canvas.width, height: canvas.height, count: n,
      cx: n ? sx / n : null, cy: n ? sy / n : null, minX, minY, maxX, maxY,
    };
  }, dataUrl);
}

// Two parts: a 40 mm cube at the origin and a 20 mm cube placed 200 mm along +X.
const CUBE40 = 'let part = Manifold.cube([40, 40, 40], true);\nreturn part;\n';
const CUBE20 = 'let part = Manifold.cube([20, 20, 20], true);\nreturn part;\n';

console.log('agent camera framing golden');
if (!(await waitForServer())) {
  console.log('  ❌ dev server did not start');
  stop();
  process.exit(1);
}

const browser = await chromium.launch({
  executablePath: exe,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader'],
});
attachConsentPresetToBrowser(browser);
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const pageErrors = [];
page.on('pageerror', (err) => pageErrors.push(err.message));
await page.route('**/api/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
await page.route('**/api/auth/me', (route) => route.fulfill({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({ authenticated: true, user: { _id: 'user-camera-framing', email: 'agent@test.local' } }),
}));
await page.route('**/api/config', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));

await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(
  () => typeof window.surfcad?.call === 'function' && !document.querySelector('[data-app-loading]'),
  { timeout: 120000 },
);
await page.waitForSelector('[data-cad-run]', { state: 'attached', timeout: 120000 });

const created = await agentCall(page, 'create_assembly', {});
check('create_assembly', created.ok === true, JSON.stringify(created));
const baseId = (await agentCall(page, 'parts', {})).result?.activeId;
const base = await agentCall(page, 'set_script', { part_id: baseId, source: CUBE40 });
check('base cube', base.ok === true && base.result?.ok === true, JSON.stringify(base.result?.errors || base.error));
const far = await agentCall(page, 'create_part', { name: 'Far', script: CUBE20, position: [200, 0, 0] });
check('far cube at x = 200', far.ok === true && typeof far.result?.partId === 'string', JSON.stringify(far));
const farId = far.result?.partId;
await agentCall(page, 'set_active_part', { part_id: baseId });
await agentCall(page, 'run', {});
await page.waitForTimeout(600);
// A parts-row pick leaves a body highlight (that part is "selected"); clear it
// so the named views frame the whole assembly.
await agentCall(page, 'select_clear', {});

// Named views frame the whole assembly as placed: the target is between the cubes.
const front = await agentCall(page, 'camera_set', { view: 'front' });
check('camera_set front', front.ok === true, JSON.stringify(front));
const camFront = (await agentCall(page, 'camera', {})).result;
check('front view targets the assembly center (x ≈ 100), not the active part', camFront?.target && near(camFront.target[0], 100, 15), JSON.stringify(camFront?.target));
const iso = await agentCall(page, 'camera_set', { view: 'iso' });
check('camera_set iso', iso.ok === true, JSON.stringify(iso));
const camIso = (await agentCall(page, 'camera', {})).result;
check('iso view targets the assembly center too', camIso?.target && near(camIso.target[0], 100, 15), JSON.stringify(camIso?.target));
const shotIso = await agentCall(page, 'screenshot', { format: 'png' });
check('screenshot iso', shotIso.ok === true && typeof shotIso.result?.dataUrl === 'string', JSON.stringify(shotIso.error));
const pxIso = await modelPixels(page, shotIso.result.dataUrl);
check('iso screenshot shows both cubes, nothing cropped', pxIso.count > 500 && pxIso.minX > 2 && pxIso.minY > 2 && pxIso.maxX < pxIso.width - 3 && pxIso.maxY < pxIso.height - 3, JSON.stringify(pxIso));
check('iso screenshot is centered on the target', near(pxIso.cx, pxIso.width / 2, pxIso.width * 0.12) && near(pxIso.cy, pxIso.height / 2, pxIso.height * 0.12), JSON.stringify(pxIso));

// A selected part is framed on its own, as placed.
const selected = await agentCall(page, 'select_parts', { part_ids: [farId] });
check('select_parts far', selected.ok === true, JSON.stringify(selected));
const isoFar = await agentCall(page, 'camera_set', { view: 'iso' });
check('camera_set iso with a selected part', isoFar.ok === true, JSON.stringify(isoFar));
const camFar = (await agentCall(page, 'camera', {})).result;
check('the selected part is framed at its placed position (x ≈ 200)', camFar?.target && near(camFar.target[0], 200, 5), JSON.stringify(camFar?.target));
await agentCall(page, 'select_clear', {});
await agentCall(page, 'set_active_part', { part_id: baseId });

// camera_set with position + target from a high oblique angle: level horizon.
const oblique = await agentCall(page, 'camera_set', { position: [400, -500, 700], target: [100, 0, 0] });
check('camera_set position + target', oblique.ok === true, JSON.stringify(oblique));
const camOblique = (await agentCall(page, 'camera', {})).result;
const q = camOblique?.quaternion;
const rightZ = q ? (2 * (q[0] * q[2] - q[3] * q[1])) : NaN; // z of the camera's +X axis
check('a level horizon: the camera right axis has no Z', Number.isFinite(rightZ) && Math.abs(rightZ) < 0.02, JSON.stringify({ rightZ, quaternion: q }));
const shotOblique = await agentCall(page, 'screenshot', { format: 'png' });
const pxOblique = await modelPixels(page, shotOblique.result.dataUrl);
check('oblique screenshot is centered on the target', near(pxOblique.cx, pxOblique.width / 2, pxOblique.width * 0.15) && near(pxOblique.cy, pxOblique.height / 2, pxOblique.height * 0.15), JSON.stringify(pxOblique));
const upArg = await agentCall(page, 'camera_set', { position: [400, -500, 700], target: [100, 0, 0], up: [0, 0, 1] });
check('camera_set accepts up', upArg.ok === true, JSON.stringify(upArg));
const badUp = await agentCall(page, 'camera_set', { position: [400, -500, 700], target: [100, 0, 0], up: [1, 2] });
check('camera_set refuses a malformed up', badUp.ok === false && badUp.error?.code === 'bad_args', JSON.stringify(badUp));

// A screenshot with a feature card open is still centered on the target.
await agentCall(page, 'camera_set', { view: 'iso' });
const tree = await agentCall(page, 'feature_tree', {});
const chip = (tree.result?.features || [])[0];
if (chip) {
  const opened = await agentCall(page, 'open_feature', { id: chip.id });
  check('open_feature (card up)', opened.ok === true, JSON.stringify(opened));
  await page.waitForTimeout(900);
  const shotCard = await agentCall(page, 'screenshot', { format: 'png' });
  const pxCard = await modelPixels(page, shotCard.result.dataUrl);
  check('screenshot with a card open is still centered, nothing cropped', pxCard.count > 500 && near(pxCard.cx, pxCard.width / 2, pxCard.width * 0.15) && near(pxCard.cy, pxCard.height / 2, pxCard.height * 0.15) && pxCard.minY > 2 && pxCard.maxY < pxCard.height - 3, JSON.stringify(pxCard));
  await agentCall(page, 'cancel_feature', {});
}

check('no page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));

await browser.close();
stop();
if (failed) {
  console.log(`agent camera framing golden: FAIL (${failed})`);
  process.exit(1);
}
console.log('agent camera framing golden: ok');

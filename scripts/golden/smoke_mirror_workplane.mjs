#!/usr/bin/env node
/**
 * Mirror one body across a user workplane.
 *
 * The rail Mirror button opens a chip like Move: double-click a body, pick
 * XY / YZ / ZX, a planar face, or a workplane, then the green check writes
 * one mirror() and replaces a previous Mirror block. X writes nothing.
 * The copy is a cyan ghost until Confirm.
 *
 * Static checks, the compose helpers, the kernel through sandboxWorker, then
 * the app: double-click the offset body, pick the custom workplane, confirm,
 * and one undo. Chrome from CHROME_PATH or the usual paths.
 */
/* global document, window */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { register } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { attachConsentPresetToBrowser } from './lib/presetConsentInit.mjs';
import { MIRROR_BEGIN, MIRROR_END } from '../../src/utils/helperPaletteSnippets.js';
import { composeMirrorCommit, emptyMirrorState } from '../../src/utils/mirrorMode.js';
import { hasFeatureBlock } from '../../src/utils/featureBlockId.js';

const PORT = Number(process.env.SMOKE_PORT || 4374);
const APP_URL = `http://127.0.0.1:${PORT}/?agent=1`;
const SHOT_DIR = process.env.GOLDEN_SHOT_DIR || join(tmpdir(), 'surfcad-golden');
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].filter(Boolean);

const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

let failed = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed += 1;
    console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`);
  }
}
const near = (a, b, tol = 0.05) => Math.abs(a - b) <= tol;

console.log('mirror workplane golden');

const PART = `
const a = Manifold.cube([20, 20, 20], true);
const b = Manifold.cube([10, 10, 10], true).translate([20, 0, 0]);
let part = Manifold.compose([a, b]);
const wp1 = { center: [30, 0, 0], normal: [1, 0, 0], x: [0, 1, 0], y: [0, 0, 1] };
`;

{
  const view = read('src/components/Viewport.jsx');
  const app = read('src/App.jsx');
  const chip = read('src/components/MirrorModeChip.jsx');
  const palette = read('src/components/HelperInsertPalette.jsx');
  const guide = read('docs/ui-style-guide.md');
  const runtime = read('src/lib/surfcad/runtime.js');
  const mirrorFn = runtime.slice(runtime.indexOf('function _mirrorJoin('), runtime.indexOf('function array3D('));
  check('Mirror button enters mirror mode', /item\.id === 'mirror'/.test(palette) && /onEnterMirrorMode/.test(palette));
  check('mirror uses the shared feature card',
    /<FeatureSheet\b/.test(chip) && /fullLeft/.test(chip)
    && /onCancel=\{onDismiss\}/.test(chip) && /onConfirm=\{onConfirm\}/.test(chip)
    && /mirrorMode && mode !== 'game'/.test(view));
  check('App writes composeMirrorCommit on both viewports',
    /composeMirrorCommit/.test(app) && (app.match(/onCommitMirror=\{handleCommitMirror\}/g) || []).length === 2);
  check('double-click selects the mirror body', /const mirroring = !!mirrorModeRef\.current/.test(view)
    && /resolveMirrorBodyAt\(/.test(view));
  check('a workplane click sets the mirror plane', /mirrorPlaneFromHit\(/.test(view)
    && /mirrorPlanesOpen/.test(view)
    && /the ray misses the solid/.test(view));
  check('dismiss does not commit', /onDismiss=\{exitMirrorMode\}/.test(view) && !/onDismiss=\{[^}]*onCommitMirror/.test(view));
  check('a refused confirm stays open and toasts', /softFailMirror/.test(view) && /showShellToast\(gate\.message\)/.test(view.slice(view.indexOf('const acceptMirror'))));
  check('mirror no longer swallows a failed union', /could not be joined/.test(mirrorFn) && !/catch\s*\{\s*return mirrored/.test(mirrorFn));
  check('ui-style-guide documents MirrorModeChip', /MirrorModeChip/.test(guide));
  const needBody = composeMirrorCommit(PART, { ...emptyMirrorState(), planeSource: 'yz' });
  check('confirm without a body is refused', needBody.ok === false);
  const named = composeMirrorCommit(`${PART}return part;\n`, {
    ...emptyMirrorState(), target: { at: [20, 0, 0] }, planeSource: 'workplane',
    workplane: { id: 'wp1', name: 'wp1', center: [30, 0, 0], normal: [1, 0, 0] },
  });
  check('compose emits one mirror across the workplane', named.ok === true
    && hasFeatureBlock(named.buffer, MIRROR_BEGIN, MIRROR_END) && /\/\/ --- mirror begin id=mirror1 ---/.test(named.buffer)
    && /mirror\(part, \{ center: \[30, 0, 0\], normal: \[1, 0, 0\] \}, true, \{ bodies: \[\{ at: \[20, 0, 0\] \}\] \}\)/.test(named.buffer));
}

const pending = new Map();
let msgId = 0;
const workerSelf = {
  onmessage: null,
  postMessage(msg) {
    if (msg.type === 'loaded') return;
    const waiter = pending.get(msg.id);
    if (!waiter) return;
    pending.delete(msg.id);
    if (msg.type === 'error') waiter.reject(new Error(msg.payload?.message || 'worker error'));
    else waiter.resolve(msg);
  },
};
globalThis.self = workerSelf;
function send(type, payload = {}) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    Promise.resolve().then(() => {
      if (!workerSelf.onmessage) {
        reject(new Error('sandboxWorker handler missing'));
        return;
      }
      workerSelf.onmessage({ data: { type, payload, id } });
    });
  });
}
register('./manifold-resolve-hook.mjs', import.meta.url);
await import('../../src/workers/sandboxWorker.js');
await send('init');
async function exec(script) {
  const res = await send('execute', { script, importedModels: {}, memoryLimitMB: 512 });
  return res.payload;
}
async function execFail(script) {
  try {
    await exec(script);
    return null;
  } catch (e) {
    return e.message || String(e);
  }
}

{
  const base = await exec(`${PART}\nreturn part;`);
  check('two bodies before the mirror', near(base.volume, 9000, 1), `vol=${base.volume}`);
  const mirrored = await exec(`
    ${PART}
    part = mirror(part, { center: [30, 0, 0], normal: [1, 0, 0] }, true, { bodies: [{ at: [20, 0, 0] }] });
    return part;
  `);
  const box = mirrored.boundingBox;
  check('the offset body is copied across the workplane and the other body stays',
    near(mirrored.volume, 10000, 1) && near(box.min[0], -10) && near(box.max[0], 45, 0.5),
    `vol=${mirrored.volume} bbox=${JSON.stringify(box)}`);
  const old = await exec(`
    let part = Manifold.cube([20, 10, 10], true).translate([20, 0, 0]);
    part = mirror(part, 'yz', true);
    return part;
  `);
  check('the old string plane still mirrors and keeps the original',
    near(old.volume, 4000, 1) && old.boundingBox.min[0] < -20 && old.boundingBox.max[0] > 20,
    `vol=${old.volume}`);
  const bad = await execFail(`${PART}\npart = mirror(part, { center: [30, 0, 0] }, true);\nreturn part;`);
  check('a plane without a normal throws', !!bad && /mirror: plane must be/.test(bad), bad || 'no throw');
  const miss = await execFail(`${PART}\npart = mirror(part, 'yz', true, { bodies: [{ at: [7, 7, 7] }] });\nreturn part;`);
  check('a point that is not a centroid fails as mirror', !!miss && /^mirror:/.test(miss), miss || 'no throw');
}

const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!exe) {
  console.log('mirror workplane golden: no system Chrome found — set CHROME_PATH. Skipping the app checks.');
} else {
  mkdirSync(SHOT_DIR, { recursive: true });
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
  const waitForServer = async () => {
    for (let i = 0; i < 120; i += 1) {
      try {
        if ((await fetch(`http://127.0.0.1:${PORT}/`)).ok) return true;
      } catch { /* not yet */ }
      await new Promise((r) => setTimeout(r, 500));
    }
    return false;
  };
  if (!(await waitForServer())) {
    check('dev server started', false, APP_URL);
  } else {
    const browser = await chromium.launch({
      executablePath: exe,
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader'],
    });
    attachConsentPresetToBrowser(browser);
    const openPage = async (viewport) => {
      const page = await browser.newPage({ viewport });
      const pageErrors = [];
      page.on('pageerror', (err) => pageErrors.push(err.message));
      await page.route('**/api/**', (route) => route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }));
      await page.route('**/api/auth/me', (route) => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ authenticated: true, user: { _id: 'user-mirror-workplane', email: 'agent@test.local' } }),
      }));
      await page.route('**/api/config', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
      await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForFunction(
        () => typeof window.surfcad?.call === 'function' && !document.querySelector('[data-app-loading]'),
        { timeout: 120000 },
      );
      await page.waitForSelector('[data-cad-run]', { state: 'attached', timeout: 120000 });
      const agentCall = (name, args) => page.evaluate(
        async ({ name, argsJson }) => window.surfcad.call(name, argsJson),
        { name, argsJson: JSON.stringify(args ?? {}) },
      );
      return { page, pageErrors, agentCall };
    };
    const dblclickBody = async (page, at) => {
      const pt = await page.evaluate((world) => window.__VIEWPORT__?.stageProject?.(world) ?? null, at);
      if (!pt) return null;
      await page.mouse.click(pt.x, pt.y);
      await page.waitForTimeout(40);
      await page.mouse.click(pt.x, pt.y);
      await page.waitForTimeout(400);
      return pt;
    };
    try {
      const { page, pageErrors, agentCall } = await openPage({ width: 1280, height: 800 });
      const created = await agentCall('create_assembly', {});
      check('create_assembly', created.ok === true, JSON.stringify(created));
      const partId = (await agentCall('parts', {})).result?.activeId;
      const seeded = await agentCall('set_script', { part_id: partId, source: `${PART}return part;\n` });
      check('part with a workplane builds', seeded.ok === true && near(seeded.result?.status?.volume, 9000, 1), JSON.stringify(seeded.result?.status || seeded.error));
      await page.waitForTimeout(400);

      const rail = page.locator('[data-ui-action="mirror"]').first();
      await rail.waitFor({ state: 'visible', timeout: 15000 });
      await rail.click();
      const card = page.locator('[data-mirror-mode]');
      await card.waitFor({ state: 'visible', timeout: 10000 });
      check('the card opens with Confirm disabled', (await card.getAttribute('data-mirror-confirm')) === 'disabled');
      check('XY YZ ZX are on the card', (await page.locator('[data-mirror-plane-choice="xy"]').count()) === 1
        && (await page.locator('[data-mirror-plane-choice="yz"]').count()) === 1
        && (await page.locator('[data-mirror-plane-choice="xz"]').count()) === 1);
      const wpBtn = page.locator('[data-mirror-workplane]').filter({ hasText: 'wp1' });
      check('the user workplane is a plane choice', (await wpBtn.count()) === 1);

      await page.locator('[data-mirror-mode] button[aria-label="Cancel"]').click();
      await page.waitForTimeout(200);
      check('X closes the card and writes nothing', (await page.locator('[data-mirror-mode]').count()) === 0
        && !/mirror\(/.test((await agentCall('get_script', {})).result?.source || ''));

      await rail.click();
      await card.waitFor({ state: 'visible', timeout: 10000 });
      const picked = await dblclickBody(page, [20, 0, 0]);
      check('double-click hit the offset body', !!picked, JSON.stringify(picked));
      await page.locator('[data-mirror-clear]').waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
      check('double-click selects the body', (await page.locator('[data-mirror-clear]').count()) === 1);
      const place = await page.evaluate(() => {
        const card = document.querySelector('[data-mirror-mode]');
        const pane = card?.closest('.viewport-shell');
        if (!card || !pane) return null;
        const c = card.getBoundingClientRect();
        const p = pane.getBoundingClientRect();
        return { gap: c.left - p.left, cardLeft: c.left, paneLeft: p.left };
      });
      check('desktop card is 10px from the pane, the left rail hidden',
        place && Math.abs(place.gap - 10) < 4, JSON.stringify(place));
      await page.screenshot({ path: join(SHOT_DIR, 'mirror-desktop-body.png') });
      console.log(`  shot ${join(SHOT_DIR, 'mirror-desktop-body.png')}`);
      const planePt = await page.evaluate((world) => window.__VIEWPORT__?.stageProject?.(world) ?? null, [30, 0, 0]);
      if (planePt) await page.mouse.click(planePt.x, planePt.y);
      await page.waitForTimeout(200);
      if ((await card.getAttribute('data-mirror-plane')) !== 'workplane') {
        await wpBtn.click();
      }
      check('the workplane is the mirror plane', (await card.getAttribute('data-mirror-plane')) === 'workplane');
      check('Confirm is enabled once the body and the plane are set', (await card.getAttribute('data-mirror-confirm')) === 'enabled');
      const ghost = await page.evaluate(() => window.__VIEWPORT__?.worldBounds?.('mirror-preview') ?? null);
      check('the copy is previewed before Confirm', !!ghost && ghost.max[0] > 30, JSON.stringify(ghost));
      await page.screenshot({ path: join(SHOT_DIR, 'mirror-desktop-preview.png') });
      await page.screenshot({ path: join(SHOT_DIR, 'mirror-after-desktop.png') });
      console.log(`  shot ${join(SHOT_DIR, 'mirror-desktop-preview.png')}`);

      await page.locator('[data-feature-card-confirm]').click();
      let solid = null;
      let runError = '';
      for (let i = 0; i < 40; i += 1) {
        solid = await page.evaluate(() => window.__VIEWPORT__?.worldBounds?.('active-solid') ?? null);
        runError = await page.evaluate(() => document.querySelector('[data-execution-error]')?.textContent || '');
        if (runError) break;
        if (solid && solid.max[0] > 40) break;
        await page.waitForTimeout(250);
      }
      const script = (await agentCall('get_script', {})).result?.source || '';
      check('Confirm wrote one mirror across wp1 and rebuilt',
        /mirror\(part, \{ center: \[30, 0, 0\], normal: \[1, 0, 0\] \}/.test(script)
        && (script.match(/\bmirror\s*\(/g) || []).length === 1
        && !runError
        && !!solid && near(solid.min[0], -10, 0.5) && near(solid.max[0], 45, 0.5),
        `bounds=${JSON.stringify(solid)} error=${runError} ${script.slice(-240)}`);
      check('the card closed after a successful confirm', (await page.locator('[data-mirror-mode]').count()) === 0);
      await page.screenshot({ path: join(SHOT_DIR, 'mirror-desktop-result.png') });
      console.log(`  shot ${join(SHOT_DIR, 'mirror-desktop-result.png')}`);
      const undone = await agentCall('undo', {});
      const afterUndo = (await agentCall('get_script', {})).result?.source || '';
      check('one undo removes the mirror', undone.ok === true && !/\bmirror\s*\(/.test(afterUndo)
        && near(undone.result?.status?.volume, 9000, 1), JSON.stringify(undone.result?.status || undone.error));
      check('no page errors (desktop)', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
      await page.close();

      const phone = await openPage({ width: 390, height: 844 });
      await phone.agentCall('create_assembly', {});
      const phonePart = (await phone.agentCall('parts', {})).result?.activeId;
      await phone.agentCall('set_script', { part_id: phonePart, source: `${PART}return part;\n` });
      const phoneButton = phone.page.locator('[data-ui-action="mirror"]').first();
      await phoneButton.waitFor({ state: 'attached', timeout: 15000 });
      await phoneButton.scrollIntoViewIfNeeded();
      await phoneButton.click();
      const phoneCard = phone.page.locator('[data-mirror-mode]');
      await phoneCard.waitFor({ state: 'visible', timeout: 10000 });
      const cardBox = await phoneCard.boundingBox();
      check('the phone card is on screen', !!cardBox && cardBox.y > 40 && cardBox.y + cardBox.height <= 844, JSON.stringify(cardBox));
      check('the phone card lists the workplane', (await phone.page.locator('[data-mirror-workplane]').count()) >= 1);
      await phone.page.screenshot({ path: join(SHOT_DIR, 'mirror-after-phone.png') });
      console.log(`  shot ${join(SHOT_DIR, 'mirror-after-phone.png')}`);
      check('no page errors (phone)', phone.pageErrors.length === 0, phone.pageErrors.slice(0, 3).join(' | '));
      await phone.page.close();
    } finally {
      await browser.close();
      stop();
    }
  }
}

if (failed) {
  console.log(`mirror workplane golden: FAIL (${failed})`);
  process.exit(1);
}
console.log('mirror workplane golden: ok');

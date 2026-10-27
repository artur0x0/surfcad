#!/usr/bin/env node
/**
 * Rotate one body about an axis through a point.
 *
 * The left-rail Rotate button sits directly below Move and opens a chip
 * (axis X / Y / Z / Face / Vector, angle in degrees, center = body centroid
 * or a typed point). Confirm writes one
 *   part = rotateAbout(part, axis, angleDeg, center, { bodies: [{ at }] })
 * and replaces a previous Rotate block. rotateAbout() is Manifold.transform
 * of the named body, with the same decompose / centroid / compose split
 * move() uses. The turned body is a cyan ghost until Confirm, posed with the
 * part like the Move ghost.
 *
 * Static checks, the compose helpers, the kernel through sandboxWorker, then
 * the app on the Vite dev server: insert_rotate through the bridge, the strip
 * chip, edit_feature and undo, the rail button and card at 1280 and 390, and
 * the ghost on a placed part. Chrome from CHROME_PATH or the usual paths.
 */
/* global document, window */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { register } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BufferAttribute, BufferGeometry } from 'three';
import { chromium } from 'playwright-core';
import { attachConsentPresetToBrowser } from './lib/presetConsentInit.mjs';
import { paletteRailSections } from '../../src/utils/helperPaletteSnippets.js';
import { composeRotateCommit, emptyRotateState, rotatePreviewMap } from '../../src/utils/rotateMode.js';
import { meshBodyComponents } from '../../src/utils/cutMode.js';

const PORT = Number(process.env.SMOKE_PORT || 4368);
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
const vecNear = (a, b, tol = 0.05) => Array.isArray(a) && Array.isArray(b) && a.length >= 3 && b.length >= 3
  && a.slice(0, 3).every((v, i) => near(v, b[i], tol));
const fmt = (b) => (b ? `[${b.min.map((v) => v.toFixed(2))}]..[${b.max.map((v) => v.toFixed(2))}]` : 'null');

console.log('rotate feature golden');

// ── Static: wiring mirrors Move ─────────────────────────────────────────
{
  const view = read('src/components/Viewport.jsx');
  const app = read('src/App.jsx');
  const chip = read('src/components/RotateModeChip.jsx');
  const palette = read('src/components/HelperInsertPalette.jsx');
  const strip = read('src/components/FeatureStrip.jsx');
  const guide = read('docs/ui-style-guide.md');
  const runtime = read('src/lib/surfcad/runtime.js');
  for (const layout of ['cad', 'game']) {
    const ids = paletteRailSections(layout).find((s) => s.key === 'Transforms').items.map((i) => i.id);
    check(`${layout} Rotate sits directly below Move`, ids[ids.indexOf('move') + 1] === 'rotate', ids.join(','));
  }
  check('Rotate button enters rotate mode', /item\.id === 'rotate'/.test(palette) && /onEnterRotateMode/.test(palette)
    && /rotate:\s*RotateCw/.test(palette));
  check('the strip has a Rotate chip icon', /rotate:\s*RotateCw/.test(strip));
  check('rotate uses the shared feature card',
    /<FeatureSheet\b/.test(chip) && /compact=\{compact\}/.test(chip)
    && /onCancel=\{onDismiss\}/.test(chip) && /onConfirm=\{onConfirm\}/.test(chip)
    && /rotateMode && mode !== 'game'/.test(view));
  check('angle, axis vector, and center are NumberFields', /id="angle"/.test(chip) && /vecField\('ax'/.test(chip) && /id="cx"/.test(chip)
    && /NumberField/.test(chip) && /type="range"/.test(read('src/components/controls/popupUI.jsx')));
  check('App writes composeRotateCommit on both viewports',
    /composeRotateCommit/.test(app) && (app.match(/onCommitRotate=\{handleCommitRotate\}/g) || []).length === 2);
  const paint = view.slice(view.indexOf('const paintRotatePreview = useCallback'), view.indexOf('const syncRotateTargetFromMesh'));
  check('the rotate ghost is anchored to the active part before scene.add',
    paint.indexOf('anchorToActivePart(mesh)') > 0 && paint.indexOf('anchorToActivePart(mesh)') < paint.indexOf('scene.add(mesh)')
    && /name = 'rotate-preview'/.test(paint));
  const sync = view.slice(view.indexOf('const syncAnchoredOverlays = useCallback'), view.indexOf('const syncAnchoredOverlays = useCallback') + 4000);
  check('rotatePreviewRef is re-posed by syncAnchoredOverlays', /rotatePreviewRef\.current,/.test(sync));
  check('dismiss does not commit', /onDismiss=\{exitRotateMode\}/.test(view) && !/onDismiss=\{[^}]*onCommitRotate/.test(view));
  check('rotateAbout is a registered helper with the move body split',
    /function rotateAbout\(manifold, axis, angleDeg/.test(runtime) && /\n {2}rotateAbout,\n/.test(runtime)
    && /_moveSelected\(manifold, bodies, options\.bodies\)/.test(runtime.slice(runtime.indexOf('function rotateAbout(')))
    && /body\.transform\(matrix\)/.test(runtime));
  check('ui-style-guide documents RotateModeChip', /RotateModeChip/.test(guide));
}

// ── Compose ─────────────────────────────────────────────────────────────
{
  const need = composeRotateCommit('let part = Manifold.cube([10, 10, 10], true);', { ...emptyRotateState(), angle: 30 });
  check('confirm without a body is refused', need.ok === false);
  const first = composeRotateCommit('let part = Manifold.cube([10, 10, 10], true);', {
    ...emptyRotateState(), target: { at: [1, 2, 3] }, axis: 'z', angle: 30,
  });
  check('emits one named-body rotateAbout', first.ok === true
    && first.buffer.includes("part = rotateAbout(part, 'z', 30, null, { bodies: [{ at: [1, 2, 3] }] });")
    && /\/\/ --- rotate begin id=rotate1 ---/.test(first.buffer) && /\/\/ --- rotate end id=rotate1 ---/.test(first.buffer));
  const again = composeRotateCommit(first.buffer, {
    ...emptyRotateState(), target: { at: [1, 2, 3] }, axis: 'x', angle: -10, centerMode: 'custom', center: [5, 0, 0],
  });
  check('a second confirm replaces the previous Rotate block', again.ok === true
    && (again.buffer.match(/\brotateAbout\s*\(/g) || []).length === 1
    && again.buffer.includes("rotateAbout(part, 'x', -10, [5, 0, 0], { bodies: [{ at: [1, 2, 3] }] });"));
  const ghost = rotatePreviewMap({ ...emptyRotateState(), target: { at: [0, 0, 0] }, angle: 90 }, '');
  check('the preview turns right-handed about the body', !!ghost && vecNear(ghost([1, 0, 0]), [0, 1, 0], 1e-9));
}

// ── Kernel ──────────────────────────────────────────────────────────────
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
/** exec that reports a thrown script as a failed check instead of killing the golden. */
async function tryExec(script) {
  try {
    return { out: await exec(script) };
  } catch (e) {
    return { err: e.message || String(e) };
  }
}
function geometryFromMesh(mesh) {
  const np = mesh.numProp || 3;
  const src = mesh.vertProperties;
  const nVert = Math.floor(src.length / np);
  const positions = new Float32Array(nVert * 3);
  for (let i = 0; i < nVert; i++) {
    positions[i * 3] = src[i * np];
    positions[i * 3 + 1] = src[i * np + 1];
    positions[i * 3 + 2] = src[i * np + 2];
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setIndex(new BufferAttribute(new Uint32Array(mesh.triVerts), 1));
  return geometry;
}

// A 20 mm cube at the origin and a 10 × 20 × 10 box at x = 40.
const TWO = `
const a = Manifold.cube([20, 20, 20], true);
const b = Manifold.cube([10, 20, 10], true).translate([40, 0, 0]);
let part = Manifold.compose([a, b]);
`;

{
  const base = await exec(`${TWO}\nreturn part;`);
  const geom = geometryFromMesh(base.mesh);
  const bodies = meshBodyComponents(geom.attributes.position, geom.index);
  check('two bodies', bodies.length === 2, `n=${bodies.length}`);
  const box = bodies.find((b) => b.at[0] > 20);
  check('viewport centroid names the box', !!box && vecNear(box.at, [40, 0, 0]), JSON.stringify(bodies.map((b) => b.at)));
  const commit = composeRotateCommit(TWO, { ...emptyRotateState(), target: { at: box.at }, axis: 'z', angle: 90 });
  const turned = await tryExec(`
    ${commit.buffer.replace(/\n*return\s+part\s*;?\s*$/i, '')}
    const parts = part.decompose();
    if (parts.length !== 2) throw new Error('bodies ' + parts.length);
    const boxes = parts.map((p) => p.boundingBox());
    const stayed = boxes.find((bb) => bb.min[0] < 0);
    const spun = boxes.find((bb) => bb.min[0] > 0);
    if (!stayed || !spun) throw new Error(JSON.stringify(boxes));
    if (Math.abs(stayed.min[0] + 10) > 1e-2 || Math.abs(stayed.max[1] - 10) > 1e-2) throw new Error('stayed ' + JSON.stringify(stayed));
    // 10 × 20 turned 90° about z through its own centroid: 20 wide in x, 10 in y, same center.
    if (Math.abs(spun.min[0] - 30) > 1e-2 || Math.abs(spun.max[0] - 50) > 1e-2) throw new Error('spun x ' + JSON.stringify(spun));
    if (Math.abs(spun.min[1] + 5) > 1e-2 || Math.abs(spun.max[1] - 5) > 1e-2) throw new Error('spun y ' + JSON.stringify(spun));
    return part;
  `);
  check('only the named body turns; volume is unchanged', !turned.err && Math.abs(turned.out.volume - 10000) < 1e-2, turned.err || `vol=${turned.out?.volume}`);

  // 10 (x) × 20 (y) at x = 40, swung 90° about z through the origin: it lands
  // across +Y, x −10..10 (the old y extent) and y 35..45 (the old x extent).
  const about = await tryExec(`
    ${TWO}
    part = rotateAbout(part, 'z', 90, [0, 0, 0], { bodies: [{ at: [40, 0, 0] }] });
    const parts = part.decompose();
    const moved = parts.map((p) => p.boundingBox()).find((bb) => bb.max[1] > 20);
    if (!moved) throw new Error('box did not swing to +Y ' + JSON.stringify(parts.map((p) => p.boundingBox())));
    if (Math.abs(moved.min[1] - 35) > 1e-2 || Math.abs(moved.max[1] - 45) > 1e-2) throw new Error('swing y ' + JSON.stringify(moved));
    if (Math.abs(moved.min[0] + 10) > 1e-2 || Math.abs(moved.max[0] - 10) > 1e-2) throw new Error('swing x ' + JSON.stringify(moved));
    return part;
  `);
  check('a typed center swings the body about that point', !about.err && Math.abs(about.out.volume - 10000) < 1e-2, about.err || `vol=${about.out?.volume}`);

  const one = await tryExec(`
    let part = Manifold.cube([20, 10, 10], true);
    part = rotateAbout(part, [0, 0, 2], 90, null, { bodies: [{ at: [0, 0, 0] }] });
    return part;
  `);
  check('one body turns about a vector axis', !one.err && near(one.out.boundingBox.min[0], -5, 1e-3) && near(one.out.boundingBox.max[1], 10, 1e-3), one.err || JSON.stringify(one.out?.boundingBox));
  const still = await tryExec(`${TWO}\npart = rotateAbout(part, 'z', 0, null, { bodies: [{ at: [40, 0, 0] }] });\nreturn part;`);
  check('a zero angle leaves both bodies', !still.err && Math.abs(still.out.volume - 10000) < 1e-2 && near(still.out.boundingBox.max[1], 10, 1e-3), still.err || '');
  const badAxis = await execFail(`${TWO}\npart = rotateAbout(part, 'w', 10, null, { bodies: [{ at: [40, 0, 0] }] });\nreturn part;`);
  check('a bad axis fails as rotateAbout', !!badAxis && /^rotateAbout: axis/.test(badAxis), badAxis || 'no throw');
  const miss = await execFail(`${TWO}\npart = rotateAbout(part, 'z', 10, null, { bodies: [{ at: [7, 7, 7] }] });\nreturn part;`);
  check('a point that is not a centroid fails as rotateAbout', !!miss && /^rotateAbout:/.test(miss) && !/^(cut|move):/.test(miss), miss || 'no throw');
  const unnamed = await execFail('let part = Manifold.cube([10, 10, 10], true);\npart = rotateAbout(part, \'z\', 10);\nreturn part;');
  check('rotateAbout names the body', !!unnamed && /name one body/.test(unnamed), unnamed || 'no throw');
}

// ── App ─────────────────────────────────────────────────────────────────
const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!exe) {
  console.log('rotate feature golden: no system Chrome found — set CHROME_PATH. Skipping the app checks.');
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
  process.on('SIGINT', () => { stop(); process.exit(130); });
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
        body: JSON.stringify({ authenticated: true, user: { _id: 'user-rotate-feature', email: 'agent@test.local' } }),
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
    try {
      const { page, pageErrors, agentCall } = await openPage({ width: 1280, height: 800 });
      const worldBounds = (name) => page.evaluate((n) => window.__VIEWPORT__?.worldBounds?.(n) ?? null, name);
      const waitForBounds = async (name, ms = 15000) => {
        const t0 = Date.now();
        while (Date.now() - t0 < ms) {
          const box = await worldBounds(name);
          if (box) return box;
          await page.waitForTimeout(150);
        }
        return null;
      };
      const sortByX = (bodies) => [...bodies].sort((p, q) => p.at[0] - q.at[0]);

      const created = await agentCall('create_assembly', {});
      check('create_assembly', created.ok === true, JSON.stringify(created));
      const partId = (await agentCall('parts', {})).result?.activeId;
      const seeded = await agentCall('set_script', { part_id: partId, source: `${TWO}return part;\n` });
      check('two-body part', seeded.ok === true && seeded.result?.status?.bodyCount === 2 && near(seeded.result?.status?.volume, 10000, 0.1), JSON.stringify(seeded.result?.status));
      const bodies0 = sortByX((await agentCall('list_bodies', {})).result?.bodies || []);
      check('list_bodies lists the cube and the box', bodies0.length === 2 && vecNear(bodies0[0].at, [0, 0, 0]) && vecNear(bodies0[1].at, [40, 0, 0]), JSON.stringify(bodies0));
      const box = bodies0[1];

      // Nothing named, nothing selected: a clear error, nothing written.
      const before = (await agentCall('get_script', {})).result?.source;
      const unnamed = await agentCall('insert_rotate', { axis: 'z', angle: 90 });
      check('insert_rotate with no body is no_body', unnamed.ok === false && unnamed.error?.code === 'no_body', JSON.stringify(unnamed));
      check('nothing was written', (await agentCall('get_script', {})).result?.source === before);

      // body_index turns the box about its own centroid: same centroids, the bbox follows.
      const turned = await agentCall('insert_rotate', { body_index: box.index, axis: 'z', angle: 90 });
      check('insert_rotate body_index', turned.ok === true && turned.result?.ok === true && turned.result?.usedSelection === false,
        JSON.stringify(turned.result?.errors || turned.error));
      const st1 = turned.result?.status;
      check('volume unchanged and the bbox follows the turn (x to 50, y to 10)',
        !!st1 && near(st1.volume, 10000, 0.1) && near(st1.bbox?.max?.[0], 50) && near(st1.bbox?.max?.[1], 10),
        JSON.stringify({ volume: st1?.volume, bbox: st1?.bbox }));
      const bodies1 = sortByX((await agentCall('list_bodies', {})).result?.bodies || []);
      check('both centroids stay (the box turned about its own)', bodies1.length === 2 && vecNear(bodies1[1].at, [40, 0, 0]) && vecNear(bodies1[0].at, [0, 0, 0]), JSON.stringify(bodies1));
      const script1 = (await agentCall('get_script', {})).result?.source || '';
      check('the script has one marked rotateAbout naming the box', /\/\/ --- rotate begin/.test(script1)
        && /rotateAbout\(part, 'z', 90, null, \{ bodies: \[\{ at: \[40, 0, 0\] \}\] \}\)/.test(script1), script1.slice(-220));

      // The strip chip, edit_feature, confirm, undo.
      const tree = await agentCall('feature_tree', {});
      const chip = (tree.result?.features || []).find((f) => f.kind === 'rotate');
      check('feature_tree has the rotate chip', !!chip, JSON.stringify((tree.result?.features || []).map((f) => f.kind)));
      check('the strip shows a Rotate chip', (await page.locator('[data-feature-chip="rotate"]').count()) >= 1);
      const opened = await agentCall('open_feature', { id: chip?.id });
      check('open_feature rotate opens the Rotate card', opened.ok === true, JSON.stringify(opened));
      await page.locator('[data-rotate-mode]').waitFor({ state: 'visible', timeout: 10000 });
      check('the card is seeded with the committed angle', (await page.locator('input[data-popup-number="angle"]').inputValue()) === '90');
      const edited = await agentCall('edit_feature', { params: { angle: 180 } });
      check('edit_feature angle', edited.ok === true, JSON.stringify(edited));
      const confirmed = await agentCall('confirm_feature', {});
      check('confirm_feature rewrote the angle', confirmed.ok === true && confirmed.result?.ok === true, JSON.stringify(confirmed.result?.errors || confirmed.error));
      const script2 = (await agentCall('get_script', {})).result?.source || '';
      check('the block now says 180 and still names the box', /rotateAbout\(part, 'z', 180, null, \{ bodies: \[\{ at: \[40, 0, 0\] \}\] \}\)/.test(script2)
        && (script2.match(/rotateAbout\(/g) || []).length === 1, script2.slice(-220));
      const st2 = (await agentCall('status', {})).result;
      check('180° about its own center restores the original bbox', near(st2?.bbox?.max?.[0], 45) && near(st2?.bbox?.max?.[1], 10), JSON.stringify(st2?.bbox));
      const undone = await agentCall('undo', {});
      check('undo restores the 90° block', undone.ok === true && /rotateAbout\(part, 'z', 90/.test((await agentCall('get_script', {})).result?.source || ''), JSON.stringify(undone.result?.status?.runState));
      const st3 = (await agentCall('status', {})).result;
      check('and the turned bbox', near(st3?.bbox?.max?.[0], 50), JSON.stringify(st3?.bbox));

      // A typed center swings the body: a second block, the box goes to +Y.
      const swung = await agentCall('insert_rotate', { body_index: box.index, axis: 'z', angle: 90, center: [0, 0, 0] });
      check('insert_rotate with a center', swung.ok === true && swung.result?.ok === true, JSON.stringify(swung.result?.errors || swung.error));
      const bodies2 = sortByX((await agentCall('list_bodies', {})).result?.bodies || []);
      check('the box swung to +Y about the origin', bodies2.length === 2 && bodies2.some((b) => vecNear(b.at, [0, 40, 0])), JSON.stringify(bodies2));
      await agentCall('undo', {});

      // The agent's confirm leaves the card up (as for Move); the X closes it
      // and brings the helper rail back.
      const dismissCard = async () => {
        if ((await page.locator('[data-rotate-mode]').count()) > 0) {
          await page.locator('[data-rotate-mode] button[aria-label="Cancel"]').click();
          await page.waitForTimeout(300);
        }
      };
      await dismissCard();

      // The rail button and the card on desktop.
      const railButton = page.locator('[data-ui-action="rotate"]').first();
      await railButton.waitFor({ state: 'visible', timeout: 10000 });
      const moveBox = await page.locator('[data-ui-action="move"]').first().boundingBox();
      const rotateBox = await railButton.boundingBox();
      check('Rotate renders directly below Move on the rail', !!moveBox && !!rotateBox && rotateBox.y > moveBox.y && near(rotateBox.x, moveBox.x, 2)
        && rotateBox.y - moveBox.y < moveBox.height * 2.5, JSON.stringify({ moveBox, rotateBox }));
      await railButton.click();
      const card = page.locator('[data-rotate-mode]');
      await card.waitFor({ state: 'visible', timeout: 10000 });
      check('the Rotate card opens from the rail with Confirm disabled until a body is picked',
        (await card.getAttribute('data-rotate-confirm')) === 'disabled');
      check('the card offers X Y Z Face Vector and Body center / Point',
        (await page.locator('[data-rotate-axis]').count()) === 5 && (await page.locator('[data-rotate-center]').count()) === 2);
      await page.locator('[data-rotate-axis="custom"]').click();
      check('Vector shows the axis fields', (await page.locator('[data-rotate-axis-vector]').count()) === 1);
      await page.locator('[data-rotate-center="custom"]').click();
      check('Point shows the center fields', (await page.locator('[data-rotate-center-point]').count()) === 1);
      await page.screenshot({ path: join(SHOT_DIR, 'rotate-card-desktop.png') });
      console.log(`  shot ${join(SHOT_DIR, 'rotate-card-desktop.png')}`);
      await page.locator('[data-rotate-mode] button[aria-label="Cancel"]').click();
      await page.waitForTimeout(200);
      check('X closes the card and writes nothing', (await page.locator('[data-rotate-mode]').count()) === 0
        && /rotateAbout\(part, 'z', 90/.test((await agentCall('get_script', {})).result?.source || ''));

      // The ghost on a placed part: open the committed block, change the
      // angle, and the cyan ghost must sit on the placed part, not at the origin.
      const made = await agentCall('create_part', { name: 'Placed' });
      const placedId = made.result?.partId;
      check('create_part Placed', made.ok === true && typeof placedId === 'string', JSON.stringify(made));
      await agentCall('set_active_part', { part_id: placedId });
      const CUBE = '// --- cube begin ---\nlet part = Manifold.cube([20, 20, 10], true);\n// --- cube end ---\n';
      const write = composeRotateCommit('', { ...emptyRotateState(), target: { at: [0, 0, 0] }, axis: 'z', angle: 10 });
      const placedScript = await agentCall('set_script', { part_id: placedId, source: `${CUBE}${write.buffer}\nreturn part;\n` });
      check('Placed builds with a Rotate block', placedScript.ok === true && placedScript.result?.status?.runState === 'ok', JSON.stringify(placedScript.result?.status));
      const placed = await agentCall('part_set_transform', { part_id: placedId, position: [0, 0, 340], rotation: [0, 0, 30] });
      check('part_set_transform [0,0,340] rz=30', placed.ok === true, JSON.stringify(placed));
      await page.waitForTimeout(500);
      const partBox = await worldBounds('active-solid');
      check('the placed part renders at its pose', !!partBox && near(partBox.min[2], 335) && near(partBox.max[2], 345), fmt(partBox));
      const tree2 = await agentCall('feature_tree', {});
      const chip2 = (tree2.result?.features || []).find((f) => f.kind === 'rotate');
      const opened2 = await agentCall('open_feature', { id: chip2?.id });
      check('open_feature rotate on the placed part', opened2.ok === true, JSON.stringify(opened2));
      await page.locator('[data-rotate-mode]').waitFor({ state: 'visible', timeout: 10000 });
      await page.waitForTimeout(300);
      check('no ghost while the angle equals the committed block', (await worldBounds('rotate-preview')) === null);
      await page.locator('input[data-popup-number="angle"]').fill('55');
      const ghost = await waitForBounds('rotate-preview', 5000);
      const center = (b) => b.min.map((v, i) => (v + b.max[i]) / 2);
      check('the rotate ghost sits on the placed part (same center and height, not at the origin)',
        !!ghost && !!partBox && vecNear(center(ghost), center(partBox), 0.5) && near(ghost.min[2], partBox.min[2]) && near(ghost.max[2], partBox.max[2]) && ghost.min[2] > 300,
        `ghost ${fmt(ghost)} part ${fmt(partBox)}`);
      const replaced = await agentCall('part_set_transform', { part_id: placedId, position: [50, 0, 340] });
      check('part_set_transform while the ghost is live', replaced.ok === true, JSON.stringify(replaced));
      await page.waitForTimeout(400);
      const ghost2 = await worldBounds('rotate-preview');
      check('ghost follows the new placement (+50 in X)', !!ghost2 && !!ghost && near(ghost2.min[0], ghost.min[0] + 50) && near(ghost2.max[2], ghost.max[2]), `${fmt(ghost)} -> ${fmt(ghost2)}`);
      // cancel_feature leaves the Rotate chip the way its X does (MVP 3 edge slice 2/3).
      await agentCall('cancel_feature', {});
      await page.locator('[data-rotate-mode]').waitFor({ state: 'detached', timeout: 5000 });
      await page.waitForTimeout(300);
      check('ghost is gone once Rotate is dismissed', (await worldBounds('rotate-preview')) === null);
      check('Rotate chip is gone', (await page.locator('[data-rotate-mode]').count()) === 0);
      check('no page errors (desktop)', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
      await page.close();

      // Phone: the rail button and the card at 390 wide.
      const phone = await openPage({ width: 390, height: 844 });
      await phone.agentCall('create_assembly', {});
      const phonePart = (await phone.agentCall('parts', {})).result?.activeId;
      await phone.agentCall('set_script', { part_id: phonePart, source: `${TWO}return part;\n` });
      const phoneButton = phone.page.locator('[data-ui-action="rotate"]').first();
      await phoneButton.waitFor({ state: 'attached', timeout: 10000 });
      await phoneButton.scrollIntoViewIfNeeded();
      await phoneButton.click();
      const phoneCard = phone.page.locator('[data-rotate-mode]');
      await phoneCard.waitFor({ state: 'visible', timeout: 10000 });
      const cardBox = await phoneCard.boundingBox();
      check('the phone card is on screen and leaves room above it', !!cardBox && cardBox.y > 80 && cardBox.y + cardBox.height <= 844, JSON.stringify(cardBox));
      await phone.page.screenshot({ path: join(SHOT_DIR, 'rotate-card-phone.png') });
      console.log(`  shot ${join(SHOT_DIR, 'rotate-card-phone.png')}`);
      check('no page errors (phone)', phone.pageErrors.length === 0, phone.pageErrors.slice(0, 3).join(' | '));
      await phone.page.close();
    } finally {
      await browser.close();
      stop();
    }
  }
}

if (failed) {
  console.log(`rotate feature golden: FAIL (${failed})`);
  process.exit(1);
}
console.log('rotate feature golden: ok');

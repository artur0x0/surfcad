#!/usr/bin/env node
/**
 * MVP-1 rendering 1: a tool preview on a placed part lands on that part.
 *
 * A Move ghost, a Move Face preview, Cut pieces and Boolean pieces are all
 * built from the active part's local vertices. The bike session showed the
 * Move ghost 340 mm away from its part: the mesh went to the scene root
 * unposed, so it drew on whichever part sat at the origin. The rule now is
 * the one block previews and sketch strokes already follow: anchor the
 * overlay to the active part (translation and rotation) before it joins the
 * scene, and list it in syncAnchoredOverlays so a placement change re-poses
 * it. A Boolean pick on another part carries that part's own pose.
 *
 * Source checks pin the rule on every preview. Then two parts on the Vite
 * dev server: a cube at the origin (the trap) and a cube placed at
 * [0, 0, 340] and turned 30° about Z. Move and Move Face are opened on the
 * placed part through the agent bridge and the preview's world box is read
 * with the dev-only __VIEWPORT__.worldBounds hook. The Move ghost must be the
 * part's box shifted by the rotated delta; the Move Face preview must share
 * the part's footprint and floor. Chrome from CHROME_PATH or the usual paths.
 */
/* global document, window */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { attachConsentPresetToBrowser } from './lib/presetConsentInit.mjs';
import { composeMoveCommit } from '../../src/utils/moveMode.js';
import { composeMoveFaceCommit } from '../../src/utils/moveFaceMode.js';

const PORT = Number(process.env.SMOKE_PORT || 4353);
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

const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');
const slice = (text, from, to) => {
  const i = text.indexOf(from);
  const j = i < 0 ? -1 : text.indexOf(to, i);
  return i < 0 || j < 0 ? '' : text.slice(i, j);
};

console.log('placed part previews');

// ── Source: every part-frame preview is anchored before it joins the scene ──
{
  const view = read('src/components/Viewport.jsx');
  const movePaint = slice(view, 'const paintMovePreview = useCallback', 'const syncMoveTargetFromMesh');
  const moveFacePaint = slice(view, 'const paintMoveFacePreview = useCallback', 'const ensureMoveFacePreview');
  const cutPaint = slice(view, 'const paintLiveCutPieces = useCallback', 'const ensureLiveCutPreview');
  const boolPaint = slice(view, 'const paintBooleanPieces = useCallback', 'const ensureBooleanPreview');
  const remotePaint = slice(view, 'const paintBooleanRemotePicks = useCallback', 'const removeBooleanPreviewGroup');
  const sync = slice(view, 'const syncAnchoredOverlays = useCallback', 'const [filletToast');
  const anchoredBeforeAdd = (src, target) => {
    const a = src.indexOf(`anchorToActivePart(${target})`);
    const b = src.indexOf(`scene.add(${target})`);
    return a >= 0 && b > a;
  };
  check('Move ghost is anchored to the active part before scene.add', anchoredBeforeAdd(movePaint, 'mesh'), movePaint.slice(-400));
  check('Move Face preview is anchored before scene.add', anchoredBeforeAdd(moveFacePaint, 'mesh'));
  check('Cut pieces preview is anchored before scene.add', anchoredBeforeAdd(cutPaint, 'group'));
  check('Boolean pieces carry the full pose, not position only',
    anchoredBeforeAdd(boolPaint, 'group') && !/group\.position\.copy\(resultRef\.current\.position\)/.test(boolPaint));
  check('Boolean remote picks take that part\'s pose and are tagged for re-posing',
    /applyPartPose\(mesh, \{/.test(remotePaint) && /host\.quaternion/.test(remotePaint)
    && /mesh\.userData\.overlayPartId = pick\.partId/.test(remotePaint)
    && !/mesh\.position\.copy\(host\.position\)/.test(remotePaint));
  for (const ref of ['movePreviewRef', 'moveFacePreviewRef', 'cutPiecesPreviewRef', 'booleanPiecesPreviewRef', 'booleanRemotePicksRef']) {
    check(`syncAnchoredOverlays re-poses ${ref}`, new RegExp(`${ref}\\.current,`).test(sync));
  }
  const probes = slice(view, 'const paintFeaProbes = useCallback', 'useEffect(() => {\n    const draw');
  check('FEA probe markers stay world points (not anchored)', probes.length > 0 && !/anchorToActivePart/.test(probes)
    && /position: probe\.world/.test(read('src/fea/useFeaStudy.js')));
  check('dev hook worldBounds exists for this golden', /worldBounds: \(name\) =>/.test(view) && /new Box3\(\)\.setFromObject\(obj, true\)/.test(view));
  check('architecture.md states the rule', /Tool previews stick to the active part/.test(read('docs/architecture.md')));
}

// ── Browser: Move and Move Face on a placed, rotated part ──
const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!exe) {
  console.log('  (no system Chrome found — set CHROME_PATH. Browser half skipped.)');
} else {
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
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      const pageErrors = [];
      page.on('pageerror', (err) => pageErrors.push(err.message));
      // Catch-all first: a staging backend on :3000 must not leak 401s in.
      await page.route('**/api/**', (route) => route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }));
      await page.route('**/api/auth/me', (route) => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ authenticated: true, user: { _id: 'user-placed-previews', email: 'agent@test.local' } }),
      }));
      await page.route('**/api/config', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));

      const agentCall = (name, args) => page.evaluate(
        async ({ name, argsJson }) => window.surfcad.call(name, argsJson),
        { name, argsJson: JSON.stringify(args ?? {}) },
      );
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
      const near = (a, b, eps = 0.05) => Math.abs(a - b) <= eps;
      const boxNear = (a, b, eps = 0.05) => !!a && !!b
        && [0, 1, 2].every((i) => near(a.min[i], b.min[i], eps) && near(a.max[i], b.max[i], eps));
      const fmt = (b) => (b ? `[${b.min.map((v) => v.toFixed(2))}]..[${b.max.map((v) => v.toFixed(2))}]` : 'null');

      await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForFunction(
        () => typeof window.surfcad?.call === 'function' && !document.querySelector('[data-app-loading]'),
        { timeout: 120000 },
      );
      await page.waitForSelector('[data-cad-run]', { state: 'attached', timeout: 120000 });

      const CUBE = '// --- cube begin ---\nlet part = Manifold.cube([20, 20, 10], true);\n// --- cube end ---\n';
      const created = await agentCall('create_assembly', {});
      check('create_assembly', created.ok === true, JSON.stringify(created));
      const originId = (await agentCall('parts', {})).result?.activeId;
      const origin = await agentCall('set_script', { part_id: originId, source: `${CUBE}return part;\n` });
      check('a cube sits at the origin (the trap an unposed ghost lands on)',
        origin.ok === true && origin.result?.status?.runState === 'ok', JSON.stringify(origin.result?.status));

      const made = await agentCall('create_part', { name: 'Placed' });
      const placedId = made.result?.partId;
      check('create_part Placed', made.ok === true && typeof placedId === 'string', JSON.stringify(made));
      const activated = await agentCall('set_active_part', { part_id: placedId });
      check('set_active_part Placed', activated.ok === true, JSON.stringify(activated));

      // Move: the committed script already moves the body by dz=3, so the
      // chip opens seeded with [0, 0, 3] and a typed dx draws the ghost.
      const moveWrite = composeMoveCommit('', { body: 'part', target: { at: [0, 0, 0] }, dx: 0, dy: 0, dz: 3 });
      const moved = await agentCall('set_script', { part_id: placedId, source: `${CUBE}${moveWrite.buffer}\nreturn part;\n` });
      check('Placed builds with a Move block', moved.ok === true && moved.result?.status?.runState === 'ok', JSON.stringify(moved.result?.status));

      const placed = await agentCall('part_set_transform', { part_id: placedId, position: [0, 0, 340], rotation: [0, 0, 30] });
      check('part_set_transform [0,0,340] rz=30', placed.ok === true, JSON.stringify(placed));
      await page.waitForTimeout(500);
      const partBox = await worldBounds('active-solid');
      const cos30 = Math.cos(Math.PI / 6);
      const sin30 = 0.5;
      const half = 10 * cos30 + 10 * sin30; // a 20×20 square turned 30°
      check('the placed part renders at its pose (z 338..348, footprint ±13.66)',
        !!partBox && near(partBox.min[2], 338) && near(partBox.max[2], 348)
        && near(partBox.min[0], -half) && near(partBox.max[0], half)
        && near(partBox.min[1], -half) && near(partBox.max[1], half),
        fmt(partBox));

      const tree = await agentCall('feature_tree', {});
      const moveChip = (tree.result?.features || []).find((f) => f.kind === 'move');
      check('feature_tree has the move chip', !!moveChip, JSON.stringify(tree.result?.features?.map((f) => f.kind)));
      const opened = await agentCall('open_feature', { id: moveChip?.id });
      check('open_feature move', opened.ok === true, JSON.stringify(opened));
      await page.waitForTimeout(400);
      check('no ghost while the delta equals the committed move', (await worldBounds('move-preview')) === null);

      const dx = page.locator('input[data-popup-number="dx"]');
      await dx.waitFor({ state: 'visible', timeout: 10000 });
      await dx.fill('10');
      const ghost = await waitForBounds('move-preview', 5000);
      const shift = [10 * cos30, 10 * sin30, 0]; // the local +X delta, turned with the part
      const expectedGhost = partBox && {
        min: partBox.min.map((v, i) => v + shift[i]),
        max: partBox.max.map((v, i) => v + shift[i]),
      };
      check('Move ghost = placed part box + rotated delta (not at the origin)',
        boxNear(ghost, expectedGhost), `ghost ${fmt(ghost)} expected ${fmt(expectedGhost)}`);
      check('Move ghost is nowhere near the origin cube', !!ghost && ghost.min[2] > 300, fmt(ghost));

      // A later placement re-poses the live ghost.
      const replaced = await agentCall('part_set_transform', { part_id: placedId, position: [50, 0, 340] });
      check('part_set_transform while the ghost is live', replaced.ok === true, JSON.stringify(replaced));
      await page.waitForTimeout(400);
      const ghost2 = await worldBounds('move-preview');
      check('ghost follows the new placement (+50 in X)',
        !!ghost2 && !!ghost && near(ghost2.min[0], ghost.min[0] + 50) && near(ghost2.max[2], ghost.max[2]),
        `${fmt(ghost)} -> ${fmt(ghost2)}`);
      // cancel_feature ends the agent's edit session and leaves the Move
      // chip the way its X does (MVP 3 edge slice 2/3), which clears the ghost.
      const cancelled = await agentCall('cancel_feature', {});
      check('cancel_feature ends the edit session', cancelled.ok === true, JSON.stringify(cancelled));
      await page.locator('[data-move-mode]').waitFor({ state: 'detached', timeout: 5000 });
      await page.waitForTimeout(300);
      check('ghost is gone once Move is dismissed', (await worldBounds('move-preview')) === null);
      check('Move chip is gone', (await page.locator('[data-move-mode]').count()) === 0);

      // Move Face: open the committed block; the preview is the whole solid
      // with the top face moved, in the part frame. It must share the
      // placed part's footprint and floor.
      await agentCall('part_set_transform', { part_id: placedId, position: [0, 0, 340], rotation: [0, 0, 30] });
      const faceWrite = composeMoveFaceCommit('', {
        body: 'part',
        faces: [{ center: [0, 0, 5], normal: [0, 0, 1] }],
        distance: 5,
      });
      check('composeMoveFaceCommit', faceWrite.ok === true, JSON.stringify(faceWrite));
      const faced = await agentCall('set_script', { part_id: placedId, source: `${CUBE}${faceWrite.buffer}\nreturn part;\n` });
      check('Placed builds with a Move Face block', faced.ok === true && faced.result?.status?.runState === 'ok', JSON.stringify(faced.result?.status));
      await page.waitForTimeout(500);
      const partBox2 = await worldBounds('active-solid');
      check('placed part still at its pose after the rebuild',
        !!partBox2 && near(partBox2.min[2], 335) && near(partBox2.min[0], -half) && near(partBox2.max[1], half), fmt(partBox2));
      const tree2 = await agentCall('feature_tree', {});
      const faceChip = (tree2.result?.features || []).find((f) => f.kind === 'moveFace');
      check('feature_tree has the moveFace chip', !!faceChip, JSON.stringify(tree2.result?.features?.map((f) => f.kind)));
      const opened2 = await agentCall('open_feature', { id: faceChip?.id });
      check('open_feature moveFace', opened2.ok === true, JSON.stringify(opened2));
      const facePreview = await waitForBounds('move-face-preview', 20000);
      check('Move Face preview appears', !!facePreview, fmt(facePreview));
      check('Move Face preview shares the placed part\'s footprint and floor (not the origin)',
        !!facePreview && !!partBox2
        && near(facePreview.min[0], partBox2.min[0]) && near(facePreview.max[0], partBox2.max[0])
        && near(facePreview.min[1], partBox2.min[1]) && near(facePreview.max[1], partBox2.max[1])
        && near(facePreview.min[2], partBox2.min[2])
        && facePreview.max[2] >= partBox2.max[2] - 0.05,
        `preview ${fmt(facePreview)} part ${fmt(partBox2)}`);
      await agentCall('cancel_feature', {});

      check('no page errors', pageErrors.length === 0, pageErrors.join(' | ').slice(0, 300));
    } finally {
      await browser.close();
      stop();
    }
  }
}

if (failed) {
  console.log(`\n${failed} failed`);
  process.exit(1);
}
console.log('\nall passed');

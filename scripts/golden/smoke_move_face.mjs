#!/usr/bin/env node
/**
 * Move Face offsets picked faces along their normals. Adjacent walls extend
 * or trim. Confirm writes one moveFace() and replaces a previous Move Face
 * block. Leaving without Confirm writes nothing. This is not body move().
 *
 * Polish holds fillet, chamfer, then Move Face, then Delete Face. The button
 * is square-arrow-out-up-right. The picker is the Shell sticky tap: add, tap
 * again to remove, Undo, Clear. A double click does not select the body.
 */
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { paletteRailSections } from '../../src/utils/helperPaletteSnippets.js';
import {
  composeMoveFaceCommit,
  toggleMoveFaceSelection,
  popLastMoveFace,
  clearMoveFaces,
  emptyMoveFaceState,
  validateMoveFaceAccept,
} from '../../src/utils/moveFaceMode.js';
import { composeMoveCommit } from '../../src/utils/moveMode.js';

const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

let failed = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`);
  }
}

const TOP = { center: [0, 0, 5], normal: [0, 0, 1] };
const SIDE = { center: [5, 0, 0], normal: [1, 0, 0] };

{
  const view = read('src/components/Viewport.jsx');
  const app = read('src/App.jsx');
  const chip = read('src/components/MoveFaceModeChip.jsx');
  const worker = read('src/workers/sandboxWorker.js') + '\n' + read('src/lib/surfcad/runtime.js');
  const palette = read('src/components/HelperInsertPalette.jsx');
  const arch = read('docs/architecture.md');
  const hi = view.indexOf('const highlightFace = useCallback');
  const note = view.indexOf('Below highlightFace on purpose');
  const paint = view.indexOf('const paintDraftPicks = useCallback');
  const legacy = view.match(/const legacyTap = ([^;]+);/);
  check('Draft callbacks stay below highlightFace', hi >= 0 && note > hi && paint > note);
  check('body Move stays off the legacy tap line', !!legacy && !/moveMode/.test(legacy[1]));
  check('Move Face double click is not the body',
    /legacy: legacyTap \|\| !!moveFaceModeRef\.current/.test(view));
  check('Move Face button is square-arrow-out-up-right',
    /moveFace:\s*SquareArrowOutUpRight/.test(palette)
    && /SquareArrowOutUpRight/.test(palette));
  check('Move Face enters its own mode',
    /item\.id === 'moveFace'/.test(palette) && /onEnterMoveFaceMode/.test(palette));
  for (const layout of ['cad', 'game']) {
    const sections = paletteRailSections(layout);
    const polish = sections.find((s) => s.key === 'Features');
    const ids = polish ? polish.items.map((i) => i.id) : [];
    check(`${layout} Move Face sits in Polish before Delete Face`,
      ids.indexOf('deleteFace') === ids.indexOf('moveFace') + 1
      && ids[0] === 'filletEdges' && ids[1] === 'chamferEdges',
      ids.join(','));
    check(`${layout} Move is the last section`,
      sections[sections.length - 1]?.key === 'Transforms',
      sections.map((s) => s.key).join('|'));
  }
  check('sticky picker has Undo and Clear and no shift',
    /data-move-face-undo/.test(chip) && /data-move-face-clear/.test(chip)
    && /data-move-face-flip/.test(chip) && !/shiftKey/.test(chip));
  check('move face uses the shared feature card',
    /<FeatureSheet\b/.test(chip)
    && /compact=\{compact\}/.test(chip)
    && /onCancel=\{onDismiss\}/.test(chip)
    && /onConfirm=\{onConfirm\}/.test(chip)
    && /moveFaceMode && mode !== 'game'/.test(view));
  check('App writes one composeMoveFaceCommit on both viewports',
    /composeMoveFaceCommit/.test(app)
    && (app.match(/onCommitMoveFace=\{handleCommitMoveFace\}/g) || []).length === 2);
  check('dismiss does not commit',
    /onDismiss=\{exitMoveFaceMode\}/.test(view)
    && !/onDismiss=\{[^}]*onCommitMoveFace/.test(view));
  check('live preview is a clone, not the cached solid',
    /name = 'move-face-preview'/.test(view)
    && /case 'previewMoveFace'/.test(worker)
    && /cachedManifold is not/.test(worker));
  check('moveFace is a helper and not body move',
    /function moveFace\(manifold, faces, distance/.test(worker)
    && /moveFace,/.test(worker));
  check('architecture names the helper, the picker, and the rebuild',
    /`moveFace`/.test(arch)
    && /Move Face/.test(arch)
    && /Maintenance:/.test(arch));
  check('user script is still a direct new Function argument',
    /new Function\(\.\.\.scopeKeys, wrappedScript\)/.test(worker)
    && !/new Function\(\.\.\.scopeKeys, [\s\S]{0,80}function\s*\(/.test(worker));
  check('FILLET_ARC_SEGMENTS and the frame turn stay put',
    /FILLET_ARC_SEGMENTS = 24/.test(read('src/utils/filletAlongPath.js'))
    && /FRAME_DENSIFY_MAX_TURN_DEG = 5/.test(read('src/utils/edgeTangencyField.js')));
}

{
  const cube = 'let part = Manifold.cube([10, 10, 10], true);';
  const need = composeMoveFaceCommit(cube, emptyMoveFaceState());
  check('confirm without a face is refused', need.ok === false);
  const bad = validateMoveFaceAccept({ faces: [TOP], distance: 'nope' });
  check('a non-numeric distance is refused', bad.ok === false);

  const first = composeMoveFaceCommit(cube, {
    body: 'part', faces: [TOP], distance: 4, flip: false,
  });
  check('emits one moveFace', first.ok === true
    && first.buffer.includes('part = moveFace(part, [{ center: [0, 0, 5], normal: [0, 0, 1] }], 4);')
    && (first.buffer.match(/\bmoveFace\s*\(/g) || []).length === 1
    && /\/\/ --- move-face begin id=moveFace1 ---/.test(first.buffer)
    && /\/\/ --- move-face end id=moveFace1 ---/.test(first.buffer)
    && !/\bmove\s*\(/.test(first.buffer),
  first.buffer || first.message);

  const flipped = composeMoveFaceCommit(cube, {
    body: 'part', faces: [TOP], distance: 4, flip: true,
  });
  check('Flip is one call with flip: true', flipped.ok === true
    && (flipped.buffer.match(/\bmoveFace\s*\(/g) || []).length === 1
    && flipped.buffer.includes('{ flip: true }'),
  flipped.buffer || flipped.message);

  const again = composeMoveFaceCommit(first.buffer, {
    body: 'part', faces: [TOP, SIDE], distance: 3, flip: false,
  });
  check('a second confirm replaces the previous Move Face block', again.ok === true
    && (again.buffer.match(/\bmoveFace\s*\(/g) || []).length === 1
    && (again.buffer.match(/\/\/ --- move-face begin id=\w+ ---/g) || []).length === 1
    && again.buffer.includes('normal: [1, 0, 0]')
    && !again.buffer.includes(', 4);'),
  again.buffer || again.message);

  const fillet = `${cube}
// --- fillet-mode begin ---
part = filletAlongPath(part, path1, 3);
// --- fillet-mode end ---`;
  const kept = composeMoveFaceCommit(fillet, {
    body: 'part', faces: [TOP], distance: 2, flip: false,
  });
  check('a fillet block stays in the script', kept.ok === true
    && kept.buffer.includes('// --- fillet-mode begin ---')
    && kept.buffer.includes('filletAlongPath')
    && (kept.buffer.match(/\bmoveFace\s*\(/g) || []).length === 1);

  const bodyMove = composeMoveCommit(cube, {
    body: 'part', target: { at: [0, 0, 0] }, dx: 0, dy: 5, dz: 0,
  });
  const both = composeMoveFaceCommit(bodyMove.buffer, {
    body: 'part', faces: [TOP], distance: 2, flip: false,
  });
  check('a body move() stays beside the face offset', both.ok === true
    && (both.buffer.match(/\bmove\s*\(/g) || []).length === 1
    && (both.buffer.match(/\bmoveFace\s*\(/g) || []).length === 1);

  let picks = emptyMoveFaceState();
  picks = toggleMoveFaceSelection(picks, { ...TOP, indices: [1] });
  picks = toggleMoveFaceSelection(picks, { ...SIDE, indices: [2] });
  check('tap adds a second face', picks.faces.length === 2);
  picks = toggleMoveFaceSelection(picks, TOP);
  check('tap again removes that face', picks.faces.length === 1 && picks.faces[0].normal[0] === 1);
  picks = popLastMoveFace(picks);
  check('Undo drops the last face', picks.faces.length === 0);
  picks = toggleMoveFaceSelection(emptyMoveFaceState(), TOP);
  picks = toggleMoveFaceSelection(picks, SIDE);
  check('Clear drops the faces', clearMoveFaces(picks).faces.length === 0);
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

function near(a, b, eps = 1e-2) {
  return Math.abs(Number(a) - Number(b)) <= eps;
}

const cubeScript = 'let part = Manifold.cube([10, 10, 10], true);\nreturn part;';

{
  const base = await exec(cubeScript);
  check('a centered cube is ±5',
    near(base.boundingBox.min[2], -5) && near(base.boundingBox.max[2], 5)
    && near(base.volume, 1000),
    JSON.stringify(base.boundingBox));

  const up = await exec(`
    let part = Manifold.cube([10, 10, 10], true);
    part = moveFace(part, [{ center: [0, 0, 5], normal: [0, 0, 1] }], 4);
    return part;
  `);
  check('offset along +Z grows only that side',
    near(up.boundingBox.min[0], -5) && near(up.boundingBox.max[0], 5)
    && near(up.boundingBox.min[1], -5) && near(up.boundingBox.max[1], 5)
    && near(up.boundingBox.min[2], -5) && near(up.boundingBox.max[2], 9)
    && near(up.volume, 1400) && near(up.surfaceArea, 760),
    `vol=${up.volume} area=${up.surfaceArea} ${JSON.stringify(up.boundingBox)}`);

  const down = await exec(`
    let part = Manifold.cube([10, 10, 10], true);
    part = moveFace(part, [{ center: [0, 0, 5], normal: [0, 0, 1] }], 4, { flip: true });
    return part;
  `);
  check('Flip trims the same face back along its normal',
    near(down.boundingBox.min[2], -5) && near(down.boundingBox.max[2], 1)
    && near(down.boundingBox.min[0], -5) && near(down.boundingBox.max[0], 5)
    && near(down.volume, 600),
    `vol=${down.volume} ${JSON.stringify(down.boundingBox)}`);

  const corner = await exec(`
    let part = Manifold.cube([10, 10, 10], true);
    part = moveFace(part, [
      { center: [0, 0, 5], normal: [0, 0, 1] },
      { center: [5, 0, 0], normal: [1, 0, 0] },
    ], 3);
    return part;
  `);
  check('two adjacent faces extend the shared corner',
    near(corner.boundingBox.min[0], -5) && near(corner.boundingBox.max[0], 8)
    && near(corner.boundingBox.min[2], -5) && near(corner.boundingBox.max[2], 8)
    && near(corner.boundingBox.min[1], -5) && near(corner.boundingBox.max[1], 5)
    && near(corner.volume, 1690),
    `vol=${corner.volume} ${JSON.stringify(corner.boundingBox)}`);

  const tooFar = await execFail(`
    let part = Manifold.cube([10, 10, 10], true);
    part = moveFace(part, [{ center: [0, 0, 5], normal: [0, 0, 1] }], 20, { flip: true });
    return part;
  `);
  check('an offset that cannot stay closed throws',
    !!tooFar && /^moveFace:/.test(tooFar), tooFar || 'no throw');

  await exec(cubeScript);
  const preview = await send('previewMoveFace', {
    faces: [{ center: [0, 0, 5], normal: [0, 0, 1] }],
    distance: 4,
    flip: false,
  });
  const src = preview.payload.mesh.vertProperties;
  const np = preview.payload.mesh.numProp || 3;
  let zMax = -Infinity;
  let zMin = Infinity;
  for (let i = 0; i < src.length; i += np) {
    zMin = Math.min(zMin, src[i + 2]);
    zMax = Math.max(zMax, src[i + 2]);
  }
  const cached = await send('stageGetLastMesh');
  check('preview shows the offset and leaves the cached solid',
    near(zMax, 9) && near(zMin, -5)
    && near(cached.payload.boundingBox.max[2], 5)
    && near(cached.payload.boundingBox.min[2], -5),
    `preview z ${zMin}..${zMax} cached ${JSON.stringify(cached.payload.boundingBox)}`);
}

{
  const two = `
    const left = Manifold.cube([10, 10, 10], true).translate([-20, 0, 0]);
    const right = Manifold.cube([10, 10, 10], true).translate([20, 0, 0]);
    let part = Manifold.compose([left, right]);
    part = moveFace(part, [{ center: [20, 0, 5], normal: [0, 0, 1] }], 4);
    const parts = part.decompose();
    if (parts.length !== 2) throw new Error('bodies ' + parts.length);
    const stayed = parts.find((p) => p.boundingBox().min[0] < 0).boundingBox();
    const grown = parts.find((p) => p.boundingBox().min[0] > 0).boundingBox();
    if (Math.abs(stayed.max[2] - 5) > 1e-2 || Math.abs(stayed.min[2] + 5) > 1e-2) {
      throw new Error('other body moved ' + JSON.stringify(stayed));
    }
    if (Math.abs(grown.max[2] - 9) > 1e-2 || Math.abs(grown.min[2] + 5) > 1e-2) {
      throw new Error('picked body ' + JSON.stringify(grown));
    }
    return part;
  `;
  const res = await exec(two);
  check('only the body that owns the face changes', near(res.volume, 1000 + 1400), `vol=${res.volume}`);
}

{
  const fixture = readFileSync(new URL('./fixtures/artur_playtest_move_face.txt', import.meta.url), 'utf8');
  check('fixture does not bind moveFace', !/^\s*(?:const|let|var)\s+moveFace\b/m.test(fixture));
  const played = await exec(fixture);
  check('playtest offsets the top and the +X face',
    near(played.boundingBox.min[0], -20) && near(played.boundingBox.max[0], 25)
    && near(played.boundingBox.min[1], -15) && near(played.boundingBox.max[1], 15)
    && near(played.boundingBox.min[2], -10) && near(played.boundingBox.max[2], 15)
    && near(played.volume, 45 * 30 * 25, 0.1),
    `vol=${played.volume} ${JSON.stringify(played.boundingBox)}`);
}

if (failed) {
  console.log(`\n${failed} move-face check(s) failed`);
  process.exit(1);
}
console.log('\nAll move-face checks passed.');

#!/usr/bin/env node
/**
 * Delete Face removes picked faces and heals by extending or trimming the
 * neighboring faces. Confirm writes one deleteFace() and replaces a previous
 * Delete Face block. Leaving without Confirm writes nothing.
 *
 * A planar chamfer heals back to the sharp edge. Deleting one face of a cube
 * throws — the side walls do not meet, and the helper must not return an open
 * solid.
 *
 * Polish holds fillet, chamfer, move face, then delete face. Delete Face is
 * square-x. A tap only adds or removes a face. Confirm writes one
 * deleteFace() for every picked face. A double click does not select the body.
 */
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { paletteRailSections } from '../../src/utils/helperPaletteSnippets.js';
import {
  composeDeleteFaceCommit,
  toggleDeleteFaceSelection,
  popLastDeleteFace,
  clearDeleteFaces,
  emptyDeleteFaceState,
} from '../../src/utils/deleteFaceMode.js';
import { composeMoveFaceCommit } from '../../src/utils/moveFaceMode.js';

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
const CHAMFER = { center: [4, 0, 4], normal: [Math.SQRT1_2, 0, Math.SQRT1_2] };

{
  const view = read('src/components/Viewport.jsx');
  const app = read('src/App.jsx');
  const chip = read('src/components/DeleteFaceModeChip.jsx');
  const worker = read('src/workers/sandboxWorker.js') + '\n' + read('src/lib/surfcad/runtime.js');
  const palette = read('src/components/HelperInsertPalette.jsx');
  const arch = read('docs/architecture.md');
  check('Delete Face double click is not the body',
    /legacy: legacyTap \|\| !!moveFaceModeRef\.current \|\| !!deleteFaceModeRef\.current/.test(view));
  check('Delete Face button is square-x',
    /deleteFace:\s*SquareX/.test(palette)
    && /SquareX/.test(read('src/components/FeatureStrip.jsx')));
  check('Delete Face enters its own mode',
    /item\.id === 'deleteFace'/.test(palette) && /onEnterDeleteFaceMode/.test(palette));
  for (const layout of ['cad', 'game']) {
    const sections = paletteRailSections(layout);
    const polish = sections.find((s) => s.key === 'Features');
    const ids = polish ? polish.items.map((i) => i.id).join(',') : '';
    check(`${layout} Polish is fillet, chamfer, move face, delete face`,
      ids === 'filletEdges,chamferEdges,moveFace,deleteFace',
      sections.map((s) => s.key).join('|') + ' polish=' + ids);
    check(`${layout} Move is the last section`,
      sections[sections.length - 1]?.key === 'Transforms');
  }
  check('sticky picker has Undo and Clear and no shift',
    /data-delete-face-undo/.test(chip) && /data-delete-face-clear/.test(chip)
    && !/shiftKey/.test(chip));
  check('delete face uses the shared feature card',
    /<FeatureSheet\b/.test(chip)
    && /compact=\{compact\}/.test(chip)
    && /onCancel=\{onDismiss\}/.test(chip)
    && /onConfirm=\{onConfirm\}/.test(chip)
    && /deleteFaceMode && mode !== 'game'/.test(view));
  check('App writes one composeDeleteFaceCommit on both viewports',
    /composeDeleteFaceCommit/.test(app)
    && (app.match(/onCommitDeleteFace=\{handleCommitDeleteFace\}/g) || []).length === 2);
  check('dismiss does not commit',
    /onDismiss=\{exitDeleteFaceMode\}/.test(view)
    && !/onDismiss=\{[^}]*onCommitDeleteFace/.test(view));
  check('a tap does not run deleteFace',
    /toggleDeleteFaceSelection\(deleteFaceModeRef\.current/.test(view)
    && !/previewDeleteFace/.test(view)
    && !/Delete Face preview failed/.test(view)
    && /onConfirm=\{acceptDeleteFace\}/.test(view));
  check('worker preview still heals a clone and leaves the cache',
    /case 'previewDeleteFace'/.test(worker)
    && /cachedManifold is not/.test(worker));
  check('deleteFace is a helper',
    /function deleteFace\(manifold, faces\)/.test(worker)
    && /deleteFace,/.test(worker));
  check('architecture names the helper, the picker, and the rebuild',
    /`deleteFace`/.test(arch)
    && /Delete Face/.test(arch)
    && /Maintenance:/.test(arch));
  check('user script is still a direct new Function argument',
    /new Function\(\.\.\.scopeKeys, wrappedScript\)/.test(worker)
    && !/new Function\(\.\.\.scopeKeys, [\s\S]{0,80}function\s*\(/.test(worker));
}

{
  const cube = 'let part = Manifold.cube([10, 10, 10], true);';
  const need = composeDeleteFaceCommit(cube, emptyDeleteFaceState());
  check('confirm without a face is refused', need.ok === false);

  const first = composeDeleteFaceCommit(cube, { body: 'part', faces: [CHAMFER] });
  check('emits one deleteFace', first.ok === true
    && first.buffer.includes('part = deleteFace(part, [{ center: [4, 0, 4], normal: [0.7071, 0, 0.7071] }]);')
    && (first.buffer.match(/\bdeleteFace\s*\(/g) || []).length === 1
    && /\/\/ --- delete-face begin id=deleteFace1 ---/.test(first.buffer)
    && /\/\/ --- delete-face end id=deleteFace1 ---/.test(first.buffer),
  first.buffer || first.message);

  const again = composeDeleteFaceCommit(first.buffer, {
    body: 'part', faces: [CHAMFER, SIDE],
  });
  check('a second confirm replaces the previous Delete Face block', again.ok === true
    && (again.buffer.match(/\bdeleteFace\s*\(/g) || []).length === 1
    && (again.buffer.match(/\/\/ --- delete-face begin id=\w+ ---/g) || []).length === 1
    && again.buffer.includes('normal: [1, 0, 0]'),
  again.buffer || again.message);

  const moved = composeMoveFaceCommit(cube, {
    body: 'part', faces: [TOP], distance: 2, flip: false,
  });
  const kept = composeDeleteFaceCommit(moved.buffer, { body: 'part', faces: [CHAMFER] });
  check('a Move Face block stays beside the delete', kept.ok === true
    && (kept.buffer.match(/\bmoveFace\s*\(/g) || []).length === 1
    && (kept.buffer.match(/\bdeleteFace\s*\(/g) || []).length === 1);

  let picks = emptyDeleteFaceState();
  picks = toggleDeleteFaceSelection(picks, { ...CHAMFER, indices: [1] });
  picks = toggleDeleteFaceSelection(picks, { ...SIDE, indices: [2] });
  check('tap adds a second face', picks.faces.length === 2);
  picks = toggleDeleteFaceSelection(picks, CHAMFER);
  check('tap again removes that face', picks.faces.length === 1 && picks.faces[0].normal[0] === 1);
  picks = popLastDeleteFace(picks);
  check('Undo drops the last face', picks.faces.length === 0);
  picks = toggleDeleteFaceSelection(emptyDeleteFaceState(), CHAMFER);
  picks = toggleDeleteFaceSelection(picks, SIDE);
  check('Clear drops the faces', clearDeleteFaces(picks).faces.length === 0);
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

const n = Math.SQRT1_2;
const chamferScript = `
  let part = Manifold.cube([10, 10, 10], true);
  part = part.trimByPlane([${-n}, 0, ${-n}], ${-8 * n});
  return part;
`;

{
  const cut = await exec(chamferScript);
  check('the chamfer removes the corner and stays closed',
    near(cut.volume, 980, 1) && near(cut.boundingBox.min[0], -5) && near(cut.boundingBox.max[2], 5),
    `vol=${cut.volume} ${JSON.stringify(cut.boundingBox)}`);

  const healed = await exec(`
    let part = Manifold.cube([10, 10, 10], true);
    part = part.trimByPlane([${-n}, 0, ${-n}], ${-8 * n});
    part = deleteFace(part, [{ center: [4, 0, 4], normal: [${n}, 0, ${n}] }]);
    return part;
  `);
  check('deleting the chamfer face heals back to the cube',
    near(healed.boundingBox.min[0], -5) && near(healed.boundingBox.max[0], 5)
    && near(healed.boundingBox.min[1], -5) && near(healed.boundingBox.max[1], 5)
    && near(healed.boundingBox.min[2], -5) && near(healed.boundingBox.max[2], 5)
    && near(healed.volume, 1000, 1),
    `vol=${healed.volume} ${JSON.stringify(healed.boundingBox)}`);

  const open = await execFail(`
    let part = Manifold.cube([10, 10, 10], true);
    part = deleteFace(part, [{ center: [0, 0, 5], normal: [0, 0, 1] }]);
    return part;
  `);
  check('deleting one face of a cube throws',
    !!open && /^deleteFace:/.test(open), open || 'no throw');

  await exec(chamferScript);
  const preview = await send('previewDeleteFace', {
    faces: [{ center: [4, 0, 4], normal: [n, 0, n] }],
  });
  const src = preview.payload.mesh.vertProperties;
  const np = preview.payload.mesh.numProp || 3;
  let xMax = -Infinity;
  let zMax = -Infinity;
  for (let i = 0; i < src.length; i += np) {
    xMax = Math.max(xMax, src[i]);
    zMax = Math.max(zMax, src[i + 2]);
  }
  const cached = await send('stageGetLastMesh');
  check('preview shows the healed cube and leaves the cached solid',
    near(xMax, 5) && near(zMax, 5)
    && near(cached.payload.volume, 980, 1),
    `preview x ${xMax} z ${zMax} cached vol ${cached.payload.volume}`);
}

{
  const fixture = readFileSync(new URL('./fixtures/artur_playtest_delete_face.txt', import.meta.url), 'utf8');
  check('fixture does not bind deleteFace', !/^\s*(?:const|let|var|function)\s+deleteFace\b/m.test(fixture));
  const played = await exec(fixture);
  check('playtest heals the chamfered box',
    near(played.boundingBox.min[0], -20) && near(played.boundingBox.max[0], 20)
    && near(played.boundingBox.min[1], -15) && near(played.boundingBox.max[1], 15)
    && near(played.boundingBox.min[2], -10) && near(played.boundingBox.max[2], 10)
    && near(played.volume, 40 * 30 * 20, 1),
    `vol=${played.volume} ${JSON.stringify(played.boundingBox)}`);
}

if (failed) {
  console.log(`\n${failed} delete-face check(s) failed`);
  process.exit(1);
}
console.log('\nAll delete-face checks passed.');

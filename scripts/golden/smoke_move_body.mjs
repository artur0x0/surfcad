#!/usr/bin/env node
/**
 * Move one body by a delta.
 *
 * The left-rail Move button sits immediately above Center and opens a chip
 * (X/Y/Z sliders + type-in). Confirm writes one
 *   part = move(part, [dx, dy, dz], { bodies: [{ at }] })
 * and replaces a previous Move block. move() is Manifold.translate of the
 * named body, using the same decompose / centroid / compose split as cut().
 * No viewport arrows. Shell, Draft, and Cut stay on the legacy tap.
 */
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { BufferAttribute, BufferGeometry } from 'three';
import { paletteRailSections } from '../../src/utils/helperPaletteSnippets.js';
import {
  composeMoveCommit,
  validateMoveAccept,
  resolveMoveBodyAt,
  cutNormalFromScript,
  movePreviewOffset,
} from '../../src/utils/moveMode.js';
import { CUT_BEGIN, CUT_END } from '../../src/utils/helperPaletteSnippets.js';
import { meshBodyComponents } from '../../src/utils/cutMode.js';

const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

let failed = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`);
  }
}

{
  const view = read('src/components/Viewport.jsx');
  const app = read('src/App.jsx');
  const chip = read('src/components/MoveModeChip.jsx');
  const worker = read('src/workers/sandboxWorker.js') + '\n' + read('src/lib/surfcad/runtime.js');
  const popup = read('docs/ui-style-guide.md');
  const palette = read('src/components/HelperInsertPalette.jsx');
  const hi = view.indexOf('const highlightFace = useCallback');
  const note = view.indexOf('Below highlightFace on purpose');
  const paint = view.indexOf('const paintDraftPicks = useCallback');
  const legacy = view.match(/const legacyTap = ([^;]+);/);
  check('Draft callbacks stay below highlightFace', hi >= 0 && note > hi && paint > note);
  check('Move is not a legacy picker', !!legacy && !/moveMode/.test(legacy[1])
    && /shellModeRef/.test(legacy[1]) && /draftModeRef/.test(legacy[1]) && /cutModeRef/.test(legacy[1]));
  check('no viewport transform gizmo', !/TransformControls/.test(view) && !/TransformControls/.test(chip));
  check('axis helper stays a visual AxesHelper', /new AxesHelper\(/.test(view));
  check('X Y Z are NumberFields', /id="dx"/.test(chip) && /id="dy"/.test(chip) && /id="dz"/.test(chip)
    && /NumberField/.test(chip) && /type="range"/.test(read('src/components/controls/popupUI.jsx')));
  check('move uses the shared feature card',
    /<FeatureSheet\b/.test(chip)
    && /compact=\{compact\}/.test(chip)
    && /onCancel=\{onDismiss\}/.test(chip)
    && /onConfirm=\{onConfirm\}/.test(chip)
    && /moveMode && mode !== 'game'/.test(view));
  check('Move button enters move mode', /item\.id === 'move'/.test(palette) && /onEnterMoveMode/.test(palette)
    && /move:\s*Move/.test(palette));
  for (const layout of ['cad', 'game']) {
    const ids = paletteRailSections(layout).find((s) => s.key === 'Transforms').items.map((i) => i.id);
    check(`${layout} Move sits immediately above Center`, ids[ids.indexOf('center') - 1] === 'move', ids.join(','));
  }
  check('App writes composeMoveCommit on both viewports',
    /composeMoveCommit/.test(app) && (app.match(/onCommitMove=\{handleCommitMove\}/g) || []).length === 2);
  check('move() is translate plus the cut body split',
    /function move\(manifold, delta/.test(worker) && /manifold\.translate\(d\)/.test(worker)
    && /_cutBodiesOf\(manifold\)/.test(worker) && /_cutSelected\(bodies/.test(worker)
    && /Manifold\.compose\(kept\)/.test(worker));
  check('ui-style-guide documents MoveModeChip', /MoveModeChip/.test(popup) && /No\s*\n\s*viewport arrows/.test(popup));
  check('slider motion previews the body and dismiss does not commit',
    /name = 'move-preview'/.test(view) && /onDismiss=\{exitMoveMode\}/.test(view)
    && !/onDismiss=\{[^}]*onCommitMove/.test(view));
  check('execution error sits above the strip and the left rail',
    /data-execution-error/.test(view) && /createPortal\(/.test(view)
    && /z-50[\s\S]{0,500}data-execution-error/.test(view));
}

{
  const need = composeMoveCommit('let part = Manifold.cube([10, 10, 10], true);', {
    body: 'part', target: null, dx: 1, dy: 0, dz: 0,
  });
  check('confirm without a body is refused', need.ok === false);
  const zero = validateMoveAccept({ target: { at: [0, 0, 0] }, dx: 0, dy: 0, dz: 0 });
  check('a zero delta is a real move', zero.ok === true);
  const first = composeMoveCommit('let part = Manifold.cube([10, 10, 10], true);', {
    body: 'part', target: { at: [1, 2, 3] }, dx: 0, dy: 10, dz: 0,
  });
  check('emits one named-body move', first.ok === true
    && first.buffer.includes('part = move(part, [0, 10, 0], { bodies: [{ at: [1, 2, 3] }] });')
    && (first.buffer.match(/\bmove\s*\(/g) || []).length === 1
    && first.buffer.includes('// --- move begin ---')
    && first.buffer.includes('// --- move end ---'));
  const again = composeMoveCommit(first.buffer, {
    body: 'part', target: { at: [4, 5, 6] }, dx: 5, dy: 0, dz: -1,
  });
  check('a second confirm replaces the previous Move block', again.ok === true
    && (again.buffer.match(/\bmove\s*\(/g) || []).length === 1
    && (again.buffer.match(/\/\/ --- move begin ---/g) || []).length === 1
    && again.buffer.includes('part = move(part, [5, 0, -1], { bodies: [{ at: [4, 5, 6] }] });')
    && !again.buffer.includes('[0, 10, 0]'));

  const drifted = [-0.4941, 10.5913, 5.9703];
  const kernel = [
    [-0.1403, 10.6516, -5.9599],
    [-0.5027, 10.5553, 5.9708],
    [18.2426, 12.6256, -8.2426],
  ];
  const snapped = resolveMoveBodyAt(drifted, kernel, '');
  check('a drifted post-cut centroid snaps to the kernel body',
    snapped[0] === kernel[1][0] && snapped[1] === kernel[1][1] && snapped[2] === kernel[1][2],
    JSON.stringify(snapped));
  const miss = resolveMoveBodyAt([0, 0, 0], kernel, '');
  check('a point far from every body is not renamed',
    miss[0] === 0 && miss[1] === 0 && miss[2] === 0);

  const cutBuf = `${CUT_BEGIN}\npart = cut(part, { normal: [0, 0, 1], originOffset: 0 }, { bodies: [{ at: [0, 0, 0] }] });\n${CUT_END}\nreturn part;\n`;
  const along = cutNormalFromScript(cutBuf);
  check('the previous cut supplies its normal', !!along && Math.abs(along[2] - 1) < 1e-9, JSON.stringify(along));
  const directed = composeMoveCommit(cutBuf, {
    body: 'part',
    direction: 'cut',
    distance: 10,
    target: { at: [0, 0, 5] },
    dx: 0,
    dy: 0,
    dz: 0,
  });
  check('a cut-normal distance writes one move along that normal', directed.ok === true
    && (directed.buffer.match(/\bmove\s*\(/g) || []).length === 1
    && directed.buffer.includes('part = move(part, [0, 0, 10], { bodies: [{ at: [0, 0, 5] }] });'),
    directed.buffer || directed.message);
  const faced = composeMoveCommit('let part = Manifold.cube([10, 10, 10], true);', {
    body: 'part',
    direction: 'face',
    distance: 4,
    faceNormal: [0, 1, 0],
    target: { at: [0, 0, 0] },
  });
  check('a picked-face distance writes one move along that normal', faced.ok === true
    && faced.buffer.includes('part = move(part, [0, 4, 0], { bodies: [{ at: [0, 0, 0] }] });'),
    faced.buffer || faced.message);
  const preview = movePreviewOffset({
    direction: 'xyz', dx: 0, dy: 15, dz: 0, target: { at: [0, 0, 5] },
  }, directed.buffer);
  check('replacing a move previews the difference from the previous translation',
    !!preview && Math.abs(preview[1] - 15) < 1e-9 && Math.abs(preview[2] + 10) < 1e-9,
    JSON.stringify(preview));
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

const two = `
const a = Manifold.cube([10, 10, 10], true).translate([-20, 0, 0]);
const b = Manifold.cube([10, 10, 10], true).translate([20, 0, 0]);
let part = Manifold.compose([a, b]);
`;

{
  const base = await exec(`${two}\nreturn part;`);
  const geom = geometryFromMesh(base.mesh);
  const bodies = meshBodyComponents(geom.attributes.position, geom.index);
  check('two cubes are two bodies', bodies.length === 2, `n=${bodies.length}`);
  const picked = bodies.find((b) => b.at[0] > 0);
  const other = bodies.find((b) => b.at[0] < 0);
  check('viewport centroid names the +X cube', !!picked && Math.abs(picked.at[0] - 20) < 1e-6
    && Math.abs(picked.at[1]) < 1e-6 && Math.abs(other.at[0] + 20) < 1e-6,
    JSON.stringify(bodies.map((b) => b.at)));
  const commit = composeMoveCommit(two, {
    body: 'part',
    target: { at: picked.at },
    dx: 0,
    dy: 10,
    dz: 0,
  });
  check('commit emits the viewport centroid', commit.ok === true && /bodies: \[\{ at: \[/.test(commit.buffer), commit.buffer);
  const moved = await exec(`
    ${commit.buffer.replace(/\n*return\s+part\s*;?\s*$/i, '')}
    const parts = part.decompose();
    if (parts.length !== 2) throw new Error('bodies ' + parts.length);
    const boxes = parts.map((p) => p.boundingBox());
    const stayed = boxes.find((b) => b.min[0] < -10);
    const shifted = boxes.find((b) => b.min[0] > 10);
    if (!stayed) throw new Error('missing stayed ' + JSON.stringify(boxes));
    if (Math.abs(stayed.min[0] + 25) > 1e-2 || Math.abs(stayed.max[0] + 15) > 1e-2) {
      throw new Error('stayed x ' + JSON.stringify(stayed));
    }
    if (Math.abs(stayed.min[1] + 5) > 1e-2 || Math.abs(stayed.max[1] - 5) > 1e-2) {
      throw new Error('stayed y ' + JSON.stringify(stayed));
    }
    if (!shifted) throw new Error('missing shifted ' + JSON.stringify(boxes));
    if (Math.abs(shifted.min[0] - 15) > 1e-2 || Math.abs(shifted.max[0] - 25) > 1e-2) {
      throw new Error('shifted x ' + JSON.stringify(shifted));
    }
    if (Math.abs(shifted.min[1] - 5) > 1e-2 || Math.abs(shifted.max[1] - 15) > 1e-2) {
      throw new Error('shifted y ' + JSON.stringify(shifted));
    }
    return part;
  `);
  check('only the picked body moves by dy=10', Math.abs(moved.volume - 2000) < 1e-2, `vol=${moved.volume}`);
}

{
  const one = await exec(`
    let part = Manifold.cube([10, 10, 10], true);
    part = move(part, [5, 0, 0], { bodies: [{ at: [0, 0, 0] }] });
    return part;
  `);
  check('one body translates by dx=5',
    Math.abs(one.boundingBox.min[0] - 0) < 1e-3 && Math.abs(one.boundingBox.max[0] - 10) < 1e-3,
    JSON.stringify(one.boundingBox));
  const still = await exec(`
    ${two}
    part = move(part, [0, 0, 0], { bodies: [{ at: [20, 0, 0] }] });
    const parts = part.decompose();
    const ys = parts.map((p) => p.boundingBox().min[1]);
    if (ys.some((y) => Math.abs(y + 5) > 1e-3)) throw new Error('y ' + ys.join(','));
    return part;
  `);
  check('a zero delta leaves both cubes', Math.abs(still.volume - 2000) < 1e-2);
  const miss = await execFail(`
    ${two}
    part = move(part, [0, 10, 0], { bodies: [{ at: [0, 0, 0] }] });
    return part;
  `);
  check('a point that is not a centroid fails as move', !!miss && /^move:/.test(miss) && !/^cut:/.test(miss), miss || 'no throw');
  const unnamed = await execFail(`
    let part = Manifold.cube([10, 10, 10], true);
    part = move(part, [1, 0, 0]);
    return part;
  `);
  check('move names the body', !!unnamed && /name one body/.test(unnamed), unnamed || 'no throw');
}

{
  const shellSrc = readFileSync(
    new URL('./fixtures/artur_playtest_shell_after_fillets.txt', import.meta.url),
    'utf8',
  ).replace(/\n*return\s+part\s*;?\s*$/i, '');
  const cutBody = `${shellSrc}\npart = cut(part, { normal: [0, 0, 1], originOffset: 0 });`;
  const res = await exec(`${cutBody}\nreturn part;`);
  const geom = geometryFromMesh(res.mesh);
  const bodies = meshBodyComponents(geom.attributes.position, geom.index);
  const kernel = res.bodyCentroids;
  check('execute names a kernel centroid for each body',
    Array.isArray(kernel) && kernel.length >= 2 && kernel.length === bodies.length,
    `kernel=${kernel?.length} view=${bodies.length}`);
  let snappedOk = true;
  let detail = '';
  for (const b of bodies) {
    const at = resolveMoveBodyAt(b.at, kernel, '').map((n) => Math.round(n * 1e4) / 1e4);
    const msg = await execFail(`${cutBody}\npart = move(part, [0, 5, 0], { bodies: [{ at: [${at.join(', ')}] }] });\nreturn part;`);
    if (msg) {
      snappedOk = false;
      detail = msg;
    }
  }
  check('a filleted shell cut body moves when named by the kernel centroid', snappedOk, detail);
}

if (failed) {
  console.log(`\n${failed} move-body check(s) failed`);
  process.exit(1);
}
console.log('\nAll move-body checks passed.');

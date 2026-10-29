/**
 * Four vertical corners of a plain box.
 *
 * Accept used to write each edgesBetween after the previous filletAlongPath.
 * The first blend rewrites the face ids of that corner, so the next lookup
 * throws "re-pick edges — no boundary between faces 2 and 5".
 *
 * This golden builds those four Z-up corners the way the edge picker does,
 * runs composeFilletCommit, and executes the script. It also fillets the
 * same corners from a script: filletEdges on the vertical convex edges, and
 * edge() ids captured before any blend. Either path fails the golden if
 * that toast would fire.
 */
import { register } from 'node:module';
import { BufferGeometry, BufferAttribute } from 'three';
import {
  buildFeatureEdges,
  buildCoherentEdges,
} from '../../src/utils/selectEdge.js';
import {
  annotateFeatureEdges,
  indexBoundaryEdges,
} from '../../src/utils/boundaryEdgeIds.js';
import { composeFilletCommit, composeChamferCommit, countMakeSweepPath } from '../../src/utils/filletMode.js';
import { FILLET_ARC_SEGMENTS } from '../../src/utils/filletAlongPath.js';
import { FRAME_DENSIFY_MAX_TURN_DEG } from '../../src/utils/edgeTangencyField.js';

let failed = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`);
  }
}

const TOAST = /no boundary between faces/;

function failRun(name, err) {
  const msg = String(err && err.message ? err.message : err);
  const kind = TOAST.test(msg) ? 'face-boundary toast' : 'error';
  check(name, false, `${kind}: ${msg}`);
}
const CUBE = 40 * 30 * 20;
const R = 2;
const LEG = 20;

function removedOk(volume, expectRemoved) {
  if (!Number.isFinite(volume)) return false;
  const removed = CUBE - volume;
  return removed > 0 && Math.abs(removed - expectRemoved) / expectRemoved < 0.03;
}

check('arc segments stay 24', FILLET_ARC_SEGMENTS === 24, `got ${FILLET_ARC_SEGMENTS}`);
check('frame densify stays 5°', FRAME_DENSIFY_MAX_TURN_DEG === 5, `got ${FRAME_DENSIFY_MAX_TURN_DEG}`);

register('./manifold-resolve-hook.mjs', import.meta.url);

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
      workerSelf.onmessage({ data: { type, payload, id } });
    });
  });
}

await import('../../src/workers/sandboxWorker.js');
await send('init');

async function exec(script) {
  const res = await send('execute', { script, importedModels: {}, memoryLimitMB: 512 });
  return res.payload;
}

function geomOf(mesh) {
  const np = mesh.numProp || 3;
  const src = mesh.vertProperties;
  const nVert = Math.floor(src.length / np);
  const positions = new Float32Array(nVert * 3);
  for (let i = 0; i < nVert; i++) {
    positions[i * 3] = src[i * np];
    positions[i * 3 + 1] = src[i * np + 1];
    positions[i * 3 + 2] = src[i * np + 2];
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(positions, 3));
  g.setIndex(new BufferAttribute(new Uint32Array(mesh.triVerts), 1));
  return g;
}

function lookupsBeforeBlends(buffer) {
  const text = String(buffer || '');
  const firstBlend = text.search(/filletAlongPath\s*\(/);
  const lastBetween = text.lastIndexOf('edgesBetween(');
  const lastEdge = text.lastIndexOf('edge(');
  const lastLookup = Math.max(lastBetween, lastEdge);
  return firstBlend > 0 && lastLookup >= 0 && lastLookup < firstBlend;
}

console.log('fillet box corners — four vertical edges');

const cube = await exec('return Manifold.cube([40, 30, 20], true);');
const g = geomOf(cube.mesh);
const topo = indexBoundaryEdges({
  positions: g.attributes.position.array,
  indices: g.index.array,
  faceIDs: cube.mesh.faceID,
});
const coherent = buildCoherentEdges(annotateFeatureEdges(buildFeatureEdges(g), topo));
const vertical = coherent.filter((e) => Math.abs(e.tangent?.[2] || 0) > 0.99);
check('plain box has four vertical corners', vertical.length === 4, `n=${vertical.length}`);
check(
  'those corners include faces 2 and 5',
  vertical.some((e) => (
    (e.faceA === 2 && e.faceB === 5) || (e.faceA === 5 && e.faceB === 2)
  )),
  vertical.map((e) => `${e.faceA}/${e.faceB}`).join(', '),
);

const starter = 'let part = Manifold.cube([40, 30, 20], true);\nreturn part;';
const commit = composeFilletCommit(starter, {
  edges: vertical,
  params: { radius: R, strategy: 'sweep' },
  geometry: g,
  filletClass: 'easy',
});
check('picker Accept writes a script', commit.ok === true, commit.message || '');
if (commit.ok) {
  // One edge set: the four corners resolve in one lookup line (four
  // edge() ids, one makeSweepPath, one filletAlongPath).
  const idList = commit.buffer.match(/\[([\d,\s]+)\]\.flatMap\(\(id\) => edge\(part, id\)\)/);
  const lookups = idList ? idList[1].split(',').filter((x) => x.trim()).length : 0;
  check('picker Accept resolves four edges in one set', lookups === 4 && countMakeSweepPath(commit.buffer) === 1, `n=${lookups} paths=${countMakeSweepPath(commit.buffer)}`);
  check(
    'picker Accept resolves every corner before the first blend',
    lookupsBeforeBlends(commit.buffer),
    commit.buffer,
  );
  try {
    const out = await exec(commit.buffer);
    const expectRemoved = 4 * LEG * R * R * (1 - Math.PI / 4);
    check(
      'picker script fillets four corners without the toast',
      removedOk(out.volume, expectRemoved),
      `vol=${out.volume}`,
    );
  } catch (err) {
    failRun('picker script fillets four corners without the toast', err);
  }
}

const chamfer = composeChamferCommit(starter, {
  edges: vertical,
  params: { chamfer: R },
});
check('chamfer Accept writes a script', chamfer.ok === true, chamfer.message || '');
if (chamfer.ok) {
  check(
    'chamfer Accept resolves every corner before the first blend',
    lookupsBeforeBlends(chamfer.buffer),
  );
  try {
    const out = await exec(chamfer.buffer);
    const expectRemoved = 4 * LEG * 0.5 * R * R;
    check(
      'chamfer script bevels four corners without the toast',
      removedOk(out.volume, expectRemoved),
      `vol=${out.volume}`,
    );
  } catch (err) {
    failRun('chamfer script bevels four corners without the toast', err);
  }
}

{
  try {
    const out = await exec(`
let part = Manifold.cube([40, 30, 20], true);
const vertEdges = convexEdges(part).filter((item) => Math.abs(item.tangent[2]) > 0.99);
if (vertEdges.length !== 4) throw new Error('vertical count ' + vertEdges.length);
part = filletEdges(part, vertEdges, ${R}, { sphericalCorners: false });
return part;
`);
    const expectRemoved = 4 * LEG * R * R * (1 - Math.PI / 4);
    check(
      'script filletEdges rounds four vertical corners',
      removedOk(out.volume, expectRemoved),
      `vol=${out.volume}`,
    );
  } catch (err) {
    failRun('script filletEdges rounds four vertical corners', err);
  }
}

{
  try {
    const out = await exec(`
let part = Manifold.cube([40, 30, 20], true);
const ids = boundaryEdges(part)
  .filter((item) => Math.abs(item.mid[2]) < 1e-3 && item.length > 15 && item.length < 25)
  .map((item) => item.id);
if (ids.length !== 4) throw new Error('vertical ids ' + ids.length);
const cornerSegs = ids.map((id) => edge(part, id));
for (const segs of cornerSegs) {
  part = filletAlongPath(part, makeSweepPath(segs), ${R});
}
return part;
`);
    const expectRemoved = 4 * LEG * R * R * (1 - Math.PI / 4);
    check(
      'script edge() fillets four vertical corners without the toast',
      removedOk(out.volume, expectRemoved),
      `vol=${out.volume}`,
    );
  } catch (err) {
    failRun('script edge() fillets four vertical corners without the toast', err);
  }
}

if (failed) {
  console.log(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nfillet box corners golden passed');

/**
 * Slice B — fillet easy vs hard.
 *
 * Box / extruded-rect edges are easy at the default sweep radius.
 * The default circle↔square loft generator (post-#49 coherent pick) is hard,
 * with a stable UI reason, and Accept is still allowed.
 */
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { BufferGeometry, BufferAttribute } from 'three';
import {
  buildFeatureEdges,
  buildCoherentEdges,
} from '../../src/utils/selectEdge.js';
import {
  annotateFeatureEdges,
  indexBoundaryEdges,
} from '../../src/utils/boundaryEdgeIds.js';
import {
  classifyFilletEdges,
  countDegenerateTriangles,
  EASY_SEGMENT_MAX,
  DIHEDRAL_SPAN_MAX_DEG,
  FILLET_REASON_TWISTED_WALL,
  FILLET_REASON_VARIABLE_ANGLE,
  FILLET_REASON_LONG_CHAIN,
  FILLET_REASON_RADIUS_TOO_LARGE,
} from '../../src/utils/filletEdgeClass.js';
import { defaultFilletRadius, validateFilletAccept } from '../../src/utils/filletMode.js';

let failed = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`);
  }
}

const REASONS = new Set([
  FILLET_REASON_TWISTED_WALL,
  FILLET_REASON_VARIABLE_ANGLE,
  FILLET_REASON_LONG_CHAIN,
  FILLET_REASON_RADIUS_TOO_LARGE,
]);

console.log('fillet easy/hard — reason strings and gates');
check('segment cap is the short-chain guideline', EASY_SEGMENT_MAX === 12);
check('dihedral span gate is 5°', DIHEDRAL_SPAN_MAX_DEG === 5);
check('reasons are the UI copy', [...REASONS].every((r) => r === r.toLowerCase() && !r.includes('{')));

{
  const empty = classifyFilletEdges([]);
  check('empty selection is not a warn', empty.klass === 'empty' && empty.reason == null);
}

{
  const planar = (i, dihedralDeg) => {
    const rad = (dihedralDeg * Math.PI) / 180;
    return {
      key: `s-${i}`,
      chainId: 1,
      a: i,
      b: i + 1,
      va: [i, 0, 0],
      vb: [i + 1, 0, 0],
      length: 1,
      tangent: [1, 0, 0],
      n0: [0, 0, 1],
      n1: [Math.sin(rad), 0, Math.cos(rad)],
      boundaryId: 1,
      faceA: 1,
      faceB: 2,
    };
  };
  const long = classifyFilletEdges(Array.from({ length: 13 }, (_, i) => planar(i, 90)));
  check('13-segment tagged chain is a long chain', long.klass === 'hard' && long.reason === FILLET_REASON_LONG_CHAIN, long.reason);

  const varied = classifyFilletEdges([planar(0, 90), planar(1, 100)]);
  check('10° dihedral span is variable angle', varied.klass === 'hard' && varied.reason === FILLET_REASON_VARIABLE_ANGLE, `${varied.reason} span=${varied.chains[0]?.dihedralSpan}`);

  const bare = classifyFilletEdges([{
    key: 'u',
    chainId: 3,
    a: 0,
    b: 1,
    va: [0, 0, 0],
    vb: [0, 0, 10],
    length: 10,
    tangent: [0, 0, 1],
    n0: [1, 0, 0],
    n1: [0, 1, 0],
  }]);
  check('untagged chain without a mesh is a twisted wall', bare.klass === 'hard' && bare.reason === FILLET_REASON_TWISTED_WALL, bare.reason);
}

{
  const zero = {
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 0]),
    indices: new Uint32Array([0, 1, 2]),
  };
  check('a collapsed triangle counts as degenerate', countDegenerateTriangles(zero) === 1);
}

console.log('fillet easy/hard — chip keeps Accept enabled, no hard warning');
{
  const chip = readFileSync(new URL('../../src/components/FilletModeChip.jsx', import.meta.url), 'utf8');
  check('chip shows no hard-edge warning', !/data-fillet-warn/.test(chip)
    && !/Hard edge/.test(chip)
    && !/Quality may be poor/.test(chip)
    && !/AlertTriangle/.test(chip)
    && !/bg-red-950/.test(chip));
  check('Confirm is not disabled by class', /data-fillet-accept': 'enabled'/.test(chip) && !/disabled=\{[^}]*hard/.test(chip));
  check('chip does not render the class reason', !/edgeClass\.reason/.test(chip));
}

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

function coherentOf(payload) {
  const g = geomOf(payload.mesh);
  const raw = buildFeatureEdges(g);
  const topo = indexBoundaryEdges({
    positions: g.attributes.position.array,
    indices: g.index.array,
    faceIDs: payload.mesh.faceID,
  });
  return { g, edges: buildCoherentEdges(annotateFeatureEdges(raw, topo)) };
}

function atDefaultRadius(edges, geometry) {
  return classifyFilletEdges(edges, { radius: defaultFilletRadius(), geometry });
}

console.log('fillet easy/hard — box, extrude, loft generator');

const LOFT = `
const fr = { center: [0,0,0], normal: [0,0,1], x: [1,0,0], y: [0,1,0] };
const xs0 = makeCrossSection(fr, profileCircle(5, 32));
const xs1 = makeCrossSection(offsetPlaneFrame(fr, 20), profileRectangle(20, 12, true));
return placeInFrame(fr, makeLoft([xs0, xs1]));
`;

{
  const cube = coherentOf(await exec('return Manifold.cube([40, 30, 20], true);'));
  const easy = cube.edges.filter((e) => atDefaultRadius([e], cube.g).klass === 'easy');
  check('every cube edge is easy at the default radius', easy.length === cube.edges.length && cube.edges.length === 12, `easy=${easy.length}/${cube.edges.length}`);
  const one = cube.edges.find((e) => e.length > 30);
  const huge = classifyFilletEdges([one], { radius: 30, geometry: cube.g });
  check('cube edge with r past the face is radius too large', huge.klass === 'hard' && huge.reason === FILLET_REASON_RADIUS_TOO_LARGE, huge.reason);

  const plate = coherentOf(await exec('return Manifold.cube([40, 30, 2], true);'));
  const long = plate.edges.find((e) => e.length > 30);
  const thin = atDefaultRadius([long], plate.g);
  check('thin plate default radius is too large for the face', thin.klass === 'hard' && thin.reason === FILLET_REASON_RADIUS_TOO_LARGE, thin.reason);

  const extruded = coherentOf(await exec('return makeExtrude(profileRectangle(40, 30, true).contours, 20);'));
  const extrudeEasy = extruded.edges.every((e) => atDefaultRadius([e], extruded.g).klass === 'easy');
  check('extruded rectangle edges are easy', extrudeEasy && extruded.edges.length === 12, `n=${extruded.edges.length}`);

  const loft = coherentOf(await exec(LOFT));
  const generators = loft.edges.filter((e) => Math.abs(e.tangent[2]) > 0.8 && e.length > 10);
  check('loft exposes a generator edge', generators.length >= 1, `n=${generators.length}`);
  const gen = generators[0];
  const hard = atDefaultRadius([gen], loft.g);
  check('loft generator is hard', hard.klass === 'hard', hard.klass);
  check('loft generator reason is twisted wall', hard.reason === FILLET_REASON_TWISTED_WALL, hard.reason);
  check('loft generator reasons stay in the UI set', hard.reasons.every((r) => REASONS.has(r)));
  const gate = validateFilletAccept([gen], { strategy: 'sweep', radius: defaultFilletRadius() });
  check('hard generator still accepts', gate.ok === true, gate.message || '');
}

{
  const payload = await exec(`
    let part = Manifold.cube([40, 30, 20], true);
    const edges = convexEdges(part).filter((e) => Math.hypot(e.vb[0] - e.va[0], e.vb[1] - e.va[1], e.vb[2] - e.va[2]) > 30);
    const path = makeSweepPath([edges[0]]);
    return filletAlongPath(part, path, 4);
  `);
  const g = geomOf(payload.mesh);
  check('default cube fillet leaves no zero-area triangles', countDegenerateTriangles(g) === 0, `n=${countDegenerateTriangles(g)}`);
}

if (failed) {
  console.log(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nfillet easy/hard golden passed');

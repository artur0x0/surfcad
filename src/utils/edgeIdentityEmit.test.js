/**
 * Edge identity (MVP 3 edge slice, emitter half): a picked edge carries the
 * name of the chain it lies on, Fillet / Chamfer Accept writes
 * `edgesNamed(part, "a~b")`, the kernel resolves it, and the edit card parses
 * and resolves the stored names. Fake rows without names still take the
 * boundary-id and literal fallbacks, so older fixtures keep working.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { runScript } from '../lib/surfcad/index.js';
import { buildSolidGeometry } from './partSolidCache.js';
import { edgeNamesForPicks, stampedFaceTable } from './faceIdentity.js';
import { buildFeatureEdges } from './selectEdge.js';
import { emitNamedEdgeLines } from './faceFeaturePlacement.js';
import { composeChamferCommit, composeFilletCommit } from './filletMode.js';
import { parseFeatureMarkers } from './featureMarkers.js';
import { parseStoredEdges, resolveStoredEdges, openFeatureEdit } from './featureEdit.js';

const alloc = (names, base) => {
  let n = 0;
  let name = base;
  while (names.has(name)) { n += 1; name = `${base}${n + 1}`; }
  names.add(name);
  return name;
};

const PLATE = `// --- cube begin id=plate ---
let part = Manifold.cube([40, 20, 10], true);
// --- cube end id=plate ---
// --- cube begin id=notch ---
part = part.subtract(Manifold.cube([10, 6, 4], true).translate([0, -10, 5]));
// --- cube end id=notch ---
`;

async function namedEdgesOf(source) {
  const ran = await runScript(`${source}return part;\n`);
  assert.equal(ran.status, 'NoError');
  const { geometry, faceIDs } = buildSolidGeometry(ran.mesh);
  const table = stampedFaceTable(geometry, faceIDs);
  const edges = edgeNamesForPicks(table, buildFeatureEdges(geometry));
  return { ran, table, edges };
}

test('edgeNamesForPicks names every feature edge from the table; the emitter writes bare names for whole pairs and [k] for one chain', async () => {
  const { edges } = await namedEdgesOf(PLATE);
  assert.ok(edges.length > 0);
  assert.ok(edges.every((e) => typeof e.edgeName === 'string' && e.edgeChainSize > 0), 'every row is on a named edge');
  const right = edges.filter((e) => e.edgeName === 'plate.right~plate.top');
  assert.equal(right.length, 1);
  const whole = emitNamedEdgeLines('part', right, new Set(), alloc);
  assert.deepEqual(whole.names, ['plate.right~plate.top']);
  assert.equal(whole.lines[0], 'const selEdges = edgesNamed(part, "plate.right~plate.top");');

  const topFront = edges.filter((e) => e.edgeBase === 'plate.front~plate.top');
  assert.deepEqual([...new Set(topFront.map((e) => e.edgeName))].sort(), ['plate.front~plate.top[0]', 'plate.front~plate.top[1]']);
  const one = emitNamedEdgeLines('part', topFront.filter((e) => e.edgeName.endsWith('[1]')), new Set(), alloc);
  assert.deepEqual(one.names, ['plate.front~plate.top[1]']);
  const both = emitNamedEdgeLines('part', topFront, new Set(), alloc);
  assert.deepEqual(both.names, ['plate.front~plate.top'], 'every chain of the pair is the bare name');

  // A partial chain, or a row with no name, has no stable name: the caller falls back.
  const rim = edges.filter((e) => e.edgeName === 'plate.right~plate.top').map((e) => ({ ...e, edgeChainSize: 3 }));
  assert.equal(emitNamedEdgeLines('part', rim, new Set(), alloc), null);
  assert.equal(emitNamedEdgeLines('part', [{ a: 0, b: 1, va: [0, 0, 0], vb: [1, 0, 0] }], new Set(), alloc), null);
});

test('Fillet and Chamfer Accept write edgesNamed and the kernel runs it; a later edit upstream keeps the fillet', async () => {
  const { edges } = await namedEdgesOf(PLATE);
  const right = edges.filter((e) => e.edgeName === 'plate.right~plate.top');
  const fillet = composeFilletCommit(`${PLATE}return part;\n`, { edges: right, params: { strategy: 'sweep', radius: 2 } });
  assert.equal(fillet.ok, true, fillet.message);
  assert.match(fillet.buffer, /edgesNamed\(part, "plate\.right~plate\.top"\)/);
  assert.doesNotMatch(fillet.buffer, /edgesBetween\(|flatMap\(\(id\) => edge\(|va: \[/);
  const ran = await runScript(fillet.buffer);
  assert.equal(ran.status, 'NoError', ran.status);
  // The notch sits half outside the plate: 10 wide, 3 deep (y -10..-7), 2 tall (z 3..5).
  const base = 40 * 20 * 10 - 10 * 3 * 2;
  const quarter = (1 - Math.PI / 4) * 4 * 20;
  assert.ok(Math.abs((base - ran.volume) - quarter) < quarter * 0.15, `removed ${base - ran.volume} expected ${quarter}`);

  // B8: the plate changes size; the name still resolves and the fillet still applies.
  const edited = fillet.buffer.replace('Manifold.cube([40, 20, 10], true)', 'Manifold.cube([60, 20, 10], true)');
  const ran2 = await runScript(edited);
  assert.equal(ran2.status, 'NoError');
  const base2 = 60 * 20 * 10 - 10 * 3 * 2;
  assert.ok(Math.abs((base2 - ran2.volume) - quarter) < quarter * 0.15, `after the edit removed ${base2 - ran2.volume}`);

  const chamfer = composeChamferCommit(fillet.buffer, { edges: edges.filter((e) => e.edgeName === 'plate.left~plate.top'), params: { chamfer: 1 } });
  assert.equal(chamfer.ok, true, chamfer.message);
  assert.match(chamfer.buffer, /edgesNamed\(part, "plate\.left~plate\.top"\)/);
  assert.equal((await runScript(chamfer.buffer)).status, 'NoError');
  assert.equal(parseFeatureMarkers(chamfer.buffer).filter((f) => f.kind === 'fillet' || f.kind === 'chamfer').length, 2);
});

test('the edit card parses edgesNamed refs and resolves them on the live edges (B12); a gone name is missing, not a neighbour', async () => {
  const block = `// --- chamfer-mode begin id=cham ---
const selEdges3 = edgesNamed(part, "plate.right~plate.top", 'plate.front~plate.top[1]');
const path3 = makeSweepPath(selEdges3); // edge→sweep path
part = filletAlongPath(part, path3, 0.5, { profile: 'chamfer' }); // sweep chamfer wedge
// --- chamfer-mode end ---`;
  const refs = parseStoredEdges(block);
  assert.deepEqual(refs.map((r) => [r.kind, r.name]), [['named', 'plate.right~plate.top'], ['named', 'plate.front~plate.top[1]']]);

  const { edges } = await namedEdgesOf(PLATE);
  const resolved = resolveStoredEdges(refs, edges);
  assert.equal(resolved.missing.length, 0, JSON.stringify(resolved.missing));
  assert.ok(resolved.resolved.every((e) => e.edgeName === 'plate.right~plate.top' || e.edgeName === 'plate.front~plate.top[1]'));
  assert.equal(resolved.resolved.filter((e) => e.edgeName === 'plate.front~plate.top[1]').length > 0, true);

  // A bare pair takes every chain; a name that is not on this solid is missing.
  const bare = resolveStoredEdges(parseStoredEdges('const s = edgesNamed(part, "plate.top~plate.front");'), edges);
  assert.deepEqual([...new Set(bare.resolved.map((e) => e.edgeName))].sort(), ['plate.front~plate.top[0]', 'plate.front~plate.top[1]']);
  const gone = resolveStoredEdges(parseStoredEdges('const s = edgesNamed(part, "plate.top~lid.side");'), edges);
  assert.equal(gone.resolved.length, 0);
  assert.equal(gone.missing.length, 1);

  // openFeatureEdit on a script that holds the block reports the resolved edges for the chamfer card.
  const script = `${PLATE}${block}\nreturn part;\n`;
  const feature = parseFeatureMarkers(script).find((f) => f.kind === 'chamfer');
  const session = openFeatureEdit(script, feature, { edges, faces: [] });
  assert.equal(session.ok, true, session.message);
  assert.ok(session.resolvedEdges.length >= 2, 'the card opens with its edges');
  assert.equal(session.missingEdges.length, 0);
  assert.equal(session.fields.chamfer, 0.5);
});

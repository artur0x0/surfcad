/**
 * Sequential fillet picks accumulate: fillet the verticals, then pick the top
 * rim (whose corners are the first fillet's arcs) at the same radius, and
 * Accept extends the first block instead of wrapping a second fillet over its
 * sails. One op, junction corners, spherical patches. A different radius, or
 * a face from a later block, still appends a new block.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { runScript } from '../lib/surfcad/index.js';
import { buildSolidGeometry } from './partSolidCache.js';
import { edgeNamesForPicks, stampedFaceTable } from './faceIdentity.js';
import { buildFeatureEdges } from './selectEdge.js';
import { parseFeatureMarkers } from './featureMarkers.js';
import { composeFilletCommit, filletAccumulationFor } from './filletMode.js';
import { filletBlockNames, filletBlockRadius, findFilletAccumulationTarget } from './filletAccumulate.js';

const R = 5;
const BOX = `// --- cube begin id=seed ---
let part = Manifold.cube([40, 30, 20], true);
// --- cube end ---
`;
const ROUNDED = 30 * 20 * 10 + 2 * R * (600 + 200 + 300) + Math.PI * R * R * (30 + 20 + 10) + (4 / 3) * Math.PI * R ** 3;

async function solidOf(script) {
  const ran = await runScript(script);
  assert.equal(ran.status, 'NoError', ran.status);
  const { geometry, faceIDs } = buildSolidGeometry(ran.mesh);
  const table = stampedFaceTable(geometry, faceIDs);
  return { ran, table, edges: edgeNamesForPicks(table, buildFeatureEdges(geometry)) };
}
const atZ = (edges, z) => edges.filter((e) => Math.abs(e.va[2] - z) < 1e-6 && Math.abs(e.vb[2] - z) < 1e-6);

test('verticals, then the top rim at the same radius: one block, junction corners, then the bottom rim', { timeout: 300_000 }, async () => {
  const start = `${BOX}return part;\n`;
  const box = await solidOf(start);
  const vertical = box.edges.filter((e) => Math.abs(e.tangent[2]) > 0.99);
  const first = composeFilletCommit(start, { edges: vertical, params: { strategy: 'sweep', radius: R } });
  assert.equal(first.ok, true, first.message);
  assert.equal(parseFeatureMarkers(first.buffer).filter((f) => f.kind === 'fillet').length, 1);

  const afterVert = await solidOf(first.buffer);
  const topRim = atZ(afterVert.edges, 10);
  assert.ok(topRim.length > 8, `${topRim.length} rim rows`);
  assert.ok(topRim.some((e) => /fillet1\.round(\[\d+\])?~/.test(e.edgeName)), 'the rim runs over the first fillet\'s arcs');
  const target = findFilletAccumulationTarget(first.buffer, topRim, R);
  assert.ok(target, 'the top rim pick extends fillet1');
  assert.equal(target.feature.id, 'fillet1');
  assert.deepEqual([...target.added].sort(), ['seed.back~seed.top', 'seed.front~seed.top', 'seed.left~seed.top', 'seed.right~seed.top']);
  assert.deepEqual(filletAccumulationFor(first.buffer, topRim, { strategy: 'sweep', radius: R }), { id: 'fillet1', added: target.added });

  const second = composeFilletCommit(first.buffer, { edges: topRim, params: { strategy: 'sweep', radius: R }, commitMode: 'append' });
  assert.equal(second.ok, true, second.message);
  assert.equal(second.kernel, 'accumulate');
  assert.equal(second.feature, 'fillet1');
  const blocks = parseFeatureMarkers(second.buffer).filter((f) => f.kind === 'fillet');
  assert.equal(blocks.length, 1, 'still one fillet block');
  const blockText = second.buffer.slice(blocks[0].startOffset, blocks[0].endOffset);
  assert.equal(filletBlockRadius(blockText), R);
  assert.equal(filletBlockNames(blockText).length, 8);
  assert.doesNotMatch(blockText, /fillet1\.round/);
  assert.equal((second.buffer.match(/filletAlongPath\s*\(/g) || []).length, 1);

  const afterTop = await solidOf(second.buffer);
  assert.equal(afterTop.table.faces.filter((f) => f.role === 'corner').length, 4, 'four spherical corners at the top');
  const planar = await runScript(`${BOX}part = filletEdges(part, convexEdges(part).filter((e) => Math.abs(e.tangent[2]) > 0.99 || (e.va[2] > 9.9 && e.vb[2] > 9.9)), ${R}, { sphericalCorners: true });\nreturn part;`);
  assert.ok(Math.abs(afterTop.ran.volume - planar.volume) < 4, `sweep ${afterTop.ran.volume} planar ${planar.volume}`);

  const bottomRim = atZ(afterTop.edges, -10);
  const third = composeFilletCommit(second.buffer, { edges: bottomRim, params: { strategy: 'sweep', radius: R }, commitMode: 'append' });
  assert.equal(third.ok, true, third.message);
  assert.equal(third.kernel, 'accumulate');
  const final = await solidOf(third.buffer);
  assert.equal(parseFeatureMarkers(third.buffer).filter((f) => f.kind === 'fillet').length, 1);
  assert.equal(final.table.faces.filter((f) => f.role === 'corner').length, 8, 'the whole box is rounded by one block');
  assert.ok(Math.abs(final.ran.volume - ROUNDED) < 6, `volume ${final.ran.volume} vs ${ROUNDED}`);
});

test('a different radius, a chamfer, or a face from a later block still appends a new block', { timeout: 300_000 }, async () => {
  const start = `${BOX}return part;\n`;
  const box = await solidOf(start);
  const vertical = box.edges.filter((e) => Math.abs(e.tangent[2]) > 0.99);
  const first = composeFilletCommit(start, { edges: vertical, params: { strategy: 'sweep', radius: R } });
  const afterVert = await solidOf(first.buffer);
  const topRim = atZ(afterVert.edges, 10);

  assert.equal(findFilletAccumulationTarget(first.buffer, topRim, 3), null, 'another radius is another fillet');
  const other = composeFilletCommit(first.buffer, { edges: topRim, params: { strategy: 'sweep', radius: 3 }, commitMode: 'append' });
  assert.equal(other.ok, true, other.message);
  assert.notEqual(other.kernel, 'accumulate');
  assert.equal(parseFeatureMarkers(other.buffer).filter((f) => f.kind === 'fillet').length, 2);

  // A boss added after the fillet: its edges are not on the solid fillet1 cuts.
  const withBoss = first.buffer.replace(/return part;\s*$/, `// --- cube begin id=boss ---
part = part.add(Manifold.cube([10, 10, 10], true).translate([0, 0, 15]));
// --- cube end ---
return part;
`);
  const bossSolid = await solidOf(withBoss);
  const bossTop = bossSolid.edges.filter((e) => e.edgeName && e.edgeName.includes('boss.'));
  const mixed = [...atZ(bossSolid.edges, 10).filter((e) => /fillet1\.round/.test(e.edgeName)).slice(0, 2), ...bossTop.slice(0, 1)];
  assert.ok(mixed.length === 3, `${mixed.length} rows`);
  assert.equal(findFilletAccumulationTarget(withBoss, mixed, R), null, 'a later block\'s face refuses the merge');

  // Chamfer never accumulates.
  assert.equal(filletAccumulationFor(first.buffer, topRim, { profile: 'chamfer', radius: R }), null);
  // No name on a row: nothing stable to write.
  assert.equal(findFilletAccumulationTarget(first.buffer, [{ ...topRim[0], edgeName: undefined }], R), null);
});

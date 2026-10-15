import assert from 'node:assert/strict';
import test from 'node:test';
import { BufferAttribute, BufferGeometry } from 'three';
import { runScript } from '../lib/surfcad/index.js';
import { annotateFeatureEdges, indexBoundaryEdges } from './boundaryEdgeIds.js';
import { parseFeatureMarkers } from './featureMarkers.js';
import {
  composeChamferCommit,
  composeFilletCommit,
  replaceEditedBlend,
} from './filletMode.js';
import { buildCoherentEdges, buildFeatureEdges } from './selectEdge.js';

/**
 * Top-level const/let/var bindings named more than once. The fillet script
 * is one function scope, so a second `const selEdges4` is a SyntaxError
 * (JavaScriptCore: "Cannot declare a const variable twice").
 */
function duplicateBindings(script) {
  const text = String(script)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  const counts = new Map();
  const re = /(?:^|[;\n])\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g;
  let match;
  while ((match = re.exec(text))) {
    counts.set(match[1], (counts.get(match[1]) || 0) + 1);
  }
  return [...counts].filter(([, n]) => n > 1).map(([name]) => name);
}

function geomOf(mesh) {
  const np = mesh.numProp || 3;
  const src = mesh.vertProperties;
  const nVert = Math.floor(src.length / np);
  const positions = new Float32Array(nVert * 3);
  for (let i = 0; i < nVert; i += 1) {
    positions[i * 3] = src[i * np];
    positions[i * 3 + 1] = src[i * np + 1];
    positions[i * 3 + 2] = src[i * np + 2];
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(positions, 3));
  g.setIndex(new BufferAttribute(new Uint32Array(mesh.triVerts), 1));
  return g;
}

const STARTER = 'let part = Manifold.cube([40, 30, 20], true);\nreturn part;\n';

let box;

test.before(async () => {
  const cube = await runScript(STARTER);
  const g = geomOf(cube.mesh);
  const topo = indexBoundaryEdges({
    positions: g.attributes.position.array,
    indices: g.index.array,
    faceIDs: cube.mesh.faceID,
  });
  const vertical = buildCoherentEdges(annotateFeatureEdges(buildFeatureEdges(g), topo))
    .filter((edge) => Math.abs(edge.tangent?.[2] || 0) > 0.99);
  assert.equal(vertical.length, 4, `expected four vertical edges, got ${vertical.length}`);
  // Drop the boundary ids. edgesBetween looks those faces up on the solid
  // after the previous blend, and a chamfer has already merged them.
  // Literals are the wire the sweep cutter uses, so a later feature still runs.
  box = {
    geometry: g,
    vertical: vertical.map((edge) => {
      const copy = { ...edge };
      delete copy.boundaryId;
      delete copy.faceA;
      delete copy.faceB;
      delete copy.pairCount;
      return copy;
    }),
  };
});

function blendOpts(chamfer, edges, params, commitMode) {
  return {
    edges,
    params,
    commitMode,
    ...(chamfer ? {} : { filletClass: 'easy', geometry: box.geometry }),
  };
}

function freshBlends(chamfer, groups) {
  let buffer = STARTER;
  groups.forEach((group, index) => {
    const opts = blendOpts(chamfer, group.edges, group.params, index === 0 ? 'replace' : 'append');
    const created = chamfer
      ? composeChamferCommit(buffer, opts)
      : composeFilletCommit(buffer, opts);
    assert.equal(created.ok, true, created.message || '');
    buffer = created.buffer;
  });
  return buffer;
}

function editBlend(chamfer, script, index, edges, params) {
  const kind = chamfer ? 'chamfer' : 'fillet';
  const features = parseFeatureMarkers(script).filter((feature) => feature.kind === kind);
  const feature = features[index];
  assert.ok(feature, `${kind} ${index} missing`);
  return replaceEditedBlend(script, feature, {
    chamfer,
    edges,
    params,
    ...(chamfer ? {} : { filletClass: 'easy', geometry: box.geometry }),
  });
}

async function solidVolume(script, label) {
  const dup = duplicateBindings(script);
  assert.deepEqual(dup, [], `${label} redeclares ${dup.join(', ')}`);
  let ran;
  try {
    ran = await runScript(script);
  } catch (error) {
    assert.fail(`${label} did not run: ${error.message}`);
  }
  assert.equal(ran.featureSkip ?? null, null, `${label} skipped: ${ran.featureSkip?.message || ''}`);
  assert.equal(ran.status, 'NoError', label);
  return ran.volume;
}

function assertSameSolid(edited, fresh, before) {
  assert.ok(Math.abs(edited - fresh) < 1e-4, `edited ${edited} vs fresh ${fresh}`);
  assert.ok(Math.abs(edited - before) > 1, `edit did not change the solid (${edited})`);
}

for (const chamfer of [false, true]) {
  const kind = chamfer ? 'chamfer' : 'fillet';
  const size = (n) => (chamfer ? { chamfer: n } : { radius: n, strategy: 'sweep' });

  test(`${kind}: add an edge to an existing feature`, async () => {
    const [a, b, c] = box.vertical;
    const original = freshBlends(chamfer, [
      { edges: [a], params: size(2) },
      { edges: [b], params: size(2) },
    ]);
    const same = editBlend(chamfer, original, 0, [a], size(2));
    assert.equal(same.ok, true, same.message || '');
    assert.equal(same.changed, false);
    assert.equal(same.buffer, original);

    const edited = editBlend(chamfer, original, 0, [a, c], size(2));
    assert.equal(edited.ok, true, edited.message || '');
    assert.equal(edited.changed, true);
    assert.equal(parseFeatureMarkers(edited.buffer).length, parseFeatureMarkers(original).length);
    const fresh = freshBlends(chamfer, [
      { edges: [a, c], params: size(2) },
      { edges: [b], params: size(2) },
    ]);
    const editedVolume = await solidVolume(edited.buffer, `${kind} add`);
    const freshVolume = await solidVolume(fresh, `${kind} add fresh`);
    const before = await solidVolume(original, `${kind} add before`);
    assertSameSolid(editedVolume, freshVolume, before);
  });

  test(`${kind}: remove an edge from an existing feature`, async () => {
    const [a, b, c] = box.vertical;
    const original = freshBlends(chamfer, [
      { edges: [a, c], params: size(2) },
      { edges: [b], params: size(2) },
    ]);
    const edited = editBlend(chamfer, original, 0, [a], size(2));
    assert.equal(edited.ok, true, edited.message || '');
    assert.equal(edited.changed, true);
    assert.equal(parseFeatureMarkers(edited.buffer).length, parseFeatureMarkers(original).length);
    const fresh = freshBlends(chamfer, [
      { edges: [a], params: size(2) },
      { edges: [b], params: size(2) },
    ]);
    const editedVolume = await solidVolume(edited.buffer, `${kind} remove`);
    const freshVolume = await solidVolume(fresh, `${kind} remove fresh`);
    const before = await solidVolume(original, `${kind} remove before`);
    assertSameSolid(editedVolume, freshVolume, before);
  });

  test(`${kind}: editing one of several features`, async () => {
    const [a, b, c, d] = box.vertical;
    const original = freshBlends(chamfer, [
      { edges: [a], params: size(2) },
      { edges: [b], params: size(2) },
      { edges: [c], params: size(2) },
    ]);
    const edited = editBlend(chamfer, original, 1, [b, d], size(3));
    assert.equal(edited.ok, true, edited.message || '');
    assert.equal(edited.changed, true);
    const markers = parseFeatureMarkers(edited.buffer);
    assert.equal(markers.filter((feature) => feature.kind === kind).length, 3);
    const fresh = freshBlends(chamfer, [
      { edges: [a], params: size(2) },
      { edges: [b, d], params: size(3) },
      { edges: [c], params: size(2) },
    ]);
    const editedVolume = await solidVolume(edited.buffer, `${kind} several`);
    const freshVolume = await solidVolume(fresh, `${kind} several fresh`);
    const before = await solidVolume(original, `${kind} several before`);
    assertSameSolid(editedVolume, freshVolume, before);
  });
}

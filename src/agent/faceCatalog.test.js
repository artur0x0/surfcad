import assert from 'node:assert/strict';
import test from 'node:test';
import { runScript } from '../lib/surfcad/index.js';
import { buildSolidGeometry } from '../utils/partSolidCache.js';
import { fingerprintsFromGeometry } from '../utils/facePaint.js';
import { catalogFromMeshData } from '../utils/jointResolve.js';
import { partPlacement } from '../utils/jointSchema.js';
import { worldPoint } from '../utils/partPose.js';
import { acceptJointPick, applyJointCard, draftFromPicks } from '../joints/jointUi.js';
import { refreshAssemblyJoints } from '../joints/refreshJoints.js';
import { rotateByQuat } from '../joints/rigid.js';
import { jointPickCommand } from './commands/joint.js';
import { listFacesCommand } from './commands/listFaces.js';
import { agentFaceCatalog, findAgentFace, jointPickForFace } from './faceCatalog.js';
import { describeJointPick } from './jointPickDescribe.js';
import { buildFaceList } from './state/listPickables.js';

const HANDLE_SID = '2026-10-17-14-00-00-0001-a001';
const BODY_SID = '2026-10-17-14-00-00-0002-b002';

// Kettle handle: a grip with two pegs along +x. The pegs are the bosses.
const HANDLE = `
const grip = Manifold.cube([10, 12, 80], true).translate([30, 0, 0]);
const peg1 = Manifold.cylinder(20, 4, 4, 48).rotate([0, 90, 0]).translate([5, 0, 25]);
const peg2 = Manifold.cylinder(20, 4, 4, 48).rotate([0, 90, 0]).translate([5, 0, -25]);
let part = grip.add(peg1).add(peg2);
return part;
`;

// Kettle body with two blind sockets for the pegs, entering through +x.
const BODY = `
const body = Manifold.cube([40, 60, 90], true);
const s1 = Manifold.cylinder(30, 4, 4, 48).rotate([0, 90, 0]).translate([0, 0, 25]);
const s2 = Manifold.cylinder(30, 4, 4, 48).rotate([0, 90, 0]).translate([0, 0, -25]);
let part = body.subtract(s1).subtract(s2);
return part;
`;

// Body and handle side by side in one part: two bodies in one mesh.
const TWO_BODIES = `
const body = Manifold.cube([40, 60, 90], true)
  .subtract(Manifold.cylinder(30, 4, 4, 48).rotate([0, 90, 0]).translate([0, 0, 25]));
const handle = Manifold.cube([10, 12, 80], true).translate([80, 0, 0])
  .add(Manifold.cylinder(20, 4, 4, 48).rotate([0, 90, 0]).translate([55, 0, 25]));
let part = body.add(handle);
return part;
`;

async function build(source) {
  const run = await runScript(source);
  assert.ok(run.mesh, `script failed: ${run.error || 'no mesh'}`);
  const solid = buildSolidGeometry(run.mesh);
  const catalog = catalogFromMeshData(run.mesh);
  run.manifold?.delete?.();
  return { geometry: solid.geometry, faceIDs: solid.faceIDs, catalog };
}

let loaded;
function load() {
  loaded ??= (async () => ({
    handle: await build(HANDLE),
    body: await build(BODY),
    twoBodies: await build(TWO_BODIES),
  }))();
  return loaded;
}

function near(a, b, tol = 0.05) {
  return a.every((v, i) => Math.abs(v - b[i]) <= tol);
}

function parallel(a, b) {
  const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return Math.abs(Math.abs(dot) - 1) < 1e-3;
}

function listFaces(part) {
  const ctx = {
    listFaces: () => buildFaceList(agentFaceCatalog(part.geometry, part.faceIDs)),
  };
  const out = listFacesCommand.run(ctx, {});
  assert.equal(out.error, undefined);
  return out.result.faces;
}

function cylinderAt(faces, z) {
  return faces.filter((row) => row.type === 'cylindrical'
    && Math.abs(row.radius - 4) < 0.1
    && parallel(row.axis.dir, [1, 0, 0])
    && Math.abs(row.axis.at[2] - z) < 0.1);
}

function capAt(faces, x, z) {
  return faces.filter((row) => row.type === 'planar'
    && parallel(row.normal, [1, 0, 0])
    && near(row.center, [x, 0, z], 0.1));
}

test('list_faces lists every pickable face, one row per face-graph patch', { timeout: 60_000 }, async () => {
  const { handle, body } = await load();
  for (const part of [handle, body]) {
    const faces = listFaces(part);
    const patches = fingerprintsFromGeometry(part.geometry, part.faceIDs);
    assert.equal(faces.length, patches.length);
    assert.deepEqual(faces.map((row) => row.id), patches.map((p) => `f${p.id}`));
    for (const row of faces) {
      assert.match(row.id, /^f\d+$/);
      assert.ok(['planar', 'cylindrical', 'curved'].includes(row.type), row.type);
      assert.ok(row.area > 0 && row.center && row.normal && row.key);
    }
  }
});

test('every peg (boss) and socket face is listed with its own axis', { timeout: 60_000 }, async () => {
  const { handle, body } = await load();
  const handleFaces = listFaces(handle);
  const bodyFaces = listFaces(body);
  for (const z of [25, -25]) {
    assert.equal(cylinderAt(handleFaces, z).length, 1, `peg wall at z=${z}`);
    assert.equal(capAt(handleFaces, 5, z).length, 1, `peg end cap at z=${z}`);
    assert.equal(cylinderAt(bodyFaces, z).length, 1, `socket wall at z=${z}`);
    assert.equal(capAt(bodyFaces, 0, z).length, 1, `socket floor at z=${z}`);
  }
  const pegs = handleFaces.filter((row) => row.type === 'cylindrical');
  assert.equal(new Set(pegs.map((row) => row.id)).size, pegs.length);
});

test('faces on every body in the mesh are listed', { timeout: 60_000 }, async () => {
  const { twoBodies } = await load();
  const faces = listFaces(twoBodies);
  assert.equal(faces.length, fingerprintsFromGeometry(twoBodies.geometry, twoBodies.faceIDs).length);
  assert.equal(cylinderAt(faces, 25).length, 2, 'socket wall and peg wall');
  assert.equal(capAt(faces, 0, 25).length, 1, 'socket floor on the body');
  assert.equal(capAt(faces, 55, 25).length, 1, 'peg cap on the handle');
});

test('face ids are stable across a rerun of the same script', { timeout: 60_000 }, async () => {
  const { handle } = await load();
  const again = await build(HANDLE);
  const first = listFaces(handle);
  const second = listFaces(again);
  assert.equal(second.length, first.length);
  const shape = (row) => ({
    id: row.id,
    type: row.type,
    center: row.center.map((v) => Math.round(v * 1000) / 1000),
    area: Math.round(row.area * 1000) / 1000,
  });
  assert.deepEqual(second.map(shape), first.map(shape));
});

test('a face id and its key resolve to the same row', { timeout: 60_000 }, async () => {
  const { handle } = await load();
  const catalog = agentFaceCatalog(handle.geometry, handle.faceIDs);
  for (const row of buildFaceList(catalog).faces) {
    const byId = findAgentFace(catalog, { faceId: row.id });
    const byKey = findAgentFace(catalog, { key: row.key });
    assert.equal(byId.face?.faceId, row.id);
    assert.equal(byKey.face?.faceId, row.id);
  }
  assert.equal(findAgentFace(catalog, { faceId: 'f999' }).error.code, 'unknown_face');
  assert.equal(findAgentFace(catalog, { faceId: 'top' }).error.code, 'bad_args');
});

test('joint references from list_faces match the joint refresh catalog', { timeout: 60_000 }, async () => {
  const { handle, body } = await load();
  for (const part of [handle, body]) {
    const catalog = agentFaceCatalog(part.geometry, part.faceIDs);
    for (const face of catalog) {
      const pick = jointPickForFace(face);
      if (pick.error) continue;
      if (pick.kind === 'axis') {
        assert.ok(part.catalog.axes.some((axis) => near(axis.at, pick.key.at, 0.5) && parallel(axis.dir, pick.key.dir)));
      } else {
        assert.ok(part.catalog.faces.some((row) => near(row.at, pick.key.at, 0.5)));
      }
    }
  }
});

function partRow(id, name, surfId, t) {
  return {
    id,
    name,
    visible: true,
    order: 0,
    surfId,
    position: t.slice(),
    placement: { t: t.slice(), q: [0, 0, 0, 1] },
  };
}

test('a concentric joint through joint_pick with list_faces ids succeeds', { timeout: 60_000 }, async () => {
  const { handle, body } = await load();
  const meshes = { 'local:handle': handle, 'local:body': body };
  const doc = {
    version: 1,
    source: 'local',
    name: 'Kettle',
    activeId: 'local:body',
    parts: [
      partRow('local:body', 'Body', BODY_SID, [0, 0, 0]),
      partRow('local:handle', 'Handle', HANDLE_SID, [40, 30, 10]),
    ],
    joints: [],
  };
  let picks = [];
  const ctx = {
    jointApplyPicks({ picks: rows }) {
      for (const row of rows) {
        const part = doc.parts.find((p) => p.id === row.part_id);
        const mesh = meshes[row.part_id];
        const described = describeJointPick({
          key: row.key,
          kind: row.kind,
          faceId: row.face_id,
          geometry: mesh.geometry,
          faceIDs: mesh.faceIDs,
        });
        if (described.error) return { error: described.error };
        const accepted = acceptJointPick(picks, {
          partId: part.id,
          surfId: part.surfId,
          partName: part.name,
          kind: described.kind,
          planar: described.planar,
          axis: described.axis,
          key: described.key,
        });
        picks = accepted.picks;
      }
      return { result: { count: picks.length } };
    },
  };
  const socket = cylinderAt(listFaces(body), 25)[0];
  const peg = cylinderAt(listFaces(handle), 25)[0];
  const picked = jointPickCommand.run(ctx, {
    picks: [
      { part_id: 'local:body', face_id: socket.id },
      { part_id: 'local:handle', face_id: peg.id },
    ],
  });
  assert.equal(picked.error, undefined, JSON.stringify(picked.error));
  assert.equal(picks.length, 2);
  assert.ok(picks.every((pick) => pick.kind === 'axis'));

  const card = { ...draftFromPicks(null, picks, { joints: [] }), type: 'concentric', userPickedType: true };
  const result = applyJointCard({
    doc,
    scripts: {},
    card,
    catalogs: { [BODY_SID]: body.catalog, [HANDLE_SID]: handle.catalog },
  });
  assert.equal(result.ok, true, result.message);
  const joint = result.doc.joints[0];
  assert.equal(joint.type, 'concentric');
  assert.equal(result.statuses[joint.id], 'ok', result.messages?.[joint.id]);

  const worldAxis = (surfId, axis) => {
    const pose = partPlacement(result.doc.parts.find((p) => p.surfId === surfId));
    return { at: worldPoint(axis.at, pose), dir: rotateByQuat(pose.q, axis.dir) };
  };
  const pegW = worldAxis(HANDLE_SID, peg.axis);
  const socketW = worldAxis(BODY_SID, socket.axis);
  assert.ok(parallel(pegW.dir, socketW.dir), `axes not parallel: ${pegW.dir} vs ${socketW.dir}`);
  const d = [pegW.at[0] - socketW.at[0], pegW.at[1] - socketW.at[1], pegW.at[2] - socketW.at[2]];
  const along = d[0] * socketW.dir[0] + d[1] * socketW.dir[1] + d[2] * socketW.dir[2];
  const off = Math.hypot(d[0] - along * socketW.dir[0], d[1] - along * socketW.dir[1], d[2] - along * socketW.dir[2]);
  assert.ok(off < 1e-2, `peg axis is ${off} mm off the socket axis`);
});

test('joint_pick refuses an unknown face id', { timeout: 60_000 }, async () => {
  const { handle } = await load();
  const out = describeJointPick({ faceId: 'f999', geometry: handle.geometry, faceIDs: handle.faceIDs });
  assert.equal(out.error.code, 'unknown_face');
  // part_id alone is a whole-part pick (fixed joint target); a pick with no part is refused.
  assert.equal(jointPickCommand.checkArgs({ picks: [{ part_id: 'local:handle' }] }), null);
  assert.deepEqual(
    jointPickCommand.checkArgs({ picks: [{ face_id: 'f3' }] }),
    { code: 'bad_args', message: 'each joint pick needs part_id, with face_id or key unless it picks the whole part' },
  );
  assert.equal(jointPickCommand.checkArgs({ part_id: 'local:handle', face_id: 'f3' }), null);
});

test('a stale face_id plus key is unknown_face after a remesh', { timeout: 60_000 }, async () => {
  const box = await build('return Manifold.cube([20, 20, 20], true);\n');
  const holed = await build('return Manifold.cube([20, 20, 20], true).subtract(Manifold.cylinder(30, 3, 3, 32));\n');
  const listed = listFaces(box);
  const f0 = listed.find((row) => row.id === 'f0');
  assert.ok(f0?.key);
  const holedCatalog = agentFaceCatalog(holed.geometry, holed.faceIDs);
  const stale = findAgentFace(holedCatalog, { faceId: 'f0', key: f0.key });
  assert.equal(stale.error?.code, 'unknown_face');
  assert.match(stale.error.message, /stale/i);
  const sameMesh = findAgentFace(agentFaceCatalog(box.geometry, box.faceIDs), { faceId: 'f0', key: f0.key });
  assert.equal(sameMesh.face?.faceId, 'f0');
  const byIdOnly = findAgentFace(holedCatalog, { faceId: 'f0' });
  assert.equal(byIdOnly.error, undefined);
  assert.ok(byIdOnly.face);
});

test('fold panel ids stay planar so joint_pick does not fail', { timeout: 60_000 }, async () => {
  const part = await build(`const panels = 3, panel = 25, fold = 10 * Math.PI / 180, thick = 2;
const top = []; let x = 0, y = 0;
for (let i = 0; i <= panels; i++) {
  top.push([x, y]);
  if (i < panels) { x += panel * Math.cos(i * fold); y += panel * Math.sin(i * fold); }
}
const bot = top.slice().reverse().map(([px, py]) => [px, py - thick]);
return makeExtrude([top.concat(bot)], 40);
`);
  const faces = listFaces(part);
  assert.equal(faces.length, 10);
  assert.ok(faces.every((row) => row.type === 'planar'));
  const catalog = agentFaceCatalog(part.geometry, part.faceIDs);
  for (const row of faces) {
    const pick = describeJointPick({ faceId: row.id, key: row.key, geometry: part.geometry, faceIDs: part.faceIDs });
    assert.equal(pick.error, undefined, JSON.stringify(pick.error));
    assert.equal(pick.kind, 'face');
    const found = findAgentFace(catalog, { faceId: row.id, key: row.key });
    assert.equal(found.face?.faceId, row.id);
  }
});

test('catalog is stored on the solid-cache entry', { timeout: 60_000 }, async () => {
  const { handle } = await load();
  const entry = {};
  const first = agentFaceCatalog(handle.geometry, handle.faceIDs, entry);
  const second = agentFaceCatalog(handle.geometry, handle.faceIDs, entry);
  assert.equal(first, second);
  assert.equal(entry.agentCatalog, first);
});

const PATTERN_SID = '2026-10-25-17-00-00-0001-a011';
const INSTANCE_SID = '2026-10-25-17-00-00-0002-a012';
const SHAFT_SID = '2026-10-25-17-00-00-0003-b013';

test('a concentric face_id resolves on a patterned part and on an instance of it', { timeout: 60_000 }, async () => {
  const pattern = await build(`
    const pin = Manifold.cylinder(10, 4, 4, 32);
    let part = array3D(pin, [1, 1, 2], [0, 0, 30]);
    return part;
  `);
  const shaft = await build('return Manifold.cylinder(40, 4, 4, 32);\n');
  const walls = (part) => listFaces(part).filter((row) => row.type === 'cylindrical' && Math.abs(row.radius - 4) < 0.2);
  const patternWalls = walls(pattern);
  const shaftWalls = walls(shaft);
  assert.ok(patternWalls.length >= 2, `pattern cylinders: ${patternWalls.map((row) => row.id).join(',')}`);
  assert.equal(shaftWalls.length, 1, 'shaft wall');
  assert.ok(pattern.catalog.axes.every((axis) => typeof axis.id === 'string' && axis.id.startsWith('f')));
  assert.ok(pattern.catalog.axes.some((axis) => axis.id === patternWalls[0].id));

  const mate = (moving, movingSid, movingGeometry, movingFaceIDs, movingCatalog, face) => {
    const doc = {
      version: 1,
      source: 'local',
      name: 'Pattern',
      activeId: 'shaft',
      parts: [
        partRow('shaft', 'Shaft', SHAFT_SID, [0, 0, 0]),
        moving,
      ],
      joints: [],
    };
    const picks = [];
    for (const row of [
      { part: doc.parts[0], geometry: shaft.geometry, faceIDs: shaft.faceIDs, faceId: shaftWalls[0].id },
      { part: moving, geometry: movingGeometry, faceIDs: movingFaceIDs, faceId: face.id },
    ]) {
      const described = describeJointPick({
        faceId: row.faceId,
        geometry: row.geometry,
        faceIDs: row.faceIDs,
      });
      assert.equal(described.error, undefined, JSON.stringify(described.error));
      assert.equal(described.key.faceId, row.faceId);
      picks.push({
        partId: row.part.id,
        surfId: row.part.surfId,
        partName: row.part.name,
        kind: described.kind,
        planar: described.planar,
        axis: described.axis,
        key: described.key,
      });
    }
    const card = {
      ...draftFromPicks(null, picks, { joints: [] }),
      type: 'concentric',
      userPickedType: true,
    };
    const catalogs = {
      [SHAFT_SID]: shaft.catalog,
      [movingSid]: movingCatalog,
    };
    const result = applyJointCard({ doc, scripts: {}, card, catalogs });
    assert.equal(result.ok, true, result.message);
    const joint = result.doc.joints[0];
    assert.equal(result.statuses[joint.id], 'ok', result.messages?.[joint.id]);
    assert.equal(joint.a.key.faceId, undefined);
    assert.equal(joint.b.key.faceId, undefined);
    const again = refreshAssemblyJoints({ doc: result.doc, catalogs });
    assert.equal(again.statuses[joint.id], 'ok', again.messages?.[joint.id]);
    const worldAxis = (surfId, axis) => {
      const pose = partPlacement(result.doc.parts.find((row) => row.surfId === surfId));
      return { at: worldPoint(axis.at, pose), dir: rotateByQuat(pose.q, axis.dir) };
    };
    const pinW = worldAxis(movingSid, face.axis);
    const shaftW = worldAxis(SHAFT_SID, shaftWalls[0].axis);
    assert.ok(parallel(pinW.dir, shaftW.dir), `${moving.name} axis not parallel to the shaft`);
    const d = [pinW.at[0] - shaftW.at[0], pinW.at[1] - shaftW.at[1], pinW.at[2] - shaftW.at[2]];
    const along = d[0] * shaftW.dir[0] + d[1] * shaftW.dir[1] + d[2] * shaftW.dir[2];
    const off = Math.hypot(
      d[0] - along * shaftW.dir[0],
      d[1] - along * shaftW.dir[1],
      d[2] - along * shaftW.dir[2],
    );
    assert.ok(off < 1e-2, `${moving.name} axis is ${off} mm off the shaft`);
  };

  const patternRow = partRow('pattern', 'Spokes', PATTERN_SID, [40, 0, 0]);
  mate(patternRow, PATTERN_SID, pattern.geometry, pattern.faceIDs, pattern.catalog, patternWalls[0]);

  const instanceRow = {
    ...partRow('instance', 'Spokes#front', INSTANCE_SID, [40, 0, 0]),
    instanceOf: 'pattern',
  };
  mate(instanceRow, INSTANCE_SID, pattern.geometry, pattern.faceIDs, pattern.catalog, patternWalls[0]);
});

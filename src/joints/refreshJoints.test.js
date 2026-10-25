import assert from 'node:assert/strict';
import test from 'node:test';
import { commitJointEdit, refreshAssemblyJoints } from './refreshJoints.js';

const A = '2026-10-10-03-00-00-0001-aaaa';
const B = '2026-10-10-03-00-00-0002-bbbb';
const J = '2026-10-10-03-00-00-0003-cccc';

function face(part, at, n) {
  return { part, kind: 'face', key: { at, n, area: 1 } };
}

function docWith(parts, joints) {
  return {
    version: 1,
    source: 'local',
    name: 'Assembly',
    activeId: 'a.js',
    parts,
    joints,
  };
}

const parts = [
  { id: 'a.js', name: 'Shaft', visible: true, order: 0, surfId: A, position: [0, 0, 0] },
  {
    id: 'b.js',
    name: 'Housing',
    visible: true,
    order: 1,
    surfId: B,
    position: [0, 0, 5],
    placement: { t: [0, 0, 5], q: [0, 0, 0, 1] },
  },
];

const coincident = {
  id: J,
  name: 'Coincident 1',
  type: 'coincident',
  opposed: true,
  a: face(A, [0, 0, 0.5], [0, 0, 1]),
  b: face(B, [0, 0, -0.5], [0, 0, -1]),
};

test('a 5 mm move is broken and the stored placement stays', () => {
  const doc = docWith(parts, [coincident]);
  const seed = doc.parts[1].placement.t.slice();
  const refreshed = refreshAssemblyJoints({
    doc,
    catalogs: {
      [A]: { faces: [{ at: [0, 0, 0.5], n: [0, 0, 1], area: 1 }] },
      [B]: { faces: [{ at: [0, 0, 4.5], n: [0, 0, -1], area: 1 }] },
    },
  });
  assert.equal(refreshed.statuses[J], 'broken');
  assert.equal(refreshed.changed, false);
  assert.deepEqual(refreshed.doc.parts[1].placement.t, seed);
  assert.deepEqual(refreshed.doc.joints[0].b.key.at, [0, 0, -0.5]);
});

test('an ambiguous face is broken and is not guessed', () => {
  const doc = docWith(parts, [coincident]);
  const refreshed = refreshAssemblyJoints({
    doc,
    catalogs: {
      [A]: { faces: [{ at: [0, 0, 0.5], n: [0, 0, 1], area: 1 }] },
      [B]: {
        faces: [
          { at: [0.2, 0, -0.5], n: [0, 0, -1], area: 1 },
          { at: [-0.2, 0, -0.5], n: [0, 0, -1], area: 1 },
        ],
      },
    },
  });
  assert.equal(refreshed.statuses[J], 'broken');
  assert.equal(refreshed.messages[J], 'More than one face matches on Housing');
  assert.deepEqual(refreshed.doc.parts[1].placement.t, [0, 0, 5]);
  assert.deepEqual(refreshed.doc.joints[0].b.key.at, [0, 0, -0.5]);
});

test('a failed part run is broken and does not solve against the leftover', () => {
  const doc = docWith(parts, [coincident]);
  const refreshed = refreshAssemblyJoints({
    doc,
    catalogs: {
      [A]: { faces: [{ at: [0, 0, 0.5], n: [0, 0, 1], area: 1 }] },
      [B]: {
        failed: true,
        faces: [{ at: [0, 0, -0.5], n: [0, 0, -1], area: 1 }],
      },
    },
  });
  assert.equal(refreshed.statuses[J], 'broken');
  assert.equal(refreshed.messages[J], 'Part run failed on Housing');
  assert.deepEqual(refreshed.doc.parts[0].position, [0, 0, 0]);
  assert.deepEqual(refreshed.doc.parts[1].placement.t, [0, 0, 5]);
});

test('a matching drift keeps the joint and the confirmed key', () => {
  const tilt = 3 * Math.PI / 180;
  const doc = docWith(parts, [coincident]);
  const refreshed = refreshAssemblyJoints({
    doc,
    catalogs: {
      [A]: { faces: [{ at: [0.4, 0, 0.5], n: [Math.sin(tilt), 0, Math.cos(tilt)], area: 1 }] },
      [B]: { faces: [{ at: [0, 0.2, -0.5], n: [0, 0, -1], area: 1 }] },
    },
  });
  assert.equal(refreshed.ok, true);
  assert.equal(refreshed.statuses[J], 'ok');
  assert.deepEqual(refreshed.doc.joints[0].a.key.at, [0, 0, 0.5]);
});

test('confirm leaves part scripts untouched', () => {
  const scripts = { 'a.js': 'let part = box(1, 1, 1);\nreturn part;\n', 'b.js': 'let part = box(1, 1, 1);\nreturn part;\n' };
  const beforeA = scripts['a.js'];
  const beforeB = scripts['b.js'];
  const doc = docWith(parts, []);
  const result = commitJointEdit({
    doc,
    scripts,
    action: 'confirm',
    joint: coincident,
    preempt: () => { throw new Error('preempt'); },
  });
  assert.equal(result.ok, true);
  assert.equal(result.scripts, scripts);
  assert.equal(result.scripts['a.js'], beforeA);
  assert.equal(result.scripts['b.js'], beforeB);
  assert.equal(result.preempted, false);
  assert.ok(result.doc.joints.some((joint) => joint.id === J));
});

test('confirm and delete no-op while the assembly open lock is set', () => {
  const scripts = { 'a.js': 'return part;\n' };
  const doc = docWith(parts, [coincident]);
  let calls = 0;
  const preempt = () => { calls += 1; };
  const confirmed = commitJointEdit({
    doc,
    scripts,
    action: 'confirm',
    joint: coincident,
    locked: true,
    preempt,
  });
  const deleted = commitJointEdit({
    doc,
    scripts,
    action: 'delete',
    joint: coincident,
    locked: true,
    preempt,
  });
  assert.equal(confirmed.ok, false);
  assert.equal(deleted.ok, false);
  assert.equal(confirmed.doc, doc);
  assert.equal(deleted.doc, doc);
  assert.equal(confirmed.scripts, scripts);
  assert.equal(calls, 0);
  assert.match(confirmed.message, /confirm the joint again/);
  assert.match(deleted.message, /confirm the joint again/);
});

test('coaxial copies resolve, a face id is never ambiguous, and a tie returns candidates', () => {
  const axisRef = (part, at, radius, faceId) => ({
    part,
    kind: 'axis',
    key: { at, dir: [0, 0, 1], radius, ...(faceId ? { faceId } : {}) },
  });
  const copies = {
    id: J,
    name: 'Concentric 1',
    type: 'concentric',
    a: axisRef(A, [0, 0, 0], 4),
    b: axisRef(B, [0, 0, 0], 4),
  };
  const shaft = { axes: [{ id: 'f1', at: [0, 0, 0], dir: [0, 0, 1], radius: 4 }] };
  const resolved = refreshAssemblyJoints({
    doc: docWith(parts, [copies]),
    catalogs: {
      [A]: shaft,
      [B]: {
        axes: [
          { id: 'f2', at: [0, 0, 0], dir: [0, 0, 1], radius: 4 },
          { id: 'f3', at: [0, 0, 30], dir: [0, 0, 1], radius: 4 },
        ],
      },
    },
  });
  assert.equal(resolved.statuses[J], 'ok', resolved.messages[J]);

  const tieCatalogs = {
    [A]: shaft,
    [B]: {
      axes: [
        { id: 'f2', at: [0.4, 0, 0], dir: [0, 0, 1], radius: 4 },
        { id: 'f3', at: [-0.4, 0, 0], dir: [0, 0, 1], radius: 4 },
      ],
    },
  };
  const tied = refreshAssemblyJoints({ doc: docWith(parts, [copies]), catalogs: tieCatalogs });
  assert.equal(tied.statuses[J], 'broken');
  assert.equal(tied.messages[J], 'More than one axis matches on Housing');
  assert.deepEqual(tied.candidates[J].map((row) => row.id).sort(), ['f2', 'f3']);
  assert.deepEqual(tied.candidates[J][0].direction, [0, 0, 1]);
  assert.equal(tied.candidates[J][0].radius, 4);
  assert.equal(tied.candidates[J][0].origin.length, 3);

  const picked = { ...copies, b: axisRef(B, [0, 0, 0], 4, 'f2') };
  const byFace = refreshAssemblyJoints({ doc: docWith(parts, [picked]), catalogs: tieCatalogs });
  assert.equal(byFace.statuses[J], 'ok', byFace.messages?.[J]);
  assert.equal(byFace.doc.joints[0].b.key.faceId, undefined);
  assert.deepEqual(Object.keys(byFace.doc.joints[0].b.key).sort(), ['at', 'dir', 'radius']);
});

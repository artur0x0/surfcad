import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAssemblyDocument, removePart, serializeAssembly } from './assembly.js';
import { mintSurfId } from './git/surfId.js';
import { migrateAssemblyRecords, rewriteVaultFile } from './git/surfIdMigration.js';
import { parseSurfJson, stringifySurfJson, validateSurfJson } from './git/surfJson.js';
import { poseFieldsForPart } from './jointSchema.js';

const WHEN = new Date('2026-10-08T02:00:00.001Z');
const A = mintSurfId({ now: WHEN, rand: 'a3f9' });
const B = mintSurfId({ now: new Date('2026-10-08T02:00:00.002Z'), rand: 'b10c' });
const J = mintSurfId({ now: new Date('2026-10-08T02:00:00.003Z'), rand: 'ee11' });
const GONE = mintSurfId({ now: new Date('2026-10-08T02:00:00.004Z'), rand: 'd00d' });
const PATH_A = 'assemblies/Gearbox/Bracket.js';
const PATH_B = 'assemblies/Gearbox/Housing.js';
const FACE = { at: [0, 0, 5], n: [0, 0, 1], area: 100 };
const FACE_B = { at: [0, 0, 0], n: [0, 0, -1], area: 80 };
const IDENTITY = [0, 0, 0, 1];
const FLIP_Z = [0, 0, 1, 0];

const LEGACY_DOC = {
  source: 'git',
  name: 'Gearbox',
  activeId: PATH_A,
  parts: [{ id: PATH_A, name: 'Bracket', visible: true, order: 0, position: [0, 0, 0], surfId: A }],
};
const LEGACY = stringifySurfJson(LEGACY_DOC);

function row(path, id, order, extra = {}) {
  return {
    id,
    path,
    name: path.split('/').pop().replace(/\.js$/, ''),
    visible: true,
    order,
    ...extra,
  };
}

function surf(parts, extra = {}) {
  return {
    format: 'surfcad.assembly',
    version: 1,
    name: 'Gearbox',
    activeId: parts[0]?.path ?? null,
    parts,
    ...extra,
  };
}

function faceRef(part, key) {
  return { part, kind: 'face', key };
}

function coincident(extra = {}) {
  return {
    id: J,
    name: 'Coincident 1',
    type: 'coincident',
    a: faceRef(A, FACE),
    b: faceRef(B, FACE_B),
    ...extra,
  };
}

function twoParts() {
  return [row(PATH_A, A, 0), row(PATH_B, B, 1)];
}

function errorsOf(patch) {
  return validateSurfJson(surf(twoParts(), patch)).errors;
}

function has(errors, text) {
  assert.ok(errors.some((line) => line.includes(text)), `${text} not in ${errors.join(' | ')}`);
}

test('a v1 file with no joints round-trips byte-identical', () => {
  assert.equal(stringifySurfJson(parseSurfJson(LEGACY)), LEGACY);
  assert.equal(LEGACY.includes('"placement"'), false);
  assert.equal(LEGACY.includes('"joints"'), false);
  assert.match(LEGACY, /"position": \[\n\s+0,\n\s+0,\n\s+0\n\s+\]/);
  assert.equal(Object.hasOwn(parseSurfJson(LEGACY).parts[0], 'placement'), false);
});

test('validateSurfJson names the schema problems', () => {
  has(errorsOf({ joints: [{ ...coincident(), type: 'mate' }] }), 'type must be coincident');
  has(errorsOf({ joints: [{ ...coincident(), mate: true }] }), 'unknown key "mate"');
  has(errorsOf({ joints: [{ ...coincident(), id: 'bracket' }] }), 'id must be a surf id');
  has(errorsOf({ joints: [{ id: J, name: 'Ground 1', type: 'fixed', a: { part: A }, b: { part: B } }] }),
    'b is omitted on a fixed joint');
  has(errorsOf({ joints: [{ id: J, name: 'Distance 1', type: 'distance', a: faceRef(A, FACE), b: faceRef(B, FACE_B) }] }),
    'value must be a finite number');
  has(errorsOf({ joints: [coincident(), { ...coincident(), name: 'Coincident 2' }] }), `id duplicates ${J}`);
  has(errorsOf({ joints: [] }), 'joints must be omitted when empty');
  has(errorsOf({ joints: [{ ...coincident(), a: faceRef(A, FACE), b: faceRef(A, FACE_B) }] }), 'needs two parts');
  has(errorsOf({ joints: [{ ...coincident(), a2: faceRef(A, FACE) }] }), 'a2 is omitted');
  has(validateSurfJson(surf([row(PATH_A, A, 0, {
    position: [1, 0, 0],
    placement: { t: [2, 0, 0], q: IDENTITY },
  })])).errors, 'position must equal placement.t');
});

test('a plane reference round-trips by its stable id', () => {
  const plane = {
    part: A,
    kind: 'plane',
    key: { id: 'origin:xy', at: [0, 0, 0], n: [0, 0, 1] },
  };
  const joint = { ...coincident(), a: plane, b: faceRef(B, FACE_B) };
  const raw = surf(twoParts(), { joints: [joint] });
  assert.equal(validateSurfJson(raw).errors.length, 0);
  const doc = parseSurfJson(raw);
  assert.equal(doc.joints[0].a.kind, 'plane');
  assert.equal(doc.joints[0].a.key.id, 'origin:xy');
  assert.deepEqual(doc.joints[0].a.key.n, [0, 0, 1]);
  const symmetric = {
    id: J,
    name: 'Symmetric 1',
    type: 'symmetric',
    a: plane,
    a2: faceRef(A, FACE),
    b: faceRef(B, FACE_B),
    b2: faceRef(B, { at: [0, 0, 4], n: [0, 0, 1], area: 40 }),
  };
  assert.equal(validateSurfJson(surf(twoParts(), { joints: [symmetric] })).errors.length, 0);
  has(errorsOf({
    joints: [{
      ...joint,
      a: { part: A, kind: 'plane', key: { at: [0, 0, 0], n: [0, 0, 1] } },
    }],
  }), 'id must be a plane id');
  has(errorsOf({
    joints: [{
      ...joint,
      a: { part: A, kind: 'plane', key: { id: 'origin:xy', at: [0, 0, 0], n: [0, 0, 2] } },
    }],
  }), 'n must be a unit direction');
  has(errorsOf({
    joints: [{
      id: J,
      name: 'Concentric 1',
      type: 'concentric',
      a: plane,
      b: { part: B, kind: 'axis', key: { at: [0, 0, 0], dir: [0, 0, 1], radius: 1 } },
    }],
  }), 'concentric does not fit these references');
});

test('a symmetric joint stores two faces on each part', () => {
  const joint = {
    id: J,
    name: 'Symmetric 1',
    type: 'symmetric',
    a: faceRef(A, FACE),
    a2: faceRef(A, { at: [0, 0, -5], n: [0, 0, -1], area: 40 }),
    b: faceRef(B, FACE_B),
    b2: faceRef(B, { at: [0, 0, 4], n: [0, 0, 1], area: 40 }),
  };
  const raw = surf(twoParts(), { joints: [joint] });
  assert.equal(validateSurfJson(raw).errors.length, 0);
  const doc = parseSurfJson(raw);
  assert.equal(doc.joints[0].type, 'symmetric');
  assert.equal(doc.joints[0].a2.part, A);
  assert.equal(doc.joints[0].b2.part, B);
  assert.equal(doc.joints[0].value, undefined);
  const text = stringifySurfJson(doc);
  assert.equal(stringifySurfJson(parseSurfJson(text)), text);
});

test('a joint naming a missing surf id is dropped on load', () => {
  const raw = surf(twoParts(), {
    joints: [coincident(), { ...coincident(), id: GONE, a: faceRef(GONE, FACE) }],
  });
  const doc = parseSurfJson(raw);
  assert.equal(doc.joints.length, 1);
  assert.equal(doc.joints[0].id, J);
  const text = stringifySurfJson(doc);
  assert.equal(stringifySurfJson(parseSurfJson(text)), text);
  assert.equal(JSON.parse(text).joints.length, 1);
});

test('position and placement.t stay equal, and IndexedDB keeps joints', () => {
  const stored = {
    version: 1,
    source: 'local',
    name: 'Gearbox',
    activeId: PATH_A,
    parts: [
      {
        id: PATH_A,
        name: 'Bracket',
        visible: true,
        surfId: A,
        position: [5, 0, 0],
        placement: { t: [5, 0, 0], q: FLIP_Z },
      },
      { id: PATH_B, name: 'Housing', visible: true, surfId: B, position: [0, 0, 0] },
    ],
    joints: [coincident()],
  };
  const once = parseAssemblyDocument(stored);
  const twice = serializeAssembly(JSON.parse(JSON.stringify(once)));
  assert.equal(twice.joints[0].name, 'Coincident 1');
  assert.equal(twice.joints[0].opposed, true);
  assert.deepEqual(twice.parts[0].position, [5, 0, 0]);
  assert.deepEqual(twice.parts[0].placement, { t: [5, 0, 0], q: FLIP_Z });
  assert.deepEqual(twice.parts[1].placement, { t: [0, 0, 0], q: IDENTITY });
  assert.equal(twice.parts[1].position, undefined);
  const file = JSON.parse(stringifySurfJson(twice));
  assert.deepEqual(file.parts[0].position, file.parts[0].placement.t);
  assert.equal(file.joints[0].opposed, true);
});

test('pose fields follow the pre-joints rule and the jointed-origin rule', () => {
  const ident = { t: [0, 0, 0], q: IDENTITY };
  assert.deepEqual(poseFieldsForPart({ position: [1, 2, 3] }, false, [1, 2, 3]), { position: [1, 2, 3] });
  assert.deepEqual(poseFieldsForPart({ position: [0, 0, 0] }, false, [0, 0, 0]), { position: [0, 0, 0] });
  assert.deepEqual(poseFieldsForPart({}, false, null), {});
  assert.deepEqual(
    poseFieldsForPart({ placement: { t: [1, 2, 3], q: IDENTITY } }, false, null),
    { position: [1, 2, 3] },
  );
  assert.deepEqual(poseFieldsForPart({ placement: ident }, false, null), {});
  assert.deepEqual(poseFieldsForPart({ position: [0, 0, 0], placement: ident }, false, [0, 0, 0]), {
    position: [0, 0, 0],
  });
  assert.deepEqual(
    poseFieldsForPart({ placement: { t: [1, 0, 0], q: FLIP_Z } }, false, null),
    { position: [1, 0, 0], placement: { t: [1, 0, 0], q: FLIP_Z } },
  );
  assert.deepEqual(
    poseFieldsForPart({ placement: { t: [0, 0, 0], q: FLIP_Z } }, false, null),
    { placement: { t: [0, 0, 0], q: FLIP_Z } },
  );
  assert.deepEqual(
    poseFieldsForPart({ position: [1, 0, 0], placement: { t: [2, 0, 0], q: IDENTITY } }, false, [1, 0, 0]),
    { position: [2, 0, 0] },
  );
  const grounded = serializeAssembly({
    source: 'local',
    name: 'Gearbox',
    parts: [
      { id: PATH_A, name: 'Bracket', surfId: A },
      { id: PATH_B, name: 'Housing', surfId: B, position: [4, 0, 0] },
    ],
    joints: [{ id: J, name: 'Ground 1', type: 'fixed', a: { part: A } }],
  });
  assert.deepEqual(grounded.parts[0].placement, ident);
  assert.equal(grounded.parts[0].position, undefined);
  assert.equal(grounded.joints[0].b, undefined);
  assert.equal(removePart(grounded, PATH_A).joints, undefined);
});

test('copying a part onto a new surf id drops the joint instead of retargeting it', () => {
  const doc = serializeAssembly({
    source: 'git',
    name: 'Gearbox',
    parts: [
      { id: PATH_A, name: 'Bracket', surfId: A, position: [1, 0, 0] },
      { id: PATH_B, name: 'Housing', surfId: B },
    ],
    joints: [coincident()],
  });
  const copied = serializeAssembly({
    ...doc,
    parts: doc.parts.map((part) => (part.surfId === A ? { ...part, surfId: GONE } : part)),
  });
  assert.equal(copied.joints, undefined);
  assert.equal(copied.parts.find((part) => part.surfId === GONE).placement, undefined);
});

test('a legacy local- prefix on a joint follows the part', () => {
  const localA = `local-${A}`;
  const localJ = `local-${J}`;
  const text = `${JSON.stringify(surf(
    [row(PATH_A, localA, 0), row(PATH_B, B, 1)],
    { joints: [{ ...coincident(), id: localJ, a: faceRef(localA, FACE) }] },
  ), null, 2)}\n`;
  const promoted = rewriteVaultFile('assemblies/Gearbox/.surf.json', text);
  const parsed = JSON.parse(promoted);
  assert.equal(parsed.parts[0].id, A);
  assert.equal(parsed.joints[0].id, J);
  assert.equal(parsed.joints[0].a.part, A);
  assert.equal(parsed.joints[0].b.part, B);
  assert.equal(rewriteVaultFile('assemblies/Gearbox/.surf.json', promoted), promoted);
  const memory = migrateAssemblyRecords({
    doc: {
      source: 'local',
      name: 'Gearbox',
      parts: [{ id: PATH_A, name: 'Bracket', surfId: localA }],
      joints: [{ id: localJ, name: 'Ground 1', type: 'fixed', a: { part: localA } }],
    },
    scripts: {},
  });
  assert.equal(memory.doc.parts[0].surfId, A);
  assert.equal(memory.doc.joints[0].id, J);
  assert.equal(memory.doc.joints[0].a.part, A);
  assert.equal(migrateAssemblyRecords({ doc: memory.doc, scripts: {} }).changed, false);
});

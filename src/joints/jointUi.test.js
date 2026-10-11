import assert from 'node:assert/strict';
import test from 'node:test';
import { serializeAssembly } from '../utils/assembly.js';
import { composeMoveCommit } from '../utils/moveMode.js';
import { displayToMm, lengthCaption, lengthToDisplay } from '../utils/displayUnit.js';
import { refreshAssemblyJoints } from './refreshJoints.js';
import {
  SAME_PART_MESSAGE,
  acceptJointPick,
  applyAssemblySnapshot,
  groupPicksByPart,
  planarAnglePair,
  quickAngleCard,
  resolvePartChange,
  applyJointCard,
  assemblyHistoryCanUndo,
  buildJointRecord,
  cardFromJoint,
  dismissJointEdit,
  draftFromPicks,
  emptyClickCadSelection,
  jointChipTitle,
  jointChips,
  jointHighlightEntries,
  jointConfirmDisabled,
  jointTagAnchor,
  stickyJointPick,
  jointsChromeMounted,
  cadStripsShowJoints,
  shouldArmJointPick,
  nextJointName,
  pushAssemblyHistory,
  seedAssemblyHistory,
  stripUndoLabel,
  stripUndoTarget,
  suggestJointType,
  typeFits,
  planarGapMm,
  undoJointStrip,
} from './jointUi.js';

const A = '2026-10-10-03-00-00-0001-aaaa';
const B = '2026-10-10-03-00-00-0002-bbbb';
const J = '2026-10-10-03-00-00-0003-cccc';

const face = (surfId, name, at, n) => ({
  partId: name,
  surfId,
  partName: name,
  kind: 'face',
  planar: true,
  axis: false,
  key: { at, n, area: 1 },
});

const axis = (surfId, name) => ({
  partId: name,
  surfId,
  partName: name,
  kind: 'axis',
  planar: false,
  axis: true,
  key: { at: [0, 0, 0], dir: [0, 0, 1], radius: 2 },
});

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

function docWith(joints) {
  return {
    version: 1,
    source: 'local',
    name: 'Assembly',
    activeId: 'a.js',
    parts,
    joints,
  };
}

test('a plane suggests coincident, or parallel when the gap is open', () => {
  const plane = (surfId, name, id, at, n) => ({
    partId: name,
    surfId,
    partName: name,
    kind: 'plane',
    planar: true,
    axis: false,
    key: { id, at, n },
  });
  const near = [
    plane(A, 'Shaft', 'origin:xy', [0, 0, 0], [0, 0, 1]),
    face(B, 'Housing', [0, 0, 1], [0, 0, 1]),
  ];
  assert.equal(suggestJointType(near), 'coincident');
  const offset = [
    plane(A, 'Shaft', 'origin:xy', [0, 0, 0], [0, 0, 1]),
    face(B, 'Housing', [0, 0, 12], [0, 0, 1]),
  ];
  assert.equal(suggestJointType(offset), 'parallel');
  const tilted = [
    plane(A, 'Shaft', 'workplane:deck', [0, 0, 0], [0, 0, 1]),
    face(B, 'Housing', [0, 0, 0], [1, 0, 0]),
  ];
  assert.equal(suggestJointType(tilted), 'coincident');
  const drafted = draftFromPicks(null, offset, { joints: [] });
  assert.equal(drafted.suggested, 'parallel');
  assert.equal(drafted.type, 'angle');
  assert.equal(drafted.valueMm, 0);
  assert.equal(typeFits('angle', offset), true);
  assert.ok(planarAnglePair(offset));
  const both = acceptJointPick([], plane(A, 'Shaft', 'origin:xy', [0, 0, 0], [0, 0, 1]));
  const yz = acceptJointPick(both.picks, plane(A, 'Shaft', 'origin:yz', [0, 0, 0], [1, 0, 0]));
  assert.equal(yz.picks.length, 2);
  assert.equal(yz.picks[0].key.id, 'origin:xy');
  assert.equal(yz.picks[1].key.id, 'origin:yz');
});

test('two planar faces suggest coincident and two axes suggest concentric', () => {
  const faces = [face(A, 'Shaft', [0, 0, 1], [0, 0, 1]), face(B, 'Housing', [0, 0, -1], [0, 0, -1])];
  assert.equal(suggestJointType(faces), 'coincident');
  assert.equal(planarGapMm(faces) < 5, true);
  assert.equal(suggestJointType([axis(A, 'Shaft'), axis(B, 'Housing')]), 'concentric');
  assert.equal(suggestJointType([face(A, 'Shaft', [0, 0, 1], [0, 0, 1])]), null);
  assert.equal(typeFits('fixed', faces), false);
});

test('round faces and circular edges suggest concentric', () => {
  const cyl = (surfId, name) => ({
    surfId,
    partName: name,
    kind: 'face',
    planar: false,
    axis: true,
    key: { at: [0, 0, 0], dir: [0, 0, 1], radius: 5 },
  });
  const circle = (surfId, name) => ({
    surfId,
    partName: name,
    kind: 'edge',
    planar: false,
    axis: false,
    key: { at: [0, 0, 0], dir: [0, 0, 1], radius: 4 },
  });
  assert.equal(suggestJointType([cyl(A, 'Shaft'), cyl(B, 'Housing')]), 'concentric');
  assert.equal(suggestJointType([circle(A, 'Shaft'), circle(B, 'Housing')]), 'concentric');
  assert.equal(suggestJointType([circle(A, 'Shaft'), axis(B, 'Housing')]), 'concentric');
});

test('parallel planar faces with an offset suggest distance, and the user can override', () => {
  const far = [face(A, 'Shaft', [0, 0, 0], [0, 0, 1]), face(B, 'Housing', [0, 0, 12], [0, 0, 1])];
  assert.equal(suggestJointType(far), 'distance');
  const drafted = draftFromPicks(null, far, { joints: [] });
  assert.equal(drafted.type, 'distance');
  assert.equal(drafted.suggested, 'distance');
  assert.ok(Math.abs(drafted.valueMm - 12) < 1e-6);
  const overridden = draftFromPicks(
    { ...drafted, type: 'coincident', userPickedType: true },
    far,
    { joints: [] },
  );
  assert.equal(overridden.type, 'coincident');
  assert.equal(overridden.userPickedType, true);
});

test('a second face on the same part stays grouped, and one part still cannot confirm', () => {
  const first = acceptJointPick([], face(A, 'Shaft', [0, 0, 1], [0, 0, 1]));
  const second = acceptJointPick(first.picks, face(A, 'Shaft', [0, 0, -1], [0, 0, -1]));
  assert.equal(second.refuse, false);
  assert.equal(second.picks.length, 2);
  assert.equal(groupPicksByPart(second.picks).length, 1);
  const built = buildJointRecord({
    ...draftFromPicks(null, second.picks, { joints: [] }),
    type: 'coincident',
    id: J,
    name: 'Coincident 1',
  });
  assert.equal(built.ok, false);
  assert.equal(built.message, SAME_PART_MESSAGE);
});

const C = '2026-10-10-03-00-00-0004-dddd';

test('picks group by part in any order and two faces each suggest symmetric', () => {
  const faces = {
    a1: face(A, 'Shaft', [0, 0, 1], [0, 0, 1]),
    a2: face(A, 'Shaft', [0, 0, -1], [0, 0, -1]),
    b1: face(B, 'Housing', [0, 0, 1], [0, 0, 1]),
    b2: face(B, 'Housing', [0, 0, -1], [0, 0, -1]),
  };
  for (const order of [
    [faces.a1, faces.a2, faces.b1, faces.b2],
    [faces.a1, faces.b1, faces.a2, faces.b2],
    [faces.b1, faces.b2, faces.a1, faces.a2],
  ]) {
    let picks = [];
    for (const pick of order) picks = acceptJointPick(picks, pick).picks;
    assert.equal(suggestJointType(picks), 'symmetric');
    assert.equal(groupPicksByPart(picks).length, 2);
    assert.equal(groupPicksByPart(picks).every((group) => group.picks.length === 2), true);
  }
  const drafted = draftFromPicks(null, [
    faces.b1, faces.a1, faces.b2, faces.a2,
  ].reduce((list, pick) => acceptJointPick(list, pick).picks, []), { joints: [] });
  assert.equal(drafted.type, 'symmetric');
  assert.equal(drafted.suggested, 'symmetric');
  const written = buildJointRecord({ ...drafted, id: J, name: drafted.name }, { id: J, name: drafted.name });
  assert.equal(written.ok, true);
  assert.equal(written.joint.a.part, B);
  assert.equal(written.joint.a2.part, B);
  assert.equal(written.joint.b.part, A);
  assert.equal(written.joint.b2.part, A);
});

test('a third part asks which side to replace', () => {
  let picks = [];
  picks = acceptJointPick(picks, face(A, 'Shaft', [0, 0, 1], [0, 0, 1])).picks;
  picks = acceptJointPick(picks, face(B, 'Housing', [0, 0, -1], [0, 0, -1])).picks;
  const third = acceptJointPick(picks, face(C, 'Bracket', [1, 0, 0], [1, 0, 0]));
  assert.equal(third.choice.part1, 'Shaft');
  assert.equal(third.choice.part2, 'Housing');
  assert.equal(third.picks.length, 2);
  const discarded = resolvePartChange(third.picks, third.choice.pick, 'discard');
  assert.equal(discarded.length, 2);
  assert.equal(discarded.some((pick) => pick.surfId === C), false);
  const replaced = resolvePartChange(third.picks, third.choice.pick, 'replace-2');
  assert.deepEqual(replaced.map((pick) => pick.surfId), [A, C]);
  const replacedFirst = resolvePartChange(third.picks, third.choice.pick, 'replace-1');
  assert.deepEqual(replacedFirst.map((pick) => pick.surfId), [C, B]);
});

test('reopening a joint restores its type, value, and face highlights', () => {
  const angle = cardFromJoint({
    id: J,
    name: 'Angle 1',
    type: 'angle',
    value: 0,
    sense: 1,
    a: { part: A, kind: 'face', key: { at: [0, 0, 1], n: [0, 0, 1], area: 1 } },
    b: { part: B, kind: 'face', key: { at: [0, 0, 1], n: [0, 0, 1], area: 1 } },
  }, docWith([]));
  assert.equal(angle.mode, 'edit');
  assert.equal(angle.type, 'angle');
  assert.equal(angle.valueMm, 0);
  assert.equal(angle.picks[0].partId, 'a.js');
  assert.equal(angle.picks[1].partId, 'b.js');
  const painted = jointHighlightEntries(angle, docWith([]), {
    [A]: { faces: [{ at: [0, 0, 1], n: [0, 0, 1], area: 1, tris: [4, 5] }] },
    [B]: { faces: [{ at: [0, 0, 1], n: [0, 0, 1], area: 1, tris: [1] }] },
  });
  assert.deepEqual(painted.map((row) => row.partId), ['a.js', 'b.js']);
  assert.deepEqual(painted[0].tris, [4, 5]);
  const symmetric = cardFromJoint({
    id: J,
    name: 'Symmetric 1',
    type: 'symmetric',
    a: { part: A, kind: 'face', key: { at: [0, 0, 1], n: [0, 0, 1], area: 1 } },
    a2: { part: A, kind: 'face', key: { at: [0, 0, -1], n: [0, 0, -1], area: 1 } },
    b: { part: B, kind: 'face', key: { at: [0, 0, 1], n: [0, 0, 1], area: 1 } },
    b2: { part: B, kind: 'face', key: { at: [0, 0, -1], n: [0, 0, -1], area: 1 } },
  }, docWith([]));
  assert.equal(symmetric.mode, 'edit');
  assert.equal(symmetric.type, 'symmetric');
  assert.equal(symmetric.picks.length, 4);
  assert.equal(symmetric.valueMm, undefined);
});

test('parallel and perpendicular write an angle joint without an extra value step', () => {
  const card = draftFromPicks(null, [
    face(A, 'Shaft', [0, 0, 1], [0, 0, 1]),
    face(B, 'Housing', [0, 0, 1], [0, 0, -1]),
  ], { joints: [] });
  assert.ok(planarAnglePair(card.picks));
  const parallel = quickAngleCard(card, 0, docWith(undefined));
  assert.equal(parallel.type, 'angle');
  assert.equal(parallel.valueMm, 0);
  assert.equal(parallel.sense, -1);
  const perpendicular = quickAngleCard(card, 90, docWith(undefined));
  assert.equal(perpendicular.valueMm, 90);
  assert.equal(perpendicular.sense, 1);
  const scripts = { 'a.js': 'let part = 1;\n' };
  const result = applyJointCard({
    doc: docWith(undefined),
    scripts,
    card: parallel,
    catalogs: {
      [A]: { faces: [parallel.picks[0].key] },
      [B]: { faces: [parallel.picks[1].key] },
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.scripts, scripts);
  assert.equal(result.doc.joints[0].type, 'angle');
  assert.equal(result.doc.joints[0].value, 0);
  assert.equal(result.doc.joints[0].sense, -1);
  const right = quickAngleCard(draftFromPicks(null, [
    face(A, 'Shaft', [0, 0, 1], [0, 0, 1]),
    face(B, 'Housing', [0, 0, 0], [1, 0, 0]),
  ], { joints: [] }), 90, docWith(undefined));
  const perp = applyJointCard({
    doc: docWith(undefined),
    scripts,
    card: right,
    catalogs: {
      [A]: { faces: [right.picks[0].key] },
      [B]: { faces: [right.picks[1].key] },
    },
  });
  assert.equal(perp.ok, true);
  assert.equal(perp.doc.joints[0].value, 90);
  const edited = applyJointCard({
    doc: perp.doc,
    scripts,
    card: { ...cardFromJoint(perp.doc.joints[0], perp.doc), valueMm: 60 },
    catalogs: {
      [A]: { faces: [right.picks[0].key] },
      [B]: { faces: [right.picks[1].key] },
    },
  });
  assert.equal(edited.ok, true, edited.message || '');
  assert.equal(edited.doc.joints[0].value, 60);
  assert.equal(edited.doc.joints.length, 1);
});

test('fixed is available after one tap and is not the two-face suggestion', () => {
  const one = draftFromPicks(null, [face(A, 'Shaft', [0, 0, 1], [0, 0, 1])], { joints: [] });
  assert.equal(one.suggested, null);
  assert.equal(typeFits('fixed', one.picks), true);
  const grounded = { ...one, type: 'fixed', userPickedType: true };
  assert.equal(jointConfirmDisabled({ card: grounded }), false);
  const two = draftFromPicks(null, [
    face(A, 'Shaft', [0, 0, 1], [0, 0, 1]),
    face(B, 'Housing', [0, 0, -1], [0, 0, -1]),
  ], { joints: [] });
  assert.equal(two.suggested, 'coincident');
  assert.notEqual(two.suggested, 'fixed');
});

test('confirm writes a joint and leaves the scripts object untouched', () => {
  const card = draftFromPicks(null, [
    face(A, 'Shaft', [0, 0, 0.5], [0, 0, 1]),
    face(B, 'Housing', [0, 0, -0.5], [0, 0, -1]),
  ], { joints: [] });
  const scripts = { 'a.js': 'let part = 1;\n' };
  const doc = docWith(undefined);
  const result = applyJointCard({
    doc,
    scripts,
    card,
    catalogs: {
      [A]: { faces: [card.picks[0].key] },
      [B]: { faces: [card.picks[1].key] },
    },
    preempt: () => { throw new Error('preempt'); },
  });
  assert.equal(result.ok, true);
  assert.equal(result.scripts, scripts);
  assert.equal(result.doc.joints.length, 1);
  assert.equal(result.doc.joints[0].type, 'coincident');
  assert.equal(result.doc.joints[0].name, 'Coincident 1');
  assert.equal(dismissJointEdit(doc), doc);
});

test('a confirm whose reference does not match is not written', () => {
  const card = draftFromPicks(null, [
    face(A, 'Shaft', [0, 0, 0.5], [0, 0, 1]),
    face(B, 'Housing', [0, 0, -0.5], [0, 0, -1]),
  ], { joints: [] });
  const scripts = { 'a.js': 'x' };
  const doc = docWith(undefined);
  const result = applyJointCard({
    doc,
    scripts,
    card,
    catalogs: {
      [A]: { faces: [{ at: [0, 0, 0.5], n: [0, 0, 1], area: 1 }] },
      [B]: { faces: [{ at: [8, 0, -0.5], n: [0, 0, -1], area: 1 }] },
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.doc, doc);
  assert.equal(result.scripts, scripts);
  assert.match(result.message, /Housing/);
});

test('a locked confirm writes nothing and does not preempt', () => {
  let calls = 0;
  const scripts = { 'a.js': 'x' };
  const doc = docWith([]);
  const result = applyJointCard({
    doc,
    scripts,
    card: { type: 'fixed', picks: [face(A, 'Shaft', [0, 0, 1], [0, 0, 1])] },
    locked: true,
    preempt: () => { calls += 1; },
  });
  assert.equal(result.ok, false);
  assert.equal(result.doc, doc);
  assert.equal(result.scripts, scripts);
  assert.equal(calls, 0);
});

test('delete removes the joint and does not change scripts', () => {
  const joint = {
    id: J,
    name: 'Coincident 1',
    type: 'coincident',
    opposed: true,
    a: { part: A, kind: 'face', key: { at: [0, 0, 0.5], n: [0, 0, 1], area: 1 } },
    b: { part: B, kind: 'face', key: { at: [0, 0, -0.5], n: [0, 0, -1], area: 1 } },
  };
  const scripts = { 'a.js': 'script' };
  const doc = docWith([joint]);
  const result = applyJointCard({
    doc,
    scripts,
    card: cardFromJoint(joint, doc),
    action: 'delete',
    catalogs: {},
  });
  assert.equal(result.ok, true);
  assert.equal(result.scripts, scripts);
  assert.equal(serializeAssembly(result.doc).joints, undefined);
});

test('strip undo restores joints and placements and leaves scripts', () => {
  const before = docWith(undefined);
  const after = docWith([{
    id: J,
    name: 'Fixed 1',
    type: 'fixed',
    a: { part: A },
  }]);
  after.parts = after.parts.map((part) => (
    part.surfId === B
      ? { ...part, placement: { t: [1, 2, 3], q: [0, 0, 0, 1] } }
      : part
  ));
  const history = pushAssemblyHistory(seedAssemblyHistory(before), before, after);
  const scripts = { 'a.js': 'stay' };
  const step = undoJointStrip({ history, doc: after, scripts });
  assert.equal(step.changed, true);
  assert.equal(step.scripts, scripts);
  assert.equal(step.doc.joints, undefined);
  assert.deepEqual(step.doc.parts.find((part) => part.surfId === B).position, [0, 0, 5]);
  assert.equal(stripUndoTarget(null), 'joint');
  assert.equal(stripUndoTarget('a.js'), 'part');
  assert.equal(stripUndoLabel(null), 'Undo joint');
  assert.equal(stripUndoLabel('a.js'), 'Undo');
  const reseed = seedAssemblyHistory(after);
  assert.equal(assemblyHistoryCanUndo(reseed), false);
});

test('an empty click clears the CAD part and leaves the active part', () => {
  const next = emptyClickCadSelection({ cadPartId: 'b.js', activeId: 'a.js' });
  assert.equal(next.cadPartId, null);
  assert.equal(next.activeId, 'a.js');
  const held = emptyClickCadSelection({ cadPartId: 'b.js', activeId: 'a.js', featureSession: true });
  assert.equal(held.cadPartId, 'b.js');
  assert.equal(held.activeId, 'a.js');
});

test('a sticky chip keeps the fingerprint off the id and labels an edge as a line', () => {
  const chip = stickyJointPick({ surfId: A, partName: 'Shaft', kind: 'edge', key: { at: [1, 0, 0] } }, 0);
  assert.equal(chip.id, `${A}:0`);
  assert.equal(chip.kind, 'edge');
  assert.equal(chip.label, 'Shaft · line');
  assert.equal('key' in chip, false);
});

test('a joint tag sits on the midpoint of the two world references', () => {
  const joint = {
    id: J,
    name: 'Coincident 1',
    type: 'coincident',
    a: { part: A, kind: 'face', key: { at: [0, 0, 0.5], n: [0, 0, 1], area: 1 } },
    b: { part: B, kind: 'face', key: { at: [0, 0, -0.5], n: [0, 0, -1], area: 1 } },
  };
  assert.deepEqual(jointTagAnchor(docWith([joint]), joint), [0, 0, 2.5]);
  assert.deepEqual(jointTagAnchor(docWith([joint]), { ...joint, b: undefined }), [0, 0, 0.5]);
});

test('broken and conflict chips carry the name and the sentence', () => {
  const joint = { id: J, name: 'Coincident 1', type: 'coincident' };
  assert.equal(
    jointChipTitle(joint, 'broken', 'Face not found on Housing'),
    'Coincident 1 — Face not found on Housing',
  );
  const chips = jointChips(docWith([joint]), {
    statuses: { [J]: 'conflict' },
    messages: { [J]: 'Joint "Coincident 1" conflicts' },
  });
  assert.equal(chips[0].invalid, true);
  assert.match(chips[0].title, /Coincident 1/);
  assert.match(chips[0].title, /conflicts/);
});

test('game mode mounts no joint card', () => {
  assert.equal(jointsChromeMounted({ appMode: 'game' }), false);
  assert.equal(jointsChromeMounted({ appMode: 'cad', featureSession: true }), false);
  assert.equal(jointsChromeMounted({ appMode: 'cad' }), true);
});

test('distance display converts and the stored value stays millimetres', () => {
  assert.equal(lengthCaption('Distance', 'in'), 'Distance in');
  assert.equal(lengthToDisplay(25.4, 'in'), 1);
  const mm = displayToMm('1', 'in');
  assert.equal(mm, 25.4);
  const card = {
    type: 'distance',
    name: 'Distance 1',
    id: J,
    valueMm: mm,
    sense: 1,
    picks: [
      face(A, 'Shaft', [0, 0, 1], [0, 0, 1]),
      face(B, 'Housing', [0, 0, -1], [0, 0, 1]),
    ],
  };
  const built = buildJointRecord(card, { id: J, name: card.name });
  assert.equal(built.ok, true);
  assert.equal(built.joint.value, 25.4);
  assert.equal(built.joint.sense, 1);
});

test('names come from the numbered allocator', () => {
  assert.equal(nextJointName('coincident', []), 'Coincident 1');
  assert.equal(nextJointName('coincident', [{ name: 'Coincident 1' }]), 'Coincident 2');
});

test('Move Body by 10 mm is the only script change and breaks the joint', () => {
  const script = 'let part = cube([20, 20, 20]);\nreturn part;\n';
  const moved = composeMoveCommit(script, {
    direction: 'xyz',
    dx: 10,
    dy: 0,
    dz: 0,
    target: { at: [10, 10, 10] },
    body: 'part',
  });
  assert.equal(moved.ok, true);
  assert.match(moved.buffer, /move\(part, \[10, 0, 0\]/);
  assert.equal((moved.buffer.match(/\bmove\s*\(/g) || []).length, 1);
  assert.equal(script.includes('move('), false);
  const joint = {
    id: J,
    name: 'Coincident 1',
    type: 'coincident',
    opposed: true,
    a: { part: A, kind: 'face', key: { at: [0, 0, 0.5], n: [0, 0, 1], area: 1 } },
    b: { part: B, kind: 'face', key: { at: [0, 0, -0.5], n: [0, 0, -1], area: 1 } },
  };
  const doc = docWith([joint]);
  const seed = doc.parts[1].placement.t.slice();
  const refreshed = refreshAssemblyJoints({
    doc,
    catalogs: {
      [A]: { faces: [{ at: [10, 0, 0.5], n: [0, 0, 1], area: 1 }] },
      [B]: { faces: [{ at: [0, 0, -0.5], n: [0, 0, -1], area: 1 }] },
    },
  });
  assert.equal(shouldArmJointPick({ cadPartId: null, kind: 'face' }), false);
  assert.equal(shouldArmJointPick({ jointPicking: true, kind: 'face' }), true);
  assert.equal(shouldArmJointPick({ jointPicking: true, kind: 'point' }), true);
  assert.equal(shouldArmJointPick({ jointPicking: true, kind: 'body' }), false);
  assert.equal(shouldArmJointPick({ jointPicking: true, appMode: 'game', kind: 'edge' }), false);
  assert.equal(shouldArmJointPick({ jointPicking: true, featureSession: true, kind: 'face' }), false);
  assert.equal(cadStripsShowJoints(null), true);
  assert.equal(cadStripsShowJoints('a.js'), false);
  assert.equal(refreshed.statuses[J], 'broken');
  assert.equal(refreshed.changed, false);
  assert.deepEqual(refreshed.doc.parts[1].placement.t, seed);
  const restored = applyAssemblySnapshot(doc, seedAssemblyHistory(doc).commits[0]);
  assert.equal(restored.joints[0].id, J);
});

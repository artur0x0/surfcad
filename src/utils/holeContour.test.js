import assert from 'node:assert/strict';
import test from 'node:test';
import { markerWithId } from './featureBlockId.js';
import { deleteFeatureBlock } from './featureSheetWriteback.js';
import { parseFeatureMarkers } from './featureMarkers.js';
import {
  CLEARANCE_HOLE_BEGIN,
  CLEARANCE_HOLE_END,
  CONTOUR_EXTRUDE_BEGIN,
  CONTOUR_EXTRUDE_END,
  CUBE_BEGIN,
  CUBE_END,
  HOLE_BEGIN,
  HOLE_END,
} from './helperPaletteSnippets.js';
import { commitScriptAtRollback, evaluationScript, resolveRollback } from './featureSkip.js';
import {
  contourFeatureUsers,
  contourUsedByText,
  deleteContourStatement,
  featuresWithContours,
} from './contourUsers.js';
import {
  composeHoleOnContour,
  readCentersContour,
  readContourHole,
  rewriteCentersContour,
} from './holeContour.js';

const FRAME = {
  center: [0, 0, 10],
  normal: [0, 0, 1],
  x: [1, 0, 0],
  y: [0, 1, 0],
};

const POINTS = {
  points: [
    { id: 'p0', at: [12, 8] },
    { id: 'c0', at: [20, 8] },
  ],
  lines: [{ id: 'e0', a: 'p0', b: 'c0' }],
  arcs: [{ id: 'a0', center: 'c0', radius: 8, full: true, sweep: 'ccw' }],
  dimensions: [{ id: 'd0', kind: 'distance', a: 'p0', b: 'c0', value: 8, name: 'pitch' }],
};

const SPEC = {
  type: 'clearance',
  size: 'M3',
  fit: 'normal',
  through: true,
  side: 1,
  near: { kind: 'cbore', dia: 6.5, depth: 3.5 },
  far: { kind: 'none' },
};

function region(begin, end, id, body) {
  return `${markerWithId(begin, id)}\n${body}\n${markerWithId(end, id)}`;
}

function cubeScript(extra = '') {
  return [
    region(CUBE_BEGIN, CUBE_END, 'cube1', 'let part = Manifold.cube([40, 40, 20], true);'),
    extra,
    'return part;',
    '// study stays',
    '',
  ].filter((line) => line !== undefined).join('\n');
}

test('a new hole writes a centres contour and one block before return part', () => {
  const script = cubeScript();
  const wrote = composeHoleOnContour(script, { frame: FRAME, contour: POINTS, spec: SPEC });
  assert.equal(wrote.ok, true, wrote.message || '');
  assert.equal(wrote.featureId, 'hole1');
  assert.equal(wrote.contourId, 'c1');
  assert.equal(wrote.createdContour, true);
  const buf = wrote.buffer;
  assert.match(buf, /\/\/ @contour id=c1 role=centers/);
  assert.match(buf, /centers: true/);
  assert.match(buf, /construction: true/);
  assert.match(buf, /id=hole1/);
  assert.match(buf, /part = holesOnContour\(part, c1, \{ type: 'clearance', size: 'M3', fit: 'normal', through: true, side: 1, near: \{ kind: 'cbore', dia: 6\.5, depth: 3\.5 \}, far: \{ kind: 'none' \} \}\);/);
  assert.ok(buf.indexOf('role=centers') < buf.indexOf('id=hole1'));
  assert.ok(buf.indexOf('id=hole1') < buf.indexOf('return part;'));
  assert.ok(buf.indexOf('return part;') < buf.indexOf('// study stays'));
  const chips = featuresWithContours(buf).map((chip) => chip.id);
  assert.deepEqual(chips, ['cube1', 'contour:c1', 'hole1']);
  assert.equal(featuresWithContours(buf).find((chip) => chip.id === 'contour:c1').unused, false);
  assert.equal(contourUsedByText(buf, 'c1'), 'Used by Hole 1');
});

test('a second hole names the same contour and only adds its block', () => {
  const first = composeHoleOnContour(cubeScript(), { frame: FRAME, contour: POINTS, spec: SPEC });
  const second = composeHoleOnContour(first.buffer, {
    contourId: 'c1',
    spec: { dia: 4.2, through: false, depth: 8, side: -1 },
  });
  assert.equal(second.ok, true, second.message || '');
  assert.equal(second.featureId, 'hole2');
  assert.equal(second.createdContour, false);
  assert.equal(second.buffer.split('makeCrossSection').length - 1, 1);
  assert.match(second.buffer, /holesOnContour\(part, c1, \{ dia: 4\.2, through: false, depth: 8, side: -1 \}\)/);
  assert.equal(contourUsedByText(second.buffer, 'c1'), 'Used by Hole 1, Hole 2');
  const ask = deleteContourStatement(second.buffer, 'c1');
  assert.equal(ask.confirm, true);
  assert.equal(ask.count, 2);
  assert.equal(ask.message, 'Delete along with 2 features');
  const saved = deleteContourStatement(second.buffer, 'c1', { withFeatures: true });
  assert.equal(saved.ok, true);
  assert.doesNotMatch(saved.buffer, /holesOnContour|@contour|makeCrossSection/);
  assert.match(saved.buffer, /Manifold\.cube/);
});

test('deleting one hole leaves the shared contour', () => {
  const first = composeHoleOnContour(cubeScript(), { frame: FRAME, contour: POINTS, spec: SPEC });
  const second = composeHoleOnContour(first.buffer, {
    contourId: 'c1',
    spec: { dia: 4, depth: 6, side: 1 },
  });
  const hole = parseFeatureMarkers(second.buffer).find((feature) => feature.id === 'hole1');
  const dropped = deleteFeatureBlock(second.buffer, hole);
  assert.equal(dropped.ok, true);
  assert.match(dropped.buffer, /@contour id=c1 role=centers/);
  assert.match(dropped.buffer, /id=hole2/);
  assert.doesNotMatch(dropped.buffer, /id=hole1/);
  assert.equal(contourFeatureUsers(dropped.buffer, 'c1').map((user) => user.id).join(','), 'hole2');
});

test('an old hole block is not rewritten into a contour hole', () => {
  const old = cubeScript(region(
    HOLE_BEGIN,
    HOLE_END,
    'hole9',
    'part = hole(part, fr, 0, 0, 5, 12);',
  ));
  const refused = composeHoleOnContour(old, {
    featureId: 'hole9',
    frame: FRAME,
    contour: POINTS,
    spec: SPEC,
  });
  assert.equal(refused.ok, false);
  assert.equal(refused.buffer, undefined);
  assert.match(old, /part = hole\(part, fr, 0, 0, 5, 12\);/);
  const added = composeHoleOnContour(old, { frame: FRAME, contour: POINTS, spec: SPEC });
  assert.equal(added.ok, true, added.message || '');
  assert.equal(added.featureId, 'hole1');
  assert.match(added.buffer, /part = hole\(part, fr, 0, 0, 5, 12\);/);
  assert.match(added.buffer, /holesOnContour\(part, c1/);
  const clearance = region(
    CLEARANCE_HOLE_BEGIN,
    CLEARANCE_HOLE_END,
    'clearanceHole1',
    "const ignored = c1;\npart = clearanceHole(part, fr, 0, 0, 'M3');",
  );
  assert.deepEqual(
    contourFeatureUsers(`${added.buffer}\n${clearance}`, 'c1').map((user) => user.kind),
    ['hole'],
  );
});

test('no centres on a new hole writes nothing, and clearing the last centre keeps the hole', () => {
  const script = cubeScript();
  const empty = composeHoleOnContour(script, {
    frame: FRAME,
    contour: { points: [] },
    spec: { dia: 4, depth: 6 },
  });
  assert.equal(empty.empty, true);
  assert.equal(empty.buffer, script);
  const wrote = composeHoleOnContour(script, { frame: FRAME, contour: POINTS, spec: { dia: 4, depth: 6, side: 1 } });
  const cleared = composeHoleOnContour(wrote.buffer, {
    featureId: 'hole1',
    frame: FRAME,
    contour: { points: [], lines: [], arcs: [] },
    spec: { dia: 4, depth: 6, side: 1 },
  });
  assert.equal(cleared.ok, true, cleared.message || '');
  assert.match(cleared.buffer, /id=hole1/);
  assert.match(cleared.buffer, /points: \[\]/);
  assert.match(cleared.buffer, /holesOnContour/);
});

test('a mid-strip accept moves the fresh centres contour with the hole', () => {
  const script = cubeScript(region(
    CONTOUR_EXTRUDE_BEGIN,
    CONTOUR_EXTRUDE_END,
    'extrude1',
    'part = part.add(placeInFrame(c0.plane, makeExtrude(c0.contours, 8), [0, 0, 0]));',
  ));
  const wrote = composeHoleOnContour(script, { frame: FRAME, contour: POINTS, spec: SPEC });
  assert.ok(wrote.buffer.indexOf('id=hole1') > wrote.buffer.indexOf('id=extrude1'));
  const placed = commitScriptAtRollback(script, wrote.buffer, 'cube1');
  assert.equal(placed.anchor, 'hole1');
  const buf = placed.buffer;
  assert.ok(buf.indexOf('id=cube1') < buf.indexOf('role=centers'));
  assert.ok(buf.indexOf('role=centers') < buf.indexOf('id=hole1'));
  assert.ok(buf.indexOf('id=hole1') < buf.indexOf('id=extrude1'));
  const copy = evaluationScript(buf, { anchorId: 'hole1' });
  assert.match(copy, /role=centers/);
  assert.match(copy, /holesOnContour/);
  assert.equal(copy.includes('makeExtrude'), false);
  const plan = resolveRollback(buf, 'contour:c1');
  assert.deepEqual(plan.skipIds, ['hole1', 'extrude1']);
  assert.ok(plan.ids.includes('contour:c1'));
});

test('a second hole stays after the contour it names', () => {
  const base = cubeScript(region(
    CONTOUR_EXTRUDE_BEGIN,
    CONTOUR_EXTRUDE_END,
    'extrude1',
    'part = part.add(placeInFrame(c0.plane, makeExtrude(c0.contours, 8), [0, 0, 0]));',
  ));
  const first = composeHoleOnContour(base, { frame: FRAME, contour: POINTS, spec: SPEC });
  const parked = commitScriptAtRollback(base, first.buffer, 'extrude1');
  assert.equal(parked.anchor, 'hole1');
  const second = composeHoleOnContour(parked.buffer, {
    contourId: 'c1',
    spec: { dia: 5, depth: 4, flip: true },
  });
  assert.match(second.buffer, /side: -1/);
  const placed = commitScriptAtRollback(parked.buffer, second.buffer, 'cube1');
  assert.equal(placed.anchor, 'hole2');
  const buf = placed.buffer;
  assert.equal(buf.split('makeCrossSection').length - 1, 1);
  assert.ok(buf.indexOf('role=centers') < buf.indexOf('id=hole2'));
  assert.ok(buf.indexOf('id=hole2') < buf.indexOf('id=hole1'));
  const copy = evaluationScript(buf, { anchorId: 'hole2' });
  assert.match(copy, /role=centers/);
  assert.match(copy, /dia: 5/);
  assert.match(copy, /makeExtrude/);
  assert.equal(copy.includes("size: 'M3'"), false);
});

function solveCall(script) {
  const at = script.indexOf('solveContour');
  const end = script.indexOf('); // @contour', at);
  return script.slice(at, end);
}

test('a spec edit rewrites that hole and leaves the contour and the bar', () => {
  const wrote = composeHoleOnContour(cubeScript(), { frame: FRAME, contour: POINTS, spec: SPEC });
  const opened = readContourHole(wrote.buffer, 'hole1');
  assert.equal(opened.featureId, 'hole1');
  assert.equal(opened.contourId, 'c1');
  assert.equal(opened.contourName, 'c1');
  assert.equal(opened.spec.side, 1);
  assert.equal(opened.spec.size, 'M3');
  const solve = solveCall(wrote.buffer);
  const edited = composeHoleOnContour(wrote.buffer, {
    featureId: 'hole1',
    spec: { dia: 5, through: true, side: -1 },
  });
  assert.equal(edited.ok, true, edited.message || '');
  assert.match(edited.buffer, /dia: 5/);
  assert.match(edited.buffer, /side: -1/);
  assert.equal(solveCall(edited.buffer), solve);
  assert.equal(
    edited.buffer.split('holesOnContour').length,
    wrote.buffer.split('holesOnContour').length,
  );
  const placed = commitScriptAtRollback(wrote.buffer, edited.buffer, 'hole1');
  assert.equal(placed.anchor, 'hole1');
  assert.ok(placed.buffer.indexOf('role=centers') < placed.buffer.indexOf('id=hole1'));
});

test('clearing the last centre rewrites the contour and leaves the hole block', () => {
  const wrote = composeHoleOnContour(cubeScript(), { frame: FRAME, contour: POINTS, spec: SPEC });
  const hole = wrote.buffer.slice(wrote.buffer.indexOf('id=hole1'));
  const cleared = rewriteCentersContour(wrote.buffer, {
    contourId: 'c1',
    contour: { points: [] },
  });
  assert.equal(cleared.ok, true, cleared.message || '');
  assert.equal(cleared.changed, true);
  assert.match(cleared.buffer, /points: \[\]/);
  assert.match(cleared.buffer, /centers: true/);
  assert.equal(cleared.buffer.slice(cleared.buffer.indexOf('id=hole1')), hole);
  const read = readCentersContour(cleared.buffer, 'c1');
  assert.equal(read.contour.points.length, 0);
  assert.equal(read.contour.centers, true);
  assert.equal(readContourHole(cleared.buffer, 'hole1').contourId, 'c1');
});

test('an old hole block does not read as a contour hole', () => {
  const old = cubeScript(region(
    HOLE_BEGIN,
    HOLE_END,
    'hole9',
    'part = hole(part, fr, 0, 0, 5, 12);',
  ));
  assert.equal(readContourHole(old, 'hole9'), null);
  assert.equal(readCentersContour(old, 'c1'), null);
});

test('a bad hole spec is refused', () => {
  const script = cubeScript();
  const both = composeHoleOnContour(script, {
    frame: FRAME,
    contour: POINTS,
    spec: { dia: 4, through: true, depth: 6 },
  });
  assert.equal(both.ok, false);
  const far = composeHoleOnContour(script, {
    frame: FRAME,
    contour: POINTS,
    spec: { dia: 4, depth: 6, far: { kind: 'csk', dia: 8, depth: 2 } },
  });
  assert.equal(far.ok, false);
  const side = composeHoleOnContour(script, {
    frame: FRAME,
    contour: POINTS,
    spec: { dia: 4, depth: 6, side: 2 },
  });
  assert.equal(side.ok, false);
  assert.equal(script.includes('holesOnContour'), false);
});

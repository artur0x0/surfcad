import assert from 'node:assert/strict';
import test from 'node:test';
import { insertContourPoint } from './contourDrag.js';
import { specFromSolved } from './contourGesture.js';
import { saveContourDimension } from './contourMode.js';
import { emitSolveContour, parseSolveContour } from './contourScript.js';
import {
  contourFromCircle,
  contourFromPolygon,
  contourFromPolyline,
  contourFromRectangle,
  solveContour,
} from './contourSolve.js';
import {
  assignSeq,
  contourChips,
  contourDependents,
  deleteContourEntity,
  dependentDeleteLabel,
} from './contourStrip.js';

test('builders stamp seq in kind order and a full circle is one Circle chip', () => {
  const circle = contourFromCircle(5);
  assert.equal(circle.arcs[0].seq, 1);
  assert.equal(circle.dimensions[0].seq, 2);
  assert.equal(circle.constraints[0].seq, 3);
  assert.equal(circle.points[0].seq, undefined);
  const chips = contourChips({ params: { contour: circle } });
  assert.deepEqual(chips.map((chip) => chip.label), ['Circle', 'Radius', 'Fix']);
  assert.equal(chips[0].kind, 'circle');
  assert.equal(chips[0].index, 1);
  assert.equal(chips[1].title, 'Radius 5');

  const rect = contourFromRectangle(40, 20);
  assert.deepEqual(rect.lines.map((line) => line.seq), [1, 2, 3, 4]);
  assert.deepEqual(rect.dimensions.map((dim) => dim.seq), [5, 6]);
  assert.equal(rect.constraints[0].seq, 7);
  assert.equal(rect.constraints[4].seq, 11);
  const rectChips = contourChips({ params: { contour: rect } });
  assert.deepEqual(rectChips.map((chip) => chip.label), [
    'Line', 'Line', 'Line', 'Line', 'Length', 'Length',
    'Horizontal', 'Horizontal', 'Vertical', 'Vertical', 'Fix',
  ]);
  assert.deepEqual(rectChips.filter((chip) => chip.label === 'Line').map((chip) => chip.index), [1, 2, 3, 4]);
  assert.equal(rectChips.find((chip) => chip.id === 'd0').title, 'Length 40');
});

test('a polygon spoke is stamped and omitted, and an angle title keeps its sign', () => {
  const hex = contourFromPolygon('hexagon', 8);
  const spoke = hex.lines.find((line) => line.guide);
  assert.equal(spoke.seq, 7);
  const chips = contourChips({ params: { contour: hex } });
  assert.equal(chips.filter((chip) => chip.kind === 'line').length, 6);
  assert.equal(chips.find((chip) => chip.id === 'd0').label, 'Length');
  assert.ok(chips.findIndex((chip) => chip.id === 'd0') < chips.findIndex((chip) => chip.id === 'k0'));
  const angle = contourChips({
    dimensions: [{ id: 'd0', kind: 'angle', value: -30, seq: 1 }],
  });
  assert.equal(angle[0].title, 'Angle -30');
});

test('emit and parse keep seq, and a statement without seq lists in kind order', () => {
  const src = emitSolveContour(contourFromCircle(5));
  assert.match(src, /seq: 1/);
  assert.doesNotMatch(src, /id: 'p0'[^}]*seq:/);
  const parsed = parseSolveContour(src);
  assert.equal(parsed.arcs[0].seq, 1);
  assert.equal(parsed.points[0].seq, undefined);
  assert.equal(emitSolveContour(parsed), src);

  const bare = parseSolveContour("solveContour({ points: [], lines: [{ id: 'e0', a: 'p0', b: 'p1', seq: 0 }], arcs: [], dimensions: [], constraints: [] })");
  assert.equal(bare.lines[0].seq, undefined);

  const chips = contourChips({
    lines: [{ id: 'e0', a: 'p0', b: 'p1' }, { id: 'e1', a: 'p0', b: 'p1', guide: true }],
    arcs: [{ id: 'a0', full: false }],
    dimensions: [{ id: 'd0', kind: 'offset', value: -2 }],
    constraints: [{ id: 'k0', kind: 'horizontal', items: ['e0'] }],
    refs: [{ id: 'r0', kind: 'edge', broken: true, geom: { kind: 'line' } }],
  });
  assert.deepEqual(chips.map((chip) => chip.id), ['e0', 'a0', 'd0', 'k0', 'r0']);
  assert.equal(chips.find((chip) => chip.id === 'd0').title, 'Offset 2');
  assert.equal(chips.find((chip) => chip.id === 'r0').broken, true);
  assert.equal(chips.find((chip) => chip.id === 'r0').geomKind, 'line');
});

test('solve keeps seq, a later dimension sorts after construction, and an edit keeps its seq', () => {
  const rect = contourFromRectangle(40, 12);
  const stored = specFromSolved(solveContour(rect));
  assert.equal(stored.lines[0].seq, 1);
  assert.equal(stored.dimensions[0].seq, 5);
  const spoke = specFromSolved(solveContour(contourFromPolygon('square', 8)));
  assert.equal(spoke.lines.some((line) => line.guide), true);

  const stamped = assignSeq({
    ...rect,
    dimensions: [...rect.dimensions, { id: 'd9', kind: 'length', edge: 'e2', value: 12 }],
  });
  const added = stamped.dimensions.find((dim) => dim.id === 'd9');
  assert.ok(added.seq > rect.constraints[rect.constraints.length - 1].seq);

  const seq = rect.dimensions[0].seq;
  const saved = saveContourDimension({
    tool: 'rectangle',
    params: { contour: rect },
    picks: [{ id: 'e0', kind: 'line' }],
    dimensionEdit: 'd0',
  }, { kind: 'length', valueMm: 30, side: 1, id: 'd0' });
  assert.equal(saved.error, null);
  assert.equal(saved.state.params.contour.dimensions.find((dim) => dim.id === 'd0').seq, seq);
});

test('a new polyline point takes the next seq', () => {
  const spec = contourFromPolyline([[0, 0], [10, 0], [10, 8]]);
  const next = insertContourPoint(spec, [5, 0]);
  assert.equal(next.lines.length, spec.lines.length + 1);
  const newest = next.lines.reduce((best, line) => (line.seq > best.seq ? line : best));
  assert.equal(newest.a === 'p3' || newest.b === 'p3', true);
  assert.equal(newest.seq, Math.max(...spec.lines.map((line) => line.seq)) + 1);
});

test('delete drops the entity and its dimensions and constraints, and leaves points', () => {
  const contour = contourFromRectangle(40, 20);
  const state = {
    params: { contour },
    picks: [{ id: 'e0', kind: 'line' }],
    dimensionEdit: 'd0',
    tagId: 'd0',
  };
  const deps = contourDependents(contour, 'e0');
  assert.deepEqual(deps.dimensions.map((dim) => dim.id), ['d0']);
  assert.deepEqual(deps.constraints.map((con) => con.id), ['k0']);
  assert.equal(dependentDeleteLabel(deps), 'Delete along with 2 items');
  const deleted = deleteContourEntity(state, 'e0');
  assert.equal(deleted.label, 'Delete along with 2 items');
  const next = deleted.state.params.contour;
  assert.equal(next.lines.some((line) => line.id === 'e0'), false);
  assert.equal(next.lines.some((line) => line.id === 'e1'), true);
  assert.equal(next.points.length, 4);
  assert.equal(next.dimensions.some((dim) => dim.id === 'd0'), false);
  assert.equal(next.dimensions.some((dim) => dim.id === 'd1'), true);
  assert.equal(next.constraints.some((con) => con.id === 'k0'), false);
  assert.equal(next.constraints.some((con) => con.id === 'k4'), true);
  assert.deepEqual(deleted.state.picks, []);
  assert.equal(deleted.state.dimensionEdit, null);
  assert.equal(deleted.state.tagId, null);

  const only = deleteContourEntity({ params: { contour } }, 'd1');
  assert.equal(only.label, null);
  assert.equal(only.state.params.contour.lines.length, 4);
  assert.equal(only.state.params.contour.dimensions.some((dim) => dim.id === 'd1'), false);

  const same = deleteContourEntity({ params: { contour } }, 'e9');
  assert.equal(same.state.params.contour, contour);
  assert.deepEqual(same.removed, []);
  const point = deleteContourEntity({ params: { contour } }, 'p0');
  assert.equal(point.state.params.contour, contour);
});

test('deleting a reference names the one dimension, and an unpromoted shape is one chip', () => {
  const contour = {
    points: [{ id: 'p0', at: [0, 0] }, { id: 'p1', at: [4, 0] }],
    lines: [{ id: 'e0', a: 'p0', b: 'p1', seq: 1 }],
    arcs: [],
    dimensions: [{ id: 'd0', kind: 'distance', a: 'p1', b: 'r0', value: -3, seq: 3 }],
    constraints: [{ id: 'k0', kind: 'fix', items: ['p0'], seq: 4 }],
    refs: [{ id: 'r0', kind: 'edge', seq: 2, geom: { kind: 'line', a: [0, 0], b: [4, 0] } }],
  };
  const deleted = deleteContourEntity({
    params: { contour },
    picks: [{ id: 'r0', kind: 'ref' }],
  }, 'r0');
  assert.equal(deleted.label, 'Delete along with 1 dimension');
  assert.equal(deleted.state.params.contour.refs.length, 0);
  assert.equal(deleted.state.params.contour.dimensions.length, 0);
  assert.equal(deleted.state.params.contour.constraints.length, 1);
  assert.equal(deleted.state.params.contour.lines.length, 1);
  assert.equal(deleted.state.picks.length, 0);
  assert.equal(dependentDeleteLabel(contourDependents(contour, 'k0')), null);

  const drawn = { tool: 'polyline', params: { points: [[0, 0], [1, 0]] } };
  assert.equal(contourChips(drawn)[0].label, 'Polyline');
  assert.equal(contourChips(drawn)[0].id, 'shape');
  const cleared = deleteContourEntity(drawn, 'shape');
  assert.deepEqual(cleared.state.params.points, []);
  assert.equal(contourChips(cleared.state).length, 0);
  assert.equal(contourChips({ tool: 'polyline', params: { points: [] } }).length, 0);
  assert.equal(contourChips({ tool: 'circle', params: { radius: 5, segments: 64 } })[0].kind, 'circle');
  assert.equal(contourChips({ tool: 'rectangle', params: { width: 20, height: 12 } })[0].label, 'Rectangle');
  assert.equal(deleteContourEntity(drawn, 'e0').removed.length, 0);
});

test('a promoted polyline is one chip, and delete takes the chain and its dimension', () => {
  const spec = contourFromPolyline([[0, 0], [10, 0], [10, 8]]);
  spec.dimensions.push({ id: 'd0', kind: 'length', edge: 'e0', value: 10, seq: 9 });
  const state = {
    tool: 'polyline',
    params: { contour: spec, points: spec.points.map((p) => p.at.slice()) },
  };
  const chips = contourChips(state);
  assert.equal(chips.filter((chip) => chip.kind === 'line').length, 0);
  assert.equal(chips.find((chip) => chip.id === 'polyline').label, 'Polyline');
  assert.equal(chips.some((chip) => chip.id === 'd0'), true);
  const rect = contourFromRectangle(20, 10, true);
  assert.ok(contourChips({ params: { contour: rect } }).some((chip) => chip.id === 'e0'));
  assert.equal(rect.polyline, undefined);

  const solved = specFromSolved(solveContour(spec));
  assert.equal(solved.polyline, true);
  const roundTrip = parseSolveContour(emitSolveContour(solved));
  assert.equal(roundTrip.polyline, true);
  assert.equal(contourChips({ params: { contour: roundTrip } }).filter((chip) => chip.kind === 'line').length, 0);

  const deleted = deleteContourEntity(state, 'polyline');
  assert.equal(deleted.label, 'Delete along with 1 dimension');
  assert.deepEqual(deleted.state.params.points, []);
  assert.equal(deleted.state.params.contour, undefined);
  assert.equal(deleted.removed[0], 'polyline');
  assert.equal(contourChips(deleted.state).length, 0);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  armContourGesture,
  enterContourState,
  saveContourConstraint,
  saveContourDimension,
  sketchKeepsGeometry,
  switchContourTool,
} from './contourMode.js';
import {
  contourPointDragAllowed,
  dragContourPoint,
  dragSketchParam,
  insertContourPoint,
  sketchHandles,
} from './contourDrag.js';
import {
  buildDimension,
  contourFromTool,
  dimensionShownNumber,
  dimensionStoredValue,
  suggestContourDimension,
} from './contourGesture.js';
import { contourChips } from './contourStrip.js';
import {
  contourFromPolygon,
  roundContourCorner,
  solveContour,
} from './contourSolve.js';

test('a tool change keeps a drawn polyline and a promoted contour', () => {
  const empty = {
    ...enterContourState('crossSection', null),
    tool: 'polyline',
    params: { points: [] },
  };
  assert.equal(sketchKeepsGeometry(empty), false);
  const started = switchContourTool(empty, 'circle');
  assert.equal(started.tool, 'circle');
  assert.equal(started.params.contour, undefined);

  const drawn = {
    ...enterContourState('crossSection', null),
    tool: 'polyline',
    params: { points: [[0, 0], [30, 0], [30, 12]] },
  };
  const armed = armContourGesture(drawn, 'dimension');
  const kept = switchContourTool(armed, 'rectangle');
  assert.equal(kept.tool, 'rectangle');
  assert.equal(kept.gesture, null);
  assert.equal(kept.params.contour.points.length, 3);
  assert.equal(kept.params.points.length, 3);
  assert.equal(kept.params.contour.polyline, true);
  assert.ok(sketchHandles(kept).every((h) => h.kind === 'contour'));
  const cursor = switchContourTool(drawn, 'cursor');
  assert.equal(cursor.params.contour, undefined);
  assert.equal(contourChips(cursor).length, 1);
  assert.equal(contourChips(cursor)[0].id, 'shape');
  assert.equal(contourChips(cursor).filter((chip) => chip.kind === 'line').length, 0);
  const promoted = armContourGesture(cursor, 'dimension');
  assert.equal(promoted.params.contour.polyline, true);
  assert.equal(promoted.params.contour.lines.length, 3);
  const chips = contourChips(promoted);
  assert.equal(chips.filter((chip) => chip.kind === 'line').length, 0);
  assert.equal(chips.filter((chip) => chip.id === 'polyline').length, 1);
  const fromCursor = contourFromTool('cursor', {
    points: [[0, 0], [10, 0], [10, 4]],
    radius: 5,
  });
  assert.equal(fromCursor.polyline, true);
  assert.ok(fromCursor.lines.length >= 3);
});

test('free polyline points drag after a dimension and a tool change', () => {
  const drawn = armContourGesture({
    ...enterContourState('crossSection', null),
    tool: 'polyline',
    params: { points: [[0, 0], [40, 0], [40, 20], [0, 20]] },
  }, 'dimension');
  const saved = saveContourDimension(
    { ...drawn, picks: [{ id: 'e0', kind: 'line' }] },
    { kind: 'length', valueMm: 40, side: 1, sense: 1 },
  );
  assert.equal(saved.error, null);
  const back = switchContourTool(saved.state, 'circle');
  const spec = back.params.contour;
  assert.equal(contourPointDragAllowed(spec, 'p2'), true);
  const moved = dragContourPoint(spec, 'p2', [55, 28]);
  assert.equal(moved.moved, true);
  assert.ok(Math.hypot(moved.uv[0] - 40, moved.uv[1] - 20) > 5);

  const fixed = saveContourConstraint(
    { ...back, gesture: 'constraints', picks: [{ id: 'p0', kind: 'point' }] },
    { kind: 'fix', side: 1 },
  );
  assert.equal(fixed.error, null);
  assert.equal(contourPointDragAllowed(fixed.state.params.contour, 'p0'), false);
  const stay = dragContourPoint(fixed.state.params.contour, 'p0', [8, 8]);
  assert.equal(stay.moved, false);
});

test('unpromoted circle, rectangle, and polygon drags edit their sizes', () => {
  const circle = dragSketchParam('circle', { radius: 5, segments: 64 }, 0, [9, 0]);
  assert.ok(Math.abs(circle.params.radius - 9) < 1e-9);
  const rect = dragSketchParam('rectangle', { width: 20, height: 12, centered: true }, 2, [15, 9]);
  assert.ok(Math.abs(rect.params.width - 30) < 1e-9);
  assert.ok(Math.abs(rect.params.height - 18) < 1e-9);
  const poly = dragSketchParam('polygon', { polygonPreset: 'hexagon', radius: 8 }, 0, [0, 14]);
  assert.ok(Math.abs(poly.params.radius - 14) < 1e-9);
  const handles = sketchHandles({
    tool: 'polygon',
    params: { polygonPreset: 'hexagon', radius: 8 },
  });
  assert.equal(handles.length, 6);
  assert.equal(handles[0].kind, 'polygon');
});

test('a promoted polygon solves, the center stays fixed, and a vertex can move', () => {
  const spec = contourFromPolygon('hexagon', 8);
  const solved = solveContour(spec);
  assert.notEqual(solved.status, 'conflict');
  assert.ok(solved.contours[0].length >= 6);
  assert.equal(contourPointDragAllowed(spec, 'p0'), false);
  assert.equal(contourPointDragAllowed(spec, 'p2'), true);
  const moved = dragContourPoint(spec, 'p2', [spec.points[2].at[0] + 3, spec.points[2].at[1] + 3]);
  assert.equal(moved.moved, true);
  assert.ok(Math.hypot(moved.spec.points[0].at[0], moved.spec.points[0].at[1]) < 1e-6);
});

test('an arc leaves a free point draggable', () => {
  const square = {
    points: [
      { id: 'p0', at: [0, 0] },
      { id: 'p1', at: [40, 0] },
      { id: 'p2', at: [40, 30] },
      { id: 'p3', at: [0, 30] },
    ],
    lines: [
      { id: 'e0', a: 'p0', b: 'p1' },
      { id: 'e1', a: 'p1', b: 'p2' },
      { id: 'e2', a: 'p2', b: 'p3' },
      { id: 'e3', a: 'p3', b: 'p0' },
    ],
    arcs: [],
    dimensions: [],
    constraints: [],
  };
  const rounded = roundContourCorner(square, ['e0', 'e1'], 4);
  const solved = solveContour(rounded);
  assert.notEqual(solved.status, 'conflict');
  const free = solved.points.find((p) => contourPointDragAllowed(rounded, p.id));
  assert.ok(free, 'an arc does not freeze every point');
  const moved = dragContourPoint(rounded, free.id, [free.at[0] + 6, free.at[1] + 4]);
  assert.equal(moved.moved, true);
});

test('a new polyline point splits the chain instead of branching it', () => {
  const spec = {
    points: [
      { id: 'p0', at: [0, 0] },
      { id: 'p1', at: [10, 0] },
      { id: 'p2', at: [10, 8] },
    ],
    lines: [
      { id: 'e0', a: 'p0', b: 'p1' },
      { id: 'e1', a: 'p1', b: 'p2' },
      { id: 'e2', a: 'p2', b: 'p0' },
    ],
    arcs: [],
    dimensions: [],
    constraints: [],
  };
  const next = insertContourPoint(spec, [5, 0]);
  assert.equal(next.points.length, 4);
  const solved = solveContour(next);
  assert.notEqual(solved.status, 'conflict');
});

test('a negative offset displays positive and a positive edit keeps the side', () => {
  const model = {
    points: [
      { id: 'p0', at: [0, 0] },
      { id: 'p1', at: [20, 0] },
      { id: 'p2', at: [8, -6] },
    ],
    lines: [{ id: 'e0', a: 'p0', b: 'p1' }],
    arcs: [],
    dimensions: [],
    constraints: [],
  };
  const picks = [{ id: 'p2', kind: 'point' }, { id: 'e0', kind: 'line' }];
  const offer = suggestContourDimension(model, picks);
  assert.equal(offer.kind, 'offset');
  assert.ok(offer.value < 0, String(offer.value));
  assert.equal(offer.side, -1);
  assert.ok(dimensionShownNumber('offset', offer.value) > 0);
  const typed = dimensionStoredValue('offset', picks, 12, offer.side);
  assert.equal(typed, -12);
  const built = buildDimension(model, picks, {
    kind: 'offset',
    valueMm: 12,
    side: offer.side,
    sense: 1,
  });
  assert.equal(built.ok, true);
  assert.equal(built.dimension.value, -12);
  assert.equal(built.dimension.side, -1);

  const refModel = {
    ...model,
    refs: [{
      id: 'r0',
      kind: 'edge',
      geom: { kind: 'line', a: [0, 0], b: [20, 0] },
    }],
  };
  const refPicks = [
    { id: 'p2', kind: 'point' },
    { id: 'r0', kind: 'ref', geomKind: 'line' },
  ];
  const refOffer = suggestContourDimension(refModel, refPicks);
  assert.equal(refOffer.kind, 'distance');
  assert.ok(refOffer.value < 0);
  const refBuilt = buildDimension(refModel, refPicks, {
    kind: 'distance',
    valueMm: Math.abs(refOffer.value) + 4,
    side: refOffer.side,
    sense: 1,
  });
  assert.equal(refBuilt.ok, true, refBuilt.message);
  assert.ok(refBuilt.dimension.value < 0);
  assert.equal(refBuilt.dimension.side, -1);
  const solved = solveContour({
    ...refModel,
    dimensions: [refBuilt.dimension],
  });
  const moved = solved.points.find((p) => p.id === 'p2');
  assert.ok(moved.at[1] < 0, JSON.stringify(moved.at));
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { contourRailTools, enterContourState, switchContourTool } from './contourMode.js';
import { selectContourGesture } from './contourGesture.js';
import { solveContour } from './contourSolve.js';
import { composeHoleOnContour } from './holeContour.js';
import {
  defaultHoleCard,
  holeCardFromSpec,
  holeCentresSketch,
  holeSketchContour,
  holeSpecFromCard,
  materializeHoleRectangleCenters,
} from './holeCard.js';

const FRAME = { center: [0, 0, 5], normal: [0, 0, 1], x: [1, 0, 0], y: [0, 1, 0] };
const PART = 'let part = Manifold.cube([10, 10, 10], true);\nreturn part;\n';

test('hole card defaults are a through M3 clearance', () => {
  const spec = holeSpecFromCard(defaultHoleCard());
  assert.equal(spec.ok, true);
  assert.equal(spec.spec.type, 'clearance');
  assert.equal(spec.spec.size, 'M3');
  assert.equal(spec.spec.fit, 'normal');
  assert.equal(spec.spec.through, true);
  assert.equal(spec.spec.side, 1);
  assert.equal(spec.spec.depth, undefined);
  assert.equal(spec.spec.near.kind, 'none');
  assert.equal(spec.spec.far.kind, 'none');
});

test('explicit dia wins and a blind hole drops the far end', () => {
  const spec = holeSpecFromCard({
    ...defaultHoleCard(),
    dia: '4.2',
    through: false,
    depth: 8,
    side: -1,
    farKind: 'cbore',
    farDia: 8,
    farDepth: 2,
  });
  assert.equal(spec.ok, true);
  assert.equal(spec.spec.dia, 4.2);
  assert.equal(spec.spec.type, undefined);
  assert.equal(spec.spec.size, undefined);
  assert.equal(spec.spec.through, false);
  assert.equal(spec.spec.depth, 8);
  assert.equal(spec.spec.side, -1);
  assert.equal(spec.spec.far.kind, 'none');
});

test('a bad diameter or a shallow end is refused on the card', () => {
  assert.equal(holeSpecFromCard({ ...defaultHoleCard(), dia: 0 }).ok, false);
  assert.equal(holeSpecFromCard({
    ...defaultHoleCard(),
    dia: 4,
    nearKind: 'cbore',
    nearDia: 4,
    nearDepth: 2,
  }).ok, false);
  assert.equal(holeSpecFromCard({ ...defaultHoleCard(), through: false, depth: 0 }).ok, false);
});

test('the hole rail is cursor, rectangle, and polyline, and the sketch starts empty', () => {
  assert.deepEqual(contourRailTools('hole').map((tool) => tool.id), ['cursor', 'rectangle', 'polyline']);
  assert.ok(contourRailTools('crossSection').some((tool) => tool.id === 'circle'));
  assert.ok(contourRailTools('crossSection').some((tool) => tool.id === 'rectangle'));
  const started = enterContourState('hole', null);
  assert.equal(started.entry, 'hole');
  assert.equal(started.tool, 'cursor');
  assert.deepEqual(started.params.points, []);
});

test('one centre writes a hole and zero centres write nothing', () => {
  assert.equal(holeSketchContour({ params: { points: [] } }), null);
  const one = holeSketchContour({ params: { points: [[3, 4]] } });
  assert.equal(one.points.length, 1);
  assert.equal(one.lines.length, 0);
  const two = holeSketchContour({ params: { points: [[3, 4], [8, 4]] } });
  assert.equal(two.lines.length, 1);
  const spec = holeSpecFromCard(defaultHoleCard()).spec;
  const empty = composeHoleOnContour(PART, { frame: FRAME, contour: null, spec });
  assert.equal(empty.empty, true);
  assert.equal(empty.buffer, PART);
  const wrote = composeHoleOnContour(PART, { frame: FRAME, contour: two, spec });
  assert.equal(wrote.ok, true);
  assert.equal(wrote.featureId, 'hole1');
  assert.match(wrote.buffer, /role=centers/);
  assert.match(wrote.buffer, /centers: true/);
  assert.match(wrote.buffer, /construction: true/);
  assert.match(wrote.buffer, /holesOnContour\(part, c1,/);
});

test('a saved spec refills the card and an empty contour stays a contour', () => {
  const fastener = holeSpecFromCard(defaultHoleCard()).spec;
  const filled = holeSpecFromCard(holeCardFromSpec(fastener));
  assert.equal(filled.ok, true);
  assert.equal(filled.spec.type, 'clearance');
  assert.equal(filled.spec.size, 'M3');
  assert.equal(filled.spec.fit, 'normal');
  assert.equal(filled.spec.dia, undefined);
  const explicit = holeSpecFromCard(holeCardFromSpec({
    dia: 5,
    through: true,
    side: -1,
    near: { kind: 'none' },
    far: { kind: 'none' },
  }));
  assert.equal(explicit.spec.dia, 5);
  assert.equal(explicit.spec.side, -1);
  assert.equal(explicit.spec.type, undefined);
  const empty = holeSketchContour({ params: { contour: { points: [], lines: [] } } });
  assert.deepEqual(empty.points, []);
  assert.equal(holeSketchContour({ params: { points: [] } }), null);
  const sketch = holeCentresSketch(enterContourState('hole', null), {
    id: 'c1',
    name: 'c1',
    frame: FRAME,
    contour: {
      points: [{ id: 'p0', at: [1, 2] }],
      lines: [{ id: 'e0', a: 'p0', b: 'p0' }],
    },
  });
  assert.equal(sketch.entry, 'hole');
  assert.equal(sketch.tool, 'polyline');
  assert.equal(sketch.contourId, 'c1');
  assert.equal(sketch.params.contour.centers, true);
  assert.equal(sketch.params.contour.lines[0].construction, true);
  assert.deepEqual(sketch.planeFace.planeFrame.normal, [0, 0, 1]);
  assert.deepEqual(sketch.params.points, [[1, 2]]);
});

test('materializeHoleRectangleCenters marks centres on the promoted contour', () => {
  const drawn = switchContourTool(enterContourState('hole', null), 'rectangle');
  const next = materializeHoleRectangleCenters(drawn);
  assert.equal(next.params.contour.centers, true);
  assert.equal(next.params.centers, true);
  assert.equal(next.params.contour.points.length, 4);
});

test('a rectangle is four centres and keeps its dimensions and constraints', () => {
  const drawn = switchContourTool(enterContourState('hole', null), 'rectangle');
  const contour = holeSketchContour(drawn);
  assert.equal(contour.points.length, 4);
  assert.equal(contour.lines.length, 4);
  assert.ok(contour.lines.every((line) => line.construction === true));
  assert.ok(contour.dimensions.some((dim) => dim.kind === 'length' && dim.edge === 'e0' && dim.value === 20));
  assert.ok(contour.dimensions.some((dim) => dim.kind === 'length' && dim.edge === 'e1' && dim.value === 12));
  assert.ok(contour.constraints.some((item) => item.kind === 'horizontal'));
  assert.ok(contour.constraints.some((item) => item.kind === 'vertical'));
  const kept = holeSketchContour(switchContourTool(drawn, 'cursor'));
  assert.equal(kept.points.length, 4);
  const line = holeSketchContour({
    tool: 'polyline',
    params: { points: [[0, 0], [1, 0]], width: 20, height: 12 },
  });
  assert.equal(line.points.length, 2);
  const armed = selectContourGesture(drawn, 'dimension');
  assert.equal(armed.entry, 'hole');
  assert.equal(armed.gesture, 'dimension');
  assert.equal(armed.params.contour.points.length, 4);
  const widened = {
    ...armed.params.contour,
    dimensions: armed.params.contour.dimensions.map((dim) => (
      dim.edge === 'e0' ? { ...dim, value: 30 } : dim
    )),
  };
  const solved = solveContour({
    centers: true,
    points: widened.points,
    lines: widened.lines,
    arcs: widened.arcs,
    dimensions: widened.dimensions,
    constraints: widened.constraints,
    refs: widened.refs,
  });
  const xs = solved.points.map((point) => point.at[0]).sort((a, b) => a - b);
  assert.ok(Math.abs(xs[0] - (-10)) < 0.05, xs.join(','));
  assert.ok(Math.abs(xs[xs.length - 1] - 20) < 0.05, xs.join(','));
  const spec = holeSpecFromCard(defaultHoleCard()).spec;
  const wrote = composeHoleOnContour(PART, { frame: FRAME, contour, spec });
  assert.equal(wrote.ok, true);
  for (const id of ['p0', 'p1', 'p2', 'p3']) {
    assert.match(wrote.buffer, new RegExp(`id: '${id}'`));
  }
  assert.match(wrote.buffer, /kind: 'length'/);
  assert.match(wrote.buffer, /kind: 'horizontal'/);
  assert.match(wrote.buffer, /construction: true/);
  assert.match(wrote.buffer, /holesOnContour\(part, c1,/);
});

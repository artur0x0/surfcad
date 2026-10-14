import assert from 'node:assert/strict';
import { test } from 'node:test';
import { contourRailTools, enterContourState } from './contourMode.js';
import { composeHoleOnContour } from './holeContour.js';
import {
  defaultHoleCard,
  holeCardFromSpec,
  holeCentresSketch,
  holeSketchContour,
  holeSpecFromCard,
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

test('the hole rail is cursor and polyline, and the sketch starts empty', () => {
  assert.deepEqual(contourRailTools('hole').map((tool) => tool.id), ['cursor', 'polyline']);
  assert.ok(contourRailTools('crossSection').some((tool) => tool.id === 'circle'));
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

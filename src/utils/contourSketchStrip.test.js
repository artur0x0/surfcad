import assert from 'node:assert/strict';
import test from 'node:test';
import { contourFromRectangle } from './contourSolve.js';
import { selectSketchChip, sketchActiveId, sketchHighlightPicks } from './contourSketchStrip.js';

const rect = contourFromRectangle(40, 20);

test('an unpromoted shape is the chip, and an empty polyline is not', () => {
  assert.equal(sketchActiveId({ tool: 'circle', params: { radius: 5, segments: 64 } }), 'shape');
  assert.equal(sketchActiveId({ tool: 'polyline', params: { points: [] } }), null);
  assert.equal(sketchActiveId({
    tool: 'circle',
    params: { radius: 5 },
    gesture: 'dimension',
    picks: [],
  }), null);
});

test('a dimension or constraint card stays selected, and several building picks do not', () => {
  const editing = {
    params: { contour: rect },
    gesture: 'dimension',
    dimensionEdit: 'd0',
    picks: [{ kind: 'line', id: 'e0' }, { kind: 'point', id: 'p0' }],
  };
  assert.equal(sketchActiveId(editing), 'd0');
  assert.equal(sketchActiveId({
    params: { contour: rect },
    gesture: 'constraints',
    constraintEdit: 'k0',
    picks: [{ kind: 'line', id: 'e0' }, { kind: 'line', id: 'e2' }],
  }), 'k0');
  assert.equal(sketchActiveId({
    params: { contour: rect },
    gesture: 'dimension',
    picks: [{ kind: 'line', id: 'e0' }, { kind: 'line', id: 'e1' }],
  }), null);
  assert.equal(sketchActiveId({
    params: { contour: rect },
    gesture: 'dimension',
    picks: [{ kind: 'line', id: 'e2' }],
  }), 'e2');
  assert.equal(sketchActiveId({
    params: { contour: rect },
    picks: [{ kind: 'point', id: 'p0' }],
  }), null);
  assert.equal(sketchActiveId({
    params: { contour: rect },
    gesture: 'arc',
    picks: [{ kind: 'line', id: 'e0' }],
  }), 'e0');
});

test('a chip tap opens the edit card or replaces the pick, and a broken reference still selects', () => {
  const building = {
    tool: 'rectangle',
    params: { contour: rect },
    gesture: 'dimension',
    picks: [{ kind: 'line', id: 'e0' }, { kind: 'line', id: 'e1' }],
  };
  const line = selectSketchChip(building, { id: 'e0', kind: 'line', label: 'Line' });
  assert.equal(line.gesture, null);
  assert.deepEqual(line.picks.map((pick) => pick.id), ['e0']);
  assert.equal(sketchActiveId(line), 'e0');

  const dim = selectSketchChip(building, { id: 'd0', kind: 'dimension' });
  assert.equal(dim.dimensionEdit, 'd0');
  assert.equal(dim.gesture, 'dimension');
  assert.equal(sketchActiveId(dim), 'd0');

  const con = selectSketchChip({ params: { contour: rect } }, { id: 'k0', kind: 'constraint' });
  assert.equal(con.constraintEdit, 'k0');
  assert.equal(con.gesture, 'constraints');
  assert.equal(sketchActiveId(con), 'k0');

  const shape = selectSketchChip({
    tool: 'circle',
    params: { radius: 5 },
    gesture: 'dimension',
    picks: [{ kind: 'line', id: 'e0' }],
  }, { id: 'shape', kind: 'circle' });
  assert.equal(shape.gesture, null);
  assert.deepEqual(shape.picks, []);
  assert.equal(sketchActiveId(shape), 'shape');

  const spec = {
    lines: [],
    arcs: [],
    dimensions: [],
    constraints: [],
    refs: [{ id: 'r0', broken: true, geom: { kind: 'line' }, seq: 1 }],
  };
  assert.equal(sketchActiveId({
    params: { contour: spec },
    picks: [{ kind: 'ref', id: 'r0' }],
  }), 'r0');
  const ref = selectSketchChip({
    params: { contour: spec },
    gesture: 'constraints',
    picks: [{ kind: 'line', id: 'e0' }, { kind: 'line', id: 'e1' }],
  }, { id: 'r0', kind: 'ref', geomKind: 'line', label: 'Reference' });
  assert.equal(ref.gesture, null);
  assert.equal(ref.picks[0].kind, 'ref');
  assert.equal(ref.picks[0].geomKind, 'line');
  assert.equal(sketchActiveId(ref), 'r0');
});

test('a selected entity uses the dimension highlight, and an arc gesture does not', () => {
  const line = [{ kind: 'line', id: 'e0' }];
  assert.equal(sketchHighlightPicks({ gesture: null, picks: line }), line);
  assert.equal(sketchHighlightPicks({ gesture: 'dimension', picks: line }), line);
  assert.equal(sketchHighlightPicks({ gesture: 'arc', picks: line }), null);
  assert.equal(sketchHighlightPicks({ gesture: null, picks: [] }), null);
});

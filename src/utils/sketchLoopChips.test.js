import assert from 'node:assert/strict';
import test from 'node:test';
import { applySketchAdd, enterContourState } from './contourMode.js';
import { emitSolveContour, parseSolveContour } from './contourScript.js';
import { entityDeleteChip, selectSketchChip, sketchActiveId } from './contourSketchStrip.js';
import { contourFromCircle, contourFromPolygon, contourFromRectangle, solveContour } from './contourSolve.js';
import {
  contourChips,
  deleteContourEntity,
  hiddenAutoItem,
  itemLoop,
  loopChipId,
  loopOfChipId,
  loopShape,
} from './contourStrip.js';
import { maxLoop, mergeContourSpecs, stripAutoSizing } from './sketchLoops.js';

/**
 * A second shape in a sketch is one more shape, as free and undimensioned
 * as the first was.
 *
 * Appending used to promote the first rectangle into its solver rows and
 * give the second the same seq numbers (22 interleaved chips, every
 * builder constraint and length drawn as a tag). Now a shape that joins a
 * multi-loop sketch drops its builder fix and dimensions, keeps its form
 * constraints hidden, and is one shape chip. A lone promoted shape is
 * unchanged.
 */

function twoRectangles() {
  const sketch = enterContourState('crossSection');
  const first = applySketchAdd(sketch, 'rectangle', { width: 40, height: 24, centered: true });
  const second = applySketchAdd(first.state, 'rectangle', { width: 20, height: 12, centered: true }, { inset: true });
  assert.equal(second.ok, true, second.message);
  return second.state;
}

test('builders mark their constraints and dimensions auto; a lone shape still lists every row', () => {
  const rect = contourFromRectangle(40, 20);
  assert.ok(rect.constraints.every((con) => con.auto === true));
  assert.ok(rect.dimensions.every((dim) => dim.auto === true));
  assert.ok(contourFromCircle(5).constraints.every((con) => con.auto === true));
  assert.ok(contourFromCircle(5).dimensions.every((dim) => dim.auto === true));
  assert.ok(contourFromPolygon('hexagon', 8).constraints.every((con) => con.auto === true));
  // No loop number: nothing is hidden and the chips are as before.
  assert.equal(hiddenAutoItem(rect.constraints[0]), false);
  assert.deepEqual(contourChips({ params: { contour: rect } }).map((chip) => chip.label), [
    'Line', 'Line', 'Line', 'Line', 'Length', 'Length',
    'Horizontal', 'Horizontal', 'Vertical', 'Vertical', 'Fix',
  ]);
});

test('stripAutoSizing drops the builder fix and dimensions and keeps the form constraints and user rows', () => {
  const rect = contourFromRectangle(40, 20);
  const withUser = {
    ...rect,
    dimensions: [...rect.dimensions, { id: 'd9', kind: 'length', edge: 'e0', value: 40 }],
    constraints: [...rect.constraints, { id: 'k9', kind: 'fix', items: ['p2'], at: { p2: [20, 10] } }],
  };
  const stripped = stripAutoSizing(withUser);
  assert.deepEqual(stripped.dimensions.map((dim) => dim.id), ['d9']);
  assert.deepEqual(stripped.constraints.map((con) => con.kind), ['horizontal', 'horizontal', 'vertical', 'vertical', 'fix']);
  assert.equal(stripped.constraints[4].id, 'k9');
  assert.equal(stripped.points.length, 4);
});

test('merging two shapes stamps loop 1 and 2 and numbers the second loop after the first', () => {
  const merged = mergeContourSpecs(contourFromRectangle(40, 24), contourFromRectangle(20, 12));
  assert.equal(maxLoop(merged), 2);
  const loops = (list) => list.map(itemLoop);
  assert.deepEqual(loops(merged.lines), [1, 1, 1, 1, 2, 2, 2, 2]);
  assert.deepEqual(loops(merged.constraints), [1, 1, 1, 1, 1, 2, 2, 2, 2, 2]);
  assert.ok(merged.constraints.every((con) => con.auto === true && hiddenAutoItem(con)));
  const firstMax = Math.max(...[...merged.lines, ...merged.constraints].filter((item) => itemLoop(item) === 1).map((item) => item.seq));
  const secondMin = Math.min(...[...merged.lines, ...merged.constraints].filter((item) => itemLoop(item) === 2).map((item) => item.seq));
  assert.ok(secondMin > firstMax, `loop 2 (${secondMin}) numbers after loop 1 (${firstMax})`);
  const three = mergeContourSpecs(merged, contourFromCircle(3));
  assert.equal(maxLoop(three), 3);
  assert.deepEqual(loops(three.arcs), [3]);
});

test('a second rectangle arrives with no dimensions and no fix: two shape chips, both free', () => {
  const state = twoRectangles();
  const contour = state.params.contour;
  assert.equal(contour.dimensions.length, 0, 'nothing is dimensioned');
  assert.equal(contour.constraints.some((con) => con.kind === 'fix'), false, 'nothing is pinned');
  assert.deepEqual(contour.constraints.map((con) => con.kind), [
    'horizontal', 'horizontal', 'vertical', 'vertical',
    'horizontal', 'horizontal', 'vertical', 'vertical',
  ]);
  const chips = contourChips(state);
  assert.deepEqual(chips.map((chip) => `${chip.label} ${chip.index}`), ['Rectangle 1', 'Rectangle 2']);
  assert.equal(chips[0].id, loopChipId(1));
  assert.equal(chips[1].id, loopChipId(2));
  assert.ok(chips.every((chip) => chip.kind === 'rectangle'));
  // Both solve and keep their drawn size.
  const solved = solveContour(contour);
  assert.equal(solved.contours.length, 2);
  const withCircle = applySketchAdd(state, 'circle', { radius: 3 }, { inset: true });
  assert.equal(withCircle.ok, true, withCircle.message);
  assert.deepEqual(contourChips(withCircle.state).map((chip) => chip.label), ['Rectangle', 'Rectangle', 'Circle']);
  assert.equal(withCircle.state.params.contour.dimensions.length, 0);
  assert.equal(loopShape(withCircle.state.params.contour, 3), 'circle');
  const polygon = applySketchAdd(withCircle.state, 'polygon', { polygonPreset: 'hexagon', radius: 2 }, { inset: true });
  assert.equal(polygon.ok, true, polygon.message);
  assert.equal(loopShape(polygon.state.params.contour, 4), 'polygon');
  assert.deepEqual(contourChips(polygon.state).map((chip) => chip.label), ['Rectangle', 'Rectangle', 'Circle', 'Polygon']);
  assert.equal(solveContour(polygon.state.params.contour).contours.length, 4);
});

test('a promoted first shape keeps the rows the user already saw; only the new shape joins bare', () => {
  const sketch = enterContourState('crossSection');
  const first = applySketchAdd(sketch, 'rectangle', { width: 40, height: 24, centered: true });
  const promoted = { ...first.state, tool: 'cursor', params: { contour: contourFromRectangle(40, 24) } };
  const second = applySketchAdd(promoted, 'rectangle', { width: 20, height: 12, centered: true }, { inset: true });
  assert.equal(second.ok, true, second.message);
  const contour = second.state.params.contour;
  assert.deepEqual(contour.dimensions.map((dim) => itemLoop(dim)), [1, 1], 'the first shape keeps its two lengths');
  assert.equal(contour.constraints.filter((con) => con.kind === 'fix').length, 1, 'and its fix');
  assert.deepEqual(contourChips(second.state).map((chip) => chip.label), ['Rectangle', 'Length', 'Length', 'Rectangle']);
});

test('a user constraint or dimension on a multi-loop sketch shows; only the builders\' rows are hidden', () => {
  const state = twoRectangles();
  const contour = state.params.contour;
  const e0 = contour.lines[0].id;
  const e4 = contour.lines[4].id;
  const withUser = {
    ...contour,
    dimensions: [{ id: 'd9', kind: 'length', edge: e4, value: 20 }],
    constraints: [...contour.constraints, { id: 'k99', kind: 'parallel', items: [e0, e4] }],
  };
  const chips = contourChips({ params: { contour: withUser } });
  assert.deepEqual(chips.map((chip) => chip.label), ['Rectangle', 'Rectangle', 'Length', 'Parallel']);
  assert.equal(hiddenAutoItem(withUser.constraints[withUser.constraints.length - 1]), false);
});

test('a loop chip selects its lines, opens the Delete card, and deletes the whole loop', () => {
  const state = twoRectangles();
  const chip = contourChips(state)[1];
  assert.equal(loopOfChipId(chip.id), 2);
  const selected = selectSketchChip(state, chip);
  assert.deepEqual(selected.picks.map((pick) => pick.id), state.params.contour.lines.slice(4).map((line) => line.id));
  assert.equal(selected.entityCard, chip.id);
  assert.equal(sketchActiveId(selected), chip.id);
  assert.equal(entityDeleteChip(selected)?.id, chip.id);
  const deleted = deleteContourEntity(selected, chip.id);
  assert.equal(deleted.label, null, 'the loop\'s own rows go without a prompt');
  assert.deepEqual(contourChips(deleted.state).map((chip) => chip.label), ['Rectangle']);
  const left = deleted.state.params.contour;
  assert.equal(left.lines.length, 4);
  assert.equal(left.points.length, 4);
  assert.ok(left.constraints.every((con) => itemLoop(con) === 1));
  assert.equal(solveContour(left).contours.length, 1);
  const gone = deleteContourEntity(deleted.state, loopChipId(1));
  assert.deepEqual(gone.state.params, { points: [] });
  assert.equal(gone.state.profileSet, false);
});

test('a dimension that spans two loops counts on the delete prompt and goes with the loop', () => {
  const state = twoRectangles();
  const contour = state.params.contour;
  const spec = {
    ...contour,
    dimensions: [{ id: 'd9', kind: 'distance', a: contour.points[0].id, b: contour.points[4].id, value: 5 }],
  };
  const spanning = { ...state, params: { ...state.params, contour: spec } };
  const deleted = deleteContourEntity(spanning, loopChipId(2));
  assert.equal(deleted.label, 'Delete along with 1 dimension');
  assert.equal(deleted.state.params.contour.dimensions.some((dim) => dim.id === 'd9'), false);
});

test('loop and auto survive the script round trip', () => {
  const state = twoRectangles();
  const text = emitSolveContour(state.params.contour);
  assert.match(text, /loop: 2/);
  assert.match(text, /auto: true/);
  const back = parseSolveContour(text);
  assert.deepEqual(back.lines.map(itemLoop), [1, 1, 1, 1, 2, 2, 2, 2]);
  assert.ok(back.constraints.every((con) => con.auto === true));
  assert.deepEqual(contourChips({ params: { contour: back } }).map((chip) => chip.label), ['Rectangle', 'Rectangle']);
  const plain = parseSolveContour(emitSolveContour(contourFromRectangle(10, 10)));
  assert.ok(plain.lines.every((line) => line.loop === undefined));
  assert.ok(plain.dimensions.every((dim) => dim.auto === true));
});

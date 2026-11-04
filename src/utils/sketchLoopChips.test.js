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
import { maxLoop, mergeContourSpecs } from './sketchLoops.js';

/**
 * A second shape in a sketch is another loop, not a pile of relationships.
 *
 * Appending promoted the first rectangle into its solver rows and gave the
 * second the same seq numbers, so the strip showed 22 interleaved chips
 * (Line, Line, Length, Length, Horizontal, Horizontal, Fix, Fix, …) and
 * the canvas drew every builder constraint as a tag between the two.
 * Now each loop is one shape chip plus its dimensions; the builders'
 * horizontals, verticals, fixes and equals are `auto` and hidden on a
 * multi-loop sketch; a single promoted shape is unchanged.
 */

function twoRectangles() {
  const sketch = enterContourState('crossSection');
  const first = applySketchAdd(sketch, 'rectangle', { width: 40, height: 24, centered: true });
  const second = applySketchAdd(first.state, 'rectangle', { width: 20, height: 12, centered: true }, { inset: true });
  assert.equal(second.ok, true, second.message);
  return second.state;
}

test('builders mark their own constraints auto; a lone shape still lists every row', () => {
  const rect = contourFromRectangle(40, 20);
  assert.ok(rect.constraints.every((con) => con.auto === true));
  assert.ok(rect.dimensions.every((dim) => dim.auto === undefined));
  assert.ok(contourFromCircle(5).constraints.every((con) => con.auto === true));
  assert.ok(contourFromPolygon('hexagon', 8).constraints.every((con) => con.auto === true));
  // No loop number: nothing is hidden and the chips are as before.
  assert.equal(hiddenAutoItem(rect.constraints[0]), false);
  assert.deepEqual(contourChips({ params: { contour: rect } }).map((chip) => chip.label), [
    'Line', 'Line', 'Line', 'Line', 'Length', 'Length',
    'Horizontal', 'Horizontal', 'Vertical', 'Vertical', 'Fix',
  ]);
});

test('merging two shapes stamps loop 1 and 2, keeps auto, and numbers the second loop after the first', () => {
  const merged = mergeContourSpecs(contourFromRectangle(40, 24), contourFromRectangle(20, 12));
  assert.equal(maxLoop(merged), 2);
  const loops = (list) => list.map(itemLoop);
  assert.deepEqual(loops(merged.lines), [1, 1, 1, 1, 2, 2, 2, 2]);
  assert.deepEqual(loops(merged.dimensions), [1, 1, 2, 2]);
  assert.deepEqual(loops(merged.constraints), [1, 1, 1, 1, 1, 2, 2, 2, 2, 2]);
  assert.ok(merged.constraints.every((con) => con.auto === true && hiddenAutoItem(con)));
  const firstMax = Math.max(...[...merged.lines, ...merged.dimensions, ...merged.constraints]
    .filter((item) => itemLoop(item) === 1).map((item) => item.seq));
  const secondMin = Math.min(...[...merged.lines, ...merged.dimensions, ...merged.constraints]
    .filter((item) => itemLoop(item) === 2).map((item) => item.seq));
  assert.ok(secondMin > firstMax, `loop 2 (${secondMin}) numbers after loop 1 (${firstMax})`);
  // Every constraint and dimension still names only its own loop's geometry.
  const loopOfGeom = new Map([...merged.lines, ...merged.arcs].map((item) => [item.id, itemLoop(item)]));
  for (const con of merged.constraints) {
    for (const id of con.items || []) {
      if (loopOfGeom.has(id)) assert.equal(loopOfGeom.get(id), itemLoop(con));
    }
  }
  for (const dim of merged.dimensions) assert.equal(loopOfGeom.get(dim.edge), itemLoop(dim));
  assert.equal(solveContour(merged).contours.length, 2);
  // A third loop takes 3; the first two keep their numbers.
  const three = mergeContourSpecs(merged, contourFromCircle(3));
  assert.equal(maxLoop(three), 3);
  assert.deepEqual(loops(three.arcs), [3]);
  assert.deepEqual(loops(three.lines), [1, 1, 1, 1, 2, 2, 2, 2]);
});

test('the strip shows one shape chip per loop with its dimensions, and no builder constraints', () => {
  const state = twoRectangles();
  const chips = contourChips(state);
  assert.deepEqual(chips.map((chip) => `${chip.label} ${chip.index}`), [
    'Rectangle 1', 'Length 1', 'Length 2', 'Rectangle 2', 'Length 3', 'Length 4',
  ]);
  assert.equal(chips[0].id, loopChipId(1));
  assert.equal(chips[0].kind, 'rectangle');
  assert.equal(chips[3].id, loopChipId(2));
  assert.equal(chips[1].title, 'Length 40');
  assert.equal(chips[4].title, 'Length 20');
  assert.ok(chips.every((chip) => chip.kind !== 'constraint' && chip.kind !== 'line'));
  const withCircle = applySketchAdd(state, 'circle', { radius: 3 }, { inset: true });
  assert.equal(withCircle.ok, true, withCircle.message);
  const more = contourChips(withCircle.state);
  assert.deepEqual(more.map((chip) => chip.label).slice(6), ['Circle', 'Radius']);
  assert.equal(more[6].kind, 'circle');
  assert.equal(loopShape(withCircle.state.params.contour, 3), 'circle');
  const polygon = applySketchAdd(withCircle.state, 'polygon', { polygonPreset: 'hexagon', radius: 2 }, { inset: true });
  assert.equal(polygon.ok, true, polygon.message);
  assert.equal(loopShape(polygon.state.params.contour, 4), 'polygon');
  assert.equal(contourChips(polygon.state).filter((chip) => chip.kind === 'polygon').length, 1);
});

test('a user constraint on a multi-loop sketch still shows; only the builders\' are hidden', () => {
  const state = twoRectangles();
  const contour = state.params.contour;
  const e0 = contour.lines[0].id;
  const e4 = contour.lines[4].id;
  const withUser = {
    ...contour,
    constraints: [...contour.constraints, { id: 'k99', kind: 'parallel', items: [e0, e4] }],
  };
  const chips = contourChips({ params: { contour: withUser } });
  assert.deepEqual(chips.map((chip) => chip.label), [
    'Rectangle', 'Length', 'Length', 'Rectangle', 'Length', 'Length', 'Parallel',
  ]);
  assert.equal(hiddenAutoItem(withUser.constraints[withUser.constraints.length - 1]), false);
});

test('a loop chip selects its lines, opens the Delete card, and deletes the whole loop', () => {
  const state = twoRectangles();
  const chip = contourChips(state)[3];
  assert.equal(loopOfChipId(chip.id), 2);
  const selected = selectSketchChip(state, chip);
  assert.deepEqual(selected.picks.map((pick) => pick.id), state.params.contour.lines.slice(4).map((line) => line.id));
  assert.equal(selected.entityCard, chip.id);
  assert.equal(sketchActiveId(selected), chip.id);
  assert.equal(entityDeleteChip(selected)?.id, chip.id);
  const deleted = deleteContourEntity(selected, chip.id);
  assert.equal(deleted.label, null, 'the loop\'s own rows go without a prompt');
  assert.deepEqual(contourChips(deleted.state).map((chip) => chip.label), ['Rectangle', 'Length', 'Length']);
  const left = deleted.state.params.contour;
  assert.equal(left.lines.length, 4);
  assert.equal(left.points.length, 4);
  assert.ok(left.constraints.every((con) => itemLoop(con) === 1));
  assert.equal(solveContour(left).contours.length, 1);
  // Deleting the last loop clears the sketch.
  const gone = deleteContourEntity(deleted.state, loopChipId(1));
  assert.deepEqual(gone.state.params, { points: [] });
  assert.equal(gone.state.profileSet, false);
});

test('a dimension that spans two loops counts on the delete prompt and goes with the loop', () => {
  const state = twoRectangles();
  const contour = state.params.contour;
  const spec = {
    ...contour,
    dimensions: [...contour.dimensions, { id: 'd9', kind: 'distance', a: contour.points[0].id, b: contour.points[4].id, value: 5 }],
  };
  const spanning = { ...state, params: { ...state.params, contour: spec } };
  const deleted = deleteContourEntity(spanning, loopChipId(2));
  assert.equal(deleted.label, 'Delete along with 1 dimension');
  assert.equal(deleted.state.params.contour.dimensions.some((dim) => dim.id === 'd9'), false);
});

test('loop and auto survive the script round trip', () => {
  const merged = mergeContourSpecs(contourFromRectangle(40, 24), contourFromCircle(5));
  const text = emitSolveContour(merged);
  assert.match(text, /loop: 2/);
  assert.match(text, /auto: true/);
  const back = parseSolveContour(text);
  assert.deepEqual(back.lines.map(itemLoop), [1, 1, 1, 1]);
  assert.deepEqual(back.arcs.map(itemLoop), [2]);
  assert.ok(back.constraints.every((con) => con.auto === true));
  assert.deepEqual(contourChips({ params: { contour: back } }).map((chip) => chip.label), [
    'Rectangle', 'Length', 'Length', 'Circle', 'Radius',
  ]);
  // A plain item neither gains nor keeps junk.
  const plain = parseSolveContour(emitSolveContour(contourFromRectangle(10, 10)));
  assert.ok(plain.lines.every((line) => line.loop === undefined));
  assert.ok(plain.constraints.every((con) => con.auto === true));
});

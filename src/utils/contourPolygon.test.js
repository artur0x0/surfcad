import assert from 'node:assert/strict';
import test from 'node:test';
import { buildProfileFromParams, regularPolygonContours } from './crossSectionSubstrate.js';
import { sketchHandles } from './contourDrag.js';
import { emitProfileExprFromParams } from './helperPaletteSnippets.js';
import {
  REGULAR_POLYGON_PRESETS,
  contourFromPolygon,
  regularPolygonSides,
  solveContour,
} from './contourSolve.js';

const PRESETS = ['triangle', 'square', 'pentagon', 'hexagon', 'heptagon', 'octagon'];

function sideLengths(spec) {
  const at = Object.fromEntries(spec.points.map((p) => [p.id, p.at]));
  return spec.lines
    .filter((line) => !line.guide)
    .map((line) => Math.hypot(at[line.b][0] - at[line.a][0], at[line.b][1] - at[line.a][1]));
}

test('polygon presets run from 3 sides through 8', () => {
  assert.deepEqual(Object.keys(REGULAR_POLYGON_PRESETS), PRESETS);
  assert.deepEqual(PRESETS.map((preset) => regularPolygonSides(preset)), [3, 4, 5, 6, 7, 8]);
  assert.equal(regularPolygonSides('quarterCircle'), 0);
  assert.throws(
    () => contourFromPolygon('nonagon', 8),
    /triangle, square, pentagon, hexagon, heptagon, or octagon/,
  );
});

test('heptagon and octagon keep equal sides and the same first corner as a hexagon', () => {
  for (const preset of ['heptagon', 'octagon']) {
    const sides = regularPolygonSides(preset);
    const spec = contourFromPolygon(preset, 8);
    assert.equal(spec.points.length, sides + 1);
    assert.equal(spec.lines.filter((line) => !line.guide).length, sides);
    assert.equal(spec.constraints.filter((item) => item.kind === 'equal').length, sides - 1);
    const first = spec.points.find((p) => p.id === 'p1').at;
    // Same start angle as the older presets: angle -π/2, so the first corner is on -V.
    assert.ok(Math.abs(first[0]) < 1e-9 && Math.abs(first[1] + 8) < 1e-9, JSON.stringify(first));
    const lengths = sideLengths(spec);
    const chord = 2 * 8 * Math.sin(Math.PI / sides);
    for (const length of lengths) assert.ok(Math.abs(length - chord) < 1e-6, String(length));
    const solved = solveContour(spec);
    assert.equal(solved.contours[0].length, sides);
    assert.notEqual(solved.status, 'conflict');

    const built = buildProfileFromParams({ profileType: 'polygon', polygonPreset: preset, radius: 8 });
    assert.equal(built.profile.sides, sides);
    assert.equal(built.contours[0].length, sides);
    assert.equal(regularPolygonContours(sides, 8)[0].length, sides);

    const handles = sketchHandles({ tool: 'polygon', params: { polygonPreset: preset, radius: 8 } });
    assert.equal(handles.length, sides);
    assert.ok(handles.every((handle) => handle.kind === 'polygon'));

    const emitted = emitProfileExprFromParams({ profileType: 'polygon', polygonPreset: preset, radius: 8 });
    const pairs = emitted.match(/\[[^\]]+\]/g) || [];
    assert.equal(pairs.length, sides, emitted);
  }
});

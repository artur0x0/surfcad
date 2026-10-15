import assert from 'node:assert/strict';
import test from 'node:test';
import { composeHelperInsert } from './helperPaletteSnippets.js';
import { confirmFeatureEdit, openFeatureEdit } from './featureEdit.js';
import { parseFeatureMarkers } from './featureMarkers.js';

test('confirmFeatureEdit merges partial bridge fields with parsed block params', () => {
  const script = composeHelperInsert('', 'cube', null, {
    width: 20,
    depth: 20,
    height: 20,
    center: true,
  });
  const cube = parseFeatureMarkers(script).find((f) => f.kind === 'cube');
  assert.ok(cube);
  const session = openFeatureEdit(script, cube);
  assert.ok(session.ok);
  assert.equal(session.fields.width, 20);

  const result = confirmFeatureEdit(script, cube, {
    fields: { x: 15, center: false },
  });
  assert.ok(result.ok && result.changed);
  assert.match(result.buffer, /Manifold\.cube\(\[20, 20, 20\], false\)/);
  assert.match(result.buffer, /\.translate\(\[15, 0, 0\]\)/);
  assert.doesNotMatch(result.buffer, /Manifold\.cube\(\[40, 30, 20\]/);
});

test('confirmFeatureEdit keeps cylinder size when only pose is patched', () => {
  const host = composeHelperInsert('', 'cube', null, { width: 10, depth: 10, height: 10, center: true });
  const script = composeHelperInsert(host, 'cylinder', null, {
    height: 18,
    radius: 7,
    segments: 32,
    x: 5,
  });
  const cyl = parseFeatureMarkers(script).find((f) => f.kind === 'cylinder');
  const result = confirmFeatureEdit(script, cyl, { fields: { z: 12 } });
  assert.ok(result.ok && result.changed);
  assert.match(result.buffer, /Manifold\.cylinder\(18, 7, 7, 32\)/);
  assert.match(result.buffer, /\.translate\(\[5, 0, 12\]\)/);
});

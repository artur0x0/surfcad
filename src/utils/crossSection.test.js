import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as crossSection from './crossSection.js';

test('unused cross-section script eval helpers are removed', () => {
  assert.equal(crossSection.createCrossSection, undefined);
  assert.equal(crossSection.getManifoldBounds, undefined);
  assert.equal(crossSection.getPlaneOffsetRange, undefined);
  assert.equal(crossSection.createParallelSections, undefined);
  assert.ok(crossSection.PLANE_PRESETS.XY);
  assert.equal(typeof crossSection.getCutEdges, 'function');
  const src = readFileSync(new URL('./crossSection.js', import.meta.url), 'utf8');
  assert.equal(src.includes('new Function'), false);
  assert.equal(src.includes('evaluateSandboxedScript'), false);
});

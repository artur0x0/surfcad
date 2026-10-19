import assert from 'node:assert/strict';
import test from 'node:test';
import { runScript } from '../lib/surfcad/index.js';
import { composeHelperInsert } from './helperPaletteSnippets.js';

/** Bike acceptance PR 2: a cube at Z = 600 and Z = 2000 mm builds. */

async function cubeAt(z) {
  const script = composeHelperInsert('', 'cube', null, { width: 20, depth: 20, height: 20, center: true, z });
  assert.match(script, new RegExp(`translate\\(\\[0, 0, ${z}\\]\\)`));
  const ran = await runScript(script);
  assert.equal(ran.status, 'NoError');
  assert.equal(ran.bodyCount, 1);
  return ran;
}

test('a cube at Z = 600 mm builds where it was placed', async () => {
  const ran = await cubeAt(600);
  assert.ok(Math.abs(ran.boundingBox.max[2] - 610) < 1e-6 && Math.abs(ran.boundingBox.min[2] - 590) < 1e-6, JSON.stringify(ran.boundingBox));
});

test('a cube at Z = 2000 mm builds where it was placed', async () => {
  const ran = await cubeAt(2000);
  assert.ok(Math.abs(ran.boundingBox.max[2] - 2010) < 1e-6, JSON.stringify(ran.boundingBox));
  assert.ok(Math.abs(ran.volume - 8000) < 1e-6);
});

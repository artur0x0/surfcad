import assert from 'node:assert/strict';
import test from 'node:test';
import { runScript } from '../lib/surfcad/index.js';

/**
 * patternOnPoints(body, points, opts): one instance placed at every point,
 * oriented along the point's axis when it has one. The way a bolt part is
 * patterned onto the hole centers of the part it fastens.
 */

const BOLT = 'const bolt = Manifold.cylinder(20, 2, 2, 24);';

test('copies land on every point; the volume is the count times one', async () => {
  const ran = await runScript(`${BOLT}\nlet part = patternOnPoints(bolt, [[0, 0, 0], [40, 0, 0], [0, 40, 0]]);\nreturn part;`);
  assert.equal(ran.status, 'NoError');
  assert.equal(ran.bodyCount, 3);
  const one = (await runScript(`${BOLT}\nreturn bolt;`)).volume;
  assert.ok(Math.abs(ran.volume - 3 * one) < 1e-6, `${ran.volume} vs ${3 * one}`);
  const xs = ran.bodyCentroids.map((c) => Math.round(c[0])).sort((a, b) => a - b);
  assert.deepEqual(xs, [0, 0, 40]);
});

test('a point with an axis turns the body so its up direction follows it', async () => {
  const ran = await runScript(`${BOLT}\nlet part = patternOnPoints(bolt, [{ at: [0, 0, 0], axis: [1, 0, 0] }], { up: [0, 0, 1] });\nreturn part;`);
  assert.equal(ran.status, 'NoError');
  const size = ran.boundingBox.max.map((v, i) => v - ran.boundingBox.min[i]);
  // Height 20 now along x; radius 2 across y and z.
  assert.ok(Math.abs(size[0] - 20) < 1e-6, JSON.stringify(size));
  assert.ok(Math.abs(size[1] - 4) < 0.05 && Math.abs(size[2] - 4) < 0.05, JSON.stringify(size));
  // A point whose axis is already up is a plain translate; a flipped axis points the body down.
  const down = await runScript(`${BOLT}\nlet part = patternOnPoints(bolt, [{ at: [0, 0, 0], axis: [0, 0, -1] }]);\nreturn part;`);
  assert.ok(Math.abs(down.boundingBox.min[2] + 20) < 1e-6 && Math.abs(down.boundingBox.max[2]) < 1e-6, JSON.stringify(down.boundingBox));
  // An object point without an axis keeps the body as it is.
  const plain = await runScript(`${BOLT}\nlet part = patternOnPoints(bolt, [{ at: [5, 6, 7] }]);\nreturn part;`);
  assert.ok(Math.abs(plain.boundingBox.min[2] - 7) < 1e-6);
});

test('keepOriginal adds the source where it is; merge false keeps overlapping copies as separate bodies', async () => {
  const kept = await runScript(`${BOLT}\nlet part = patternOnPoints(bolt, [[40, 0, 0]], { keepOriginal: true });\nreturn part;`);
  assert.equal(kept.bodyCount, 2);
  const fused = await runScript(`${BOLT}\nlet part = patternOnPoints(bolt, [[0, 0, 0], [1, 0, 0]]);\nreturn part;`);
  assert.equal(fused.bodyCount, 1);
  const separate = await runScript(`${BOLT}\nlet part = patternOnPoints(bolt, [[0, 0, 0], [1, 0, 0]], { merge: false });\nreturn part;`);
  assert.equal(separate.bodyCount, 2);
});

test('bad input is a clear script error, not a kernel failure', async () => {
  for (const bad of ['[]', 'null', '[[1, 2]]', '[[1, 2, "x"]]', '[{ axis: [0, 0, 1] }]', '"not points"', '[[0, 0, 0, 0]]']) {
    await assert.rejects(runScript(`${BOLT}\nlet part = patternOnPoints(bolt, ${bad});\nreturn part;`), /patternOnPoints/, bad);
  }
  await assert.rejects(runScript(`${BOLT}\nlet part = patternOnPoints(bolt, [{ at: [0, 0, 0], axis: [0, 0, 0] }]);\nreturn part;`), /axis/);
});

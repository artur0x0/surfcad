import assert from 'node:assert/strict';
import test from 'node:test';
import { getManifoldModule, runScript } from './index.js';
import { logicalBodies } from '../../workers/separateBodies.js';

/**
 * Cavity ownership is which solid encloses the void shell, not which bounding
 * box covers the cavity center. Each fixture is one the box test gets wrong:
 * the wrong solid is smaller, and its box contains the cavity center.
 */

function copyBox(box) {
  return {
    min: [box.min[0], box.min[1], box.min[2]],
    max: [box.max[0], box.max[1], box.max[2]],
  };
}

function boxCenter(box) {
  return [
    (box.min[0] + box.max[0]) / 2,
    (box.min[1] + box.max[1]) / 2,
    (box.min[2] + box.max[2]) / 2,
  ];
}

function pointInBox(point, box, eps = 1e-4) {
  return point.every((value, axis) => value >= box.min[axis] - eps && value <= box.max[axis] + eps);
}

function boxContainsBox(outer, inner, eps = 1e-4) {
  for (let axis = 0; axis < 3; axis++) {
    if (inner.min[axis] < outer.min[axis] - eps) return false;
    if (inner.max[axis] > outer.max[axis] + eps) return false;
  }
  return true;
}

function boxesOverlap(a, b, eps = 1e-4) {
  for (let axis = 0; axis < 3; axis++) {
    const lo = Math.max(a.min[axis], b.min[axis]);
    const hi = Math.min(a.max[axis], b.max[axis]);
    if (!(hi - lo > eps)) return false;
  }
  return true;
}

function componentRows(manifold) {
  const parts = manifold.decompose();
  try {
    return parts.map((part) => ({ volume: part.volume(), box: copyBox(part.boundingBox()) }));
  } finally {
    for (const part of parts) part.delete();
  }
}

function logicalRows(manifold) {
  const bodies = logicalBodies(manifold, getManifoldModule());
  assert.ok(bodies, 'expected more than one logical solid');
  try {
    return bodies.map((body) => {
      const parts = body.decompose();
      let negative = 0;
      try {
        for (const part of parts) negative = Math.min(negative, part.volume());
      } finally {
        for (const part of parts) part.delete();
      }
      return { volume: body.volume(), negative, box: copyBox(body.boundingBox()) };
    });
  } finally {
    for (const body of bodies) body.delete();
  }
}

function hullAndCavity(manifold) {
  const rows = componentRows(manifold);
  return {
    hull: rows.find((row) => row.volume > 0),
    cavity: rows.find((row) => row.volume < 0),
  };
}

test('a void stays with the hollow solid when a neighbour box covers the cavity center', async () => {
  const voided = await runScript("return hollow(Manifold.cube([40, 40, 40], true).translate([20, 20, 20]), 2, 'none');");
  const boss = await runScript('return Manifold.cube([30, 16, 16], true).translate([32, 20, 20]);');
  const both = await runScript([
    "const voided = hollow(Manifold.cube([40, 40, 40], true).translate([20, 20, 20]), 2, 'none');",
    'const boss = Manifold.cube([30, 16, 16], true).translate([32, 20, 20]);',
    'return Manifold.compose([voided, boss]);',
  ].join('\n'));
  assert.equal(voided.status, 'NoError');
  assert.equal(boss.status, 'NoError');
  assert.equal(both.status, 'NoError');
  assert.equal(both.bodyCount, 2);

  const voidBox = copyBox(voided.manifold.boundingBox());
  const bossBox = copyBox(boss.manifold.boundingBox());
  const { hull, cavity } = hullAndCavity(voided.manifold);
  assert.ok(boxesOverlap(voidBox, bossBox), 'boxes do not overlap');
  assert.ok(!boxContainsBox(voidBox, bossBox) && !boxContainsBox(bossBox, voidBox), 'one box nests in the other');
  assert.ok(pointInBox(boxCenter(cavity.box), bossBox), 'cavity center is outside the neighbour box');
  assert.ok(boss.volume < hull.volume, 'neighbour is not the smaller containing box');

  const rows = logicalRows(both.manifold);
  const shelled = rows.find((row) => Math.abs(row.volume - voided.volume) < 1);
  const solid = rows.find((row) => Math.abs(row.volume - boss.volume) < 1);
  assert.ok(shelled, `hollow volume ${voided.volume} was not kept (${rows.map((row) => row.volume).join(', ')})`);
  assert.ok(solid, `neighbour volume ${boss.volume} was not kept`);
  assert.ok(shelled.negative < -1000, 'hollow solid lost its cavity');
  assert.ok(Math.abs(shelled.negative - cavity.volume) < 1, `cavity ${shelled.negative} is not the hollow void`);
  assert.equal(solid.negative, 0);
});

test('each nested hollow keeps its own cavity', async () => {
  const outer = await runScript("return hollow(Manifold.cube([80, 80, 80], true), 3, 'none');");
  const inner = await runScript("return hollow(Manifold.cube([30, 30, 30], true), 2, 'none');");
  const both = await runScript([
    "const outer = hollow(Manifold.cube([80, 80, 80], true), 3, 'none');",
    "const inner = hollow(Manifold.cube([30, 30, 30], true), 2, 'none');",
    'return Manifold.compose([outer, inner]);',
  ].join('\n'));
  assert.equal(outer.status, 'NoError');
  assert.equal(inner.status, 'NoError');
  assert.equal(both.status, 'NoError');
  assert.equal(both.bodyCount, 2);

  const outerParts = hullAndCavity(outer.manifold);
  const innerParts = hullAndCavity(inner.manifold);
  const innerBox = copyBox(inner.manifold.boundingBox());
  assert.ok(boxContainsBox(outerParts.cavity.box, innerBox), 'inner solid is not inside the outer cavity');
  assert.ok(pointInBox(boxCenter(outerParts.cavity.box), innerBox), 'outer cavity center misses the inner box');
  assert.ok(pointInBox(boxCenter(innerParts.cavity.box), innerBox));
  assert.ok(innerParts.hull.volume < outerParts.hull.volume, 'inner hull is not the smaller box');

  const rows = logicalRows(both.manifold);
  const outerBody = rows.find((row) => Math.abs(row.volume - outer.volume) < 1);
  const innerBody = rows.find((row) => Math.abs(row.volume - inner.volume) < 1);
  assert.ok(outerBody, `outer shell ${outer.volume} was not kept (${rows.map((row) => row.volume).join(', ')})`);
  assert.ok(innerBody, `inner shell ${inner.volume} was not kept`);
  assert.ok(Math.abs(outerBody.negative - outerParts.cavity.volume) < 1, 'outer cavity moved onto the inner solid');
  assert.ok(Math.abs(innerBody.negative - innerParts.cavity.volume) < 1, 'inner cavity moved onto the outer solid');
});

test('a hollow part in the crook of an L keeps its cavity when the L box contains it', async () => {
  const frameSrc = [
    'Manifold.cube([4, 70, 40], true).translate([2, 35, 20])',
    '.add(Manifold.cube([70, 4, 40], true).translate([35, 2, 20]))',
  ].join('');
  const podSrc = "hollow(Manifold.cube([30, 30, 30], true).translate([36, 36, 20]), 2, 'none')";
  const frame = await runScript(`return ${frameSrc};`);
  const pod = await runScript(`return ${podSrc};`);
  const both = await runScript(`return Manifold.compose([${frameSrc}, ${podSrc}]);`);
  assert.equal(frame.status, 'NoError');
  assert.equal(pod.status, 'NoError');
  assert.equal(both.status, 'NoError');
  assert.equal(both.bodyCount, 2);

  const frameBox = copyBox(frame.manifold.boundingBox());
  const podBox = copyBox(pod.manifold.boundingBox());
  const { hull, cavity } = hullAndCavity(pod.manifold);
  assert.ok(boxContainsBox(frameBox, podBox), 'L box does not contain the hollow part');
  assert.ok(pointInBox(boxCenter(cavity.box), frameBox), 'cavity center is outside the L box');
  assert.ok(frame.volume < hull.volume, 'L is not the smaller containing box');

  const rows = logicalRows(both.manifold);
  const shelled = rows.find((row) => Math.abs(row.volume - pod.volume) < 1);
  const solid = rows.find((row) => Math.abs(row.volume - frame.volume) < 1);
  assert.ok(shelled, `hollow volume ${pod.volume} was not kept (${rows.map((row) => row.volume).join(', ')})`);
  assert.ok(solid, `L volume ${frame.volume} was not kept`);
  assert.ok(Math.abs(shelled.negative - cavity.volume) < 1, 'hollow part lost its cavity to the L');
  assert.equal(solid.negative, 0);
});

/**
 * A frame contour whose hole runs out to the outer profile extrudes as two
 * boxes. Set on the host face they only share an edge, so a plain boolean
 * leaves each as its own 12-triangle body. Merge-on has to absorb them.
 * `{ merge: false }` still composes. A gap past the weld (0.001 mm) stays
 * a separate body.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { runScript } from './index.js';

function rows(manifold) {
  const parts = manifold.decompose();
  try {
    return parts.map((part) => ({
      volume: part.volume(),
      tri: part.numTri(),
    }));
  } finally {
    for (const part of parts) part.delete();
  }
}

const CUBE = 'let part = Manifold.cube([40, 40, 20], true);';

test('a frame that splits into boxes merges onto the face instead of leaving 12-triangle scraps', async () => {
  const src = `${CUBE}
const frame = makeExtrude([].concat(profileRectangle(50, 40, true).contours, profileRectangle(40, 40, true).contours), 5).translate([0, 0, 10]);
part = part.add(frame, { merge: true });
return part;`;
  const ran = await runScript(src);
  assert.equal(ran.status, 'NoError', ran.status);
  assert.equal(ran.bodyCount, 1);
  const parts = rows(ran.manifold);
  assert.equal(parts.length, 1);
  assert.ok(Math.abs(ran.volume - 34000) < 1, `volume ${ran.volume}`);
  assert.ok(!parts.some((part) => part.tri === 12 && part.volume < 30000), 'a 12-triangle scrap body remains');
});

test('merge off still keeps the split frame as its own bodies', async () => {
  const src = `${CUBE}
const frame = makeExtrude([].concat(profileRectangle(50, 40, true).contours, profileRectangle(40, 40, true).contours), 5).translate([0, 0, 10]);
part = part.add(frame, { merge: false });
return part;`;
  const ran = await runScript(src);
  assert.equal(ran.status, 'NoError', ran.status);
  assert.equal(ran.bodyCount, 3);
  const scraps = rows(ran.manifold).filter((part) => part.tri === 12 && part.volume < 2000);
  assert.equal(scraps.length, 2);
});

test('a picture-frame lip welds on without filling its hole', async () => {
  const src = `${CUBE}
const lip = makeExtrude([].concat(profileRectangle(50, 50, true).contours, profileRectangle(40, 40, true).contours), 5).translate([0, 0, 10]);
part = part.add(lip, { merge: true });
return part;`;
  const ran = await runScript(src);
  assert.equal(ran.status, 'NoError', ran.status);
  assert.equal(ran.bodyCount, 1);
  // Border only: (50*50 - 40*40) * 5 = 4500, on the 32000 cube. A filled hole
  // would add the whole 50*50*5 plate (12500) and land near 44500.
  assert.ok(Math.abs(ran.volume - 36500) < 5, `volume ${ran.volume} filled the lip hole`);
});

test('a rim lip the boolean turns into a handle stays its own body', async () => {
  // 68.7 x 74.1 is not the 40 mm lip: the coplanar rim boolean joins into one
  // solid of genus 2. That join is dropped. The lip stays a separate body.
  const src = `let part = Manifold.cube([68.7, 74.1, 37.5], true);
const lip = makeExtrude([].concat(profileRectangle(86.7, 92.1, true).contours, profileRectangle(68.7, 74.1, true).contours), 3.175).translate([0, 0, 18.75]);
part = part.add(lip);
return part;`;
  const ran = await runScript(src);
  assert.equal(ran.status, 'NoError', ran.status);
  assert.equal(ran.bodyCount, 2);
  assert.equal(ran.manifold.genus(), 0);
  const parts = rows(ran.manifold);
  assert.equal(parts.length, 2);
});

test('a proper frame on the face stays one solid, and a real gap stays separate', async () => {
  const frame = await runScript(`${CUBE}
const frame = makeExtrude([].concat(profileRectangle(50, 40, true).contours, profileRectangle(30, 20, true).contours), 5).translate([0, 0, 10]);
part = part.add(frame);
return part;`);
  assert.equal(frame.status, 'NoError', frame.status);
  assert.equal(frame.bodyCount, 1);
  assert.ok(Math.abs(frame.volume - 39000) < 1, `volume ${frame.volume}`);

  const near = await runScript(`${CUBE}
part = part.add(Manifold.cube([30, 20, 3], true).translate([0, 0, 11.5001]), { merge: true });
return part;`);
  assert.equal(near.bodyCount, 1, 'a 0.0001 mm gap left a scrap box');

  const gap = await runScript(`${CUBE}
part = part.add(Manifold.cube([30, 20, 3], true).translate([0, 0, 11.52]), { merge: true });
return part;`);
  assert.equal(gap.status, 'NoError', gap.status);
  assert.equal(gap.bodyCount, 2);
  const boxes = rows(gap.manifold);
  assert.ok(boxes.some((part) => part.tri === 12 && Math.abs(part.volume - 1800) < 1));
});

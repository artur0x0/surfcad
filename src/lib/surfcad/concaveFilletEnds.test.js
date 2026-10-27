/**
 * Open ends of a concave (material-add) fillet, MVP 3 B6 / B7 / follow-up 4.
 *
 * B6: a 10 mm boss root edge on a 10.75 mm plate. The plate side 0.375 mm
 * past the boss end wall tied it on alignment and took the clip plane out
 * to itself, so the filler grew 0.375 mm wings (15.16 mm³ for 13.41).
 * B7 / follow-up 4: the same root edge after the boss corners were rounded.
 * The straight segment ends where the round begins, no face is aligned with
 * the tangent there, and the open-end pad stood proud as a nub (+1.65 mm³).
 * The pocket case pins the rule's other branch: an end that runs into
 * material keeps its pad (swallowed), so the filler fills the corner.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { runScript } from './index.js';

const QUARTER = (r, L) => (1 - Math.PI / 4) * r * r * L;

async function volumeOf(source) {
  const ran = await runScript(`${source}\nreturn part;\n`);
  assert.equal(ran.status, 'NoError', `${ran.status}: ${String(ran.error || ran.message || '').slice(0, 200)}`);
  return ran.volume;
}

const BOSS = (plateWidth, bossWidth) => `
let part = Manifold.cube([${plateWidth}, 20, 5], true);
part = part.add(Manifold.cube([${bossWidth}, 6, 10], true).translate([0, 0, 7.5]));
`;
/** The straight concave root edge on the boss front (y = -3, z = 2.5). */
const FRONT_ROOT = (r, opts = '') => `
{
  const cc = concaveEdges(part).filter((e) => Math.abs(e.va[1] + 3) < 1e-6 && Math.abs(e.vb[1] + 3) < 1e-6
    && Math.abs(e.va[2] - 2.5) < 1e-6 && Math.abs(e.vb[2] - 2.5) < 1e-6 && Math.abs(e.va[0] - e.vb[0]) > 5);
  if (cc.length !== 1) throw new Error('front root edge: ' + cc.length);
  part = filletAlongPath(part, makeSweepPath(cc), ${r}${opts});
}
`;

test('B6: a concave fillet on a 10 mm edge stops at the boss end walls on a 10.75 mm plate', async () => {
  for (const plate of [10.75, 10, 14]) {
    const base = await volumeOf(BOSS(plate, 10));
    const added = (await volumeOf(`${BOSS(plate, 10)}${FRONT_ROOT(2.5)}`)) - base;
    const expected = QUARTER(2.5, 10);
    assert.ok(Math.abs(added - expected) < 0.02 * expected, `plate ${plate}: added ${added.toFixed(3)} expected ${expected.toFixed(3)}`);
  }
});

test('B7: a concave fillet after the boss corners were rounded ends flush at the round, no nub', async () => {
  const ROUND = `
{
  const cv = convexEdges(part).filter((e) => Math.abs(e.va[1] + 3) < 1e-6 && Math.abs(e.vb[1] + 3) < 1e-6
    && Math.abs(e.va[0] - e.vb[0]) < 1e-6 && Math.abs(e.va[0]) > 9.9 && Math.min(e.va[2], e.vb[2]) > 2.4);
  if (cv.length !== 2) throw new Error('boss corners: ' + cv.length);
  for (const e of cv) part = filletAlongPath(part, makeSweepPath([e]), 4);
}
`;
  const rounded = await volumeOf(`${BOSS(40, 20)}${ROUND}`);
  for (const opts of ['', ', { variableProfile: true }']) {
    const added = (await volumeOf(`${BOSS(40, 20)}${ROUND}${FRONT_ROOT(2.8, opts)}`)) - rounded;
    // The straight segment runs between the rounds' first facets: 12.1 mm,
    // not the nominal 12. A nub at each end adds about 1.65 mm³ (8%).
    const expected = QUARTER(2.8, 12.1);
    assert.ok(Math.abs(added - expected) < 0.03 * expected, `opts [${opts}]: added ${added.toFixed(3)} expected ${expected.toFixed(3)}`);
  }
});

test('an end that runs into material keeps its pad: a pocket floor edge fills to both end walls', async () => {
  const POCKET = `
let part = Manifold.cube([30, 20, 10], true);
part = part.subtract(Manifold.cube([16, 8, 5], true).translate([0, 0, 2.5]));
`;
  const base = await volumeOf(POCKET);
  for (const r of [1, 2]) {
    const added = (await volumeOf(`${POCKET}
{
  const cc = concaveEdges(part).filter((e) => Math.abs(e.va[1] + 4) < 1e-6 && Math.abs(e.vb[1] + 4) < 1e-6
    && Math.abs(e.va[2]) < 1e-6 && Math.abs(e.vb[2]) < 1e-6);
  if (cc.length !== 1) throw new Error('pocket floor edge: ' + cc.length);
  part = filletAlongPath(part, makeSweepPath(cc), ${r});
}
`)) - base;
    const expected = QUARTER(r, 16);
    assert.ok(Math.abs(added - expected) < 0.02 * expected, `r ${r}: added ${added.toFixed(3)} expected ${expected.toFixed(3)}`);
  }
});

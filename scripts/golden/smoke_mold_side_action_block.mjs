#!/usr/bin/env node
/**
 * Side actions as blocks (headless, no Chrome).
 *
 * A side action is one block of steel that forms a set of trapped faces and
 * withdraws along one direction. Every trapped feature that shares a
 * direction and a connected surface is one block; the block's face is what
 * it reaches inside the window of its trapped cells.
 *
 * Fixtures:
 *   1. Flanged_Box from the vault (fixtures/flanged_box_side_action.txt): a
 *      1° drafted, filleted, shelled tray with a flange, a thin plate on the
 *      back wall carrying two bosses and a slot. The slot was cut with a
 *      stadium-plan roundedBox, so its ends narrow toward the outer face by
 *      about a millimetre: no straight pull frees them. Expected: one slide
 *      along +Y spanning the plate, the bosses, the wall the plate shadows and
 *      the flange underside above the bosses, plus one unresolved undercut
 *      (the slot). No lifter.
 *   2. The same part with the slot cut straight: exactly one slide along +Y,
 *      window x ±20 and z from the slot bottom to the flange underside.
 *   3. A plate with two Ø5 through-holes 40 mm apart along one wall: one
 *      slide, through both, whatever the distance.
 */
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

register('./manifold-resolve-hook.mjs', import.meta.url);

const pending = new Map();
let msgId = 0;
const workerSelf = {
  onmessage: null,
  postMessage(msg) {
    if (msg.type === 'loaded') return;
    const w = pending.get(msg.id);
    if (!w) return;
    pending.delete(msg.id);
    if (msg.type === 'error') w.reject(new Error(msg.payload?.message || 'err'));
    else w.resolve(msg);
  },
};
globalThis.self = workerSelf;
function send(type, payload = {}) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    Promise.resolve().then(() => workerSelf.onmessage({ data: { type, payload, id } }));
  });
}

let failed = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`);
  }
}

const here = dirname(fileURLToPath(import.meta.url));
const flanged = readFileSync(join(here, 'fixtures/flanged_box_side_action.txt'), 'utf8');
const straight = flanged.replace(
  'let rbox3 = roundedBox([24, 6, 14], 3, 16).translate([0, 40.972, 0]);',
  'let rbox3 = Manifold.cube([24, 6, 14], true).translate([0, 40.972, 0]);',
);
if (straight === flanged) {
  console.log('  ❌ fixture no longer has the stadium slot line to replace');
  process.exit(1);
}
const twoHoles = `
// --- cube begin id=cube1 ---
let part = Manifold.cube([60, 20, 30], true);
// --- cube end id=cube1 ---
// --- cylinder begin id=cylinder1 ---
part = part.subtract(Manifold.cylinder(30, 2.5, 2.5, 48).rotate([90, 0, 0]).translate([-20, 0, 5]));
// --- cylinder end id=cylinder1 ---
// --- cylinder begin id=cylinder2 ---
part = part.subtract(Manifold.cylinder(30, 2.5, 2.5, 48).rotate([90, 0, 0]).translate([20, 0, 5]));
// --- cylinder end id=cylinder2 ---
return part;
`;

await import('../../src/workers/sandboxWorker.js');
await send('init');
const { buildSolidGeometry } = await import('../../src/utils/partSolidCache.js');
const { moldFitFromGeometry } = await import('../../src/molding/fromGeometry.js');
const exec = async (s) => (await send('execute', { script: s, importedModels: {}, memoryLimitMB: 1024 })).payload;
async function analyze(script, pull) {
  const res = await exec(script);
  if (res.status !== 'NoError') throw new Error(`script status ${res.status}`);
  const { geometry, faceIDs } = buildSolidGeometry(res.mesh);
  return moldFitFromGeometry(geometry, faceIDs, { pull });
}
const near = (a, b, tol) => Math.abs(a - b) <= tol;

console.log('side actions as blocks');

console.log('Flanged_Box as modelled');
{
  const fit = await analyze(flanged, [0, 0, 1]);
  const sa = fit.sideActions;
  check('one slide', sa.slideCount === 1, `slides ${sa.slideCount}`);
  check('no lifter', sa.lifterCount === 0, `lifters ${sa.lifterCount}`);
  check('one unresolved undercut (the stadium slot)', sa.unresolvedCount === 1, `unresolved ${sa.unresolvedCount}`);
  const slide = sa.groups.find((g) => g.kind === 'slide');
  check('slide pulls +Y', !!slide && near(slide.pull[1], 1, 1e-3), slide ? JSON.stringify(slide.pull) : 'none');
  check('slide window spans the plate width (x ±20)',
    !!slide && near(Math.abs(slide.window.min[0]), 20, 1.5) && near(Math.abs(slide.window.max[0]), 20, 1.5),
    slide ? JSON.stringify(slide.window) : 'none');
  check('slide reaches the flange underside (span top ≥ 18.75)', !!slide && slide.span && slide.span[1] >= 18.75, slide ? JSON.stringify(slide.span) : 'none');
  check('slide carries the plate, both bosses and the trapped wall',
    !!slide && ['cube2', 'cylinder1', 'cylinder2'].every((f) => slide.features.includes(f)) && slide.frees.some((n) => n.startsWith('cube1.back')),
    slide ? `${slide.features.join(',')} | ${slide.frees.join(',')}` : 'none');
  check('slide face is larger than its trapped area', !!slide && slide.area > slide.trappedArea && slide.trappedArea > 500,
    slide ? `face ${slide.area} trapped ${slide.trappedArea}` : 'none');
  check('slide face does not include the inside shell', !!slide && !slide.features.includes('shell1'), slide ? slide.features.join(',') : 'none');
  const stuck = sa.groups.find((g) => g.kind === 'unresolved');
  check('the unresolved undercut is the slot', !!stuck && stuck.frees.some((n) => n.startsWith('roundedBox3')), stuck ? stuck.frees.join(',') : 'none');
}

console.log('Flanged_Box with a straight slot');
{
  const fit = await analyze(straight, [0, 0, 1]);
  const sa = fit.sideActions;
  check('exactly one side action', sa.count === 1, `count ${sa.count}`);
  check('it is a slide along +Y', sa.slideCount === 1 && near(sa.groups[0].pull[1], 1, 1e-3), JSON.stringify(sa.groups[0]?.pull));
  const g = sa.groups[0];
  check('window x ±20', !!g && near(Math.abs(g.window.min[0]), 20, 1.5) && near(Math.abs(g.window.max[0]), 20, 1.5), g ? JSON.stringify(g.window) : 'none');
  check('window z from the slot bottom to the flange underside', !!g && g.window.min[1] <= -6.5 && g.window.max[1] >= 18.75, g ? JSON.stringify(g.window) : 'none');
  check('the slot is part of the slide', !!g && g.features.includes('roundedBox3'), g ? g.features.join(',') : 'none');
}

console.log('two through-holes on one wall');
{
  const fit = await analyze(twoHoles, [0, 0, 1]);
  const sa = fit.sideActions;
  check('one slide through both holes', sa.count === 1 && sa.slideCount === 1, `count ${sa.count} slides ${sa.slideCount} lifters ${sa.lifterCount} unresolved ${sa.unresolvedCount}`);
  const g = sa.groups[0];
  check('slide runs along the holes (±Y)', !!g && near(Math.abs(g.pull[1]), 1, 1e-3), g ? JSON.stringify(g.pull) : 'none');
  check('slide window spans both holes (x from about −22.5 to 22.5)',
    !!g && g.window.min[0] <= -21 && g.window.max[0] >= 21, g ? JSON.stringify(g.window) : 'none');
  check('both bores are freed', !!g && ['cylinder1', 'cylinder2'].every((f) => g.features.includes(f)), g ? g.features.join(',') : 'none');
}

if (failed) {
  console.log(`side actions as blocks: ${failed} check(s) failed`);
  process.exit(1);
}
console.log('side actions as blocks ok');
process.exit(0);

import assert from 'node:assert/strict';
import test from 'node:test';
import { agentFeatureCount } from '../src/utils/agentBridge.js';
import { blankPartStarter, DEFAULT_SCRIPT } from '../src/utils/defaultScript.js';
import { mintSurfId } from '../src/utils/git/surfId.js';
import { newPartStarterScript, starterCubeScript } from '../src/utils/helperPaletteSnippets.js';
import { createSheetSpec } from '../src/utils/sheetMetal/sheetModel.js';
import {
  composeSheetMetalCommit,
  readSheetMetalSpec,
  sheetMetalFresh,
  SHEET_METAL_BEGIN,
} from '../src/utils/sheetMetal/sheetMetalScript.js';

const alu = {
  sku: 'ALU-090',
  name: '5052 H32 Aluminum',
  thicknessMm: 2.286,
  bend: { radiusIn: 0.032, kFactor: 0.38 },
};

const CUBE = `// --- cube begin ---
let box1 = Manifold.cube([40, 30, 20], true);
let part = box1;
// --- cube end ---`;

const FILLET = `// --- fillet-mode begin ---
const selEdges = edgesBetween(part, 0, 2); // boundary edge 1
const path = makeSweepPath(selEdges); // edge→sweep path
part = filletAlongPath(part, path, 2); // sweep fillet wedge
// --- fillet-mode end ---`;

const BOX_FILLET = `${CUBE}\n${FILLET}\nreturn part;\n`;

function prefixThrough(script, marker) {
  const end = script.indexOf(marker);
  assert.ok(end >= 0, `missing ${marker}`);
  return script.slice(0, end + marker.length);
}

test('a part with a box and a fillet is not replaced by the sheet starter', () => {
  assert.equal(sheetMetalFresh(''), true);
  assert.equal(sheetMetalFresh(newPartStarterScript()), true);
  const gitBlank = blankPartStarter(mintSurfId());
  assert.equal(agentFeatureCount(''), 0);
  assert.equal(agentFeatureCount(gitBlank), 0);
  assert.equal(sheetMetalFresh(gitBlank), true);
  assert.equal(sheetMetalFresh('// note only\n'), true);
  assert.equal(sheetMetalFresh('return part;\n'), true);
  assert.equal(agentFeatureCount(starterCubeScript()), 1);
  assert.equal(sheetMetalFresh(starterCubeScript()), false);
  assert.equal(sheetMetalFresh(DEFAULT_SCRIPT), false);
  assert.equal(sheetMetalFresh(BOX_FILLET), false);

  const spec = createSheetSpec(alu, 'XY', { width: 100, height: 60 });
  const res = composeSheetMetalCommit(BOX_FILLET, spec);
  assert.equal(res.ok, true, res.message || 'commit refused');
  const kept = prefixThrough(BOX_FILLET, '// --- fillet-mode end ---');
  assert.equal(res.buffer.slice(0, kept.length), kept);
  assert.match(res.buffer, /part = part\.add\(sheetMetalSolid\(sheetSpec\)\)/);
  assert.equal(readSheetMetalSpec(res.buffer).plane, 'XY');
  assert.equal(readSheetMetalSpec(res.buffer).t, 2.286);
  assert.ok(res.buffer.indexOf(SHEET_METAL_BEGIN) > kept.length - 1);

  const demoKept = prefixThrough(DEFAULT_SCRIPT, '// --- hole end ---');
  const demo = composeSheetMetalCommit(DEFAULT_SCRIPT, spec);
  assert.equal(demo.ok, true, demo.message || 'demo commit refused');
  assert.equal(demo.buffer.slice(0, demoKept.length), demoKept);

  const edited = composeSheetMetalCommit(res.buffer, { ...spec, plane: 'XZ', width: 80 });
  assert.equal(edited.ok, true);
  assert.equal(edited.buffer.slice(0, kept.length), kept);
  assert.match(edited.buffer, /part = part\.add\(sheetMetalSolid\(sheetSpec\)\)/);
  assert.doesNotMatch(edited.buffer, /let part = sheetMetalSolid/);
  assert.equal(readSheetMetalSpec(edited.buffer).plane, 'XZ');
  assert.equal(readSheetMetalSpec(edited.buffer).width, 80);

  const fresh = composeSheetMetalCommit('', spec);
  assert.equal(fresh.ok, true);
  assert.ok(fresh.buffer.startsWith(SHEET_METAL_BEGIN));
  assert.match(fresh.buffer, /let part = sheetMetalSolid\(sheetSpec\)/);
  assert.doesNotMatch(fresh.buffer, /Manifold\.cube/);

  const cube = composeSheetMetalCommit(starterCubeScript(), spec);
  assert.equal(cube.ok, true);
  assert.match(cube.buffer, /Manifold\.cube/);
  assert.match(cube.buffer, /part = part\.add\(sheetMetalSolid\(sheetSpec\)\)/);
});

test('the appended flange is unioned onto the box and fillet', async () => {
  const spec = createSheetSpec(alu, 'XY', { width: 100, height: 60 });
  const res = composeSheetMetalCommit(BOX_FILLET, spec);
  assert.equal(res.ok, true, res.message || 'commit refused');
  const { loadSandbox } = await import('../scripts/golden/scs_sandbox.mjs');
  const { exec } = await loadSandbox();
  const before = await exec(BOX_FILLET);
  const after = await exec(res.buffer);
  const span = (box) => box.max.map((v, i) => v - box.min[i]);
  const beforeSpan = span(before.boundingBox);
  const afterSpan = span(after.boundingBox);
  assert.ok(after.boundingBox.min[2] <= -8, `cube bottom gone: ${after.boundingBox.min[2]}`);
  assert.ok(after.boundingBox.max[2] >= 8, `cube top gone: ${after.boundingBox.max[2]}`);
  assert.ok(afterSpan[2] > 10, `thickness-only body: ${afterSpan[2]}`);
  assert.ok(afterSpan[0] > beforeSpan[0] + 20, `plate did not widen the body: ${afterSpan}`);
  assert.ok(after.volume > before.volume + 1000, `volume ${after.volume} vs ${before.volume}`);
});

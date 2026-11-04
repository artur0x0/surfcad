import assert from 'node:assert/strict';
import test from 'node:test';
import { runAssemblyParts } from './assemblyRun.js';
import { feedRows, preserveHiddenPartRuns } from './assembly.js';

/**
 * A part built on the geometry pool that recovered by skipping a thrown
 * feature keeps that failure on its run record, so the Parts feed row turns
 * red and the strip can mark the chip once the part is active.
 */

const MESH = { numProp: 3, vertProperties: [0, 0, 0, 1, 0, 0, 0, 1, 0], triVerts: [0, 1, 2] };

const SCRIPT = [
  '// --- cube begin id=cube1 ---',
  'let part = Manifold.cube([20, 20, 20], true);',
  '// --- cube end id=cube1 ---',
  '// --- fillet-mode begin id=fillet1 ---',
  'part = filletAlongPath(part, makeSweepPath(edgesBetween(part, 90, 91)), 2);',
  '// --- fillet-mode end id=fillet1 ---',
  'return part;',
  '',
].join('\n');

const BLOCK = SCRIPT.slice(SCRIPT.indexOf('// --- fillet-mode begin'), SCRIPT.indexOf('return part;'));

function docOf() {
  return {
    id: 'asm',
    activeId: 'good',
    source: 'local',
    parts: [
      { id: 'bad', name: 'Bad part', visible: true, order: 0 },
      { id: 'good', name: 'Good part', visible: true, order: 1 },
    ],
  };
}

const scripts = { bad: SCRIPT, good: 'return Manifold.cube([1, 1, 1]);' };

async function execute(script, opts) {
  const out = { mesh: MESH, volume: 8000, boundingBox: { min: [-10, -10, -10], max: [10, 10, 10] }, bodyCentroids: [[0, 0, 0]] };
  if (opts.partId === 'bad') {
    out.featureSkip = {
      featureId: 'fillet1',
      featureBlock: BLOCK.trimEnd(),
      scriptLine: 5,
      message: 're-pick edges — no boundary between faces 90 and 91',
      skipped: [],
    };
  }
  return out;
}

test('a recovered pool run keeps the failed feature on its record and the row shows it', async () => {
  const { runs } = await runAssemblyParts({ doc: docOf(), scripts, execute, ids: ['bad', 'good'] });
  assert.equal(runs.bad.ok, true, 'the recovered solid is still a good run');
  assert.ok(runs.bad.mesh, 'the mesh is kept');
  assert.equal(runs.bad.featureFailure.id, 'fillet1');
  assert.equal(runs.bad.featureFailure.kind, 'fillet');
  assert.equal(runs.bad.featureFailure.block, BLOCK.trimEnd());
  assert.match(runs.bad.featureFailure.message, /faces 90 and 91/);
  assert.equal('featureFailure' in runs.good, false, 'a clean run carries no failure');

  const rows = feedRows(docOf(), runs, scripts);
  const bad = rows.find((row) => row.id === 'bad');
  const good = rows.find((row) => row.id === 'good');
  assert.equal(bad.error, false, 'not a hard failure: the thumbnail stays');
  assert.ok(bad.mesh);
  assert.equal(bad.featureFailed, true);
  assert.equal(good.featureFailed, false);
});

test('a hidden part keeps its feature failure on the run it kept', async () => {
  const { runs } = await runAssemblyParts({ doc: docOf(), scripts, execute, ids: ['bad', 'good'] });
  const doc = docOf();
  doc.parts[0].visible = false;
  const kept = preserveHiddenPartRuns(doc, { good: runs.good }, runs);
  assert.equal(kept.bad.ok, true);
  assert.equal(kept.bad.featureFailure.id, 'fillet1');
});

test('a skip that names no block leaves the record clean', async () => {
  const quiet = async () => ({ mesh: MESH, volume: 1, featureSkip: { message: 'odd' } });
  const { runs } = await runAssemblyParts({ doc: docOf(), scripts, execute: quiet, ids: ['bad'] });
  assert.equal(runs.bad.ok, true);
  assert.equal('featureFailure' in runs.bad, false);
});

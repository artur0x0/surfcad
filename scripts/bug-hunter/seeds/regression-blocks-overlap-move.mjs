/**
 * Regression: Move on overlapping bodies uses tri disambiguation (#485).
 */
import { join } from 'node:path';
import { agentCall, saveBridgeScreenshot } from '../../playtest/lib/harness.mjs';
import { newPartStarterScript } from '../../../src/utils/helperPaletteSnippets.js';

export const id = 'regression-blocks-overlap-move';
export const title = 'Move one of two overlapping blocks (#485)';
export const userId = 'user-bug-hunter-overlap';
export const fixedIn = 'PR #485';

/** minTri 12 is stable for 10³ centered cubes (see golden:blocks-artur-fixes). */
const OVERLAP_SCRIPT = `const a = Manifold.cube([10, 10, 10], true);
const b = Manifold.cube([10, 10, 10], true);
let part = Manifold.compose([a, b]);
// --- move begin id=mv1 ---
part = move(part, [0, 0, 5], { bodies: [{ at: [0, 0, 0], tri: 12 }] });
// --- move end ---
const parts = part.decompose();
if (parts.length !== 2) throw new Error('expected 2 bodies, got ' + parts.length);
const zs = parts.map((p) => p.boundingBox().min[2]).sort((a, b) => a - b);
if (Math.abs(zs[0] + 5) > 0.05 || Math.abs(zs[1]) > 0.05) throw new Error('z separation failed: ' + zs.join(','));
return part;
`;

export function seedDoc() {
  return {
    format: 'surfcad.assembly',
    v: 1,
    name: 'bug-hunter-overlap',
    activeId: 'local:part1',
    source: 'git',
    parts: [{ id: 'local:part1', name: 'Part (1)', visible: true, order: 0 }],
    joints: [],
  };
}

export function seedParts() {
  return [{ id: 'local:part1', script: newPartStarterScript() }];
}

export async function run(ctx) {
  const { page, outDir } = ctx;
  const steps = [];
  let ok = true;

  const set = await agentCall(page, 'set_script', { source: OVERLAP_SCRIPT });
  steps.push({ id: 'set_script', ok: set.ok === true });
  if (!set.ok) ok = false;

  const runEnv = await agentCall(page, 'run', {});
  const runOk = runEnv.ok === true && runEnv.result?.ok === true;
  steps.push({ id: 'run', ok: runOk });
  if (!runOk) ok = false;

  const st = await agentCall(page, 'status', {});
  const vol = st.result?.volume;
  const volOk = Number.isFinite(vol) && vol > 0;
  steps.push({ id: 'volume_finite', ok: volOk, detail: String(vol) });
  if (!volOk) ok = false;

  const tree = await agentCall(page, 'feature_tree', {});
  const moveBlock = (tree.result?.features || []).find((f) => f.kind === 'move');
  steps.push({ id: 'move_block_present', ok: !!moveBlock });
  if (!moveBlock) ok = false;

  const shot = join(outDir, 'screenshots', `${id}.png`);
  await saveBridgeScreenshot(page, shot);
  return { id, title, ok, steps, screenshots: [shot] };
}

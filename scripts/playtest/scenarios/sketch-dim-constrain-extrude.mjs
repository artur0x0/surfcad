/** Sketch on face → dimension → constraint → commit → extrude. */
import { join } from 'node:path';
import { agentCall, saveBridgeScreenshot } from '../lib/harness.mjs';
import { createStepRunner } from '../lib/stepRunner.mjs';

const USER_ID = 'user-playtest-sketch-h7';

const SEED_SCRIPT = `// --- cube begin ---
let part = Manifold.cube([10, 10, 10], true);
// --- cube end ---
return part;
`;

export const id = 'sketch-dim-constrain-extrude';
export const title = 'Sketch dimension, constraint, and extrude';
export const userId = USER_ID;

export function seedDoc() {
  return {
    format: 'surfcad.assembly',
    v: 1,
    name: 'playtest-sketch-h7',
    activeId: 'local:part1',
    source: 'git',
    parts: [{ id: 'local:part1', name: 'Part (1)', visible: true, order: 0 }],
    joints: [],
  };
}

export function seedParts() {
  return [{ id: 'local:part1', script: SEED_SCRIPT }];
}

async function waitContourReady(page) {
  for (let i = 0; i < 120; i += 1) {
    const env = await agentCall(page, 'mode', {});
    if (env.result?.viewport === 'contour' && env.result?.contour?.planeOpen !== true) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('contour sketch did not become ready');
}

/**
 * @param {{ page: import('playwright-core').Page, outDir: string, findings: string[] }} ctx
 */
export async function run(ctx) {
  const { page, outDir } = ctx;
  const runner = createStepRunner();
  const screenshots = [];

  await runner.runStep('insert_cube base', async () => {
    const env = await agentCall(page, 'insert_cube', { width: 40, depth: 30, height: 20 });
    return {
      ok: env.ok === true && env.result?.ok === true,
      call: 'insert_cube',
      args: { width: 40, depth: 30, height: 20 },
      envelope: env,
    };
  });

  await runner.runStep('select top face', async () => {
    const faces = await agentCall(page, 'list_faces', {});
    const topKey = faces.result?.faces?.find((row) => row.key?.n?.[2] > 0.9)?.key
      || faces.result?.faces?.[0]?.key;
    const env = await agentCall(page, 'select_faces', { keys: [topKey] });
    return { ok: env.ok === true, call: 'select_faces', args: { keys: [topKey] }, envelope: env };
  });

  await runner.runStep('sketch_begin', async () => {
    const env = await agentCall(page, 'sketch_begin', { entry: 'crossSection', accept_plane: true });
    if (env.ok) await waitContourReady(page);
    return { ok: env.ok === true, call: 'sketch_begin', args: { entry: 'crossSection' }, envelope: env };
  });

  await runner.runStep('sketch_add rectangle', async () => {
    const env = await agentCall(page, 'sketch_add', { tool: 'rectangle', width: 24, height: 16 });
    return { ok: env.ok === true, call: 'sketch_add', args: { tool: 'rectangle' }, envelope: env };
  });

  await runner.runStep('sketch_dimension width', async () => {
    const env = await agentCall(page, 'sketch_dimension', { kind: 'length', edge: 'e0', value: 28 });
    return {
      ok: env.ok === true && env.result?.written === true && env.result?.dimensionId === 'd0',
      call: 'sketch_dimension',
      args: { kind: 'length', edge: 'e0', value: 28 },
      envelope: env,
      detail: JSON.stringify(env.result),
    };
  });

  await runner.runStep('sketch_constrain horizontal', async () => {
    const env = await agentCall(page, 'sketch_constrain', {
      kind: 'horizontal',
      picks: [{ kind: 'line', id: 'e2' }],
    });
    return {
      ok: env.ok === true && env.result?.written === true,
      call: 'sketch_constrain',
      args: { kind: 'horizontal' },
      envelope: env,
    };
  });

  await runner.runStep('sketch_commit profile', async () => {
    const env = await agentCall(page, 'sketch_commit', {});
    return {
      ok: env.ok === true && (env.result?.written === true || env.result?.unchanged === true),
      call: 'sketch_commit',
      args: {},
      envelope: env,
    };
  });

  await runner.runStep('slot extrude', async () => {
    const script = await agentCall(page, 'get_script', {});
    const contourId = (script.result?.source?.match(/@contour id=(c\d+)/) || [])[1] || 'c1';
    let env = await agentCall(page, 'slot_open', { kind: 'makeExtrude' });
    if (!env.ok) return { ok: false, call: 'slot_open', envelope: env };
    env = await agentCall(page, 'slot_assign_contour', { contour_id: contourId, role: 'profile' });
    if (!env.ok) return { ok: false, call: 'slot_assign_contour', envelope: env };
    env = await agentCall(page, 'slot_set_params', { distance: 10 });
    if (!env.ok) return { ok: false, call: 'slot_set_params', envelope: env };
    const before = await agentCall(page, 'status', {});
    env = await agentCall(page, 'slot_commit', {});
    const after = env.result?.status?.volume ?? 0;
    return {
      ok: env.ok === true && env.result?.written === true && after > (before.result?.volume ?? 0),
      call: 'slot_commit',
      args: {},
      envelope: env,
      detail: `vol ${before.result?.volume} → ${after}`,
    };
  });

  await runner.runStep('undo restores extrude', async () => {
    const before = await agentCall(page, 'status', {});
    const env = await agentCall(page, 'undo', {});
    const after = await agentCall(page, 'status', {});
    const ok = env.ok === true
      && env.result?.ok === true
      && (after.result?.volume ?? 0) < (before.result?.volume ?? 0);
    return { ok, call: 'undo', args: {}, envelope: env };
  });

  await runner.runStep('errors empty', async () => {
    const env = await agentCall(page, 'errors', {});
    const n = env.result?.errors?.length ?? 0;
    return { ok: env.ok === true && n === 0, call: 'errors', args: {}, envelope: env, detail: `errors=${n}` };
  });

  const shot = await saveBridgeScreenshot(page, join(outDir, 'sketch-h7-final.png'));
  if (shot) screenshots.push(shot);

  return {
    id,
    title,
    ok: runner.failed === 0,
    steps: runner.steps,
    replaySteps: runner.replaySteps,
    screenshots,
  };
}

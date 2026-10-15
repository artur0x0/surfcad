/** Plate with holes on rectangle corners + arc centre, offset workplane, undo. */
import { agentCall, saveBridgeScreenshot } from '../lib/harness.mjs';
import { createStepRunner } from '../lib/stepRunner.mjs';

const USER_ID = 'user-playtest-plate-holes';

export const id = 'plate-holes-offset';
export const title = 'Plate holes on offset workplane with arc centre';
export const userId = USER_ID;
export const mobileScreenshot = true;

const SEED_SCRIPT = `// --- cube begin ---
let part = Manifold.cube([60, 40, 8], true);
// --- cube end ---
return part;
`;

export function seedDoc() {
  return {
    format: 'surfcad.assembly',
    v: 1,
    name: 'playtest-plate-holes',
    activeId: 'local:part1',
    source: 'git',
    parts: [{ id: 'local:part1', name: 'Part (1)', visible: true, order: 0 }],
    joints: [],
  };
}

export function seedParts() {
  return [{ id: 'local:part1', script: SEED_SCRIPT }];
}

/**
 * @param {{ page: import('playwright-core').Page, outDir: string, findings: string[] }} ctx
 */
export async function run(ctx) {
  const { page, outDir, findings } = ctx;
  const runner = createStepRunner();

  await runner.runStep('seed cube', async () => {
    const env = await agentCall(page, 'set_script', { source: SEED_SCRIPT });
    const run = await agentCall(page, 'run', {});
    return {
      ok: env.ok === true && run.ok === true && run.result?.ok === true,
      call: 'run',
      envelope: run,
    };
  });

  await runner.runStep('hole flow', async () => {
    const faces = await agentCall(page, 'list_faces', {});
    const top = (faces.result?.faces || []).find((row) => row.normal?.[2] > 0.9);
    if (!top) {
      findings.push('No top face for hole plane');
      return { ok: false, call: 'list_faces', envelope: faces };
    }
    await agentCall(page, 'pick_faces', { keys: [top.key], max: 1 });
    await agentCall(page, 'hole_open', {});
    await agentCall(page, 'hole_set_params', { size: 'M4', through: true });
    await agentCall(page, 'hole_begin_centres', {});
    await agentCall(page, 'plane_set', { preset: 'z', offset: 4 });
    await agentCall(page, 'sketch_accept_plane', {});
    await agentCall(page, 'sketch_add', { tool: 'rectangle', width: 28, height: 18 });
    await agentCall(page, 'sketch_add', {
      tool: 'cursor',
      params: {
        contour: {
          centers: true,
          points: [{ id: 'pArc', at: [-10, 6] }],
          lines: [],
          arcs: [{ id: 'a0', center: 'pArc', radius: 5, sweep: 'ccw' }],
        },
      },
    });
    const pick = await agentCall(page, 'pick_points', { kind: 'arc', keys: ['a0'] });
    const commit = await agentCall(page, 'hole_commit', {});
    return {
      ok: pick.ok === true && commit.ok === true && commit.result?.written === true,
      call: 'hole_commit',
      envelope: commit,
    };
  });

  await runner.runStep('undo hole', async () => {
    const before = await agentCall(page, 'get_script', {});
    const env = await agentCall(page, 'undo', {});
    const after = await agentCall(page, 'get_script', {});
    return {
      ok: env.ok === true && after.result?.source !== before.result?.source,
      call: 'undo',
      envelope: env,
    };
  });

  await saveBridgeScreenshot(page, outDir, 'plate-holes-offset-final');
  return runner.summary();
}

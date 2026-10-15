/** Two-part local assembly, coincident joint, assembly undo. */
import { agentCall } from '../lib/harness.mjs';
import { createStepRunner } from '../lib/stepRunner.mjs';

const USER_ID = 'user-playtest-parts-joints';
let basePartId = null;
let pinPartId = null;

export const id = 'parts-joints-assembly';
export const title = 'Parts, assembly, joint, undo';
export const userId = USER_ID;

export function seedDoc() {
  return {
    format: 'surfcad.assembly',
    v: 1,
    name: 'playtest-joints-seed',
    activeId: 'local:seed',
    source: 'local',
    parts: [{ id: 'local:seed', name: 'Seed', visible: true, order: 0 }],
    joints: [],
  };
}

export function seedParts() {
  return [{ id: 'local:seed', script: 'return Manifold.cube([5,5,5], true);\n' }];
}

function topFace(faces) {
  return (faces || []).find((row) => (row.normal?.[2] ?? row.n?.[2] ?? 0) > 0.9);
}

function bottomFace(faces) {
  const list = faces || [];
  let best = null;
  let bestZ = Infinity;
  for (const row of list) {
    const at = row.center || row.at || row.key?.at;
    const z = Array.isArray(at) ? at[2] : null;
    const nz = row.normal?.[2] ?? row.n?.[2] ?? row.key?.n?.[2] ?? 0;
    if (z != null && z < bestZ && nz < -0.5) {
      bestZ = z;
      best = row;
    }
  }
  return best;
}

export async function run(ctx) {
  const { page } = ctx;
  const runner = createStepRunner();

  await runner.runStep('create_assembly replaces doc', async () => {
    const env = await agentCall(page, 'create_assembly', {});
    const parts = await agentCall(page, 'parts', {});
    const n = parts.result?.parts?.length ?? 0;
    return {
      ok: env.ok === true && n >= 1,
      call: 'create_assembly',
      args: {},
      envelope: env,
      detail: `parts=${n}`,
    };
  });

  await runner.runStep('insert_cube base', async () => {
    await page.waitForTimeout(800);
    const parts = await agentCall(page, 'parts', {});
    basePartId = parts.result?.activeId;
    const inserted = await agentCall(page, 'insert_cube', { width: 50, depth: 40, height: 10 });
    const env = await agentCall(page, 'run', {});
    const ok = inserted.ok === true && env.ok === true && env.result?.ok === true;
    return { ok, call: 'insert_cube', args: {}, envelope: env };
  });

  await runner.runStep('create_part pin', async () => {
    const env = await agentCall(page, 'create_part', { name: 'Pin' });
    const parts = await agentCall(page, 'parts', {});
    const n = parts.result?.parts?.length ?? 0;
    pinPartId = parts.result?.activeId
      || parts.result?.parts?.find((p) => p.name === 'Pin')?.id
      || parts.result?.parts?.[1]?.id;
    return {
      ok: env.ok === true && n >= 2 && !!pinPartId,
      call: 'create_part',
      args: { name: 'Pin' },
      envelope: env,
      detail: `parts=${n}`,
    };
  });

  await runner.runStep('insert_cube pin', async () => {
    const inserted = await agentCall(page, 'insert_cube', { width: 12, depth: 12, height: 20 });
    const env = await agentCall(page, 'run', {});
    const ok = inserted.ok === true && env.ok === true && env.result?.ok === true;
    return { ok, call: 'insert_cube', args: {}, envelope: env };
  });

  let baseTopKey = null;
  let pinBottomKey = null;

  await runner.runStep('list_faces for joint picks', async () => {
    await agentCall(page, 'set_active_part', { part_id: basePartId });
    await agentCall(page, 'run', {});
    const baseFaces = await agentCall(page, 'list_faces', {});
    const top = topFace(baseFaces.result?.faces);
    await agentCall(page, 'set_active_part', { part_id: pinPartId });
    await agentCall(page, 'run', {});
    const pinFaces = await agentCall(page, 'list_faces', {});
    const bottom = bottomFace(pinFaces.result?.faces);
    baseTopKey = top?.key || top;
    pinBottomKey = bottom?.key || bottom;
    const ok = !!(baseTopKey && pinBottomKey);
    return { ok, detail: JSON.stringify({ baseTopKey, pinBottomKey }) };
  });

  await runner.runStep('joint_open pick commit', async () => {
    const opened = await agentCall(page, 'joint_open', {});
    const picked = await agentCall(page, 'joint_pick', {
      picks: [
        { part_id: basePartId, key: baseTopKey },
        { part_id: pinPartId, key: pinBottomKey },
      ],
    });
    await agentCall(page, 'joint_set_params', { type: 'coincident' });
    const committed = await agentCall(page, 'joint_commit', {});
    const pickCount = picked.result?.count ?? 0;
    const jointCount = committed.result?.jointCount ?? 0;
    const ok = opened.ok && picked.ok && pickCount >= 2 && committed.ok && jointCount >= 1;
    return {
      ok,
      call: 'joint_commit',
      args: {},
      envelope: committed,
      detail: `picks=${pickCount} joints=${jointCount}`,
    };
  });

  await runner.runStep('undo joint', async () => {
    const env = await agentCall(page, 'undo', {});
    const ok = env.ok === true && env.result?.kind === 'assembly' && env.result?.joints === 0;
    return { ok, call: 'undo', args: {}, envelope: env, detail: `joints=${env.result?.joints}` };
  });

  return {
    id,
    title,
    ok: runner.failed === 0,
    steps: runner.steps,
    replaySteps: runner.replaySteps,
    screenshots: [],
  };
}

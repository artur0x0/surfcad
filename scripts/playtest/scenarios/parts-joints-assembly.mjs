/** Two-part local assembly, coincident + concentric joints, edit, assembly undo. */
import { agentCall } from '../lib/harness.mjs';
import { createStepRunner } from '../lib/stepRunner.mjs';

const USER_ID = 'user-playtest-parts-joints';
let basePartId = null;
let pinPartId = null;

const BASE_HOLE_SCRIPT = [
  'let part = Manifold.cube([50, 40, 10], true);',
  'part = part.subtract(Manifold.cylinder(15, 6, 6, 64));',
  'return part;',
].join('\n');

const PIN_CYL_SCRIPT = 'return Manifold.cylinder(20, 5, 5, 64);\n';

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

function cylindricalWallFace(faces, expectedRadius) {
  let best = null;
  let bestScore = -1;
  for (const row of faces || []) {
    const at = row.center || row.at || row.key?.at;
    const n = row.normal || row.n || row.key?.n;
    if (!Array.isArray(at) || !Array.isArray(n)) continue;
    const nz = Math.abs(n[2] ?? 0);
    const rxy = Math.hypot(at[0] ?? 0, at[1] ?? 0);
    const radius = Number(expectedRadius);
    const radialOk = !Number.isFinite(radius)
      || (rxy > radius * 0.45 && rxy < radius * 1.6);
    const area = Number(row.area ?? row.key?.area ?? 0);
    const score = area * (1 - nz);
    if (nz < 0.45 && area > 20 && radialOk && score > bestScore) {
      bestScore = score;
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
    const params = await agentCall(page, 'joint_set_params', { type: 'planar' });
    const committed = await agentCall(page, 'joint_commit', {});
    const pickCount = picked.result?.count ?? 0;
    const jointCount = committed.result?.jointCount ?? 0;
    const ok = !!(opened.ok && picked.ok && pickCount >= 2 && committed.ok && jointCount >= 1
      && params.result?.type === 'coincident');
    return {
      ok,
      call: 'joint_commit',
      args: {},
      envelope: committed,
      detail: `picks=${pickCount} joints=${jointCount} type=${params.result?.type}`,
    };
  });

  await runner.runStep('undo joint', async () => {
    const env = await agentCall(page, 'undo', {});
    const ok = env.ok === true && env.result?.kind === 'assembly' && env.result?.joints === 0;
    return { ok, call: 'undo', args: {}, envelope: env, detail: `joints=${env.result?.joints}` };
  });

  let baseWallKey = null;
  let pinWallKey = null;

  await runner.runStep('cylinder geometry for concentric', async () => {
    await agentCall(page, 'set_active_part', { part_id: basePartId });
    await agentCall(page, 'set_script', { source: BASE_HOLE_SCRIPT });
    const baseRun = await agentCall(page, 'run', {});
    await agentCall(page, 'set_active_part', { part_id: pinPartId });
    await agentCall(page, 'set_script', { source: PIN_CYL_SCRIPT });
    const pinRun = await agentCall(page, 'run', {});
    await page.waitForTimeout(400);
    const ok = baseRun.ok === true && baseRun.result?.ok === true
      && pinRun.ok === true && pinRun.result?.ok === true;
    return { ok, call: 'run', args: {}, envelope: pinRun };
  });

  let concentricJointId = null;

  await runner.runStep('concentric joint commit', async () => {
    await agentCall(page, 'set_active_part', { part_id: basePartId });
    await agentCall(page, 'run', {});
    const baseFaces = await agentCall(page, 'list_faces', {});
    const baseWall = cylindricalWallFace(baseFaces.result?.faces, 6);
    await agentCall(page, 'set_active_part', { part_id: pinPartId });
    await agentCall(page, 'run', {});
    const pinFaces = await agentCall(page, 'list_faces', {});
    const pinWall = cylindricalWallFace(pinFaces.result?.faces, 5);
    baseWallKey = baseWall?.key || baseWall;
    pinWallKey = pinWall?.key || pinWall;
    const pickRows = (baseWallKey && pinWallKey)
      ? [
        { part_id: basePartId, key: baseWallKey },
        { part_id: pinPartId, key: pinWallKey },
      ]
      : [
        {
          part_id: basePartId,
          kind: 'axis',
          key: { at: [0, 0, 0], dir: [0, 0, 1], radius: 6 },
        },
        {
          part_id: pinPartId,
          kind: 'axis',
          key: { at: [0, 0, 10], dir: [0, 0, 1], radius: 5 },
        },
      ];
    await agentCall(page, 'joint_cancel', {});
    const opened = await agentCall(page, 'joint_open', {});
    const picked = await agentCall(page, 'joint_pick', { picks: pickRows });
    const params = await agentCall(page, 'joint_set_params', { type: 'concentric' });
    const committed = await agentCall(page, 'joint_commit', {});
    concentricJointId = committed.result?.jointId ?? null;
    const pickCount = picked.result?.count ?? 0;
    const ok = !!(opened.ok && picked.ok && pickCount >= 2 && params.result?.type === 'concentric'
      && committed.ok && (committed.result?.jointCount ?? 0) >= 1 && concentricJointId);
    return {
      ok,
      call: 'joint_commit',
      envelope: committed,
      detail: `picks=${pickCount} walls=${!!baseWallKey} type=${params.result?.type} jointId=${concentricJointId}`,
    };
  });

  await runner.runStep('joint_select and joint_edit', async () => {
    const selected = await agentCall(page, 'joint_select', { joint_id: concentricJointId });
    const edited = await agentCall(page, 'joint_edit', { name: 'Pin axis' });
    const committed = await agentCall(page, 'joint_commit', {});
    const ok = !!(selected.ok && selected.result?.mode === 'edit'
      && edited.ok && edited.result?.name === 'Pin axis' && committed.ok);
    return {
      ok,
      call: 'joint_edit',
      envelope: edited,
      detail: `name=${edited.result?.name}`,
    };
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

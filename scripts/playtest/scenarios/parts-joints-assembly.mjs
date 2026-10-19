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

const PIN_CYL_SCRIPT = 'return Manifold.cylinder(30, 5, 5, 64, false);\n';

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
  const radius = Number(expectedRadius);
  const pool = (faces || []).filter((row) => row.axis?.radius > 0);
  const list = pool.length ? pool : (faces || []);
  let best = null;
  let bestDist = Infinity;
  for (const row of list) {
    const at = row.center || row.at || row.key?.at;
    const n = row.normal || row.n || row.key?.n;
    if (!Array.isArray(at)) continue;
    const nz = Math.abs(n?.[2] ?? 0);
    const rxy = Math.hypot(at[0] ?? 0, at[1] ?? 0);
    const area = Number(row.area ?? row.key?.area ?? 0);
    const triCount = Number(row.triangleCount ?? 0);
    const mergedWall = area > 80 && triCount >= 8;
    const wallLike = mergedWall || (nz < 0.45 && area > 20);
    if (!wallLike) continue;
    if (!Number.isFinite(radius)) {
      const score = area * (mergedWall ? 1 : (1 - nz));
      if (score > (best?.score ?? -1)) {
        best = { row, score };
      }
      continue;
    }
    const dist = Math.abs(rxy - radius);
    if (dist < bestDist) {
      bestDist = dist;
      best = { row, score: area };
    }
  }
  return best?.row ?? null;
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
    pinPartId = env.result?.partId || parts.result?.activeId;
    const tree = await agentCall(page, 'feature_tree', {});
    const kinds = (tree.result?.features || []).map((row) => row.kind);
    // A new part starts empty (no seed cube): no features, no chips.
    await page.waitForTimeout(400);
    const chips = page.locator('[data-cad-feature-strip="desktop"] [data-feature-chip]');
    const ribbon = await chips.evaluateAll((els) => els.map((el) => el.getAttribute('data-feature-chip') || ''));
    return {
      ok: env.ok === true && n >= 2 && !!pinPartId && kinds.length === 0 && ribbon.length === 0,
      call: 'create_part',
      args: { name: 'Pin' },
      envelope: env,
      detail: `parts=${n} tree=${kinds.join(',')} ribbon=${ribbon.join(',')}`,
    };
  });

  await runner.runStep('insert_cube pin', async () => {
    const inserted = await agentCall(page, 'insert_cube', { width: 12, depth: 12, height: 20 });
    const env = await agentCall(page, 'run', {});
    const tree = await agentCall(page, 'feature_tree', {});
    const kinds = (tree.result?.features || []).map((row) => row.kind);
    const cubeChips = page.locator('[data-cad-feature-strip="desktop"] [data-feature-chip="cube"]');
    const chips = page.locator('[data-cad-feature-strip="desktop"] [data-feature-chip]');
    let ribbon = [];
    try {
      await cubeChips.first().waitFor({ timeout: 8000 });
      ribbon = await chips.evaluateAll((els) => els.map((el) => el.getAttribute('data-feature-chip') || ''));
    } catch { /* assert below */ }
    // The inserted cube is the part's first and only feature (no seed cube).
    const cubeCount = ribbon.filter((kind) => kind === 'cube').length;
    const ok = inserted.ok === true
      && env.ok === true
      && env.result?.ok === true
      && kinds.filter((kind) => kind === 'cube').length === 1
      && cubeCount === 1;
    return { ok, call: 'insert_cube', args: {}, envelope: env, detail: `tree=${kinds.join(',')} ribbon=${ribbon.join(',')}` };
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

  await runner.runStep('joint_open pick commit back-to-back', async () => {
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

  await runner.runStep('undo joint reports reverted', async () => {
    const env = await agentCall(page, 'undo', {});
    const rev = env.result?.reverted;
    const ok = env.ok === true
      && env.result?.kind === 'assembly'
      && env.result?.joints === 0
      && rev?.jointsBefore >= 1
      && rev?.jointsAfter === 0;
    return { ok, call: 'undo', args: {}, envelope: env, detail: JSON.stringify(rev) };
  });

  await runner.runStep('history after joint undo', async () => {
    const env = await agentCall(page, 'history', {});
    const ok = env.ok === true
      && env.result?.kind === 'assembly'
      && env.result?.canRedo === true
      && (env.result?.entries?.length ?? 0) >= 2;
    return { ok, call: 'history', args: {}, envelope: env };
  });

  await runner.runStep('redo restores joint', async () => {
    const env = await agentCall(page, 'redo', {});
    const ok = env.ok === true
      && env.result?.kind === 'assembly'
      && (env.result?.joints ?? 0) >= 1
      && !!env.result?.applied?.label;
    return { ok, call: 'redo', args: {}, envelope: env };
  });

  await runner.runStep('failed commit does not add undo step', async () => {
    await agentCall(page, 'joint_cancel', {});
    await agentCall(page, 'joint_open', {});
    await agentCall(page, 'joint_pick', {
      picks: [{ part_id: basePartId, key: baseTopKey }],
    });
    await agentCall(page, 'joint_set_params', { type: 'coincident' });
    const failed = await agentCall(page, 'joint_commit', {});
    await agentCall(page, 'joint_cancel', {});
    const ok = failed.ok === false && failed.error?.code === 'commit_failed';
    return {
      ok,
      call: 'joint_commit',
      envelope: failed,
      detail: `failed=${failed.error?.message}`,
    };
  });

  await runner.runStep('cylinder geometry for concentric', async () => {
    await agentCall(page, 'set_active_part', { part_id: basePartId });
    await agentCall(page, 'set_script', { source: BASE_HOLE_SCRIPT });
    const baseRun = await agentCall(page, 'run', {});
    await agentCall(page, 'set_active_part', { part_id: pinPartId });
    const pinSet = await agentCall(page, 'set_script', { source: PIN_CYL_SCRIPT });
    const pinRun = await agentCall(page, 'run', {});
    const tree = await agentCall(page, 'feature_tree', {});
    const kinds = (tree.result?.features || []).map((row) => row.kind);
    const got = await agentCall(page, 'get_script', {});
    const source = got.result?.source || '';
    const chips = page.locator('[data-cad-feature-strip="desktop"] [data-feature-chip="code"]');
    let ribbon = false;
    try {
      await chips.first().waitFor({ timeout: 8000 });
      ribbon = true;
    } catch { /* assert below */ }
    const ok = baseRun.ok === true && baseRun.result?.ok === true
      && pinSet.ok === true
      && pinRun.ok === true && pinRun.result?.ok === true
      && kinds.includes('code')
      && /\/\/ --- code begin ---/.test(source)
      && ribbon;
    return {
      ok,
      call: 'run',
      args: {},
      envelope: pinRun,
      detail: `tree=${kinds.join(',')} wrapped=${/code begin/.test(source)} ribbon=${ribbon}`,
    };
  });

  let concentricJointId = null;

  await runner.runStep('tall pin list_faces side count', async () => {
    await agentCall(page, 'set_active_part', { part_id: pinPartId });
    await agentCall(page, 'run', {});
    const pinFaces = await agentCall(page, 'list_faces', {});
    const walls = (pinFaces.result?.faces || []).filter((row) => {
      const nz = Math.abs(row.normal?.[2] ?? row.n?.[2] ?? 1);
      return nz < 0.45;
    });
    const ok = walls.length <= 4;
    return { ok, detail: `sideFaces=${walls.length}` };
  });

  await runner.runStep('concentric joint commit', async () => {
    await agentCall(page, 'set_active_part', { part_id: basePartId });
    await agentCall(page, 'run', {});
    const baseFaces = await agentCall(page, 'list_faces', {});
    const baseWall = cylindricalWallFace(baseFaces.result?.faces, 6);
    await agentCall(page, 'set_active_part', { part_id: pinPartId });
    await agentCall(page, 'run', {});
    const pinFaces = await agentCall(page, 'list_faces', {});
    const pinWall = cylindricalWallFace(pinFaces.result?.faces, 5);
    const baseWallKey = baseWall?.axis || baseWall?.key || baseWall;
    const pinWallKey = pinWall?.axis || pinWall?.key || pinWall;
    const basePickKind = baseWall?.axis ? 'axis' : undefined;
    const pinPickKind = pinWall?.axis ? 'axis' : undefined;
    await agentCall(page, 'joint_cancel', {});
    const opened = await agentCall(page, 'joint_open', {});
    const picked = await agentCall(page, 'joint_pick', {
      picks: [
        { part_id: basePartId, key: baseWallKey, kind: basePickKind },
        { part_id: pinPartId, key: pinWallKey, kind: pinPickKind },
      ],
    });
    const params = await agentCall(page, 'joint_set_params', { type: 'concentric' });
    const committed = await agentCall(page, 'joint_commit', {});
    concentricJointId = committed.result?.jointId ?? null;
    const pickCount = picked.result?.count ?? 0;
    const ok = !!(baseWallKey && pinWallKey && opened.ok && picked.ok && pickCount >= 2
      && params.result?.type === 'concentric'
      && committed.ok && (committed.result?.jointCount ?? 0) >= 1 && concentricJointId);
    return {
      ok,
      call: 'joint_commit',
      envelope: committed,
      detail: `picks=${pickCount} type=${params.result?.type} jointId=${concentricJointId}`,
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

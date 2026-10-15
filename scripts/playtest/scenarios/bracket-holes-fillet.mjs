/** Bracket: base plate, two holes, vertical edge fillet. */
import { agentCall, saveBridgeScreenshot } from '../lib/harness.mjs';
import { createStepRunner } from '../lib/stepRunner.mjs';
import { join } from 'node:path';

const USER_ID = 'user-playtest-bracket';

const SCRIPT = `// --- cube begin id=base ---
let part = Manifold.cube([60, 40, 8], true);
// --- cube end ---
// --- hole begin id=holes ---
part = part.subtract(Manifold.cylinder(10, 4, 4, 12, true).translate([-20, 0, 0]));
part = part.subtract(Manifold.cylinder(10, 4, 4, 12, true).translate([20, 0, 0]));
// --- hole end ---
// --- fillet-mode begin ---
const rim = convexEdges(part).filter((e) => Math.abs(e.tangent[2]) < 0.01);
part = filletEdges(part, rim.slice(0, 4), 1.5);
// --- fillet-mode end ---
return part;
`;

const BAD = `// --- cube begin id=base ---
let part = Manifold.cube([10, 10, 10], true);
throw new Error('playtest deliberate failure');
// --- cube end ---
return part;
`;

const SEED_SCRIPT = `// --- cube begin ---
let part = Manifold.cube([10, 10, 10], true);
// --- cube end ---
return part;
`;

export const id = 'bracket-holes-fillet';
export const title = 'Bracket with holes and fillet';
export const userId = USER_ID;
export const mobileScreenshot = true;

export function seedDoc() {
  return {
    format: 'surfcad.assembly',
    v: 1,
    name: 'playtest-bracket',
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
  const screenshots = [];
  let meshEdgeCount = null;

  await runner.runStep('set_script bracket', async () => {
    const env = await agentCall(page, 'set_script', { source: SCRIPT });
    return {
      ok: env.ok === true && env.result?.ok === true,
      call: 'set_script',
      args: { source: SCRIPT },
      envelope: env,
      detail: JSON.stringify(env.error || env.result?.errors),
    };
  });

  await runner.runStep('run', async () => {
    const env = await agentCall(page, 'run', {});
    return {
      ok: env.ok === true && env.result?.ok === true,
      call: 'run',
      args: {},
      envelope: env,
      detail: JSON.stringify(env.result?.errors),
    };
  });

  await runner.runStep('status volume', async () => {
    const env = await agentCall(page, 'status', {});
    const vol = env.result?.volume;
    const ok = env.ok === true && vol > 15000 && vol < 20000;
    return { ok, call: 'status', args: {}, envelope: env, detail: `volume=${vol}` };
  });

  await runner.runStep('feature_tree three features', async () => {
    const env = await agentCall(page, 'feature_tree', {});
    const n = env.result?.features?.length ?? 0;
    return {
      ok: env.ok === true && n === 3,
      call: 'feature_tree',
      args: {},
      envelope: env,
      detail: `features=${n}`,
    };
  });

  await runner.runStep('parts reader', async () => {
    const env = await agentCall(page, 'parts', {});
    const n = env.result?.parts?.length ?? 0;
    return { ok: env.ok === true && n >= 1, call: 'parts', args: {}, envelope: env, detail: `parts=${n}` };
  });

  await runner.runStep('list_faces catalog', async () => {
    const env = await agentCall(page, 'list_faces', {});
    const n = env.result?.faces?.length ?? 0;
    return { ok: env.ok === true && n >= 6, call: 'list_faces', args: {}, envelope: env, detail: `faces=${n}` };
  });

  await runner.runStep('list_edges mesh count', async () => {
    const env = await agentCall(page, 'list_edges', {});
    const n = env.result?.edges?.length ?? 0;
    meshEdgeCount = n;
    findings.push(
      `list_edges returns raw mesh edges (${n} on bracket+holes+fillet), not topology-stable edge ids — agents should prefer adjacent faceKey pairs when present.`,
    );
    return { ok: env.ok === true && n >= 12, call: 'list_edges', args: {}, envelope: env, detail: `edges=${n}` };
  });

  await runner.runStep('list_feature_edges topology count', async () => {
    const raw = await agentCall(page, 'list_edges', { raw: true });
    const grouped = await agentCall(page, 'list_feature_edges', {});
    const rawN = raw.result?.edges?.length ?? 0;
    const groupedN = grouped.result?.edges?.length ?? 0;
    findings.push(
      `list_feature_edges returns ${groupedN} boundary edges vs ${rawN} raw mesh edges on the bracket playtest.`,
    );
    return {
      ok: grouped.ok === true && groupedN > 0 && rawN > groupedN,
      call: 'list_feature_edges',
      args: {},
      envelope: grouped,
      detail: `raw=${rawN} grouped=${groupedN}`,
    };
  });

  await runner.runStep('select_edges grouped key', async () => {
    const listed = await agentCall(page, 'list_feature_edges', {});
    const key = listed.result?.edges?.[0]?.key;
    const env = await agentCall(page, 'select_edges', { keys: [key] });
    const sel = await agentCall(page, 'selection', {});
    const ok = env.ok === true && (sel.result?.edges?.length ?? 0) >= 1;
    return {
      ok,
      call: 'select_edges',
      args: { keys: [key] },
      envelope: env,
      detail: JSON.stringify(sel.result?.edges?.length),
    };
  });

  await runner.runStep('select_faces top via list_faces', async () => {
    const listed = await agentCall(page, 'list_faces', {});
    const faces = listed.result?.faces || [];
    const tops = faces.filter((row) => (row.normal?.[2] ?? 0) > 0.9);
    const topFace = tops.sort((a, b) => (b.area ?? 0) - (a.area ?? 0))[0]
      || faces.sort((a, b) => (b.area ?? 0) - (a.area ?? 0))[0];
    if (!topFace?.key) {
      return {
        ok: false,
        call: 'list_faces',
        envelope: listed,
        detail: 'no face key',
      };
    }
    const env = await agentCall(page, 'select_faces', { keys: [topFace.key] });
    const ok = env.ok === true && (env.result?.count ?? 0) >= 1;
    return {
      ok,
      call: 'select_faces',
      args: { keys: [topFace.key] },
      envelope: env,
      detail: `count=${env.result?.count} area=${topFace.area}`,
    };
  });

  await runner.runStep('camera_set iso + fit', async () => {
    const snap = await agentCall(page, 'camera_set', { view: 'iso' });
    const fit = await agentCall(page, 'camera_fit', {});
    return {
      ok: snap.ok === true && fit.ok === true,
      call: 'camera_fit',
      args: {},
      envelope: fit,
      detail: JSON.stringify(snap.error || fit.error),
    };
  });

  await runner.runStep('screenshot 1280', async () => {
    const path = join(outDir, 'screenshots', `${id}-1280.png`);
    await saveBridgeScreenshot(page, path);
    screenshots.push(path);
    return { ok: true, detail: path };
  });

  if (ctx.mobileScreenshot) {
    await runner.runStep('screenshot 390', async () => {
      const path = join(outDir, 'screenshots', `${id}-390.png`);
      await saveBridgeScreenshot(page, path, { width: 390, height: 844 });
      screenshots.push(path);
      return { ok: true, detail: path };
    });
  }

  let volumeBeforeUndo;
  await runner.runStep('undo round-trip', async () => {
    const before = await agentCall(page, 'status', {});
    volumeBeforeUndo = before.result?.volume;
    const bump = SCRIPT.replace(
      'return part;',
      `// --- cube begin id=bump ---
part = part.add(Manifold.cube([2, 2, 2], true).translate([25, 15, 6]));
// --- cube end ---
return part;`,
    );
    const wrote = await agentCall(page, 'set_script', { source: bump });
    const bumped = await agentCall(page, 'status', {});
    const env = await agentCall(page, 'undo', {});
    const st = await agentCall(page, 'status', {});
    const vol = st.result?.volume;
    const bumpedVol = bumped.result?.volume ?? 0;
    const ok = wrote.ok === true
      && env.ok === true
      && env.result?.ok === true
      && bumpedVol > volumeBeforeUndo + 1
      && vol < bumpedVol - 1;
    return {
      ok,
      call: 'undo',
      args: {},
      envelope: env,
      detail: `volBefore=${volumeBeforeUndo} bumped=${bumped.result?.volume} volAfter=${vol}`,
    };
  });

  await runner.runStep('re-run idempotent after undo', async () => {
    const first = await agentCall(page, 'run', {});
    const second = await agentCall(page, 'run', {});
    const v1 = first.result?.status?.volume;
    const v2 = second.result?.status?.volume;
    const ok = first.ok && second.ok && Math.abs(v1 - v2) < 0.5;
    return {
      ok,
      call: 'run',
      args: {},
      envelope: second,
      detail: `v1=${v1} v2=${v2}`,
    };
  });

  await runner.runStep('deliberate script error', async () => {
    await agentCall(page, 'set_script', { source: BAD });
    const ran = await agentCall(page, 'run', {});
    const errs = await agentCall(page, 'errors', {});
    const hasMsg = (errs.result?.errors || []).some((row) => String(row.message || row).includes('deliberate'));
    const ok = ran.ok === true && ran.result?.ok === false && hasMsg;
    return {
      ok,
      call: 'run',
      args: {},
      envelope: ran,
      detail: JSON.stringify(errs.result?.errors),
    };
  });

  return {
    id,
    title,
    ok: runner.failed === 0,
    steps: runner.steps,
    replaySteps: runner.replaySteps,
    screenshots,
    notes: meshEdgeCount != null ? `list_edges count=${meshEdgeCount}` : undefined,
  };
}

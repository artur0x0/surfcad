/** Enclosed box with a top opening via hollow(). */
import { agentCall, focusPartHistoryForUndo, saveBridgeScreenshot } from '../lib/harness.mjs';
import { createStepRunner } from '../lib/stepRunner.mjs';
import { join } from 'node:path';

const USER_ID = 'user-playtest-shell';

const SCRIPT = `// --- cube begin id=enclosure ---
let part = Manifold.cube([80, 60, 40], true);
// --- cube end ---
// --- shell begin ---
part = hollow(part, 2.5, { center: [0, 0, 20], normal: [0, 0, 1] });
// --- shell end ---
return part;
`;

const SEED = `// --- cube begin ---
let part = Manifold.cube([20, 20, 20], true);
// --- cube end ---
return part;
`;

export const id = 'enclosure-shell';
export const title = 'Enclosure shell (hollow top opening)';
export const userId = USER_ID;

export function seedDoc() {
  return {
    format: 'surfcad.assembly',
    v: 1,
    name: 'playtest-shell',
    activeId: 'local:part1',
    source: 'git',
    parts: [{ id: 'local:part1', name: 'Part (1)', visible: true, order: 0 }],
    joints: [],
  };
}

export function seedParts() {
  return [{ id: 'local:part1', script: SEED }];
}

export async function run(ctx) {
  const { page, outDir } = ctx;
  const runner = createStepRunner();
  const screenshots = [];

  await runner.runStep('set_script shell', async () => {
    const env = await agentCall(page, 'set_script', { source: SCRIPT });
    return {
      ok: env.ok === true && env.result?.ok === true,
      call: 'set_script',
      args: { source: SCRIPT },
      envelope: env,
    };
  });

  await runner.runStep('run', async () => {
    const env = await agentCall(page, 'run', {});
    return {
      ok: env.ok === true && env.result?.ok === true,
      call: 'run',
      args: {},
      envelope: env,
    };
  });

  await runner.runStep('status hollow volume', async () => {
    const env = await agentCall(page, 'status', {});
    const vol = env.result?.volume;
    const solid = 80 * 60 * 40;
    const ok = env.ok === true && vol > solid * 0.12 && vol < solid * 0.95;
    return { ok, call: 'status', args: {}, envelope: env, detail: `volume=${vol}` };
  });

  await runner.runStep('feature_tree two features', async () => {
    const env = await agentCall(page, 'feature_tree', {});
    const n = env.result?.features?.length ?? 0;
    return { ok: env.ok === true && n === 2, call: 'feature_tree', args: {}, envelope: env, detail: `n=${n}` };
  });

  await runner.runStep('pick opening face + camera top', async () => {
    const listed = await agentCall(page, 'list_faces', {});
    const top = listed.result?.faces?.find((row) => row.normal?.[2] > 0.9 && (row.area ?? 0) > 500)?.key;
    const pick = await agentCall(page, 'select_faces', { keys: [top] });
    const cam = await agentCall(page, 'camera_set', { view: 'top' });
    return {
      ok: pick.ok === true && cam.ok === true,
      call: 'camera_set',
      args: { view: 'top' },
      envelope: cam,
    };
  });

  await runner.runStep('screenshot', async () => {
    const path = join(outDir, 'screenshots', `${id}.png`);
    await saveBridgeScreenshot(page, path);
    screenshots.push(path);
    return { ok: true, detail: path };
  });

  await runner.runStep('undo back to seed cube', async () => {
    await focusPartHistoryForUndo(page);
    const env = await agentCall(page, 'undo', {});
    const st = await agentCall(page, 'status', {});
    const ok = env.ok === true && (st.result?.featureCount ?? 0) === 1;
    return { ok, call: 'undo', args: {}, envelope: env, detail: `features=${st.result?.featureCount}` };
  });

  return {
    id,
    title,
    ok: runner.failed === 0,
    steps: runner.steps,
    replaySteps: runner.replaySteps,
    screenshots,
  };
}

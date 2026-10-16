/** Sheet-metal base flange via sheetMetalSolid (script-only). */
import { agentCall, focusPartHistoryForUndo, saveBridgeScreenshot } from '../lib/harness.mjs';
import { createStepRunner } from '../lib/stepRunner.mjs';
import { join } from 'node:path';

const USER_ID = 'user-playtest-sheet';

const sheetSpec = {
  v: 1,
  sku: 'ALU-090',
  material: 'Aluminum 5052',
  t: 1.63,
  r: 1.5,
  k: 0.44,
  limits: { bendable: true },
  plane: 'XY',
  width: 80,
  height: 50,
  bends: [{ id: 'b1', panel: 'base', edge: 'u+', angle: 90, length: 20 }],
  tabs: [],
  holes: [],
};

const SCRIPT = `// --- sheet-metal begin id=sm1 ---
const sheetSpec = ${JSON.stringify(sheetSpec)};
return sheetMetalSolid(sheetSpec);
// --- sheet-metal end ---
`;

const SEED = `return Manifold.cube([12, 12, 12], true);\n`;

export const id = 'sheet-metal-flange';
export const title = 'Sheet-metal flange (sheetMetalSolid)';
export const userId = USER_ID;

export function seedDoc() {
  return {
    format: 'surfcad.assembly',
    v: 1,
    name: 'playtest-sheet',
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

  await runner.runStep('set_script sheet', async () => {
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

  await runner.runStep('status sheet volume', async () => {
    const env = await agentCall(page, 'status', {});
    const vol = env.result?.volume;
    return {
      ok: env.ok === true && vol > 1000 && vol < 80000,
      call: 'status',
      args: {},
      envelope: env,
      detail: `volume=${vol}`,
    };
  });

  await runner.runStep('feature_tree one sheet feature', async () => {
    const env = await agentCall(page, 'feature_tree', {});
    const n = env.result?.features?.length ?? 0;
    return { ok: env.ok === true && n >= 1, call: 'feature_tree', args: {}, envelope: env, detail: `n=${n}` };
  });

  await runner.runStep('list_faces + camera_fit', async () => {
    const faces = await agentCall(page, 'list_faces', {});
    const fit = await agentCall(page, 'camera_fit', {});
    const ok = faces.ok === true && (faces.result?.faces?.length ?? 0) > 0 && fit.ok === true;
    return { ok, call: 'camera_fit', args: {}, envelope: fit };
  });

  await runner.runStep('screenshot', async () => {
    const path = join(outDir, 'screenshots', `${id}.png`);
    await saveBridgeScreenshot(page, path);
    screenshots.push(path);
    return { ok: true, detail: path };
  });

  await runner.runStep('undo', async () => {
    await focusPartHistoryForUndo(page);
    const env = await agentCall(page, 'undo', {});
    const script = await agentCall(page, 'get_script', {});
    const ok = env.ok === true && script.result?.source === SEED;
    return { ok, call: 'undo', args: {}, envelope: env };
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

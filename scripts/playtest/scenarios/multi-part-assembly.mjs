/** Two-part assembly: base block + pin; switch active part via bridge. */
import { agentCall, focusPartHistoryForUndo, saveBridgeScreenshot } from '../lib/harness.mjs';
import { createStepRunner } from '../lib/stepRunner.mjs';
import { join } from 'node:path';

const USER_ID = 'user-playtest-assembly';
const BASE_ID = 'base';
const PIN_ID = 'pin';

const BASE_SCRIPT = `// --- cube begin id=base ---
return Manifold.cube([50, 40, 10], true);
// --- cube end ---
`;

const PIN_SCRIPT = `// --- pin begin id=pin ---
return Manifold.cylinder(16, 5, 5, 30, true).translate([0, 0, 15]);
// --- pin end ---
`;

const SEED_BASE = `return Manifold.cube([10, 10, 10], true);\n`;
const SEED_PIN = `return Manifold.cube([6, 6, 6], true);\n`;

export const id = 'multi-part-assembly';
export const title = 'Multi-part assembly (base + pin)';
export const userId = USER_ID;

export function seedDoc() {
  return {
    format: 'surfcad.assembly',
    v: 1,
    name: 'playtest-assembly',
    activeId: BASE_ID,
    source: 'git',
    parts: [
      { id: BASE_ID, name: 'Base', visible: true, order: 0 },
      { id: PIN_ID, name: 'Pin', visible: true, order: 1 },
    ],
    joints: [],
  };
}

export function seedParts() {
  return [
    { id: BASE_ID, script: SEED_BASE },
    { id: PIN_ID, script: SEED_PIN },
  ];
}

export async function run(ctx) {
  const { page, outDir } = ctx;
  const runner = createStepRunner();
  const screenshots = [];

  await runner.runStep('parts lists two', async () => {
    const env = await agentCall(page, 'parts', {});
    const n = env.result?.parts?.length ?? 0;
    return { ok: env.ok === true && n === 2, call: 'parts', args: {}, envelope: env, detail: `parts=${n}` };
  });

  await runner.runStep('set_script base', async () => {
    const env = await agentCall(page, 'set_script', { source: BASE_SCRIPT });
    return {
      ok: env.ok === true && env.result?.ok === true,
      call: 'set_script',
      args: { source: BASE_SCRIPT },
      envelope: env,
    };
  });

  await runner.runStep('run base', async () => {
    const env = await agentCall(page, 'run', {});
    return { ok: env.ok === true && env.result?.ok === true, call: 'run', args: {}, envelope: env };
  });

  await runner.runStep('set_active_part pin', async () => {
    const env = await agentCall(page, 'set_active_part', { part_id: PIN_ID });
    const parts = await agentCall(page, 'parts', {});
    const active = parts.result?.parts?.find((p) => p.id === PIN_ID);
    const ok = env.ok === true && active != null;
    return {
      ok,
      call: 'set_active_part',
      args: { part_id: PIN_ID },
      envelope: env,
      detail: JSON.stringify(active),
    };
  });

  await runner.runStep('set_script pin', async () => {
    const env = await agentCall(page, 'set_script', { source: PIN_SCRIPT });
    return {
      ok: env.ok === true && env.result?.ok === true,
      call: 'set_script',
      args: { source: PIN_SCRIPT },
      envelope: env,
    };
  });

  await runner.runStep('run pin', async () => {
    const env = await agentCall(page, 'run', {});
    return { ok: env.ok === true && env.result?.ok === true, call: 'run', args: {}, envelope: env };
  });

  await runner.runStep('select_parts highlight base', async () => {
    const env = await agentCall(page, 'select_parts', { part_ids: [BASE_ID] });
    const sel = await agentCall(page, 'selection', {});
    const ok = env.ok === true && (sel.result?.cadPartId === BASE_ID || sel.result?.cadPartHighlighted === true);
    return {
      ok,
      call: 'select_parts',
      args: { part_ids: [BASE_ID] },
      envelope: env,
      detail: JSON.stringify(sel.result),
    };
  });

  await runner.runStep('list_edges on pin', async () => {
    await agentCall(page, 'set_active_part', { part_id: PIN_ID });
    const edges = await agentCall(page, 'list_edges', {});
    const n = edges.result?.edges?.length ?? 0;
    return { ok: edges.ok === true && n >= 8, call: 'list_edges', args: {}, envelope: edges, detail: `edges=${n}` };
  });

  await runner.runStep('camera iso + screenshot', async () => {
    await agentCall(page, 'camera_set', { view: 'iso' });
    const path = join(outDir, 'screenshots', `${id}.png`);
    await saveBridgeScreenshot(page, path);
    screenshots.push(path);
    return { ok: true, detail: path };
  });

  await runner.runStep('undo pin edit', async () => {
    await focusPartHistoryForUndo(page);
    const env = await agentCall(page, 'undo', {});
    const script = await agentCall(page, 'get_script', {});
    const ok = env.ok === true && (script.result?.source || '').trim() === SEED_PIN.trim();
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

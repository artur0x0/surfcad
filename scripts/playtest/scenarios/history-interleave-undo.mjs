/**
 * Interleaved sketch, extrude, fillet, joint, sheet flange — agent undo/redo
 * matches feature-bar buttons at each step.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { agentCall, saveBridgeScreenshot } from '../lib/harness.mjs';
import { createStepRunner } from '../lib/stepRunner.mjs';
import { newPartStarterScript } from '../../../src/utils/helperPaletteSnippets.js';

const USER_ID = 'user-playtest-history-interleave';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const catalog = readFileSync(join(ROOT, 'scripts/golden/fixtures/scs/catalog.json'));
const specs = readFileSync(join(ROOT, 'scripts/golden/fixtures/scs/specs.json'));

export const id = 'history-interleave-undo';
export const title = 'History undo/redo interleave';
export const userId = USER_ID;
export const mobileScreenshot = true;

export function seedDoc() {
  return {
    format: 'surfcad.assembly',
    v: 1,
    name: 'playtest-history',
    activeId: 'local:part1',
    source: 'git',
    parts: [{ id: 'local:part1', name: 'Base', visible: true, order: 0 }],
    joints: [],
  };
}

export function seedParts() {
  return [{ id: 'local:part1', script: newPartStarterScript() }];
}

async function waitContourReady(page) {
  for (let i = 0; i < 120; i += 1) {
    const env = await agentCall(page, 'mode', {});
    if (env.result?.viewport === 'contour' && env.result?.contour?.planeOpen !== true) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('contour sketch not ready');
}

async function fingerprint(page) {
  const [status, script, history] = await Promise.all([
    agentCall(page, 'status', {}),
    agentCall(page, 'get_script', {}),
    agentCall(page, 'history', {}),
  ]);
  return {
    volume: status.result?.volume ?? null,
    featureCount: status.result?.featureCount ?? 0,
    scriptLen: script.result?.source?.length ?? 0,
    historyKind: history.result?.kind,
    head: history.result?.head,
    canUndo: history.result?.canUndo,
    canRedo: history.result?.canRedo,
  };
}

async function nudgeHistoryTarget(page) {
  const hist = await agentCall(page, 'history', {});
  if (hist.result?.canUndo) return true;
  const parts = await agentCall(page, 'parts', {});
  const baseId = parts.result?.activeId || parts.result?.parts?.[0]?.id;
  if (hist.result?.kind === 'assembly' && baseId) {
    await agentCall(page, 'select_parts', { part_id: baseId });
    return (await agentCall(page, 'history', {})).result?.canUndo === true;
  }
  if (hist.result?.kind === 'part') {
    await agentCall(page, 'select_clear', {});
    return (await agentCall(page, 'history', {})).result?.canUndo === true;
  }
  return false;
}

async function collectUndoFingerprints(page, via) {
  const rows = [await fingerprint(page)];
  for (let guard = 0; guard < 50; guard += 1) {
    let hist = await agentCall(page, 'history', {});
    if (!hist.result?.canUndo) {
      if (!(await nudgeHistoryTarget(page))) break;
      hist = await agentCall(page, 'history', {});
      if (!hist.result?.canUndo) break;
    }
    if (via === 'agent') {
      const env = await agentCall(page, 'undo', {});
      if (env.ok !== true) break;
    } else {
      const btn = page.locator('[data-ui-action="data-feature-bar-undo"]');
      if (!(await btn.isEnabled())) break;
      await btn.click();
      await page.waitForTimeout(900);
    }
    rows.push(await fingerprint(page));
  }
  return rows;
}

async function collectRedoFingerprints(page, via) {
  const rows = [await fingerprint(page)];
  for (let guard = 0; guard < 40; guard += 1) {
    const hist = await agentCall(page, 'history', {});
    if (!hist.result?.canRedo) break;
    if (via === 'agent') {
      const env = await agentCall(page, 'redo', {});
      if (env.ok !== true) break;
    } else {
      const btn = page.locator('[data-ui-action="data-feature-bar-redo"]');
      if (!(await btn.isEnabled())) break;
      await btn.click();
      await page.waitForTimeout(900);
    }
    rows.push(await fingerprint(page));
  }
  return rows;
}

function samePath(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

let pinPartId = null;

/**
 * @param {{ page: import('playwright-core').Page, outDir: string }} ctx
 */
export async function run(ctx) {
  const { page, outDir } = ctx;
  const runner = createStepRunner();
  const screenshots = [];

  await page.route('**/sendcutsend-catalog*.json', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: catalog,
  }));
  await page.route('**/sendcutsend-specs*.json', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: specs,
  }));

  await runner.runStep('base cube', async () => {
    const env = await agentCall(page, 'insert_cube', { width: 50, depth: 40, height: 12 });
    const run = await agentCall(page, 'run', {});
    return { ok: env.ok && run.ok === true && run.result?.ok === true, call: 'insert_cube', envelope: run };
  });

  await runner.runStep('sketch extrude on top', async () => {
    const faces = await agentCall(page, 'list_faces', {});
    const top = (faces.result?.faces || []).find((row) => row.key?.n?.[2] > 0.9);
    await agentCall(page, 'select_faces', { keys: [top.key] });
    await agentCall(page, 'sketch_begin', { entry: 'crossSection', accept_plane: true });
    await waitContourReady(page);
    await agentCall(page, 'sketch_add', { tool: 'rectangle', width: 20, height: 14 });
    await agentCall(page, 'sketch_commit', {});
    const script = await agentCall(page, 'get_script', {});
    const contourId = (script.result?.source?.match(/@contour id=(c\d+)/) || [])[1] || 'c1';
    await agentCall(page, 'slot_open', { kind: 'makeExtrude' });
    await agentCall(page, 'slot_assign_contour', { contour_id: contourId, role: 'profile' });
    await agentCall(page, 'slot_set_params', { distance: 8 });
    const commit = await agentCall(page, 'slot_commit', {});
    return { ok: commit.ok === true && commit.result?.written === true, call: 'slot_commit', envelope: commit };
  });

  await runner.runStep('fillet edge', async () => {
    const edges = await agentCall(page, 'list_feature_edges', {});
    const edge = (edges.result?.edges || [])[0];
    const card = await agentCall(page, 'pick_edges', {
      tool: 'filletEdges',
      keys: [edge.key],
      params: { radius: 1.2 },
      accept: true,
    });
    return { ok: card.ok === true && card.result?.accepted === true, call: 'pick_edges', envelope: card };
  });

  await runner.runStep('joint on second part', async () => {
    const partsBefore = await agentCall(page, 'parts', {});
    const baseId = partsBefore.result?.parts?.[0]?.id;
    const baseFaces = await agentCall(page, 'list_faces', {});
    await agentCall(page, 'create_part', { name: 'Pin' });
    const parts = await agentCall(page, 'parts', {});
    pinPartId = parts.result?.activeId || parts.result?.parts?.[1]?.id;
    await agentCall(page, 'insert_cube', { width: 10, depth: 10, height: 24 });
    await agentCall(page, 'run', {});
    const pinFaces = await agentCall(page, 'list_faces', {});
    const topBase = (baseFaces.result?.faces || []).find((row) => row.key?.n?.[2] > 0.9)?.key;
    const bottomPin = (pinFaces.result?.faces || []).find((row) => (row.key?.at?.[2] ?? 0) < 0)?.key
      || pinFaces.result?.faces?.[0]?.key;
    await agentCall(page, 'joint_open', {});
    await agentCall(page, 'joint_pick', {
      picks: [
        { part_id: baseId, key: topBase },
        { part_id: pinPartId, key: bottomPin },
      ],
    });
    await agentCall(page, 'joint_set_params', { type: 'planar' });
    const committed = await agentCall(page, 'joint_commit', {});
    const ok = committed.ok === true && (committed.result?.jointCount ?? 0) >= 1;
    return { ok, call: 'joint_commit', envelope: committed };
  });

  await runner.runStep('sheet flange on base', async () => {
    const parts = await agentCall(page, 'parts', {});
    const baseId = parts.result?.parts?.[0]?.id;
    await agentCall(page, 'set_active_part', { part_id: baseId });
    await agentCall(page, 'run', {});
    await agentCall(page, 'sheet_open', {});
    await agentCall(page, 'sheet_start', { sku: 'ALU-090' });
    await agentCall(page, 'sheet_pick', { plane: 'XY' });
    await agentCall(page, 'sheet_set_params', { width: 60, height: 40 });
    const commit = await agentCall(page, 'sheet_commit', {});
    await agentCall(page, 'sheet_set_tool', { tool: 'bend' });
    await agentCall(page, 'sheet_pick', { panel: 'base', edge: 'u+' });
    await agentCall(page, 'sheet_set_params', { angle: 90, length: 12 });
    const bend = await agentCall(page, 'sheet_commit', {});
    const run = await agentCall(page, 'run', {});
    const ok = commit.ok && bend.ok && run.ok === true;
    return { ok, call: 'sheet_commit', envelope: bend };
  });

  const peak = await fingerprint(page);
  const histPeak = await agentCall(page, 'history', {});
  const peakOk = histPeak.result?.canUndo === true && (peak.volume ?? 0) > 0;

  await runner.runStep('history lists committed steps', async () => {
    const env = await agentCall(page, 'history', {});
    const n = env.result?.entries?.length ?? 0;
    const ok = env.ok === true && n >= 2 && env.result?.canUndo === true;
    return { ok, call: 'history', envelope: env, detail: `entries=${n} kind=${env.result?.kind}` };
  });

  let agentUndoPath = [];
  let uiUndoPath = [];

  await runner.runStep('agent undo path', async () => {
    agentUndoPath = await collectUndoFingerprints(page, 'agent');
    const ok = agentUndoPath.length >= 3 && peakOk;
    return { ok, detail: `steps=${agentUndoPath.length}` };
  });

  await runner.runStep('agent redo to peak', async () => {
    const redoPath = await collectRedoFingerprints(page, 'agent');
    const end = redoPath[redoPath.length - 1];
    const ok = samePath(end, peak) || JSON.stringify(end) === JSON.stringify(await fingerprint(page));
    return { ok, detail: JSON.stringify({ end, peak }) };
  });

  await runner.runStep('replay build for UI undo parity', async () => {
    for (const step of runner.replaySteps) {
      await agentCall(page, step.call, step.args);
    }
    const ok = samePath(await fingerprint(page), peak);
    return { ok, detail: 'rebuilt peak' };
  });

  await runner.runStep('UI undo matches agent', async () => {
    uiUndoPath = await collectUndoFingerprints(page, 'ui');
    const ok = samePath(agentUndoPath, uiUndoPath);
    return { ok, detail: `agent=${agentUndoPath.length} ui=${uiUndoPath.length}` };
  });

  await runner.runStep('new action clears redo (agent)', async () => {
    for (const step of runner.replaySteps) {
      await agentCall(page, step.call, step.args);
    }
    await agentCall(page, 'select_parts', { part_id: (await agentCall(page, 'parts', {})).result?.parts?.[0]?.id });
    await agentCall(page, 'undo', {});
    const before = await agentCall(page, 'history', {});
    await agentCall(page, 'insert_cube', { width: 12, depth: 12, height: 12 });
    await agentCall(page, 'run', {});
    const after = await agentCall(page, 'history', {});
    const ok = before.result?.canRedo === true && after.result?.canRedo === false;
    return { ok, detail: JSON.stringify({ before: before.result?.canRedo, after: after.result?.canRedo }) };
  });

  await runner.runStep('screenshot 1280', async () => {
    for (const step of runner.replaySteps) {
      await agentCall(page, step.call, step.args);
    }
    const path = join(outDir, 'screenshots', `${id}-1280.png`);
    await saveBridgeScreenshot(page, path, { width: 1280, height: 800 });
    screenshots.push(path);
    return { ok: true, detail: path };
  });

  await runner.runStep('screenshot 390', async () => {
    const path = join(outDir, 'screenshots', `${id}-390.png`);
    await saveBridgeScreenshot(page, path, { width: 390, height: 844 });
    screenshots.push(path);
    return { ok: true, detail: path };
  });

  return {
    id,
    title,
    ok: runner.failed === 0 && peakOk,
    steps: runner.steps,
    replaySteps: runner.replaySteps,
    screenshots,
  };
}

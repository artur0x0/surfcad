/** Sheet-metal bracket via agent bridge: plate, two flanges, check/refold, edit thickness, undo. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { agentCall, saveBridgeScreenshot } from '../lib/harness.mjs';
import { createStepRunner } from '../lib/stepRunner.mjs';
import { newPartStarterScript } from '../../../src/utils/helperPaletteSnippets.js';

const USER_ID = 'user-playtest-sheet-bracket';
const ROOT = join(fileURLToPath(import.meta.url), '../../..');
const catalog = readFileSync(join(ROOT, 'scripts/golden/fixtures/scs/catalog.json'));
const specs = readFileSync(join(ROOT, 'scripts/golden/fixtures/scs/specs.json'));

export const id = 'sheet-metal-bracket';
export const title = 'Sheet-metal bracket (agent bridge)';
export const userId = USER_ID;
export const mobileScreenshot = true;

export function seedDoc() {
  return {
    format: 'surfcad.assembly',
    v: 1,
    name: 'playtest-sheet-bracket',
    activeId: 'local:part1',
    source: 'git',
    parts: [{ id: 'local:part1', name: 'Part (1)', visible: true, order: 0 }],
    joints: [],
  };
}

export function seedParts() {
  return [{ id: 'local:part1', script: newPartStarterScript() }];
}

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

  await runner.runStep('sheet_start base', async () => {
    await agentCall(page, 'sheet_open', {});
    const start = await agentCall(page, 'sheet_start', { sku: 'ALU-090' });
    await agentCall(page, 'sheet_pick', { plane: 'XY' });
    await agentCall(page, 'sheet_set_params', { width: 80, height: 50 });
    const commit = await agentCall(page, 'sheet_commit', {});
    const run = await agentCall(page, 'run', {});
    const ok = start.ok && commit.ok && run.ok === true;
    return { ok, call: 'sheet_commit', envelope: commit };
  });

  await runner.runStep('two flanges + bend radius', async () => {
    await agentCall(page, 'sheet_set_tool', { tool: 'bend' });
    await agentCall(page, 'sheet_pick', { panel: 'base', edge: 'u+' });
    await agentCall(page, 'sheet_set_params', { angle: 90, length: 20 });
    await agentCall(page, 'sheet_commit', {});
    await agentCall(page, 'sheet_pick', { panel: 'base', edge: 'u-' });
    await agentCall(page, 'sheet_commit', {});
    await agentCall(page, 'sheet_set_params', { r: 2 });
    const run = await agentCall(page, 'run', {});
    return { ok: run.ok === true, call: 'run', envelope: run };
  });

  await runner.runStep('unfold refold edit thickness undo', async () => {
    await agentCall(page, 'sheet_check', {});
    await agentCall(page, 'sheet_refold', {});
    await agentCall(page, 'sheet_edit', { chip_id: 'sheet:base' });
    await agentCall(page, 'sheet_set_params', { sku: 'ALU-125' });
    const commit = await agentCall(page, 'sheet_commit', {});
    const undo = await agentCall(page, 'undo', {});
    const ok = commit.ok === true && undo.ok === true;
    return { ok, call: 'undo', envelope: undo };
  });

  await runner.runStep('screenshot 1280', async () => {
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
    ok: runner.failed === 0,
    steps: runner.steps,
    replaySteps: runner.replaySteps,
    screenshots,
  };
}

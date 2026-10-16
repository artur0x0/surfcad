/**
 * Regression: block feature-edit pose writeback (#485).
 */
import { join } from 'node:path';
import { agentCall, saveBridgeScreenshot } from '../../playtest/lib/harness.mjs';
export const id = 'regression-blocks-pose';
export const title = 'Blocks pose writeback on feature edit (#485)';
export const userId = 'user-bug-hunter-pose';
export const fixedIn = 'PR #485';

export function seedDoc() {
  return {
    format: 'surfcad.assembly',
    v: 1,
    name: 'bug-hunter-pose',
    activeId: 'local:part1',
    source: 'git',
    parts: [{ id: 'local:part1', name: 'Part (1)', visible: true, order: 0 }],
    joints: [],
  };
}

export function seedParts() {
  return [{ id: 'local:part1', script: '' }];
}

export async function run(ctx) {
  const { page, outDir } = ctx;
  const steps = [];
  let ok = true;
  let detail = '';

  const cube = await agentCall(page, 'insert_cube', { width: 20, depth: 20, height: 20 });
  steps.push({ id: 'insert_cube', ok: cube.ok === true && cube.result?.ok === true });
  if (!steps[0].ok) ok = false;

  const tree = await agentCall(page, 'feature_tree', {});
  const chip = (tree.result?.features || []).find((f) => f.kind === 'cube');
  const open = await agentCall(page, 'open_feature', { id: chip?.id });
  steps.push({ id: 'open_feature', ok: open.ok === true && !!chip });
  if (!steps[1].ok) ok = false;
  await page.waitForTimeout(400);

  await agentCall(page, 'edit_feature', { params: { x: 15, center: false } });
  const confirm = await agentCall(page, 'confirm_feature', {});
  steps.push({ id: 'confirm_pose', ok: confirm.ok === true && confirm.result?.ok === true });
  if (!steps[2].ok) ok = false;

  const src = await agentCall(page, 'get_script', {});
  const text = src.result?.source || '';
  const scriptOk = /Manifold\.cube\(\[20, 20, 20\], false\)/.test(text)
    && /\.translate\(\[15, 0, 0\]\)/.test(text);
  steps.push({ id: 'script_pose', ok: scriptOk, detail: text.slice(0, 200) });
  if (!scriptOk) ok = false;

  const st = await agentCall(page, 'status', {});
  const bbox = st.result?.bbox;
  const bboxOk = bbox && Array.isArray(bbox.min) && bbox.min[0] > 4;
  steps.push({ id: 'bbox_shifted', ok: bboxOk });
  if (!bboxOk) ok = false;

  const shot = join(outDir, 'screenshots', `${id}.png`);
  await saveBridgeScreenshot(page, shot);
  return { id, title, ok, steps, screenshots: [shot], detail };
}

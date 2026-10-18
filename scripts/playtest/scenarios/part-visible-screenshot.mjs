/**
 * Hide and show a part, capture a smaller screenshot, and surface a
 * reserved-helper redeclaration. save_to is MCP-only and covered in
 * packages/surfcad-mcp tests plus the manual pair playtest.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { agentCall } from '../lib/harness.mjs';
import { createStepRunner } from '../lib/stepRunner.mjs';

const USER_ID = 'user-playtest-part-visible';

const LEFT = `let part = Manifold.cube([40, 20, 16], true);
return part;
`;
const RIGHT = `let part = Manifold.cube([10, 10, 28], true);
return part;
`;

export const id = 'part-visible-screenshot';
export const title = 'Part visibility, smaller screenshot, reserved helper name';
export const userId = USER_ID;

export function seedDoc() {
  return {
    format: 'surfcad.assembly',
    v: 1,
    name: 'playtest-part-visible',
    activeId: 'left',
    source: 'local',
    parts: [
      { id: 'left', name: 'Left', visible: true, order: 0, position: [-30, 0, 0] },
      { id: 'right', name: 'Right', visible: true, order: 1, position: [30, 0, 0] },
    ],
    joints: [],
  };
}

export function seedParts() {
  return [
    { id: 'left', script: LEFT },
    { id: 'right', script: RIGHT },
  ];
}

function writeDataUrl(dataUrl, outPath) {
  const b64 = String(dataUrl || '').split(',')[1] || '';
  mkdirSync(join(outPath, '..'), { recursive: true });
  writeFileSync(outPath, Buffer.from(b64, 'base64'));
}

export async function run(ctx) {
  const { page, outDir } = ctx;
  const runner = createStepRunner();
  const shotDir = join(outDir, 'part-visible-screenshot');
  mkdirSync(shotDir, { recursive: true });

  await runner.runStep('parts lists both ids', async () => {
    const parts = await agentCall(page, 'parts', {});
    const ids = (parts.result?.parts || []).map((row) => row.id);
    return {
      ok: parts.ok === true && ids.includes('left') && ids.includes('right'),
      call: 'parts',
      envelope: parts,
      detail: ids.join(','),
    };
  });

  let beforeUrl = '';
  await runner.runStep('screenshot before hide', async () => {
    const shot = await agentCall(page, 'screenshot', { format: 'png' });
    beforeUrl = shot.result?.dataUrl || '';
    if (beforeUrl) writeDataUrl(beforeUrl, join(shotDir, 'before-hide.png'));
    return {
      ok: shot.ok === true && beforeUrl.startsWith('data:image/png'),
      call: 'screenshot',
      args: { format: 'png' },
    };
  });

  await runner.runStep('hide the right part by id', async () => {
    const hidden = await agentCall(page, 'set_part_visible', { part_id: 'right', visible: false });
    const parts = await agentCall(page, 'parts', {});
    const right = (parts.result?.parts || []).find((row) => row.id === 'right');
    const left = (parts.result?.parts || []).find((row) => row.id === 'left');
    return {
      ok: hidden.ok === true
        && hidden.result?.visible === false
        && hidden.result?.partId === 'right'
        && right?.visible === false
        && left?.visible === true,
      call: 'set_part_visible',
      args: { part_id: 'right', visible: false },
      envelope: hidden,
      detail: `right=${right?.visible} left=${left?.visible}`,
    };
  });

  await runner.runStep('screenshot after hide differs', async () => {
    const shot = await agentCall(page, 'screenshot', { format: 'png' });
    const url = shot.result?.dataUrl || '';
    if (url) writeDataUrl(url, join(shotDir, 'after-hide.png'));
    return {
      ok: shot.ok === true && url.startsWith('data:image/png') && url !== beforeUrl,
      call: 'screenshot',
      detail: `changed=${url !== beforeUrl}`,
    };
  });

  await runner.runStep('show the right part again', async () => {
    const shown = await agentCall(page, 'set_part_visible', { part_id: 'right', visible: true });
    const parts = await agentCall(page, 'parts', {});
    const right = (parts.result?.parts || []).find((row) => row.id === 'right');
    return {
      ok: shown.ok === true && shown.result?.visible === true && right?.visible === true,
      call: 'set_part_visible',
      args: { part_id: 'right', visible: true },
    };
  });

  await runner.runStep('screenshot max_width 400', async () => {
    const shot = await agentCall(page, 'screenshot', { max_width: 400, format: 'png' });
    const url = shot.result?.dataUrl || '';
    if (url) writeDataUrl(url, join(shotDir, 'max-width-400.png'));
    const width = shot.result?.width;
    return {
      ok: shot.ok === true && url.startsWith('data:image/png') && Number.isInteger(width) && width <= 400 && width >= 1,
      call: 'screenshot',
      args: { max_width: 400, format: 'png' },
      detail: `width=${width}`,
    };
  });

  await runner.runStep('unknown id and a path are unknown_part', async () => {
    const missing = await agentCall(page, 'set_part_visible', { part_id: 'missing-id', visible: false });
    const path = await agentCall(page, 'set_part_visible', { part_id: 'assemblies/Box/Right.js', visible: false });
    const parts = await agentCall(page, 'parts', {});
    const right = (parts.result?.parts || []).find((row) => row.id === 'right');
    return {
      ok: missing.ok === false
        && missing.error?.code === 'unknown_part'
        && path.ok === false
        && path.error?.code === 'unknown_part'
        && /opaque id/.test(missing.error?.message || '')
        && right?.visible === true,
      detail: `${missing.error?.code} ${path.error?.code}`,
    };
  });

  await runner.runStep('const cut explains the reserved helper name', async () => {
    const ran = await agentCall(page, 'set_script', {
      source: 'const cut = Manifold.cube([8, 8, 8], true);\nreturn cut;\n',
    });
    const errors = await agentCall(page, 'errors', {});
    const plain = '`cut` is a reserved SurfCAD helper name; rename your variable';
    const fromRun = ran.result?.errors || [];
    const fromErrors = (errors.result?.errors || []).map((row) => row.message);
    const raw = fromRun.some((row) => /already been declared/.test(String(row)));
    return {
      ok: ran.ok === true
        && ran.result?.ok === false
        && fromRun.includes(plain)
        && fromErrors.includes(plain)
        && !raw,
      call: 'set_script',
      detail: [...fromRun, ...fromErrors].join(' | '),
    };
  });

  return {
    id,
    title,
    ok: runner.failed === 0,
    steps: runner.steps,
    replaySteps: runner.replaySteps,
    screenshots: [
      join(shotDir, 'before-hide.png'),
      join(shotDir, 'after-hide.png'),
      join(shotDir, 'max-width-400.png'),
    ],
  };
}

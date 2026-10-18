/* global document, requestAnimationFrame, window */
/**
 * Paint survives a script re-run when the faces still match, and set_script
 * names a face paint the new mesh will not draw.
 *
 *   npm run build:playtest && node scripts/playtest/run.mjs --scenario agent-paint-survive
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { agentCall } from '../lib/harness.mjs';
import { createStepRunner } from '../lib/stepRunner.mjs';

const USER_ID = 'user-playtest-paint-survive';

const CUBE = `let part = Manifold.cube([30, 20, 16], true);
return part;
`;

const NUDGED = `let part = Manifold.cube([30.4, 20, 16], true);
return part;
`;

const SHIFTED = `let part = Manifold.cube([30, 20, 16], true).translate([0, 0, 8]);
return part;
`;

export const id = 'agent-paint-survive';
export const title = 'Paint survives a re-run, and a dropped face paint is named';
export const userId = USER_ID;

export function seedDoc() {
  return {
    format: 'surfcad.assembly',
    v: 1,
    name: 'playtest-paint-survive',
    activeId: 'seed',
    source: 'local',
    parts: [{ id: 'seed', name: 'Seed', visible: true, order: 0 }],
    joints: [],
  };
}

export function seedParts() {
  return [{
    id: 'seed',
    script: 'let part = Manifold.cube([8, 8, 8], true);\nreturn part;\n',
  }];
}

function writeDataUrl(dataUrl, outPath) {
  const b64 = String(dataUrl || '').split(',')[1] || '';
  mkdirSync(join(outPath, '..'), { recursive: true });
  writeFileSync(outPath, Buffer.from(b64, 'base64'));
}

function writeJson(outPath, value) {
  mkdirSync(join(outPath, '..'), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(value, null, 2)}\n`);
}

async function frontSample(page, until = null) {
  let shot = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await agentCall(page, 'camera_set', { view: 'front' });
    await agentCall(page, 'camera_fit', {});
    await page.evaluate(() => new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    }));
    shot = await readCenter(page);
    if (typeof until !== 'function' || until(shot.center)) break;
  }
  return shot;
}

async function readCenter(page) {
  return page.evaluate(async () => {
    const env = await window.surfcad.call('screenshot', '{}');
    const dataUrl = env?.result?.dataUrl || '';
    if (!dataUrl.startsWith('data:image/png')) return { center: null, dataUrl: '' };
    const img = document.createElement('img');
    await new Promise((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('screenshot decode failed'));
      img.src = dataUrl;
    });
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, img.width, img.height).data;
    const x = Math.floor(img.width / 2);
    const y = Math.floor(img.height / 2);
    const i = (y * img.width + x) * 4;
    return { center: [data[i], data[i + 1], data[i + 2]], dataUrl };
  });
}

function near(rgb, target, tol) {
  return Array.isArray(rgb) && rgb.length === 3
    && rgb.every((channel, i) => Math.abs(channel - target[i]) <= tol);
}

async function paintPart(page, color) {
  await agentCall(page, 'paint_open', {});
  await agentCall(page, 'paint_set_color', { color });
  const part = await agentCall(page, 'paint_part', {});
  const confirm = await agentCall(page, 'paint_confirm', {});
  return { part, confirm };
}

export async function run(ctx) {
  const { page, outDir } = ctx;
  const runner = createStepRunner();
  const shotDir = join(outDir, 'agent-paint-survive');
  mkdirSync(shotDir, { recursive: true });
  const wall = { startedAt: Date.now(), steps: {} };

  await runner.runStep('seed part with no surf id does not pretend to paint', async () => {
    const t0 = Date.now();
    const painted = await paintPart(page, '#1A1A1A');
    await agentCall(page, 'paint_cancel', {});
    wall.steps.seedNoSurf = Date.now() - t0;
    const ok = painted.part.ok === false
      && painted.part.error?.code === 'bad_paint'
      && painted.confirm.result?.unchanged === true
      && painted.confirm.result?.written === false;
    return {
      ok,
      call: 'paint_part',
      envelope: painted.part,
      detail: JSON.stringify(painted.part.error || painted.part.result),
    };
  });

  await runner.runStep('unpainted body is the light default', async () => {
    const shot = await frontSample(page, (rgb) => near(rgb, [236, 234, 228], 2));
    if (shot.dataUrl) writeDataUrl(shot.dataUrl, join(shotDir, 'before-unpainted.png'));
    writeJson(join(shotDir, 'before-unpainted.json'), { center: shot.center });
    return {
      ok: near(shot.center, [236, 234, 228], 2),
      call: 'screenshot',
      detail: `center=${shot.center}`,
    };
  });

  let cubeId = null;
  await runner.runStep('create_part cube', async () => {
    const env = await agentCall(page, 'create_part', { name: 'Cube', script: CUBE });
    cubeId = env.result?.partId || null;
    const parts = await agentCall(page, 'parts', {});
    const seed = (parts.result?.parts || []).find((row) => row.id !== cubeId);
    if (seed) await agentCall(page, 'set_part_visible', { part_id: seed.id, visible: false });
    return {
      ok: env.ok === true && env.result?.ok === true && typeof cubeId === 'string',
      call: 'create_part',
      args: { name: 'Cube' },
      envelope: env,
      detail: `partId=${cubeId}`,
    };
  });

  await runner.runStep('face-on #1A1A1A matches the hex', async () => {
    const t0 = Date.now();
    const painted = await paintPart(page, '#1A1A1A');
    const shot = await frontSample(page, (rgb) => near(rgb, [26, 26, 26], 2));
    wall.steps.paintDark = Date.now() - t0;
    if (shot.dataUrl) writeDataUrl(shot.dataUrl, join(shotDir, 'after-dark.png'));
    writeJson(join(shotDir, 'after-dark.json'), {
      center: shot.center,
      confirm: painted.confirm.result,
    });
    const ok = painted.confirm.result?.written === true
      && near(shot.center, [26, 26, 26], 2);
    return {
      ok,
      call: 'paint_confirm',
      envelope: painted.confirm,
      detail: `center=${shot.center} written=${painted.confirm.result?.written}`,
    };
  });

  await runner.runStep('identical set_script keeps the part paint', async () => {
    const t0 = Date.now();
    const ran = await agentCall(page, 'set_script', { source: CUBE });
    const painted = await paintPart(page, '#1A1A1A');
    const shot = await frontSample(page, (rgb) => near(rgb, [26, 26, 26], 2));
    wall.steps.identicalRerun = Date.now() - t0;
    writeJson(join(shotDir, 'identical-rerun.json'), {
      droppedPaints: ran.result?.droppedPaints,
      confirm: painted.confirm.result,
      center: shot.center,
    });
    const ok = ran.ok === true
      && Array.isArray(ran.result?.droppedPaints)
      && ran.result.droppedPaints.length === 0
      && painted.confirm.result?.unchanged === true
      && painted.confirm.result?.written === false
      && near(shot.center, [26, 26, 26], 2);
    return {
      ok,
      call: 'set_script',
      envelope: ran,
      detail: `dropped=${ran.result?.droppedPaints?.length} confirm=${JSON.stringify(painted.confirm.result)} center=${shot.center}`,
    };
  });

  await runner.runStep('in-tolerance nudge keeps the face paint', async () => {
    const faces = await agentCall(page, 'list_faces', {});
    const top = (faces.result?.faces || []).find((row) => row.normal?.[2] > 0.9);
    await agentCall(page, 'paint_open', {});
    await agentCall(page, 'paint_set_color', { color: '#aa1122' });
    await agentCall(page, 'paint_faces', { keys: [top?.key] });
    const first = await agentCall(page, 'paint_confirm', {});
    const t0 = Date.now();
    const ran = await agentCall(page, 'set_script', { source: NUDGED });
    const faces2 = await agentCall(page, 'list_faces', {});
    const top2 = (faces2.result?.faces || []).find((row) => row.normal?.[2] > 0.9);
    await agentCall(page, 'paint_open', {});
    await agentCall(page, 'paint_set_color', { color: '#aa1122' });
    const repaint = await agentCall(page, 'paint_faces', { keys: [top2?.key] });
    const confirm = await agentCall(page, 'paint_confirm', {});
    wall.steps.nudge = Date.now() - t0;
    writeJson(join(shotDir, 'nudge.json'), {
      first: first.result,
      droppedPaints: ran.result?.droppedPaints,
      repaint: repaint.result || repaint.error,
      confirm: confirm.result,
    });
    const ok = first.result?.written === true
      && Array.isArray(ran.result?.droppedPaints)
      && ran.result.droppedPaints.length === 0
      && repaint.ok === true
      && repaint.result?.unchanged === true
      && confirm.result?.unchanged === true
      && confirm.result?.written === false;
    return {
      ok,
      call: 'set_script',
      envelope: ran,
      detail: `dropped=${ran.result?.droppedPaints?.length} repaint=${JSON.stringify(repaint.result || repaint.error)} confirm=${JSON.stringify(confirm.result)}`,
    };
  });

  await runner.runStep('a shifted face is named in droppedPaints', async () => {
    const t0 = Date.now();
    const ran = await agentCall(page, 'set_script', { source: SHIFTED });
    wall.steps.shift = Date.now() - t0;
    const dropped = ran.result?.droppedPaints || [];
    const hit = dropped.find((row) => row.color === '#aa1122' && row.reason === 'missing');
    writeJson(join(shotDir, 'dropped.json'), { droppedPaints: dropped, ms: wall.steps });
    const shot = await frontSample(page);
    if (shot.dataUrl) writeDataUrl(shot.dataUrl, join(shotDir, 'after-shift-part-color.png'));
    const ok = ran.ok === true
      && !!hit
      && typeof hit.surfId === 'string'
      && Array.isArray(hit.key?.at)
      && hit.key.at.length === 3;
    return {
      ok,
      call: 'set_script',
      envelope: { ok: ran.ok, droppedPaints: dropped },
      detail: `dropped=${dropped.length} hit=${JSON.stringify(hit || null)}`,
    };
  });

  wall.totalMs = Date.now() - wall.startedAt;
  writeJson(join(shotDir, 'wall-clock.json'), wall);

  return {
    id,
    title,
    ok: runner.failed === 0,
    steps: runner.steps,
    replaySteps: runner.replaySteps,
    screenshots: [
      join(shotDir, 'before-unpainted.png'),
      join(shotDir, 'after-dark.png'),
    ],
  };
}

/* global window, document, sessionStorage */
/**
 * create_part runs the script and returns the new part id.
 * open_assembly of a missing assembly_id is unknown_assembly and does not commit.
 *
 *   npm run build:playtest && node scripts/playtest/run.mjs --scenario create-part-open-assembly
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { agentCall } from '../lib/harness.mjs';
import { createStepRunner } from '../lib/stepRunner.mjs';

const USER_ID = 'user-playtest-create-open';

const CUBE = `let part = Manifold.cube([20, 20, 20], true);
return part;
`;

const FAIL = `// --- cube begin id=cube1 ---
throw new Error('Cube failed: result is not a valid solid (NotManifold)');
let part = Manifold.cube([20, 20, 20], true);
// --- cube end ---
return part;
`;

export const id = 'create-part-open-assembly';
export const title = 'create_part runs the new part; open_assembly misses are unknown_assembly';
export const userId = USER_ID;

export function seedDoc() {
  return {
    format: 'surfcad.assembly',
    v: 1,
    name: 'playtest-create-open',
    activeId: 'seed',
    source: 'local',
    parts: [{ id: 'seed', name: 'Seed', visible: true, order: 0 }],
    joints: [],
  };
}

export function seedParts() {
  return [{
    id: 'seed',
    script: `let part = Manifold.cube([8, 8, 8], true);\nreturn part;\n`,
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

async function mockCommitCount(page) {
  return page.evaluate(() => {
    const raw = sessionStorage.getItem('surfcad.mockGithub.v1');
    if (!raw) return 0;
    const data = JSON.parse(raw);
    return (data.repos || []).reduce((sum, repo) => sum + ((repo.commits || []).length), 0);
  });
}

async function bodySamples(page) {
  return page.evaluate(async () => {
    const env = await window.surfcad.call('screenshot', '{}');
    const dataUrl = env?.result?.dataUrl || '';
    if (!dataUrl.startsWith('data:image/png')) return { samples: 0, dataUrl: '' };
    const img = document.createElement('img');
    await new Promise((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('screenshot decode failed'));
      img.src = dataUrl;
    });
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, img.width, img.height).data;
    let samples = 0;
    for (let i = 0; i < data.length; i += 16) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const chroma = Math.max(r, g, b) - Math.min(r, g, b);
      if (r + g + b > 360 && chroma < 40) samples += 1;
    }
    return { samples, dataUrl };
  });
}

export async function run(ctx) {
  const { page, outDir } = ctx;
  const runner = createStepRunner();
  const shotDir = join(outDir, 'create-part-open-assembly');
  mkdirSync(shotDir, { recursive: true });
  let seedId = 'seed';
  let cubeId = null;

  await runner.runStep('create_part runs a cube on the new id', async () => {
    const before = await agentCall(page, 'parts', {});
    seedId = before.result?.activeId || seedId;
    const commitsBefore = await mockCommitCount(page);
    const env = await agentCall(page, 'create_part', { name: 'Cube', script: CUBE });
    const after = await agentCall(page, 'parts', {});
    cubeId = env.result?.partId || null;
    const row = (after.result?.parts || []).find((part) => part.id === cubeId);
    writeJson(join(shotDir, 'create-part-cube.json'), env);
    const ok = env.ok === true
      && typeof cubeId === 'string'
      && cubeId !== seedId
      && after.result?.activeId === cubeId
      && row
      && env.result?.ok === true
      && (env.result?.status?.volume ?? 0) > 0
      && env.result?.status?.bodyCount === 1
      && (await mockCommitCount(page)) === commitsBefore;
    return {
      ok,
      call: 'create_part',
      args: { name: 'Cube' },
      envelope: env,
      detail: `partId=${cubeId} active=${after.result?.activeId} volume=${env.result?.status?.volume} bodies=${env.result?.status?.bodyCount}`,
    };
  });

  await runner.runStep('new cube is visible', async () => {
    if (seedId) await agentCall(page, 'set_part_visible', { part_id: seedId, visible: false });
    await agentCall(page, 'camera_fit', {});
    const shot = await bodySamples(page);
    if (shot.dataUrl) writeDataUrl(shot.dataUrl, join(shotDir, 'create-part-cube.png'));
    return {
      ok: shot.samples > 20,
      call: 'screenshot',
      detail: `samples=${shot.samples}`,
    };
  });

  await runner.runStep('create_part keeps a failed script part and returns feature_failed', async () => {
    const commitsBefore = await mockCommitCount(page);
    const env = await agentCall(page, 'create_part', { name: 'Bad', script: FAIL });
    const after = await agentCall(page, 'parts', {});
    const failId = env.result?.partId;
    const row = (after.result?.parts || []).find((part) => part.id === failId);
    const failure = env.result?.failures?.[0];
    writeJson(join(shotDir, 'create-part-failed.json'), env);
    const ok = env.ok === true
      && typeof failId === 'string'
      && failId !== cubeId
      && failId !== seedId
      && after.result?.activeId === failId
      && row
      && env.result?.ok === false
      && failure?.code === 'feature_failed'
      && typeof failure.message === 'string'
      && failure.message.length > 0
      && failure.featureType === 'cube'
      && failure.featureLabel === 'Cube'
      && (await mockCommitCount(page)) === commitsBefore;
    return {
      ok,
      call: 'create_part',
      args: { name: 'Bad' },
      envelope: env,
      detail: `partId=${failId} code=${failure?.code} label=${failure?.featureLabel}`,
    };
  });

  await runner.runStep('git_move_to_repo so open_assembly has a vault', async () => {
    const env = await agentCall(page, 'git_move_to_repo', { vault_name: 'playtest-create-open-vault' });
    return {
      ok: env.ok === true && (env.result?.status === 'moved' || env.result?.status === 'ok'),
      call: 'git_move_to_repo',
      envelope: env,
    };
  });

  await runner.runStep('open_assembly of a missing id is unknown_assembly', async () => {
    const commitsBefore = await mockCommitCount(page);
    const before = await agentCall(page, 'parts', {});
    const missingId = '2026-10-18-02-50-00-0001-dead';
    const env = await agentCall(page, 'open_assembly', { assembly_id: missingId });
    const after = await agentCall(page, 'parts', {});
    writeJson(join(shotDir, 'open-assembly-missing.json'), env);
    const text = JSON.stringify(env);
    const ok = env.ok === false
      && env.error?.code === 'unknown_assembly'
      && text.includes(missingId)
      && typeof env.error?.details?.hint === 'string'
      && env.error.details.hint.length > 0
      && !text.includes('assemblies/')
      && !text.includes('.surf.json')
      && after.result?.assemblyName === before.result?.assemblyName
      && (await mockCommitCount(page)) === commitsBefore;
    return {
      ok,
      call: 'open_assembly',
      args: { assembly_id: missingId },
      envelope: env,
      detail: `hint=${env.error?.details?.hint || ''}`,
    };
  });

  return {
    id,
    title,
    ok: runner.failed === 0,
    steps: runner.steps,
    replaySteps: runner.replaySteps,
    screenshots: [
      join(shotDir, 'create-part-cube.png'),
    ],
  };
}

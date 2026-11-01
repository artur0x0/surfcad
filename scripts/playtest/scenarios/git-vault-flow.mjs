/** Mock vault: move to repo, save, branch create/switch, confirm gate.
 * Uses the in-memory mock GitHub adapter only (no token, no real repo). */
import { agentCall, waitForBridge } from '../lib/harness.mjs';
import { createStepRunner } from '../lib/stepRunner.mjs';
import { isV2SurfId } from '../../../src/utils/git/surfId.js';

const USER_ID = 'user-playtest-git-h12';
const VAULT = 'playtest-git-h12-vault';

async function readGitBadge(page) {
  return page.evaluate(() => {
    /* eslint-disable no-undef */
    const save = document.querySelector('[data-git-save]');
    const partDirty = [...document.querySelectorAll('[data-part-row][data-part-dirty="true"]')]
      .map((el) => el.getAttribute('data-part-row') || '')
      .filter(Boolean);
    return {
      gitDirty: save?.getAttribute('data-git-dirty') || null,
      hasBadge: !!document.querySelector('[data-git-dirty-badge]'),
      partDirty,
    };
    /* eslint-enable no-undef */
  });
}

function gitCleanDetail(dirty, badge) {
  const result = dirty?.result || {};
  return [
    `workspaceDirty=${result.workspaceDirty}`,
    `assemblyDirty=${result.assemblyDirty}`,
    `unsaved=${result.unsaved}`,
    `partIds=${JSON.stringify(result.partIds || [])}`,
    `gitDirty=${badge.gitDirty}`,
    `hasBadge=${badge.hasBadge}`,
    `partDirty=${JSON.stringify(badge.partDirty)}`,
  ].join(' ');
}

function isGitClean(dirty, badge) {
  const result = dirty?.result || {};
  return dirty?.ok === true
    && result.workspaceDirty !== true
    && result.assemblyDirty !== true
    && result.unsaved !== true
    && (result.partIds || []).length === 0
    && badge.gitDirty === 'false'
    && badge.hasBadge === false
    && badge.partDirty.length === 0;
}

async function waitForGitClean(page, timeoutMs = 20000) {
  const started = Date.now();
  let dirty = { ok: false };
  let badge = { gitDirty: null, hasBadge: true, partDirty: ['?'] };
  while (Date.now() - started < timeoutMs) {
    dirty = await agentCall(page, 'dirty', {});
    badge = await readGitBadge(page);
    if (isGitClean(dirty, badge)) {
      return { ok: true, dirty, detail: gitCleanDetail(dirty, badge) };
    }
    await new Promise((resolve) => { setTimeout(resolve, 200); });
  }
  return { ok: false, dirty, detail: gitCleanDetail(dirty, badge) };
}

export const id = 'git-vault-flow';
export const title = 'Git vault save and branches (mock adapter)';
export const userId = USER_ID;

export function seedDoc() {
  return {
    format: 'surfcad.assembly',
    v: 1,
    name: 'playtest-git-seed',
    activeId: 'local:seed',
    source: 'local',
    parts: [{ id: 'local:seed', name: 'Seed', visible: true, order: 0 }],
    joints: [],
  };
}

export function seedParts() {
  return [{
    id: 'local:seed',
    script: `// --- cube begin ---
let part = Manifold.cube([20, 20, 10], true);
// --- cube end ---
return part;
`,
  }];
}

export async function run(ctx) {
  const { page } = ctx;
  const runner = createStepRunner();
  await runner.runStep('git_move_to_repo (mock vault)', async () => {
    const env = await agentCall(page, 'git_move_to_repo', { vault_name: VAULT });
    const dirty = await agentCall(page, 'dirty', {});
    const adapter = await page.locator('[data-git-adapter]').first().getAttribute('data-git-adapter');
    const ok = env.ok === true
      && (env.result?.status === 'moved' || env.result?.status === 'ok')
      && adapter === 'mock';
    return {
      ok,
      call: 'git_move_to_repo',
      args: { vault_name: VAULT },
      envelope: env,
      detail: `workspaceDirty=${dirty.result?.workspaceDirty} adapter=${adapter}`,
    };
  });

  await runner.runStep('git_branch_create before save', async () => {
    const env = await agentCall(page, 'git_branch_create', { name: 'feature/playtest-save' });
    const listed = await agentCall(page, 'git_list_branches', {});
    const ok = env.ok === true
      && env.result?.status === 'created'
      && env.result?.switched === true
      && listed.result?.branch === 'feature/playtest-save';
    return {
      ok,
      call: 'git_branch_create',
      args: { name: 'feature/playtest-save' },
      envelope: env,
      detail: `switched=${env.result?.switched} branch=${listed.result?.branch}`,
    };
  });

  await runner.runStep('listed ids are surf-ids and id tools accept them', async () => {
    const listed = await agentCall(page, 'parts', {});
    const rows = listed.result?.parts || [];
    const ids = rows.map((row) => row?.id).filter(Boolean);
    const allSurf = ids.length > 0 && ids.every((id) => isV2SurfId(id));
    const noPath = ids.every((id) => !String(id).includes('/') && !String(id).includes('\\'));
    const partId = listed.result?.activeId || ids[0];
    const cur = await agentCall(page, 'get_script', { part_id: partId });
    const set = await agentCall(page, 'set_script', {
      part_id: partId,
      source: `${cur.result?.source || ''}\n// listed-id\n`,
    });
    const activate = await agentCall(page, 'set_active_part', { part_id: partId });
    return {
      ok: allSurf && noPath && set.ok === true && activate.ok === true,
      call: 'set_script',
      args: { part_id: partId },
      envelope: set.ok === true ? activate : set,
      detail: `ids=${JSON.stringify(ids)} set=${set.ok} activate=${activate.ok}`,
    };
  });

  await runner.runStep('edit script for save', async () => {
    const cur = await agentCall(page, 'get_script', {});
    const next = `${cur.result?.source || ''}\n// agent edit\n`;
    const set = await agentCall(page, 'set_script', { source: next });
    const run = await agentCall(page, 'run', {});
    return {
      ok: set.ok === true && run.ok === true,
      call: 'set_script',
      args: {},
      envelope: run,
    };
  });

  await runner.runStep('git_save', async () => {
    const env = await agentCall(page, 'git_save', { message: 'playtest agent save' });
    const ok = env.ok === true
      && (env.result?.status === 'committed'
        || env.result?.status === 'queued'
        || env.result?.status === 'clean');
    return { ok, call: 'git_save', args: { message: 'playtest agent save' }, envelope: env };
  });

  await runner.runStep('create_part for reload switch', async () => {
    const env = await agentCall(page, 'create_part', { name: 'Lid' });
    const parts = await agentCall(page, 'parts', {});
    const n = parts.result?.parts?.length ?? 0;
    return {
      ok: env.ok === true && n >= 2,
      call: 'create_part',
      args: { name: 'Lid' },
      envelope: env,
      detail: `parts=${n}`,
    };
  });

  await runner.runStep('git_save after second part', async () => {
    const env = await agentCall(page, 'git_save', { message: 'playtest add lid' });
    const ok = env.ok === true
      && (env.result?.status === 'committed'
        || env.result?.status === 'queued'
        || env.result?.status === 'clean');
    return { ok, call: 'git_save', args: { message: 'playtest add lid' }, envelope: env };
  });

  await runner.runStep('clean after save', async () => {
    const snap = await waitForGitClean(page);
    return {
      ok: snap.ok,
      call: 'dirty',
      args: {},
      envelope: snap.dirty,
      detail: snap.detail,
    };
  });

  await runner.runStep('reload stays clean', async () => {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForBridge(page);
    const started = Date.now();
    let n = 0;
    while (Date.now() - started < 20000) {
      const parts = await agentCall(page, 'parts', {});
      n = parts.result?.parts?.length ?? 0;
      if (n >= 2) break;
      await new Promise((resolve) => { setTimeout(resolve, 200); });
    }
    const snap = await waitForGitClean(page);
    return {
      ok: n >= 2 && snap.ok,
      call: 'dirty',
      args: {},
      envelope: snap.dirty,
      detail: `parts=${n} ${snap.detail}`,
    };
  });

  await runner.runStep('switch part still clean', async () => {
    const parts = await agentCall(page, 'parts', {});
    const rows = parts.result?.parts || [];
    const active = parts.result?.activeId;
    const other = rows.find((row) => row.id && row.id !== active) || rows[1];
    const switched = other?.id
      ? await agentCall(page, 'set_active_part', { part_id: other.id })
      : { ok: false };
    const snap = await waitForGitClean(page);
    return {
      ok: switched.ok === true && snap.ok,
      call: 'set_active_part',
      args: { part_id: other?.id },
      envelope: snap.dirty,
      detail: snap.detail,
    };
  });

  await runner.runStep('real edit dirties after reload', async () => {
    const cur = await agentCall(page, 'get_script', {});
    const next = `${cur.result?.source || ''}// dirty-check\n`;
    const set = await agentCall(page, 'set_script', { source: next });
    const dirty = await agentCall(page, 'dirty', {});
    const badge = await readGitBadge(page);
    const ok = set.ok === true
      && dirty.result?.workspaceDirty === true
      && badge.gitDirty === 'true';
    return {
      ok,
      call: 'set_script',
      args: {},
      envelope: dirty,
      detail: `workspaceDirty=${dirty.result?.workspaceDirty} gitDirty=${badge.gitDirty}`,
    };
  });

  await runner.runStep('git_save after dirty-check edit', async () => {
    const env = await agentCall(page, 'git_save', { message: 'playtest dirty-check' });
    const ok = env.ok === true
      && (env.result?.status === 'committed'
        || env.result?.status === 'queued'
        || env.result?.status === 'clean');
    if (!ok) {
      return { ok, call: 'git_save', args: { message: 'playtest dirty-check' }, envelope: env };
    }
    const snap = await waitForGitClean(page);
    return {
      ok: snap.ok,
      call: 'git_save',
      args: { message: 'playtest dirty-check' },
      envelope: env,
      detail: snap.detail,
    };
  });

  await runner.runStep('git_branch_create switches when clean', async () => {
    const env = await agentCall(page, 'git_branch_create', { name: 'feature/playtest-h12' });
    const listed = await agentCall(page, 'git_list_branches', {});
    const current = listed.result?.branch;
    const row = (listed.result?.branches || []).find((b) => b.name === 'feature/playtest-h12');
    const ok = env.ok === true
      && env.result?.status === 'created'
      && env.result?.switched === true
      && current === 'feature/playtest-h12'
      && row?.current === true;
    return {
      ok,
      call: 'git_branch_create',
      args: { name: 'feature/playtest-h12' },
      envelope: env,
      detail: `switched=${env.result?.switched} current=${current}`,
    };
  });

  await runner.runStep('git_branch_switch to created branch is same', async () => {
    const env = await agentCall(page, 'git_branch_switch', { branch: 'feature/playtest-h12' });
    return {
      ok: env.ok === true && (env.result?.status === 'switched' || env.result?.status === 'same'),
      call: 'git_branch_switch',
      args: { branch: 'feature/playtest-h12' },
      envelope: env,
    };
  });

  await runner.runStep('git_branch_create dirty stays on current branch', async () => {
    const cur = await agentCall(page, 'get_script', {});
    const set = await agentCall(page, 'set_script', {
      source: `${cur.result?.source || ''}\n// unsaved dirty create\n`,
    });
    await agentCall(page, 'run', {});
    const dirty = await agentCall(page, 'dirty', {});
    const env = await agentCall(page, 'git_branch_create', { name: 'feature/playtest-dirty' });
    const listed = await agentCall(page, 'git_list_branches', {});
    const names = (listed.result?.branches || []).map((b) => b.name);
    const current = listed.result?.branch;
    const row = (listed.result?.branches || []).find((b) => b.name === 'feature/playtest-dirty');
    const ok = set.ok === true
      && dirty.result?.workspaceDirty === true
      && env.ok === true
      && env.result?.status === 'created'
      && env.result?.switched === false
      && current === 'feature/playtest-h12'
      && names.includes('feature/playtest-dirty')
      && row?.current !== true;
    return {
      ok,
      call: 'git_branch_create',
      args: { name: 'feature/playtest-dirty' },
      envelope: env,
      detail: `workspaceDirty=${dirty.result?.workspaceDirty} switched=${env.result?.switched} current=${current}`,
    };
  });

  await runner.runStep('git_branch_delete confirm gate', async () => {
    const denied = await agentCall(page, 'git_branch_delete', { branch: 'feature/playtest-h12' });
    const ok = denied.ok === false && denied.error?.code === 'confirm_required';
    return {
      ok,
      call: 'git_branch_delete',
      args: { branch: 'feature/playtest-h12' },
      envelope: denied,
      detail: denied.error?.code,
    };
  });

  return {
    id,
    title,
    ok: runner.failed === 0,
    steps: runner.steps,
    replaySteps: runner.replaySteps,
    screenshots: [],
  };
}

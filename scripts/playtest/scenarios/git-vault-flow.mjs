/** Mock vault: move to repo, save, branch create/switch, confirm gate. */
import { agentCall } from '../lib/harness.mjs';
import { createStepRunner } from '../lib/stepRunner.mjs';

const USER_ID = 'user-playtest-git-h12';
const VAULT = 'playtest-git-h12-vault';

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
    const ok = env.ok === true
      && (env.result?.status === 'moved' || env.result?.status === 'ok');
    return {
      ok,
      call: 'git_move_to_repo',
      args: { vault_name: VAULT },
      envelope: env,
      detail: `workspaceDirty=${dirty.result?.workspaceDirty}`,
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

  await runner.runStep('git_branch_create', async () => {
    const env = await agentCall(page, 'git_branch_create', { name: 'feature/playtest-h12' });
    return {
      ok: env.ok === true && env.result?.status === 'created',
      call: 'git_branch_create',
      args: { name: 'feature/playtest-h12' },
      envelope: env,
    };
  });

  await runner.runStep('git_branch_switch', async () => {
    const env = await agentCall(page, 'git_branch_switch', { branch: 'feature/playtest-h12' });
    return {
      ok: env.ok === true && (env.result?.status === 'switched' || env.result?.status === 'same'),
      call: 'git_branch_switch',
      args: { branch: 'feature/playtest-h12' },
      envelope: env,
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

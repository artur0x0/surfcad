import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  requireDestructiveConfirm,
  agentGitRealOptIn,
  agentGitRealWriteBlocked,
  agentGitConsentPrompt,
  gitOpResult,
  summarizeUpgradeVaultResult,
  AGENT_GIT_REAL_SESSION_KEY,
  AGENT_SAVE_ON_MAIN_MESSAGE,
  refuseAgentSaveOnMain,
} from './gitAgent.js';
import { COMMAND_META } from './export/commandMeta.js';
import {
  gitBehindResolveCommand,
  gitBranchCreateCommand,
  gitBranchDeleteCommand,
  gitListBranchesCommand,
  gitMoveToRepoCommand,
  gitAddToRepoCommand,
  gitSaveCommand,
  gitUpgradeVaultCommand,
} from './commands/git.js';

test('requireDestructiveConfirm refuses without confirm', () => {
  const err = requireDestructiveConfirm({}, 'delete branch');
  assert.equal(err?.code, 'confirm_required');
  assert.match(err?.message || '', /confirm: true/);
});

test('requireDestructiveConfirm passes with confirm true', () => {
  assert.equal(requireDestructiveConfirm({ confirm: true }, 'delete branch'), null);
});

test('git_branch_delete checkArgs enforces confirm', () => {
  const missing = gitBranchDeleteCommand.checkArgs({ branch: 'x' });
  assert.equal(missing?.code, 'confirm_required');
  assert.equal(gitBranchDeleteCommand.checkArgs({ branch: 'x', confirm: true }), null);
});

test('git_behind_resolve checkArgs enforces confirm', () => {
  assert.equal(gitBehindResolveCommand.checkArgs({ action: 'reload' })?.code, 'confirm_required');
  assert.equal(gitBehindResolveCommand.checkArgs({ action: 'branch', confirm: true }), null);
});

test('agentGitRealOptIn reads query, storage, and session', () => {
  const emptyStore = { getItem: () => null };
  assert.equal(agentGitRealOptIn({ location: { search: '' }, localStorage: emptyStore, sessionStorage: emptyStore }), false);
  assert.equal(agentGitRealOptIn({
    location: { search: '?agent=1&agentGit=real' },
    localStorage: emptyStore,
    sessionStorage: emptyStore,
  }), true);
  assert.equal(agentGitRealOptIn({
    location: { search: '' },
    localStorage: { getItem: (k) => (k === 'surfcadAgentGitReal' ? '1' : null) },
    sessionStorage: emptyStore,
  }), true);
  assert.equal(agentGitRealOptIn({
    location: { search: '' },
    localStorage: emptyStore,
    sessionStorage: { getItem: (k) => (k === AGENT_GIT_REAL_SESSION_KEY ? '1' : null) },
  }), true);
});

test('agentGitRealWriteBlocked refuses real adapter without opt-in', () => {
  assert.equal(agentGitRealWriteBlocked('mock', false), null);
  assert.equal(agentGitRealWriteBlocked('real', true), null);
  const blocked = agentGitRealWriteBlocked('real', false);
  assert.equal(blocked?.code, 'real_repo_blocked');
  assert.equal(blocked?.details?.reason, 'consent_pending');
  const declined = agentGitRealWriteBlocked('real', false, true);
  assert.equal(declined?.details?.reason, 'consent_declined');
});

test('agentGitConsentPrompt names command target', () => {
  const text = agentGitConsentPrompt('git_save', 'acme/widgets', 'feature/x');
  assert.match(text, /save to acme\/widgets\/feature\/x/);
  assert.match(text, /Allow agent writes/);
});

test('git_save blocked on real adapter without opt-in (headless consent)', async () => {
  let saved = false;
  const ctx = {
    readAgentGitAdapterKind: () => 'real',
    readAgentGitRealOptIn: () => false,
    readAgentGitSessionDenied: () => false,
    readAgentGitWriteTarget: () => ({ repo: 'o/r', branch: 'feature/x', checkedOut: true }),
    promptAgentGitWriteConsent: () => 'unavailable',
    agentGitSave: async () => {
      saved = true;
      return { status: 'committed' };
    },
  };
  const out = await gitSaveCommand.run(ctx, { message: 'test' });
  assert.equal(saved, false);
  assert.equal(out.error?.code, 'real_repo_blocked');
  assert.equal(out.error?.details?.reason, 'consent_pending');
});

test('git_save returns consent_pending at once while the modal is up', async () => {
  let saved = false;
  const prompts = [];
  const ctx = {
    readAgentGitAdapterKind: () => 'real',
    readAgentGitRealOptIn: () => false,
    readAgentGitSessionDenied: () => false,
    readAgentGitWriteTarget: () => ({ repo: 'o/r', branch: 'feature/x', checkedOut: true }),
    promptAgentGitWriteConsent: (args) => {
      prompts.push(args);
      return 'shown';
    },
    agentGitSave: async () => {
      saved = true;
      return { status: 'committed' };
    },
  };
  const started = Date.now();
  const out = await gitSaveCommand.run(ctx, { message: 'test' });
  assert.ok(Date.now() - started < 1000);
  assert.equal(saved, false, 'nothing is written before Allow');
  assert.equal(out.error?.code, 'consent_pending');
  assert.equal(out.error?.details?.retry, true);
  assert.equal(out.error?.details?.command, 'git_save');
  assert.ok(out.error?.details?.retry_after_ms > 0);
  assert.match(out.error?.message || '', /o\/r\/feature\/x/);
  assert.deepEqual(prompts, [{ command: 'git_save', repo: 'o/r', branch: 'feature/x', checkedOut: true }]);
});

test('git_save runs on retry after session allow', async () => {
  let saved = false;
  let allowed = false;
  const ctx = {
    readAgentGitAdapterKind: () => 'real',
    readAgentGitRealOptIn: () => allowed,
    readAgentGitSessionDenied: () => false,
    readAgentGitWriteTarget: () => ({ repo: 'o/r', branch: 'feature/x', checkedOut: true }),
    promptAgentGitWriteConsent: () => 'shown',
    agentGitSave: async () => {
      saved = true;
      return { status: 'committed' };
    },
  };
  const first = await gitSaveCommand.run(ctx, { message: 'test' });
  assert.equal(first.error?.code, 'consent_pending');
  allowed = true;
  const out = await gitSaveCommand.run(ctx, { message: 'test' });
  assert.equal(saved, true);
  assert.equal(out.result?.status, 'committed');
});

test('git_save on a main checkout is refused and writes nothing', async () => {
  let saved = false;
  const ctx = {
    readAgentGitAdapterKind: () => 'real',
    readAgentGitRealOptIn: () => true,
    readAgentGitWriteTarget: () => ({ repo: 'o/r', branch: 'main', checkedOut: true }),
    promptAgentGitWriteConsent: () => {
      throw new Error('consent modal must not open');
    },
    agentGitSave: async () => {
      saved = true;
      return { status: 'committed' };
    },
  };
  const out = await gitSaveCommand.run(ctx, { message: 'test' });
  assert.equal(saved, false);
  assert.equal(out.error?.code, 'save_on_main');
  assert.equal(out.error?.message, AGENT_SAVE_ON_MAIN_MESSAGE);
  assert.equal(out.error?.hint, AGENT_SAVE_ON_MAIN_MESSAGE);
  assert.match(out.error.message, /git_branch_create \{ name \}/);
  assert.equal(/allowMain/i.test(JSON.stringify(out)), false);
  assert.equal(refuseAgentSaveOnMain({ branch: 'main', checkedOut: true })?.error.code, 'save_on_main');
});

test('git_add_to_repo on a main checkout is the same refusal and writes nothing', async () => {
  let saved = false;
  const ctx = {
    readAgentGitAdapterKind: () => 'mock',
    readAgentGitWriteTarget: () => ({ repo: 'o/r', branch: 'main', checkedOut: true }),
    agentGitSave: async () => {
      saved = true;
      return { status: 'committed' };
    },
  };
  const out = await gitAddToRepoCommand.run(ctx, { message: 'test' });
  assert.equal(saved, false);
  assert.equal(out.error?.code, 'save_on_main');
  assert.equal(out.error?.message, AGENT_SAVE_ON_MAIN_MESSAGE);
  assert.equal(/allowMain/i.test(out.error.message + out.error.hint), false);
});

test('git_save still commits on a non-main checkout', async () => {
  let saved = false;
  const ctx = {
    readAgentGitAdapterKind: () => 'mock',
    readAgentGitWriteTarget: () => ({ repo: 'o/r', branch: 'feature/x', checkedOut: true }),
    agentGitSave: async () => {
      saved = true;
      return { status: 'committed' };
    },
  };
  const out = await gitSaveCommand.run(ctx, { message: 'test' });
  assert.equal(saved, true);
  assert.equal(out.result?.status, 'committed');
});

test('a branch label of main without a checkout is not refused', async () => {
  let saved = false;
  const ctx = {
    readAgentGitAdapterKind: () => 'mock',
    readAgentGitWriteTarget: () => ({ repo: 'o/r', branch: 'main' }),
    agentGitSave: async () => {
      saved = true;
      return { status: 'committed' };
    },
  };
  const out = await gitSaveCommand.run(ctx, { message: 'test' });
  assert.equal(saved, true);
  assert.equal(out.result?.status, 'committed');
  assert.equal(refuseAgentSaveOnMain(null), null);
  assert.equal(refuseAgentSaveOnMain({ branch: 'main', checkedOut: false }), null);
  assert.equal(refuseAgentSaveOnMain({ checkedOut: true }), null);
});

test('agentGitSave refuses a main checkout before the commit', () => {
  const app = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../App.jsx'), 'utf8');
  const save = app.slice(app.indexOf('async agentGitSave({ message })'), app.indexOf('async agentGitUpgradeVault()'));
  const guardAt = save.indexOf('refuseAgentSaveOnMain(readAgentGitWriteTarget())');
  const commitAt = save.indexOf('handleGitCommit(draft)');
  assert.ok(guardAt >= 0 && commitAt > guardAt);
  const commit = app.slice(app.indexOf('const handleGitCommit'), app.indexOf('const absorbOverwriteFiles'));
  assert.equal(commit.includes('refuseAgentSaveOnMain'), false);
});

test('git_save skips consent when session already denied', async () => {
  const ctx = {
    readAgentGitAdapterKind: () => 'real',
    readAgentGitRealOptIn: () => false,
    readAgentGitSessionDenied: () => true,
    promptAgentGitWriteConsent: () => {
      throw new Error('should not show modal');
    },
    agentGitSave: async () => ({ status: 'committed' }),
  };
  const out = await gitSaveCommand.run(ctx, { message: 'test' });
  assert.equal(out.error?.details?.reason, 'consent_declined');
});

test('git_branch_create needs a non-empty name', () => {
  assert.equal(gitBranchCreateCommand.checkArgs({})?.code, 'bad_args');
  assert.equal(gitBranchCreateCommand.checkArgs({ name: '  ' })?.code, 'bad_args');
  assert.equal(gitBranchCreateCommand.checkArgs({ name: 'feature/x' }), null);
});

test('git_branch_create does not require confirm', () => {
  assert.equal(gitBranchCreateCommand.checkArgs({ name: 'feature/x' }), null);
});

test('git_branch_create host result includes switched when the session moved', async () => {
  let args;
  const ctx = {
    readAgentGitAdapterKind: () => 'mock',
    agentGitBranchCreate: async (a) => {
      args = a;
      return { status: 'created', branch: a.name, sha: 'abc', switched: true };
    },
  };
  const out = await gitBranchCreateCommand.run(ctx, { name: ' feature/x ' });
  assert.equal(args.name, 'feature/x');
  assert.equal(out.result?.status, 'created');
  assert.equal(out.result?.switched, true);
  assert.equal(out.error, undefined);
});

test('git_branch_create dirty host result stays created without confirm', async () => {
  const ctx = {
    readAgentGitAdapterKind: () => 'mock',
    agentGitBranchCreate: async () => ({
      status: 'created',
      branch: 'feature/dirty',
      sha: 'def',
      switched: false,
    }),
  };
  const out = await gitBranchCreateCommand.run(ctx, { name: 'feature/dirty' });
  assert.equal(out.result?.status, 'created');
  assert.equal(out.result?.switched, false);
  assert.equal(out.error, undefined);
});

test('git_branch_create failed switch stays created with switchError', async () => {
  const ctx = {
    readAgentGitAdapterKind: () => 'mock',
    agentGitBranchCreate: async () => ({
      status: 'created',
      branch: 'feature/x',
      sha: 'abc',
      switched: false,
      switchError: 'Could not switch to the new branch',
    }),
  };
  const out = await gitBranchCreateCommand.run(ctx, { name: 'feature/x' });
  assert.equal(out.result?.status, 'created');
  assert.equal(out.result?.switched, false);
  assert.equal(out.result?.switchError, 'Could not switch to the new branch');
  assert.equal(out.error, undefined);
});

test('git_upgrade_vault without confirm is refused', () => {
  const missing = gitUpgradeVaultCommand.checkArgs({});
  assert.equal(missing?.code, 'confirm_required');
  assert.match(missing?.message || '', /confirm: true/);
  assert.equal(gitUpgradeVaultCommand.checkArgs({ confirm: false })?.code, 'confirm_required');
  assert.equal(gitUpgradeVaultCommand.checkArgs({ confirm: true }), null);
});

test('git_upgrade_vault run refuses without confirm and does not call the host', async () => {
  let called = false;
  const ctx = {
    readAgentGitAdapterKind: () => 'mock',
    agentGitUpgradeVault: async () => {
      called = true;
      return { status: 'upgraded' };
    },
  };
  const out = await gitUpgradeVaultCommand.run(ctx, {});
  assert.equal(called, false);
  assert.equal(out.error?.code, 'confirm_required');
});

test('git_upgrade_vault with confirm is upgrade_unavailable when the flag is off', async () => {
  let called = false;
  const ctx = {
    readAgentGitAdapterKind: () => 'mock',
    upgradeVaultEnv: { enabled: false },
    agentGitUpgradeVault: async () => {
      called = true;
      return { status: 'upgraded' };
    },
  };
  const out = await gitUpgradeVaultCommand.run(ctx, { confirm: true });
  assert.equal(called, false);
  assert.equal(out.error?.code, 'upgrade_unavailable');
  assert.match(out.error?.message || '', /not available/);
});

test('gitOpResult treats upgrade_unavailable as an error with a hint', () => {
  const out = gitOpResult({
    status: 'error',
    code: 'upgrade_unavailable',
    message: 'Upgrade vault is not available in this build.',
    hint: 'opt in from dev',
  });
  assert.equal(out.error?.code, 'upgrade_unavailable');
  assert.equal(out.error?.hint, 'opt in from dev');
  assert.equal(out.result, undefined);
});

test('git_upgrade_vault with confirm: true calls the host', async () => {
  let args;
  const ctx = {
    readAgentGitAdapterKind: () => 'mock',
    agentGitUpgradeVault: async (a) => {
      args = a;
      return { status: 'upgraded', sha: 'abc' };
    },
  };
  const out = await gitUpgradeVaultCommand.run(ctx, { confirm: true });
  assert.equal(args.confirm, true);
  assert.equal(out.result?.status, 'upgraded');
  assert.equal(out.error, undefined);
});

test('gitOpResult treats upgrade_required and upgrade conflict as errors with hints', () => {
  const required = gitOpResult({
    status: 'upgrade_required',
    code: 'upgrade_required',
    message: 'This vault is still v1',
    hint: 'git_upgrade_vault { confirm: true } after the user agrees',
  });
  assert.equal(required.error?.code, 'upgrade_required');
  assert.equal(required.error?.hint, 'git_upgrade_vault { confirm: true } after the user agrees');
  assert.equal(required.result, undefined);

  const conflict = gitOpResult({
    status: 'conflict',
    code: 'conflict',
    message: 'Remote tip moved',
    hint: 'Retry Upgrade vault',
  }, { commandName: 'git_upgrade_vault' });
  assert.equal(conflict.error?.code, 'conflict');
  assert.equal(conflict.error?.hint, 'Retry Upgrade vault');
});

test('gitOpResult keeps git_move_to_repo conflict paths and assemblyExists', () => {
  const out = gitOpResult({
    status: 'conflict',
    vault: { repo: { owner: 'acme', name: 'vault' } },
    paths: ['assemblies/Box/.surf.json'],
    assemblyExists: true,
  });
  assert.equal(out.error, undefined);
  assert.equal(out.result.status, 'conflict');
  assert.deepEqual(out.result.paths, ['assemblies/Box/.surf.json']);
  assert.equal(out.result.assemblyExists, true);
});

test('git_move_to_repo conflict is not a bare Git operation failed error', async () => {
  const out = await gitMoveToRepoCommand.run({
    readAgentGitAdapterKind: () => 'mock',
    agentGitMoveToRepo: async () => ({
      status: 'conflict',
      paths: ['assemblies/Box/.surf.json'],
      assemblyExists: true,
    }),
  }, {});
  assert.equal(out.error, undefined);
  assert.equal(out.result.status, 'conflict');
  assert.deepEqual(out.result.paths, ['assemblies/Box/.surf.json']);
  assert.equal(out.result.assemblyExists, true);
});

test('gitOpResult passes already_upgraded and upgraded through as success', () => {
  assert.equal(gitOpResult({ status: 'already_upgraded' }).result?.status, 'already_upgraded');
  assert.equal(gitOpResult({ status: 'upgraded', sha: 'abc' }).result?.sha, 'abc');
  assert.equal(gitOpResult({ status: 'already_upgraded' }).error, undefined);
});

function resultMatchesSchema(schema, value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (schema.additionalProperties === false) {
    const props = schema.properties || {};
    for (const key of Object.keys(value)) {
      if (!Object.prototype.hasOwnProperty.call(props, key)) return false;
      const expected = props[key]?.type;
      if (!expected) continue;
      const types = Array.isArray(expected) ? expected : [expected];
      const actual = Array.isArray(value[key]) ? 'array' : typeof value[key];
      if (!types.includes(actual)) return false;
    }
  }
  return true;
}

test('git_upgrade_vault result schema accepts the {status, error} fallback', () => {
  const schema = COMMAND_META.git_upgrade_vault.result;
  const fallback = summarizeUpgradeVaultResult(null);
  assert.deepEqual(fallback, { status: 'error', error: 'No result' });
  assert.equal(resultMatchesSchema(schema, fallback), true, 'summarize fallback must match the catalog schema');
  const shaped = gitOpResult(null, { commandName: 'git_upgrade_vault' });
  assert.deepEqual(shaped.result, { status: 'error', error: 'No result' });
  assert.equal(resultMatchesSchema(schema, shaped.result), true, 'gitOpResult fallback must match the catalog schema');
});

test('git_upgrade_vault result is a summary without plan or rekey scripts', () => {
  const host = {
    status: 'upgraded_and_saved',
    sha: 'save-sha',
    upgradeSha: 'up-sha',
    branch: 'main',
    commits: 2,
    files: [{ path: 'parts/x.js', content: 'return 1;\n' }],
    leftoverFiles: ['assemblies/Box/notes.txt'],
    plan: {
      writes: { 'parts/x.js': 'return 1;\n' },
      files: [{ path: 'parts/x.js', content: 'return 1;\n' }],
      leftoverFiles: ['assemblies/Box/notes.txt'],
      assemblies: [{ id: 'asm-1', folder: 'Box' }],
      keptPartIds: ['p1'],
      mintedPartIds: ['p2'],
      partBindings: [{ path: 'parts/Pin.js', id: 'p1' }],
      readmeKept: true,
    },
    rekey: { scripts: { p1: 'secret' }, pairs: [{ from: 'a', to: 'b' }] },
  };
  const summary = summarizeUpgradeVaultResult(host);
  assert.equal(summary.status, 'upgraded_and_saved');
  assert.equal(summary.sha, 'save-sha');
  assert.equal(summary.upgradeSha, 'up-sha');
  assert.deepEqual(summary.assemblyIds, ['asm-1']);
  assert.equal(summary.counts.commits, 2);
  assert.equal(summary.counts.assemblies, 1);
  assert.equal(summary.counts.partsKept, 1);
  assert.equal(summary.counts.partsMinted, 1);
  assert.equal(summary.counts.leftoverFiles, 1);
  assert.deepEqual(summary.leftoverFiles, ['assemblies/Box/notes.txt']);
  assert.equal(summary.warnings.some((row) => /README/.test(row)), true);
  assert.equal(Object.hasOwn(summary, 'plan'), false);
  assert.equal(Object.hasOwn(summary, 'rekey'), false);
  assert.equal(Object.hasOwn(summary, 'files'), false);
  assert.equal(JSON.stringify(summary).includes('secret'), false);
  assert.equal(JSON.stringify(summary).includes('parts/Pin.js'), false);
  assert.equal(JSON.stringify(summary).includes('return 1'), false);

  const shaped = gitOpResult(host, { commandName: 'git_upgrade_vault' });
  assert.equal(shaped.error, undefined);
  assert.deepEqual(shaped.result, summary);
  assert.equal(Object.hasOwn(shaped.result, 'plan'), false);
});

test('git_upgrade_vault consent prompt names the vault', () => {
  const text = agentGitConsentPrompt('git_upgrade_vault', 'acme/vault', 'main');
  assert.match(text, /upgrade the vault on acme\/vault\/main/);
});

test('git_save conflict and repo-moved are typed errors without path fields', () => {
  const conflict = gitOpResult({
    status: 'conflict',
    code: 'conflict',
    error: 'Save overlaps the remote tip',
    hint: 'git_behind_resolve { action: "reload", confirm: true }',
    files: ['parts/x.js'],
    paths: ['parts/x.js'],
  }, { commandName: 'git_save' });
  assert.equal(conflict.error?.code, 'conflict');
  assert.match(conflict.error?.hint || '', /git_behind_resolve/);
  assert.equal(JSON.stringify(conflict).includes('parts/'), false);
  assert.equal(conflict.result, undefined);

  const moved = gitOpResult({
    status: 'repo-moved',
    code: 'repo-moved',
    error: 'The vault repo moved',
    files: ['assemblies/Box/.surf.json'],
  }, { commandName: 'git_save' });
  assert.equal(moved.error?.code, 'repo-moved');
  assert.equal(JSON.stringify(moved).includes('assemblies/'), false);
});

test('git_save host conflict is an envelope error', async () => {
  const out = await gitSaveCommand.run({
    readAgentGitAdapterKind: () => 'mock',
    agentGitSave: async () => ({
      status: 'conflict',
      code: 'conflict',
      error: 'Save overlaps the remote tip',
      hint: 'git_force_overwrite or git_behind_resolve',
      files: ['parts/x.js'],
    }),
  }, { message: 'Save' });
  assert.equal(out.error?.code, 'conflict');
  assert.equal(JSON.stringify(out).includes('parts/'), false);
});

test('git_save pending_save stays a result without path fields', async () => {
  const out = await gitSaveCommand.run({
    readAgentGitAdapterKind: () => 'mock',
    agentGitSave: async () => ({
      status: 'pending',
      code: 'pending_save',
      message: 'Save queued until online',
      files: ['parts/x.js'],
    }),
  }, { message: 'Save' });
  assert.equal(out.error, undefined);
  assert.equal(out.result?.status, 'pending');
  assert.equal(out.result?.code, 'pending_save');
  assert.equal(Object.hasOwn(out.result, 'files'), false);
});

test('git_list_branches allowed on real adapter without opt-in', async () => {
  const ctx = {
    readAgentGitAdapterKind: () => 'real',
    readAgentGitRealOptIn: () => false,
    agentGitListBranches: async () => ({ status: 'ok', branches: [] }),
  };
  const out = await gitListBranchesCommand.run(ctx, {});
  assert.equal(out.result?.status, 'ok');
});

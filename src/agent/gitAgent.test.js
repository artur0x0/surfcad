import test from 'node:test';
import assert from 'node:assert/strict';
import {
  requireDestructiveConfirm,
  agentGitRealOptIn,
  agentGitRealWriteBlocked,
  agentGitConsentPrompt,
  gitOpResult,
  AGENT_GIT_REAL_SESSION_KEY,
} from './gitAgent.js';
import {
  gitBranchCreateCommand,
  gitBranchDeleteCommand,
  gitListBranchesCommand,
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
    readAgentGitWriteTarget: () => ({ repo: 'o/r', branch: 'main' }),
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
    readAgentGitWriteTarget: () => ({ repo: 'o/r', branch: 'main' }),
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
  assert.match(out.error?.message || '', /o\/r\/main/);
  assert.deepEqual(prompts, [{ command: 'git_save', repo: 'o/r', branch: 'main' }]);
});

test('git_save runs on retry after session allow', async () => {
  let saved = false;
  let allowed = false;
  const ctx = {
    readAgentGitAdapterKind: () => 'real',
    readAgentGitRealOptIn: () => allowed,
    readAgentGitSessionDenied: () => false,
    readAgentGitWriteTarget: () => ({ repo: 'o/r', branch: 'main' }),
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

test('gitOpResult treats upgrade_required and conflict as errors with hints', () => {
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
  });
  assert.equal(conflict.error?.code, 'conflict');
  assert.equal(conflict.error?.hint, 'Retry Upgrade vault');
});

test('gitOpResult passes already_upgraded and upgraded through as success', () => {
  assert.equal(gitOpResult({ status: 'already_upgraded' }).result?.status, 'already_upgraded');
  assert.equal(gitOpResult({ status: 'upgraded', sha: 'abc' }).result?.sha, 'abc');
  assert.equal(gitOpResult({ status: 'already_upgraded' }).error, undefined);
});

test('git_upgrade_vault consent prompt names the vault', () => {
  const text = agentGitConsentPrompt('git_upgrade_vault', 'acme/vault', 'main');
  assert.match(text, /upgrade the vault on acme\/vault\/main/);
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

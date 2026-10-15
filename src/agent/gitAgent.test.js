import test from 'node:test';
import assert from 'node:assert/strict';
import {
  requireDestructiveConfirm,
  agentGitRealOptIn,
  agentGitRealWriteBlocked,
} from './gitAgent.js';
import {
  gitBranchDeleteCommand,
  gitListBranchesCommand,
  gitSaveCommand,
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

test('agentGitRealOptIn reads query and storage', () => {
  assert.equal(agentGitRealOptIn({ location: { search: '' }, localStorage: { getItem: () => null } }), false);
  assert.equal(agentGitRealOptIn({
    location: { search: '?agent=1&agentGit=real' },
    localStorage: { getItem: () => null },
  }), true);
  assert.equal(agentGitRealOptIn({
    location: { search: '' },
    localStorage: { getItem: (k) => (k === 'surfcadAgentGitReal' ? '1' : null) },
  }), true);
});

test('agentGitRealWriteBlocked refuses real adapter without opt-in', () => {
  assert.equal(agentGitRealWriteBlocked('mock', false), null);
  assert.equal(agentGitRealWriteBlocked('real', true), null);
  const blocked = agentGitRealWriteBlocked('real', false);
  assert.equal(blocked?.code, 'real_repo_blocked');
});

test('git_save blocked on real adapter without opt-in', async () => {
  const ctx = {
    readAgentGitAdapterKind: () => 'real',
    readAgentGitRealOptIn: () => false,
    agentGitSave: async () => ({ status: 'committed' }),
  };
  const out = await gitSaveCommand.run(ctx, { message: 'test' });
  assert.equal(out.error?.code, 'real_repo_blocked');
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

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  requireDestructiveConfirm,
  agentGitRealOptIn,
  agentGitRealWriteBlocked,
  agentGitConsentPrompt,
  AGENT_GIT_REAL_SESSION_KEY,
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
  const ctx = {
    readAgentGitAdapterKind: () => 'real',
    readAgentGitRealOptIn: () => false,
    readAgentGitSessionDenied: () => false,
    readAgentGitWriteTarget: () => ({ repo: 'o/r', branch: 'main' }),
    requestAgentGitWriteConsent: async () => 'timeout',
    agentGitSave: async () => ({ status: 'committed' }),
  };
  const out = await gitSaveCommand.run(ctx, { message: 'test' });
  assert.equal(out.error?.code, 'real_repo_blocked');
  assert.equal(out.error?.details?.reason, 'consent_pending');
});

test('git_save runs after session allow', async () => {
  let saved = false;
  const ctx = {
    readAgentGitAdapterKind: () => 'real',
    readAgentGitRealOptIn: () => false,
    readAgentGitSessionDenied: () => false,
    readAgentGitWriteTarget: () => ({ repo: 'o/r', branch: 'main' }),
    requestAgentGitWriteConsent: async () => 'allow',
    agentGitSave: async () => {
      saved = true;
      return { status: 'committed' };
    },
  };
  const out = await gitSaveCommand.run(ctx, { message: 'test' });
  assert.equal(saved, true);
  assert.equal(out.result?.status, 'committed');
});

test('git_save consent_declined when user denies', async () => {
  const ctx = {
    readAgentGitAdapterKind: () => 'real',
    readAgentGitRealOptIn: () => false,
    readAgentGitSessionDenied: () => false,
    readAgentGitWriteTarget: () => ({ repo: 'o/r', branch: 'main' }),
    requestAgentGitWriteConsent: async () => 'deny',
    agentGitSave: async () => ({ status: 'committed' }),
  };
  const out = await gitSaveCommand.run(ctx, { message: 'test' });
  assert.equal(out.error?.code, 'real_repo_blocked');
  assert.equal(out.error?.details?.reason, 'consent_declined');
});

test('git_save skips consent when session already denied', async () => {
  const ctx = {
    readAgentGitAdapterKind: () => 'real',
    readAgentGitRealOptIn: () => false,
    readAgentGitSessionDenied: () => true,
    requestAgentGitWriteConsent: async () => {
      throw new Error('should not show modal');
    },
    agentGitSave: async () => ({ status: 'committed' }),
  };
  const out = await gitSaveCommand.run(ctx, { message: 'test' });
  assert.equal(out.error?.details?.reason, 'consent_declined');
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

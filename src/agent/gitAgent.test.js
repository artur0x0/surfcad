import test from 'node:test';
import assert from 'node:assert/strict';
import { requireDestructiveConfirm } from './gitAgent.js';
import { gitBranchDeleteCommand } from './commands/git.js';

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

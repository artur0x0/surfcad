import {
  requireDestructiveConfirm,
  gitOpResult,
  agentGitRealWriteBlocked,
} from '../gitAgent.js';
import { NO_ARGS_SCHEMA } from '../registry.js';

function assertAgentGitWrite(ctx) {
  const kind = typeof ctx.readAgentGitAdapterKind === 'function'
    ? ctx.readAgentGitAdapterKind()
    : null;
  const optedIn = typeof ctx.readAgentGitRealOptIn === 'function'
    ? ctx.readAgentGitRealOptIn() === true
    : false;
  const blocked = agentGitRealWriteBlocked(kind, optedIn);
  if (blocked) return { error: blocked };
  return null;
}

async function hostGit(ctx, name, args, { readOnly = false } = {}) {
  if (!readOnly) {
    const gate = assertAgentGitWrite(ctx);
    if (gate) return gate;
  }
  const fn = ctx[name];
  if (typeof fn !== 'function') {
    return { error: { code: 'internal', message: `${name} handler is missing` } };
  }
  const out = await fn(args);
  if (out && typeof out === 'object' && out.error != null && typeof out.error === 'object') {
    return { error: out.error };
  }
  const shaped = gitOpResult(out?.result ?? out);
  if (shaped.error) return shaped;
  return shaped;
}

export const gitMoveToRepoCommand = Object.freeze({
  name: 'git_move_to_repo',
  uiEntry: 'data-git-move-open',
  schema: Object.freeze({
    type: 'object',
    additionalProperties: false,
    properties: {
      vault_name: { type: 'string', description: 'New vault repo name (local assembly only)' },
    },
  }),
  example: { vault_name: 'my-vault' },
  async run(ctx, args) {
    return hostGit(ctx, 'agentGitMoveToRepo', args || {});
  },
});

export const gitSaveCommand = Object.freeze({
  name: 'git_save',
  uiEntry: ['data-git-save', 'data-git-commit-confirm'],
  schema: Object.freeze({
    type: 'object',
    additionalProperties: false,
    required: ['message'],
    properties: {
      message: { type: 'string', description: 'Commit message (Save to current branch)' },
    },
  }),
  example: { message: 'Update bracket' },
  checkArgs(args) {
    const message = typeof args?.message === 'string' ? args.message.trim() : '';
    if (!message) return { code: 'bad_args', message: 'git_save needs a non-empty message' };
    return null;
  },
  async run(ctx, args) {
    const message = String(args?.message || '').trim();
    return hostGit(ctx, 'agentGitSave', { message });
  },
});

export const gitAddToRepoCommand = Object.freeze({
  name: 'git_add_to_repo',
  uiEntry: 'data-git-commit-add-to-repo',
  schema: Object.freeze({
    type: 'object',
    additionalProperties: false,
    required: ['part_id'],
    properties: {
      part_id: { type: 'string', description: 'Part row id to add under the vault layout' },
    },
  }),
  example: { part_id: 'parts/Bracket.js' },
  checkArgs(args) {
    if (!args?.part_id || typeof args.part_id !== 'string') {
      return { code: 'bad_args', message: 'git_add_to_repo needs part_id' };
    }
    return null;
  },
  async run(ctx, args) {
    return hostGit(ctx, 'agentGitAddToRepo', { partId: args.part_id });
  },
});

export const gitBehindResolveCommand = Object.freeze({
  name: 'git_behind_resolve',
  uiEntry: ['data-git-behind-keep', 'data-git-behind-reload', 'data-git-behind-branch'],
  schema: Object.freeze({
    type: 'object',
    additionalProperties: false,
    required: ['action'],
    properties: {
      action: {
        type: 'string',
        enum: ['keep', 'reload', 'branch'],
        description: 'Get latest choice: keep mine, reload remote, or park mine on a branch',
      },
      path: { type: 'string', description: 'Vault path (assembly or part file)' },
      kind: { type: 'string', enum: ['part', 'assembly'], description: 'Defaults from path when omitted' },
    },
  }),
  example: { action: 'keep', path: 'assemblies/demo.surf.json', kind: 'assembly' },
  checkArgs(args) {
    const action = args?.action;
    if (action !== 'keep' && action !== 'reload' && action !== 'branch') {
      return { code: 'bad_args', message: 'git_behind_resolve action must be keep, reload, or branch' };
    }
    if ((action === 'reload' || action === 'branch') && !args?.path) {
      return { code: 'bad_args', message: 'git_behind_resolve needs path for reload or branch' };
    }
    return null;
  },
  async run(ctx, args) {
    if (args.action === 'reload' || args.action === 'branch') {
      const gate = requireDestructiveConfirm(args, `git_behind_resolve ${args.action}`);
      if (gate) return { error: gate };
    }
    return hostGit(ctx, 'agentGitBehindResolve', {
      action: args.action,
      path: args.path,
      kind: args.kind,
    });
  },
});

export const gitBranchCreateCommand = Object.freeze({
  name: 'git_branch_create',
  uiEntry: ['data-git-branch-action-create', 'data-git-branch-create-confirm'],
  schema: Object.freeze({
    type: 'object',
    additionalProperties: false,
    required: ['name'],
    properties: {
      name: { type: 'string' },
    },
  }),
  example: { name: 'feature/agent-h12' },
  checkArgs(args) {
    const name = typeof args?.name === 'string' ? args.name.trim() : '';
    if (!name) return { code: 'bad_args', message: 'git_branch_create needs name' };
    return null;
  },
  async run(ctx, args) {
    return hostGit(ctx, 'agentGitBranchCreate', { name: String(args.name).trim() });
  },
});

export const gitBranchSwitchCommand = Object.freeze({
  name: 'git_branch_switch',
  uiEntry: ['data-git-branches', 'data-git-branch-confirm'],
  schema: Object.freeze({
    type: 'object',
    additionalProperties: false,
    required: ['branch'],
    properties: {
      branch: { type: 'string' },
      confirm: {
        type: 'boolean',
        description: 'Required true when the working copy has uncommitted changes',
      },
    },
  }),
  example: { branch: 'main' },
  checkArgs(args) {
    if (!args?.branch || typeof args.branch !== 'string') {
      return { code: 'bad_args', message: 'git_branch_switch needs branch' };
    }
    return null;
  },
  async run(ctx, args) {
    return hostGit(ctx, 'agentGitBranchSwitch', {
      branch: args.branch,
      confirm: args?.confirm === true,
    });
  },
});

export const gitBranchDeleteCommand = Object.freeze({
  name: 'git_branch_delete',
  uiEntry: 'data-git-branch-delete-confirm',
  schema: Object.freeze({
    type: 'object',
    additionalProperties: false,
    required: ['branch'],
    properties: {
      branch: { type: 'string' },
      confirm: { type: 'boolean', description: 'Must be true' },
    },
  }),
  example: { branch: 'feature/old', confirm: true },
  checkArgs(args) {
    if (!args?.branch || typeof args.branch !== 'string') {
      return { code: 'bad_args', message: 'git_branch_delete needs branch' };
    }
    const gate = requireDestructiveConfirm(args, 'git_branch_delete');
    if (gate) return gate;
    return null;
  },
  async run(ctx, args) {
    return hostGit(ctx, 'agentGitBranchDelete', { branch: args.branch });
  },
});

export const gitForceOverwriteCommand = Object.freeze({
  name: 'git_force_overwrite',
  uiEntry: ['data-git-force-merge', 'data-git-conflict-overwrite'],
  schema: Object.freeze({
    type: 'object',
    additionalProperties: false,
    properties: {
      confirm: { type: 'boolean', description: 'Must be true' },
    },
  }),
  example: { confirm: true },
  checkArgs(args) {
    const gate = requireDestructiveConfirm(args, 'git_force_overwrite');
    if (gate) return gate;
    return null;
  },
  async run(ctx) {
    return hostGit(ctx, 'agentGitForceOverwrite', {});
  },
});

export const gitListBranchesCommand = Object.freeze({
  name: 'git_list_branches',
  uiEntry: 'data-git-branches',
  schema: NO_ARGS_SCHEMA,
  example: {},
  immediate: true,
  async run(ctx) {
    return hostGit(ctx, 'agentGitListBranches', {}, { readOnly: true });
  },
});

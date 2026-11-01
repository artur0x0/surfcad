import {
  consentPendingError,
  refuseAgentSaveOnMain,
  requireDestructiveConfirm,
  gitOpResult,
  realRepoBlockedError,
} from '../gitAgent.js';
import { NO_ARGS_SCHEMA } from '../registry.js';
/** How long the in-app consent modal stays up. Bridge calls never wait on it. */
export const AGENT_GIT_CONSENT_TIMEOUT_MS = 120_000;

/**
 * How long git_save waits for the host before answering `running`. MCP
 * clients give up at about 60 s and the bridge runs commands on one
 * chain, so a save that is still talking to GitHub after this budget is
 * handed back as `{ status: 'running', saveId }` and finished by
 * git_save_status { save_id }. The save itself keeps going. Tests shorten
 * the budget through `globalThis.__SURFCAD_AGENT_GIT_SAVE_WAIT_MS`.
 */
export const AGENT_GIT_SAVE_WAIT_MS = 20_000;
/** Finished saves stay readable this long after they end. */
const SAVE_RECORD_TTL_MS = 10 * 60_000;

function saveWaitMs() {
  const override = Number(globalThis.__SURFCAD_AGENT_GIT_SAVE_WAIT_MS);
  return Number.isFinite(override) && override >= 0 ? override : AGENT_GIT_SAVE_WAIT_MS;
}

/** saveId -> { saveId, message, startedAt, done, finishedAt, outcome } for saves that outlived the budget. */
const runningSaves = new Map();
let saveSeq = 0;

function pruneSaves(now = Date.now()) {
  for (const [id, entry] of runningSaves) {
    if (entry.done && now - entry.finishedAt > SAVE_RECORD_TTL_MS) runningSaves.delete(id);
  }
}

/** Test hook: forget every recorded save. */
export function _resetRunningSaves() {
  runningSaves.clear();
}

export const SAVE_RUNNING_MESSAGE = 'Save is still running (GitHub round trips); poll git_save_status { save_id } until it answers with the save result.';

function runningResult(entry, now = Date.now()) {
  return {
    result: {
      status: 'running',
      saveId: entry.saveId,
      elapsedMs: now - entry.startedAt,
      message: SAVE_RUNNING_MESSAGE,
    },
  };
}

/**
 * Run the host save; if it is still going after the budget, record it and
 * answer `running`. The host promise is awaited either way, so a late
 * failure lands in the record, never as an unhandled rejection.
 */
async function saveWithBudget(work, message) {
  const startedAt = Date.now();
  saveSeq += 1;
  const entry = { saveId: `save-${saveSeq}-${startedAt.toString(36)}`, message, startedAt, done: false, finishedAt: 0, outcome: null };
  const settled = work.then(
    (out) => { entry.done = true; entry.finishedAt = Date.now(); entry.outcome = out; return out; },
    (err) => {
      entry.done = true;
      entry.finishedAt = Date.now();
      entry.outcome = { error: { code: 'internal', message: String(err?.message || err) } };
      return entry.outcome;
    },
  );
  let timer = null;
  const budget = new Promise((resolve) => { timer = setTimeout(() => resolve(null), saveWaitMs()); });
  const first = await Promise.race([settled.then(() => entry), budget]);
  if (timer) clearTimeout(timer);
  if (first === entry) return entry.outcome;
  pruneSaves();
  runningSaves.set(entry.saveId, entry);
  return runningResult(entry);
}

/**
 * Returns null when the agent may write, else a structured refusal. Never
 * awaits the user: an interactive tab shows the modal and the call returns
 * `consent_pending` at once, so the MCP client can retry after Allow.
 */
export function ensureAgentGitWriteConsent(ctx, commandName) {
  const kind = typeof ctx.readAgentGitAdapterKind === 'function'
    ? ctx.readAgentGitAdapterKind()
    : null;
  if (kind !== 'real') return null;
  const optedIn = typeof ctx.readAgentGitRealOptIn === 'function'
    ? ctx.readAgentGitRealOptIn() === true
    : false;
  if (optedIn) return null;

  if (typeof ctx.readAgentGitSessionDenied === 'function' && ctx.readAgentGitSessionDenied() === true) {
    return realRepoBlockedError(
      'consent_declined',
      'You declined agent git writes for this browser session.',
    );
  }

  const prompt = ctx.promptAgentGitWriteConsent;
  const target = typeof ctx.readAgentGitWriteTarget === 'function'
    ? ctx.readAgentGitWriteTarget()
    : { repo: 'your repo', branch: 'main' };
  const shown = typeof prompt === 'function'
    ? prompt({ command: commandName, ...target })
    : 'unavailable';
  if (shown === 'shown') return consentPendingError(commandName, target);
  return realRepoBlockedError(
    'consent_pending',
    'Agent git write consent is unavailable headless (playtest / automation). Open SurfCAD in a regular Chrome tab and retry, or opt in with ?agentGit=real.',
  );
}

async function hostGit(ctx, name, args, { readOnly = false, commandName = '' } = {}) {
  if (!readOnly && name === 'agentGitSave') {
    const target = typeof ctx.readAgentGitWriteTarget === 'function'
      ? ctx.readAgentGitWriteTarget()
      : null;
    const onMain = refuseAgentSaveOnMain(target);
    if (onMain) return onMain;
  }
  if (!readOnly) {
    const gate = ensureAgentGitWriteConsent(ctx, commandName || name);
    if (gate) return { error: gate };
  }
  const fn = ctx[name];
  if (typeof fn !== 'function') {
    return { error: { code: 'internal', message: `${name} handler is missing` } };
  }
  const out = await fn(args);
  if (out && typeof out === 'object' && out.error != null && typeof out.error === 'object') {
    return { error: out.error };
  }
  const shaped = gitOpResult(out?.result ?? out, { commandName: commandName || name });
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
    return hostGit(ctx, 'agentGitMoveToRepo', args || {}, { commandName: 'git_move_to_repo' });
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
    return saveWithBudget(hostGit(ctx, 'agentGitSave', { message }, { commandName: 'git_save' }), message);
  },
});

/**
 * The outcome of a git_save that answered `running`: the same result or
 * error git_save would have returned, or `running` again. Immediate, so it
 * answers while the save is still on the wire.
 */
export const gitSaveStatusCommand = Object.freeze({
  name: 'git_save_status',
  schema: Object.freeze({
    type: 'object',
    additionalProperties: false,
    required: ['save_id'],
    properties: {
      save_id: { type: 'string', description: 'saveId from a git_save that answered status running' },
    },
  }),
  example: { save_id: 'save-1-abc' },
  immediate: true,
  checkArgs(args) {
    const id = typeof args?.save_id === 'string' ? args.save_id.trim() : '';
    if (!id) return { code: 'bad_args', message: 'git_save_status needs save_id' };
    return null;
  },
  run(ctx, args) {
    const id = String(args?.save_id || '').trim();
    pruneSaves();
    const entry = runningSaves.get(id);
    if (!entry) {
      return { error: { code: 'unknown_save', message: `No running or recent save ${id}; git_save answers its result directly when it finishes within the budget.` } };
    }
    if (!entry.done) return runningResult(entry);
    const out = entry.outcome;
    if (out && out.result && typeof out.result === 'object' && !Array.isArray(out.result)) {
      return { result: { ...out.result, saveId: entry.saveId } };
    }
    return out;
  },
});

export const gitUpgradeVaultCommand = Object.freeze({
  name: 'git_upgrade_vault',
  schema: Object.freeze({
    type: 'object',
    additionalProperties: false,
    properties: {
      confirm: {
        type: 'boolean',
        description: 'Must be true when a vault upgrade step is registered for this version. The current version returns already_upgraded without it.',
      },
    },
  }),
  example: { confirm: true },
  checkArgs() {
    return null;
  },
  async run(ctx, args) {
    return hostGit(ctx, 'agentGitUpgradeVault', { confirm: args?.confirm === true }, { commandName: 'git_upgrade_vault' });
  },
});

export const gitAddToRepoCommand = Object.freeze({
  name: 'git_add_to_repo',
  uiEntry: ['data-git-commit-add-to-repo', 'data-part-add-to-repo'],
  schema: Object.freeze({
    type: 'object',
    additionalProperties: false,
    required: ['message'],
    properties: {
      message: { type: 'string', description: 'Commit message. Alias of git_save; prefer git_save.' },
    },
  }),
  example: { message: 'Add to repo' },
  checkArgs(args) {
    const message = typeof args?.message === 'string' ? args.message.trim() : '';
    if (!message) return { code: 'bad_args', message: 'git_add_to_repo needs a non-empty message' };
    return null;
  },
  async run(ctx, args) {
    const message = String(args?.message || '').trim();
    return hostGit(ctx, 'agentGitSave', { message }, { commandName: 'git_add_to_repo' });
  },
});

export const gitBehindResolveCommand = Object.freeze({
  name: 'git_behind_resolve',
  uiEntry: ['data-git-behind-reload', 'data-git-behind-branch'],
  schema: Object.freeze({
    type: 'object',
    additionalProperties: false,
    required: ['action'],
    properties: {
      action: {
        type: 'string',
        enum: ['reload', 'branch'],
        description: 'reload = Get latest (no git write). branch = Create a new branch (save-time git write). keep is removed.',
      },
      confirm: { type: 'boolean', description: 'Must be true.' },
    },
  }),
  example: { action: 'reload', confirm: true },
  checkArgs(args) {
    const action = args?.action;
    if (action !== 'reload' && action !== 'branch') {
      return { code: 'bad_args', message: 'git_behind_resolve action must be reload or branch' };
    }
    return requireDestructiveConfirm(args, `git_behind_resolve ${action}`);
  },
  async run(ctx, args) {
    const gate = requireDestructiveConfirm(args, `git_behind_resolve ${args.action}`);
    if (gate) return { error: gate };
    return hostGit(ctx, 'agentGitBehindResolve', {
      action: args.action,
    }, { commandName: 'git_behind_resolve' });
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
      name: {
        type: 'string',
        description: 'New branch name. Created from the current tip; the session switches to it when the working copy is clean.',
      },
    },
  }),
  example: { name: 'feature/agent-h12' },
  checkArgs(args) {
    const name = typeof args?.name === 'string' ? args.name.trim() : '';
    if (!name) return { code: 'bad_args', message: 'git_branch_create needs name' };
    return null;
  },
  async run(ctx, args) {
    return hostGit(ctx, 'agentGitBranchCreate', { name: String(args.name).trim() }, { commandName: 'git_branch_create' });
  },
});

export const gitBranchSwitchCommand = Object.freeze({
  name: 'git_branch_switch',
  uiEntry: [
    'data-git-branches',
    'data-git-branch-confirm',
    'data-git-branch-switch-use-local',
    'data-git-branch-switch-use-remote',
  ],
  schema: Object.freeze({
    type: 'object',
    additionalProperties: false,
    required: ['branch'],
    properties: {
      branch: { type: 'string' },
      choice: {
        type: 'string',
        enum: ['use_local', 'use_remote'],
        description: 'Branch-switch conflict choice. use_local keeps the working copy. use_remote loads the target. Neither writes git. Both require confirm: true. Omit to preview; a file conflict returns status conflict and does not switch.',
      },
      confirm: {
        type: 'boolean',
        description: 'Required true when the working copy has uncommitted changes, and for choice use_local or use_remote',
      },
    },
  }),
  example: { branch: 'main' },
  checkArgs(args) {
    if (!args?.branch || typeof args.branch !== 'string') {
      return { code: 'bad_args', message: 'git_branch_switch needs branch' };
    }
    if (args.choice != null && args.choice !== 'use_local' && args.choice !== 'use_remote') {
      return { code: 'bad_args', message: 'git_branch_switch choice must be use_local or use_remote' };
    }
    if (args.choice === 'use_local' || args.choice === 'use_remote') {
      return requireDestructiveConfirm(args, `git_branch_switch ${args.choice}`);
    }
    return null;
  },
  async run(ctx, args) {
    return hostGit(ctx, 'agentGitBranchSwitch', {
      branch: args.branch,
      confirm: args?.confirm === true,
      choice: args.choice,
    }, { commandName: 'git_branch_switch' });
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
    return hostGit(ctx, 'agentGitBranchDelete', { branch: args.branch }, { commandName: 'git_branch_delete' });
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
    return hostGit(ctx, 'agentGitForceOverwrite', {}, { commandName: 'git_force_overwrite' });
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

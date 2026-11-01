/**
 * Shared helpers for H12 git bridge commands (confirm gates, result shaping).
 */

/** localStorage `1` opts agent git writes into a signed-in (real) vault. */
export const AGENT_GIT_REAL_STORAGE_KEY = 'surfcadAgentGitReal';
/** sessionStorage `1` — Allow for this session (consent modal). */
export const AGENT_GIT_REAL_SESSION_KEY = 'surfcadAgentGitRealSession';
/** sessionStorage `1` — user denied; do not show the modal again this session. */
export const AGENT_GIT_DENIED_SESSION_KEY = 'surfcadAgentGitDenied';

const sessionStore = (env) => {
  if (Object.prototype.hasOwnProperty.call(env, 'sessionStorage')) return env.sessionStorage;
  return typeof sessionStorage !== 'undefined' ? sessionStorage : null;
};

export function agentGitSessionDenied(env = {}) {
  const store = sessionStore(env);
  try {
    return !!(store && typeof store.getItem === 'function'
      && store.getItem(AGENT_GIT_DENIED_SESSION_KEY) === '1');
  } catch {
    return false;
  }
}

export function agentGitSetSessionDenied(env = {}) {
  const store = sessionStore(env);
  try {
    store?.setItem?.(AGENT_GIT_DENIED_SESSION_KEY, '1');
  } catch { /* private mode */ }
}

export function agentGitSetSessionAllow(env = {}) {
  const store = sessionStore(env);
  try {
    store?.setItem?.(AGENT_GIT_REAL_SESSION_KEY, '1');
    store?.removeItem?.(AGENT_GIT_DENIED_SESSION_KEY);
  } catch { /* private mode */ }
}

export function agentGitConsentInteractive(env = {}) {
  if (env.interactive === false) return false;
  if (env.interactive === true) return true;
  try {
    if (typeof navigator !== 'undefined' && navigator.webdriver) return false;
  } catch { /* ignore */ }
  return typeof document !== 'undefined';
}

export function agentGitConsentVerb(commandName) {
  switch (commandName) {
    case 'git_save': return 'save to';
    case 'git_upgrade_vault': return 'upgrade the vault on';
    case 'git_move_to_repo': return 'move this assembly to';
    case 'git_add_to_repo': return 'add a part to';
    case 'git_behind_resolve': return 'sync';
    case 'git_branch_create': return 'create a branch on';
    case 'git_branch_switch': return 'switch branch on';
    case 'git_branch_delete': return 'delete a branch on';
    case 'git_force_overwrite': return 'overwrite the remote for';
    case 'rename_part': return 'rename a part in';
    default: return 'write to';
  }
}

export function agentGitConsentPrompt(commandName, repo, branch) {
  const verb = agentGitConsentVerb(commandName);
  const target = `${repo || 'your repo'}/${branch || 'main'}`;
  return `An agent wants to ${verb} ${target}. Allow agent writes to your GitHub repos for this session?`;
}

/** Suggested wait before an agent retries a write that is waiting on consent. */
export const AGENT_GIT_CONSENT_RETRY_MS = 3000;

/**
 * git_save / git_add_to_repo on a checkout of `main`. The host returns this
 * as both message and hint so a published surfcad-mcp keeps it (a host hint
 * wins) and the agent sees the next call without a package publish.
 */
export const AGENT_SAVE_ON_MAIN_MESSAGE = 'git_save does not commit on main. Nothing was written. Create a branch first with git_branch_create { name }, then git_save { message } on that branch.';

/**
 * Refusal for an agent save whose session is checked out on main.
 * A missing checkout (`checkedOut` not true) is not main: the branch label
 * falls back to "main" before any vault branch is checked out.
 * No bypass argument. Returns null when the save may proceed.
 * @param {{ branch?: string, checkedOut?: boolean } | null | undefined} target
 * @returns {{ error: { code: string, message: string, hint: string } } | null}
 */
export function refuseAgentSaveOnMain(target) {
  if (!target || target.checkedOut !== true || target.branch !== 'main') return null;
  return {
    error: {
      code: 'save_on_main',
      message: AGENT_SAVE_ON_MAIN_MESSAGE,
      hint: AGENT_SAVE_ON_MAIN_MESSAGE,
    },
  };
}

/**
 * The consent modal is up in the tab; nothing was written. The agent should
 * ask the user to click Allow, then call the same command again.
 */
export function consentPendingError(commandName, target = {}) {
  const where = `${target.repo || 'your repo'}/${target.branch || 'main'}`;
  return {
    code: 'consent_pending',
    message: `Waiting for the user to allow agent git writes to ${where} in the SurfCAD tab. Nothing was written. Retry ${commandName || 'this call'} after they click Allow.`,
    details: {
      reason: 'consent_pending',
      command: commandName || null,
      retry: true,
      retry_after_ms: AGENT_GIT_CONSENT_RETRY_MS,
    },
  };
}

export function realRepoBlockedError(reason, message) {
  return {
    code: 'real_repo_blocked',
    message,
    details: { reason },
  };
}

/**
 * @param {{ dev?: boolean, location?: { search?: string } | null, localStorage?: { getItem?: (key: string) => string | null } | null }} [env]
 */
export function agentGitRealOptIn(env = {}) {
  const loc = Object.prototype.hasOwnProperty.call(env, 'location')
    ? env.location
    : (typeof location !== 'undefined' ? location : null);
  const store = Object.prototype.hasOwnProperty.call(env, 'localStorage')
    ? env.localStorage
    : (typeof localStorage !== 'undefined' ? localStorage : null);
  let query = false;
  try {
    const search = loc && typeof loc.search === 'string' ? loc.search : '';
    query = new URLSearchParams(search).get('agentGit') === 'real';
  } catch {
    query = false;
  }
  let stored = false;
  let session = false;
  try {
    stored = !!(store && typeof store.getItem === 'function'
      && store.getItem(AGENT_GIT_REAL_STORAGE_KEY) === '1');
  } catch {
    stored = false;
  }
  const sess = sessionStore(env);
  try {
    session = !!(sess && typeof sess.getItem === 'function'
      && sess.getItem(AGENT_GIT_REAL_SESSION_KEY) === '1');
  } catch {
    session = false;
  }
  return query || stored || session;
}

/**
 * Block agent-initiated git writes when the live adapter is GitHub (real).
 * @param {'mock'|'real'|string|null|undefined} adapterKind
 * @param {boolean} [optedIn]
 * @returns {{ code: string, message: string } | null}
 */
export function agentGitRealWriteBlocked(adapterKind, optedIn = false, sessionDenied = false) {
  if (adapterKind !== 'real' || optedIn === true) return null;
  if (sessionDenied) {
    return realRepoBlockedError(
      'consent_declined',
      'You declined agent git writes for this browser session.',
    );
  }
  return realRepoBlockedError(
    'consent_pending',
    'Agent git writes to a signed-in GitHub vault need consent in this tab (?agentGit=real, the consent dialog, or localStorage surfcadAgentGitReal=1).',
  );
}

export function requireDestructiveConfirm(args, label) {
  if (args?.confirm === true) return null;
  return {
    code: 'confirm_required',
    message: `${label} requires confirm: true`,
  };
}

/**
 * Agent-facing git_upgrade_vault payload: status, SHAs, assembly ids,
 * counts, leftover paths, warnings. No plan, file bytes, meshes,
 * partBindings paths, or rekey.scripts.
 */
export function summarizeUpgradeVaultResult(result) {
  if (!result || typeof result !== 'object') {
    return { status: 'error', error: 'No result' };
  }
  const plan = result.plan && typeof result.plan === 'object' ? result.plan : null;
  const leftoverFiles = Array.isArray(result.leftoverFiles)
    ? result.leftoverFiles.filter((path) => typeof path === 'string' && path)
    : (Array.isArray(plan?.leftoverFiles)
      ? plan.leftoverFiles.filter((path) => typeof path === 'string' && path)
      : []);
  const assemblyIds = Array.isArray(result.assemblyIds)
    ? result.assemblyIds.filter((id) => typeof id === 'string' && id)
    : (plan?.assemblies || []).map((row) => row?.id).filter((id) => typeof id === 'string' && id);
  const warnings = [];
  if (Array.isArray(result.warnings)) {
    for (const row of result.warnings) {
      if (typeof row === 'string' && row) warnings.push(row);
    }
  }
  if (plan?.readmeKept) warnings.push('README.md was not a known seed and was left in the vault');
  const out = { status: result.status || 'error' };
  if (typeof result.sha === 'string' && result.sha) out.sha = result.sha;
  if (typeof result.upgradeSha === 'string' && result.upgradeSha) out.upgradeSha = result.upgradeSha;
  if (typeof result.branch === 'string' && result.branch) out.branch = result.branch;
  if (typeof result.layout === 'string' && result.layout) out.layout = result.layout;
  if (Number.isInteger(result.commits)) out.commits = result.commits;
  if (assemblyIds.length) out.assemblyIds = assemblyIds;
  out.counts = {
    commits: Number.isInteger(result.commits) ? result.commits : 0,
    assemblies: assemblyIds.length,
    partsKept: Array.isArray(plan?.keptPartIds) ? plan.keptPartIds.length : 0,
    partsMinted: Array.isArray(plan?.mintedPartIds) ? plan.mintedPartIds.length : 0,
    files: Array.isArray(result.files) ? result.files.length : (Array.isArray(plan?.files) ? plan.files.length : 0),
    leftoverFiles: leftoverFiles.length,
  };
  if (leftoverFiles.length) out.leftoverFiles = leftoverFiles;
  if (warnings.length) out.warnings = warnings;
  return out;
}

const TYPED_CONFLICT_COMMANDS = new Set([
  'git_save',
  'git_add_to_repo',
  'git_force_overwrite',
  'git_behind_resolve',
]);

function stripGitPathFields(result) {
  if (!result || typeof result !== 'object') return result;
  const next = { ...result };
  delete next.files;
  delete next.paths;
  return next;
}

/**
 * Shape a host git result for the agent. `status: 'conflict'` is a real
 * payload for git_move_to_repo (paths / assemblyExists).
 * git_save / git_add_to_repo / git_force_overwrite / git_behind_resolve
 * map conflict and repo-moved to `{ error }` and omit path fields.
 *
 * @param {Record<string, unknown>} result
 * @param {{ commandName?: string }} [opts]
 */
export function gitOpResult(result, { commandName } = {}) {
  if (!result || typeof result !== 'object') {
    return { result: { status: 'error', error: 'No result' } };
  }
  const code = result.code;
  const upgradeFailed = result.status === 'unsupported_vault_version'
    || code === 'unsupported_vault_version'
    || result.status === 'upgrade_required'
    || result.status === 'upgrade_unavailable'
    || code === 'upgrade_required'
    || code === 'upgrade_unavailable';
  const upgradeConflict = commandName === 'git_upgrade_vault'
    && (result.status === 'conflict' || code === 'conflict');
  const typedConflict = TYPED_CONFLICT_COMMANDS.has(commandName)
    && (result.status === 'conflict' || result.status === 'repo-moved'
      || code === 'conflict' || code === 'repo-moved');
  if (result.status === 'error' || upgradeFailed || upgradeConflict || typedConflict) {
    const error = {
      code: code
        || (result.status === 'conflict' || result.status === 'repo-moved' ? result.status : 'git_error'),
      message: result.error || result.message || 'Git operation failed',
    };
    if (typeof result.hint === 'string' && result.hint) error.hint = result.hint;
    return { error };
  }
  if (commandName === 'git_upgrade_vault') {
    return { result: summarizeUpgradeVaultResult(result) };
  }
  if (TYPED_CONFLICT_COMMANDS.has(commandName)) {
    return { result: stripGitPathFields(result) };
  }
  return { result };
}

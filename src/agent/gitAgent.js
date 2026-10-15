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
    case 'git_move_to_repo': return 'move this assembly to';
    case 'git_add_to_repo': return 'add a part to';
    case 'git_behind_resolve': return 'sync';
    case 'git_branch_create': return 'create a branch on';
    case 'git_branch_switch': return 'switch branch on';
    case 'git_branch_delete': return 'delete a branch on';
    case 'git_force_overwrite': return 'overwrite the remote for';
    default: return 'write to';
  }
}

export function agentGitConsentPrompt(commandName, repo, branch) {
  const verb = agentGitConsentVerb(commandName);
  const target = `${repo || 'your repo'}/${branch || 'main'}`;
  return `An agent wants to ${verb} ${target}. Allow agent writes to your GitHub repos for this session?`;
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

/** @param {Record<string, unknown>} result */
export function gitOpResult(result) {
  if (!result || typeof result !== 'object') {
    return { result: { status: 'error', error: 'No result' } };
  }
  if (result.status === 'error') {
    return {
      error: {
        code: result.code || 'git_error',
        message: result.error || 'Git operation failed',
      },
    };
  }
  return { result };
}

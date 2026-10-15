/**
 * Shared helpers for H12 git bridge commands (confirm gates, result shaping).
 */

/** localStorage `1` opts agent git writes into a signed-in (real) vault. */
export const AGENT_GIT_REAL_STORAGE_KEY = 'surfcadAgentGitReal';

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
  try {
    stored = !!(store && typeof store.getItem === 'function'
      && store.getItem(AGENT_GIT_REAL_STORAGE_KEY) === '1');
  } catch {
    stored = false;
  }
  return query || stored;
}

/**
 * Block agent-initiated git writes when the live adapter is GitHub (real).
 * @param {'mock'|'real'|string|null|undefined} adapterKind
 * @param {boolean} [optedIn]
 * @returns {{ code: string, message: string } | null}
 */
export function agentGitRealWriteBlocked(adapterKind, optedIn = false) {
  if (adapterKind !== 'real' || optedIn === true) return null;
  return {
    code: 'real_repo_blocked',
    message: 'Agent git writes to a signed-in GitHub vault are disabled. Opt in with ?agentGit=real or localStorage surfcadAgentGitReal=1.',
  };
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

/**
 * Shared helpers for H12 git bridge commands (confirm gates, result shaping).
 */

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

// TEMPORARY: remove after Artur's vault is upgraded
/**
 * Upgrade vault is off in production. This build cannot open or save a v2
 * vault (that lands in a later PR), so writing v2 here would lock the user
 * out. Opt in only from the Vite dev server or from tests.
 *
 * Dev: `localStorage.surfcadUpgradeVault = '1'` or `VITE_SURFCAD_UPGRADE_VAULT=1`.
 * Those are ignored when `import.meta.env.DEV` is false (production / playtest
 * builds). Node's test runner (`NODE_TEST_CONTEXT`) turns the flag on so unit
 * tests exercise the planner without a browser.
 */
export const UPGRADE_VAULT_STORAGE_KEY = 'surfcadUpgradeVault';

function readVite(env) {
  if (env && Object.prototype.hasOwnProperty.call(env, 'vite')) return env.vite;
  try {
    return import.meta.env;
  } catch {
    return undefined;
  }
}

function viteFlagOn(vite) {
  const raw = String(vite?.VITE_SURFCAD_UPGRADE_VAULT || '').trim().toLowerCase();
  return raw === '1' || raw === 'true';
}

function isDevBuild(vite) {
  return vite?.DEV === true || vite?.MODE === 'development';
}

function localStorageOn(env) {
  try {
    const store = env && Object.prototype.hasOwnProperty.call(env, 'localStorage')
      ? env.localStorage
      : (typeof localStorage !== 'undefined' ? localStorage : null);
    return store && typeof store.getItem === 'function'
      && store.getItem(UPGRADE_VAULT_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function nodeTestRunner() {
  try {
    const env = globalThis.process?.env;
    return typeof env?.NODE_TEST_CONTEXT === 'string' && env.NODE_TEST_CONTEXT.length > 0;
  } catch {
    return false;
  }
}

/**
 * @param {{ enabled?: boolean, vite?: { DEV?: boolean, MODE?: string, VITE_SURFCAD_UPGRADE_VAULT?: string }, localStorage?: { getItem?: (key: string) => string | null } | null }} [env]
 */
export function upgradeVaultEnabled(env = {}) {
  if (env && Object.prototype.hasOwnProperty.call(env, 'enabled')) {
    return env.enabled === true;
  }
  const hasVite = !!(env && Object.prototype.hasOwnProperty.call(env, 'vite'));
  const vite = readVite(env);
  if (isDevBuild(vite) && (viteFlagOn(vite) || localStorageOn(env))) return true;
  // Node's test runner only when the caller did not pass a vite env (so
  // unit tests of the flag itself can still describe production).
  if (!hasVite && nodeTestRunner()) return true;
  return false;
}

export const UPGRADE_UNAVAILABLE = Object.freeze({
  status: 'error',
  code: 'upgrade_unavailable',
  error: 'Upgrade vault is not available in this build.',
  message: 'Upgrade vault is not available in this build.',
  hint: 'This SurfCAD build cannot open or save a v2 vault yet. Dev and tests can opt in with localStorage surfcadUpgradeVault=1 or VITE_SURFCAD_UPGRADE_VAULT=1.',
});

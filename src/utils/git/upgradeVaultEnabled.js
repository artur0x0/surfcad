// TEMPORARY: remove after Artur's vault is upgraded
/**
 * Upgrade vault is on in production. This build opens v2 vaults through
 * `openVaultAssembly` → `openV2Assembly` and saves them through
 * `handleGitCommit` → `handleV2PlanSave` / `executePlanSave` (save-model PR 7,
 * #614). Writing v2 no longer locks the user out of this app.
 *
 * Tests may still force the flag with `{ enabled: true | false }`.
 */
export const UPGRADE_VAULT_STORAGE_KEY = 'surfcadUpgradeVault';

/**
 * @param {{ enabled?: boolean }} [env]
 */
export function upgradeVaultEnabled(env = {}) {
  if (env && Object.prototype.hasOwnProperty.call(env, 'enabled')) {
    return env.enabled === true;
  }
  return true;
}

export const UPGRADE_UNAVAILABLE = Object.freeze({
  status: 'error',
  code: 'upgrade_unavailable',
  error: 'Upgrade vault is not available in this build.',
  message: 'Upgrade vault is not available in this build.',
  hint: 'Upgrade vault is disabled in this session.',
});

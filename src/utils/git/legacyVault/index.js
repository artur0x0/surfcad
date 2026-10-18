// TEMPORARY: remove after Artur's vault is upgraded
/**
 * Isolated v1 vault reader + Upgrade. The only public surface.
 * PR 10 deletes this folder.
 *
 * Import this entry point only — not `reader.js` / `detect.js` / `upgrade.js`.
 */
export { detectVaultLayout, isLegacyVaultTree, listLegacyAssemblyNames } from './detect.js';
export { openLegacyAssembly, listLegacyAssemblies, lastCommitBlobSources } from './reader.js';
export { isKnownReadmeSeed, knownReadmeSeedFor } from './knownReadmeSeeds.js';
export {
  UPGRADE_COMMIT_MESSAGE,
  UPGRADE_FOLLOWUP_MESSAGE,
  SURFCAD_JSON_V2,
  planUpgrade,
  planWorkingCopyFollowup,
  mapWorkingCopyToPlan,
  applyUpgradeReload,
  executeUpgrade,
  executeUpgradeFollowup,
  executeUpgradeConflictChoice,
} from './upgrade.js';

/** v2 open lands in a later PR. Do not fall through to the v1 reader. */
export class UnsupportedVaultLayoutError extends Error {
  constructor(layout = 'v2') {
    super(`Vault layout ${layout} is not yet implemented`);
    this.name = 'UnsupportedVaultLayoutError';
    this.code = 'unsupported_vault_version';
    this.layout = layout;
  }
}

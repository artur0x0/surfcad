// TEMPORARY: remove after Artur's vault is upgraded
/**
 * Isolated v1 vault reader. The only public surface: detect / open.
 * Upgrade (plan-upgrade) lands in PR 4. PR 10 deletes this folder.
 *
 * Import this entry point only — not `reader.js` / `detect.js`.
 */
export { detectVaultLayout, isLegacyVaultTree, listLegacyAssemblyNames } from './detect.js';
export { openLegacyAssembly, listLegacyAssemblies, lastCommitBlobSources } from './reader.js';

/** v2 open lands in a later PR. Do not fall through to the v1 reader. */
export class UnsupportedVaultLayoutError extends Error {
  constructor(layout = 'v2') {
    super(`Vault layout ${layout} is not yet implemented`);
    this.name = 'UnsupportedVaultLayoutError';
    this.code = 'unsupported_vault_version';
    this.layout = layout;
  }
}

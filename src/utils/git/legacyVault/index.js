// TEMPORARY: remove after Artur's vault is upgraded
/**
 * Isolated v1 vault reader. The only public surface: detect / open.
 * Upgrade (plan-upgrade) lands in PR 4. PR 10 deletes this folder.
 *
 * Import this entry point only — not `reader.js` / `detect.js`.
 */
export { detectVaultLayout, isLegacyVaultTree, listLegacyAssemblyNames } from './detect.js';
export { openLegacyAssembly, listLegacyAssemblies } from './reader.js';

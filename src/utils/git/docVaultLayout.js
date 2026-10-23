/**
 * Every git working copy carries `vaultLayout` ('v2' | 'legacy'). Save routes
 * on it: `isV2PlanSaveDoc` needs 'v2' to reach `planSave`, and PartFeed
 * enables the Save button from it. A git document without the field used to
 * fall through to the v1 writer (name-based paths on a v2 vault) and showed
 * "Nothing to save" with dirty parts. These helpers stamp it at birth and
 * name the documents that still need it (persisted before the stamp, or a
 * local document that went git on connect).
 */

/**
 * Layout a document created now is born with. The open document's legacy
 * flag wins, so a new assembly next to a v1 one still prompts Upgrade;
 * anything else is v2, which is what new vaults are.
 * @param {string} source 'git' | 'local'
 * @param {object|null} currentDoc the open working copy, if any
 * @returns {'v2'|'legacy'|undefined}
 */
export function newAssemblyVaultLayout(source, currentDoc) {
  if (source !== 'git') return undefined;
  return currentDoc?.vaultLayout === 'legacy' ? 'legacy' : 'v2';
}

/** True for a git document that has no layout yet and would mis-route Save. */
export function docNeedsVaultLayout(doc) {
  if (!doc || typeof doc !== 'object') return false;
  if (doc.source !== 'git') return false;
  return doc.vaultLayout !== 'v2' && doc.vaultLayout !== 'legacy';
}

/**
 * Layout for an unstamped git document, from the vault. No repo yet means
 * the first Save creates a v2 vault, so that is v2 too.
 * @param {{ layout?: string } | null | undefined} detected detectVaultLayout result, or null when there is no repo yet
 * @returns {'v2'|'legacy'}
 */
export function vaultLayoutFromDetection(detected) {
  return detected?.layout === 'legacy' ? 'legacy' : 'v2';
}

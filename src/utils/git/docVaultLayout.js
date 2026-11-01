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
 * flag wins, so a new assembly next to an unsupported vault stays off the
 * v2 Save path. Anything else is v2, which is what new vaults are.
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
 * Layout for an unstamped git document, from the vault version check.
 * No repo yet, no marker, or the current version is v2. An older or
 * unknown version is `legacy` so Save returns unsupported_vault_version
 * and does not write.
 * @param {{ state?: string, layout?: string } | null | undefined} detected checkVaultVersion result, or null when there is no repo yet
 * @returns {'v2'|'legacy'}
 */
export function vaultLayoutFromDetection(detected) {
  if (!detected) return 'v2';
  if (detected.state === 'unsupported' || detected.state === 'upgrade') return 'legacy';
  if (detected.state === 'current' || detected.state === 'unmarked') return 'v2';
  return detected.layout === 'legacy' ? 'legacy' : 'v2';
}

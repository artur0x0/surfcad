// TEMPORARY: remove after Artur's vault is upgraded
/**
 * Known v1 vault README bytes. Upgrade deletes README.md only when the
 * file is byte-identical to one of these seeds. Save never writes README.
 */
import { ASSEMBLIES_DIR, SHARED_PARTS_DIR } from '../vaultLayout.js';
import { DEFAULT_VAULT_NAME, LEGACY_VAULT_NAME } from '../vaultNames.js';

function seedFor(name) {
  return `# ${name}\n\nSurfCAD vault.\n\n- \`${ASSEMBLIES_DIR}/<name>/.surf.json\` assembly metadata\n- \`${SHARED_PARTS_DIR}/<part>.js\` part scripts, referenced by path\n- \`${ASSEMBLIES_DIR}/<name>/<part>.js\` only a Copy to this assembly\n`;
}

export const KNOWN_README_SEEDS = Object.freeze([
  seedFor(DEFAULT_VAULT_NAME),
  seedFor(LEGACY_VAULT_NAME),
]);

/** True when `content` matches a known old vault README seed. */
export function isKnownReadmeSeed(content, repoName) {
  const text = typeof content === 'string' ? content : '';
  if (KNOWN_README_SEEDS.includes(text)) return true;
  const name = typeof repoName === 'string' ? repoName.trim() : '';
  if (name && text === seedFor(name)) return true;
  return false;
}

export function knownReadmeSeedFor(name) {
  return seedFor(String(name || DEFAULT_VAULT_NAME));
}

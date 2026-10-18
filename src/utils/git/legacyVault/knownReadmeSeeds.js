// TEMPORARY: remove after Artur's vault is upgraded
/**
 * Known v1 vault README bytes. Upgrade deletes README.md only when the
 * file is byte-identical to one of these seeds. Save never writes README.
 *
 * Texts come from `vaultSeedFiles` in `src/utils/git/vault.js` (`git log -p`):
 *   a7b131cb G1 initial seed (`<name>/<name>.surf.json` + nested `parts/`)
 *   a3649987 #214 nameless `.surf.json`, scripts in the assembly folder
 *   319b0421 #252 Copy-only assembly-folder scripts (current template)
 * Default repo names: `surfcad` (a7b131cb) then `surfcad-vault` (2ff09aed #272).
 */
import { ASSEMBLIES_DIR, SHARED_PARTS_DIR } from '../vaultLayout.js';
import { DEFAULT_VAULT_NAME, LEGACY_VAULT_NAME } from '../vaultNames.js';

const SEED_TEMPLATES = Object.freeze([
  (name) => `# ${name}\n\nSurfCAD vault.\n\n- \`${ASSEMBLIES_DIR}/<name>/<name>.surf.json\` assembly, with its \`parts/<part>.js\`\n- \`${SHARED_PARTS_DIR}/<part>.js\` shared parts, referenced by path\n`,
  (name) => `# ${name}\n\nSurfCAD vault.\n\n- \`${ASSEMBLIES_DIR}/<name>/.surf.json\` assembly metadata; part scripts live in the same folder\n- \`${SHARED_PARTS_DIR}/<part>.js\` shared parts, referenced by path\n`,
  (name) => `# ${name}\n\nSurfCAD vault.\n\n- \`${ASSEMBLIES_DIR}/<name>/.surf.json\` assembly metadata\n- \`${SHARED_PARTS_DIR}/<part>.js\` part scripts, referenced by path\n- \`${ASSEMBLIES_DIR}/<name>/<part>.js\` only a Copy to this assembly\n`,
]);

function seedsFor(name) {
  return SEED_TEMPLATES.map((template) => template(name));
}

export const KNOWN_README_SEEDS = Object.freeze([
  ...seedsFor(DEFAULT_VAULT_NAME),
  ...seedsFor(LEGACY_VAULT_NAME),
]);

/** True when `content` matches a known old vault README seed. */
export function isKnownReadmeSeed(content, repoName) {
  const text = typeof content === 'string' ? content : '';
  if (KNOWN_README_SEEDS.includes(text)) return true;
  const name = typeof repoName === 'string' ? repoName.trim() : '';
  if (name && seedsFor(name).includes(text)) return true;
  return false;
}

export function knownReadmeSeedFor(name) {
  return SEED_TEMPLATES[SEED_TEMPLATES.length - 1](String(name || DEFAULT_VAULT_NAME));
}

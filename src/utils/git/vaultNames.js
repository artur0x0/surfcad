/**
 * Vault repo names and the marker check. No CAD imports — the backend
 * delete path and the browser share this file.
 *
 * Resolution order (every candidate must pass the marker):
 *   1. stored user.vaultName, when set
 *   2. surfcad-vault
 *   3. legacy surfcad, only when its marker matches
 *
 * An unmarked stored name falls through. An unmarked legacy repo blocks
 * create. An unmarked surfcad-vault is never seeded; later candidates may
 * still be adopted, and create is refused because that name is taken.
 */

export const DEFAULT_VAULT_NAME = 'surfcad-vault';
export const LEGACY_VAULT_NAME = 'surfcad';
export const VAULT_MARKER_KIND = 'surfcad-vault';
/** Written into a new vault. Open accepts this version. An older marker is not opened. */
export const VAULT_MARKER_VERSION = 2;
export const VAULT_MARKER_PATH = 'surfcad.json';

/** GitHub repo name: [A-Za-z0-9._-], max 100. '' when nothing is left. */
export function sanitizeVaultName(raw) {
  const name = String(raw ?? '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^A-Za-z0-9._-]/g, '')
    .replace(/^\.+/, '')
    .slice(0, 100);
  return name === '.' || name === '..' ? '' : name;
}

export function vaultMarkerContent() {
  return `${JSON.stringify({ kind: VAULT_MARKER_KIND, version: VAULT_MARKER_VERSION }, null, 2)}\n`;
}

export function isVaultMarker(content) {
  try {
    const marker = JSON.parse(String(content));
    return marker?.kind === VAULT_MARKER_KIND && Number.isInteger(marker.version);
  } catch {
    return false;
  }
}

/**
 * Stored name, then the default, then the legacy name. Duplicates dropped.
 * A null/empty stored name is skipped (existing users are left unset).
 */
export function vaultNameCandidates(storedName) {
  const out = [];
  const add = (raw) => {
    const name = sanitizeVaultName(raw);
    if (!name || out.includes(name)) return;
    out.push(name);
  };
  add(storedName);
  add(DEFAULT_VAULT_NAME);
  add(LEGACY_VAULT_NAME);
  return out;
}

/**
 * What to do with one candidate that is not a confirmed vault.
 * 'adopt' is handled by the caller before this (presence === 'marked').
 * 'skip' falls through. 'refuse' stops and must not seed or create.
 */
export function decideVaultCandidate(candidate, presence, storedName) {
  if (presence === 'marked') return 'adopt';
  if (presence === 'missing') return 'skip';
  const stored = sanitizeVaultName(storedName);
  // Unmarked or empty stored name falls through, including when that
  // stored name is surfcad-vault or the legacy surfcad.
  if (stored && candidate === stored) return 'skip';
  if (candidate === LEGACY_VAULT_NAME) return 'refuse';
  return 'skip';
}

/**
 * Walk candidates. `lookup(name)` -> { presence: 'missing'|'marked'|'unmarked', ... }.
 * -> { action: 'adopt'|'refuse'|'create', candidate, looked }
 */
export async function walkVaultCandidates(storedName, lookup) {
  const stored = sanitizeVaultName(storedName) || null;
  let defaultOccupied = null;
  let legacyUnmarked = null;
  for (const candidate of vaultNameCandidates(stored)) {
    const looked = await lookup(candidate);
    const presence = looked?.presence || 'missing';
    if (presence === 'marked') {
      return { action: 'adopt', candidate, looked };
    }
    if (presence !== 'missing') {
      if (candidate === DEFAULT_VAULT_NAME) defaultOccupied = looked;
      if (candidate === LEGACY_VAULT_NAME) legacyUnmarked = looked;
    }
    const decision = decideVaultCandidate(candidate, presence, stored);
    if (decision === 'refuse') {
      return { action: 'refuse', candidate, looked };
    }
  }
  if (legacyUnmarked) {
    return { action: 'refuse', candidate: LEGACY_VAULT_NAME, looked: legacyUnmarked };
  }
  if (defaultOccupied) {
    return { action: 'refuse', candidate: DEFAULT_VAULT_NAME, looked: defaultOccupied };
  }
  return { action: 'create', candidate: DEFAULT_VAULT_NAME, looked: null };
}

export function vaultWriteRefusalMessage(repo) {
  const label = repo?.owner && repo?.name ? `${repo.owner}/${repo.name}` : 'this repo';
  return `Refusing to write ${label}: surfcad.json is not a SurfCAD vault marker. Queued changes were kept.`;
}

/**
 * Plain user JSON or a mongoose doc.
 * Existing documents that never stored vaultName stay null. The schema
 * default is not invented here — mongoose only writes it into `_doc` when
 * a User is constructed. Reading the getter would hide that distinction.
 */
export function storedVaultNameFromUser(user) {
  if (!user) return null;
  const raw = user._doc
    ? (Object.prototype.hasOwnProperty.call(user._doc, 'vaultName') ? user._doc.vaultName : null)
    : user.vaultName;
  if (raw == null || String(raw).trim() === '') return null;
  return sanitizeVaultName(raw) || null;
}

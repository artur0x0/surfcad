/**
 * Vault format version and the generic upgrade hook.
 *
 * Open reads `surfcad.json` (`kind` + `version`). The current format is
 * version 2. Future formats register a step in `vaultUpgrades` for the
 * version they upgrade from. Nothing is registered. No step runs on open.
 *
 * `git_upgrade_vault` is the only entry point. The current version (and a
 * repo with no marker yet) returns `already_upgraded`. An older or unknown
 * version with no registered step returns `unsupported_vault_version`.
 * A registered step runs only when `confirm` is true.
 */
import { assertGithubAdapter } from './githubAdapterInterface.js';
import { VAULT_MARKER_KIND, VAULT_MARKER_PATH, VAULT_MARKER_VERSION } from './vaultNames.js';

export const CURRENT_VAULT_VERSION = VAULT_MARKER_VERSION;
export const UNSUPPORTED_VAULT_COPY = 'unsupported vault version';
export const UNSUPPORTED_VAULT_CODE = 'unsupported_vault_version';

/** @type {Map<number, (ctx: object) => Promise<object>>} */
export const vaultUpgrades = new Map();

/**
 * Register a step that upgrades a vault whose marker version is `fromVersion`.
 * Production ships with none. Tests unregister the function this returns.
 * @param {number} fromVersion
 * @param {(ctx: object) => Promise<object>} step
 */
export function registerVaultUpgrade(fromVersion, step) {
  if (!Number.isInteger(fromVersion)) {
    throw new Error('vault upgrade fromVersion must be an integer');
  }
  if (typeof step !== 'function') {
    throw new Error('vault upgrade step must be a function');
  }
  vaultUpgrades.set(fromVersion, step);
  return () => {
    if (vaultUpgrades.get(fromVersion) === step) vaultUpgrades.delete(fromVersion);
  };
}

/** Parse marker bytes. Null content means the file is absent. */
export function parseVaultMarker(content) {
  if (content == null) return null;
  try {
    const marker = JSON.parse(String(content));
    if (!marker || typeof marker !== 'object') {
      return { kind: null, version: null, readable: false };
    }
    const kind = typeof marker.kind === 'string' ? marker.kind : null;
    const version = Number.isInteger(marker.version) ? marker.version : null;
    return {
      kind,
      version,
      readable: kind === VAULT_MARKER_KIND && version != null,
    };
  } catch {
    return { kind: null, version: null, readable: false };
  }
}

/**
 * Read `surfcad.json` on `ref`.
 * -> { present, kind, version, readable }
 */
export async function readVaultMarker(adapter, repo, ref = 'main') {
  assertGithubAdapter(adapter);
  const file = await adapter.readFile(repo, VAULT_MARKER_PATH, ref);
  if (!file || file.content == null) {
    return { present: false, kind: null, version: null, readable: false };
  }
  const parsed = parseVaultMarker(file.content);
  return {
    present: true,
    kind: parsed?.kind ?? null,
    version: parsed?.version ?? null,
    readable: parsed?.readable === true,
  };
}

/**
 * Classify a marker read.
 * `unmarked` — no file yet (a new vault; the first Save writes version 2).
 * `current` — kind + version match the format this build opens.
 * `upgrade` — an older version that has a registered step.
 * `unsupported` — older, unknown, or unreadable, and no step.
 */
export function classifyVaultMarker(marker, registry = vaultUpgrades) {
  if (!marker?.present) return { state: 'unmarked', version: null };
  const version = marker.readable ? marker.version : null;
  if (marker.readable && version === CURRENT_VAULT_VERSION) {
    return { state: 'current', version };
  }
  if (marker.readable && typeof registry.get(version) === 'function') {
    return { state: 'upgrade', version, step: registry.get(version) };
  }
  return { state: 'unsupported', version: marker.version };
}

export async function checkVaultVersion(adapter, repo, ref = 'main', registry = vaultUpgrades) {
  const marker = await readVaultMarker(adapter, repo, ref);
  return { ...marker, ...classifyVaultMarker(marker, registry) };
}

export class UnsupportedVaultVersionError extends Error {
  constructor(version = null) {
    super(UNSUPPORTED_VAULT_COPY);
    this.name = 'UnsupportedVaultVersionError';
    this.code = UNSUPPORTED_VAULT_CODE;
    this.version = version;
  }
}

export function unsupportedVaultVersionResult(version = null) {
  return {
    status: 'error',
    code: UNSUPPORTED_VAULT_CODE,
    error: UNSUPPORTED_VAULT_COPY,
    message: UNSUPPORTED_VAULT_COPY,
    ...(version == null ? {} : { version }),
  };
}

export function alreadyUpgradedResult() {
  return {
    status: 'already_upgraded',
    version: CURRENT_VAULT_VERSION,
  };
}

/**
 * Refuse to open a tree that is not the current format. A registered step
 * does not run here. A missing marker is not a refusal.
 */
export async function assertVaultOpenable(adapter, repo, ref = 'main') {
  const checked = await checkVaultVersion(adapter, repo, ref);
  if (checked.state === 'current' || checked.state === 'unmarked') return checked;
  throw new UnsupportedVaultVersionError(checked.version);
}

/**
 * `git_upgrade_vault`. Reads the marker and either reports the current
 * version, refuses, or runs the registered step. Never runs on open.
 */
export async function runVaultUpgrade({
  adapter,
  repo,
  ref = 'main',
  confirm = false,
  registry = vaultUpgrades,
} = {}) {
  const checked = await checkVaultVersion(adapter, repo, ref, registry);
  if (checked.state === 'current' || checked.state === 'unmarked') {
    return alreadyUpgradedResult();
  }
  if (checked.state === 'upgrade') {
    if (confirm !== true) {
      return {
        status: 'error',
        code: 'confirm_required',
        error: 'git_upgrade_vault requires confirm: true',
        message: 'git_upgrade_vault requires confirm: true',
      };
    }
    return checked.step({
      adapter,
      repo,
      ref,
      fromVersion: checked.version,
      confirm: true,
    });
  }
  return unsupportedVaultVersionResult(checked.version);
}

/**
 * GitHub adapter interface for the git vault.
 *
 * Everything in git mode talks to GitHub through one object with the
 * methods below. G1 ships an in-memory mock (mockGithubAdapter.js). The
 * real adapter (githubAdapter.js, createGithubAdapter) shares this surface;
 * nothing outside an adapter may call the GitHub API. No adapter holds a
 * secret: the real one receives a user token that lives only in the browser.
 *
 * All methods are async. `repo` is `{ owner, name }`. Paths are
 * repo-relative (see vaultLayout.js). Text file content is a UTF-8 string.
 * A mesh asset is a Uint8Array or ArrayBuffer (Blob is accepted and stored
 * as bytes). Binary writes use Git blob encoding base64.
 *
 *   getViewer()                                  -> { login }
 *   getRepo(repo)                                -> RepoInfo | null
 *   createRepo({ name, private, description })   -> RepoInfo   (viewer-owned)
 *   listBranches(repo)                           -> [{ name, sha }]
 *   getBranch(repo, branch)                      -> { name, sha } | null
 *   createBranch(repo, branch, fromSha)          -> { name, sha }
 *   deleteBranch(repo, branch)                   -> void
 *       Refuses 'main' and missing branches (not_found / invalid).
 *   listTree(repo, ref, { prefix }?)             -> [{ path, type: 'blob', sha }]
 *       Throws not_found / invalid when the SHA is missing or GitHub is not OK.
 *       Never returns [] to mean "listing failed".
 *   readFile(repo, path, ref?)                   -> { path, content, sha } | null
 *       Text only (Contents API). A `.mesh` is not read here.
 *   readBlob(repo, sha)                          -> Uint8Array | null
 *       Git Blobs API. Assets resolve the sha from the tree, then call this.
 *   commitFiles(repo, { branch, message, files, baseSha?, onLargeFile? })
 *                                                -> { sha, parents, branch, largeFiles }
 *       files: [{ path, content }] or [{ path, delete: true }], applied as
 *       ONE commit. content is a string, Uint8Array, or ArrayBuffer.
 *       Over 40 MiB throws VaultFileTooLargeError. Over 20 MiB lists the
 *       path in largeFiles and calls onLargeFile({ path, bytes }) when set.
 *       With baseSha, the write is refused (GitAdapterError
 *       code 'non_fast_forward') when the branch head is not baseSha.
 *   compare(repo, base, head)                    -> CompareResult
 *   squashMerge(repo, { base, head, message })   -> { sha, base, head }
 *       Squash head onto base (single commit, parent = base tip).
 *       base/head are branch names or commit shas.
 *       { status: 'identical'|'ahead'|'behind'|'diverged',
 *         aheadBy, behindBy, mergeBaseSha, baseSha, headSha,
 *         files: [{ path, status: 'added'|'modified'|'removed' }] }
 *       `files` is the diff from mergeBase to head (what head changed).
 *
 * RepoInfo = { owner, name, private, defaultBranch, empty }
 */
import {
  VAULT_FILE_WARN_BYTES,
  assertVaultFileSize,
  byteLengthOf,
  isBinaryContent,
  isBlobContent,
  toUint8Array,
  utf8ByteLength,
} from './binaryContent.js';

export const GITHUB_ADAPTER_METHODS = Object.freeze([
  'getViewer',
  'getRepo',
  'createRepo',
  'listBranches',
  'getBranch',
  'createBranch',
  'deleteBranch',
  'listTree',
  'readFile',
  'readBlob',
  'commitFiles',
  'compare',
  'squashMerge',
]);

export const GIT_ADAPTER_ERROR_CODES = Object.freeze([
  'not_found',
  'name_exists',
  'non_fast_forward',
  'invalid',
  'unauthorized',
  'not_a_vault',
]);

export class GitAdapterError extends Error {
  /**
   * @param {string} code one of GIT_ADAPTER_ERROR_CODES
   * @param {string} [message]
   * @param {{ status?: number, acceptedPermissions?: string|null, githubMessage?: string|null }} [details]
   */
  constructor(code, message, details = {}) {
    super(message || code);
    this.name = 'GitAdapterError';
    this.code = code;
    if (details.status != null) this.status = details.status;
    if (details.acceptedPermissions !== undefined) {
      this.acceptedPermissions = details.acceptedPermissions;
    }
    if (details.githubMessage !== undefined) {
      this.githubMessage = details.githubMessage;
    }
  }
}

/** Missing method names, [] when `adapter` implements the whole interface. */
export function missingAdapterMethods(adapter) {
  if (!adapter || typeof adapter !== 'object') return [...GITHUB_ADAPTER_METHODS];
  return GITHUB_ADAPTER_METHODS.filter((m) => typeof adapter[m] !== 'function');
}

/** Throws when `adapter` does not implement the interface; returns it otherwise. */
export function assertGithubAdapter(adapter) {
  const missing = missingAdapterMethods(adapter);
  if (missing.length) {
    throw new GitAdapterError('invalid', `GitHub adapter is missing: ${missing.join(', ')}`);
  }
  return adapter;
}

/**
 * One file change for commitFiles.
 * A string stays text. Uint8Array, ArrayBuffer, and Blob stay binary
 * (`encoding: 'base64'`). Over 40 MiB throws VaultFileTooLargeError.
 * Over 20 MiB sets `large: true` on the returned file.
 */
export function fileWrite(path, content) {
  if (isBlobContent(content)) {
    const n = assertVaultFileSize(path, content.size);
    const file = { path, content, encoding: 'base64' };
    if (n > VAULT_FILE_WARN_BYTES) file.large = true;
    return file;
  }
  if (isBinaryContent(content)) {
    const n = assertVaultFileSize(path, byteLengthOf(content));
    const file = { path, content: toUint8Array(content), encoding: 'base64' };
    if (n > VAULT_FILE_WARN_BYTES) file.large = true;
    return file;
  }
  const text = String(content ?? '');
  const n = assertVaultFileSize(path, utf8ByteLength(text));
  const file = { path, content: text };
  if (n > VAULT_FILE_WARN_BYTES) file.large = true;
  return file;
}

export function fileDelete(path) {
  return { path, delete: true };
}

/**
 * In-memory GitHub adapter. Implements githubAdapterInterface.js for every git-mode
 * slice until the real GitHub App adapter lands. No network, no tokens.
 *
 * Model: repos keyed `owner/name`; each repo has commits (sha -> { parents,
 * tree: Map(path -> content), message }) and branches (name -> sha). A new
 * repo starts empty (no commits, no branches) like a GitHub repo created
 * without auto_init; the first commitFiles creates the default branch.
 * Shas are deterministic 40-hex strings, so tests can compare them.
 */
import { GitAdapterError, GITHUB_COMPARE_FILE_LIMIT, assertGithubAdapter } from './githubAdapterInterface.js';
import { normalizeRepoPath } from '../assembly.js';
import { gitBlobSha, prepareCommitFiles } from './binaryContent.js';

function fnv(str, seed) {
  let h = seed >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** Deterministic 40-hex digest (not cryptographic; mock only). */
export function mockSha(str) {
  const s = String(str);
  let out = '';
  for (let i = 0; i < 5; i++) out += fnv(s, 0x811c9dc5 + i * 0x9e3779b9).toString(16).padStart(8, '0');
  return out;
}

const REPO_NAME_RE = /^[A-Za-z0-9._-]{1,100}$/;

/** Tab-scoped fake GitHub so a reload can reseed against the same vault. */
export const MOCK_GITHUB_STORE_KEY = 'surfcad.mockGithub.v1';

function mockSessionStore() {
  try {
    return typeof sessionStorage !== 'undefined' ? sessionStorage : null;
  } catch {
    return null;
  }
}

function encodeMockContent(content) {
  if (content instanceof Uint8Array) return { u8: Array.from(content) };
  return content;
}

function decodeMockContent(content) {
  if (content && typeof content === 'object' && Array.isArray(content.u8)) {
    return Uint8Array.from(content.u8);
  }
  return content;
}

export function peekMockVaultName() {
  try {
    const raw = mockSessionStore()?.getItem(MOCK_GITHUB_STORE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (typeof data?.lastVaultName === 'string' && data.lastVaultName) return data.lastVaultName;
    const names = (data?.repos || []).map((row) => row.name).filter(Boolean);
    return names.length === 1 ? names[0] : null;
  } catch {
    return null;
  }
}

function readMockGithubStore() {
  try {
    const raw = mockSessionStore()?.getItem(MOCK_GITHUB_STORE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function dumpMockGithubStore(login, counter, lastVaultName, repos) {
  const list = [];
  for (const [repoKey, state] of repos) {
    const commits = [];
    for (const [sha, commit] of state.commits) {
      commits.push([sha, {
        sha: commit.sha,
        parents: commit.parents,
        message: commit.message,
        tree: [...commit.tree.entries()].map(([path, content]) => [path, encodeMockContent(content)]),
      }]);
    }
    list.push({
      key: repoKey,
      owner: state.owner,
      name: state.name,
      private: state.private,
      description: state.description,
      defaultBranch: state.defaultBranch,
      branches: [...state.branches.entries()],
      commits,
    });
  }
  return { login, counter, lastVaultName, repos: list };
}

function loadMockGithubStore(data, repos) {
  if (!data?.repos) return 0;
  for (const row of data.repos) {
    const commits = new Map();
    for (const [sha, commit] of row.commits || []) {
      commits.set(sha, {
        sha: commit.sha,
        parents: commit.parents || [],
        message: commit.message,
        tree: new Map((commit.tree || []).map(([path, content]) => [path, decodeMockContent(content)])),
      });
    }
    repos.set(row.key, {
      owner: row.owner,
      name: row.name,
      private: row.private,
      description: row.description || '',
      defaultBranch: row.defaultBranch || 'main',
      commits,
      branches: new Map(row.branches || []),
    });
  }
  return Number(data.counter) || 0;
}

export function createMockGithubAdapter(options = {}) {
  // Opt-in: App passes persist:true so a tab reload can reseed the fake vault.
  // Unit tests stay isolated (one node:test process, no shared sessionStorage).
  const persistEnabled = options.persist === true;
  const persisted = persistEnabled ? readMockGithubStore() : null;
  const login = options.login || persisted?.login || 'octo-user';
  const repos = new Map();
  let counter = 0;
  let lastVaultName = null;
  if (persisted && persisted.login === login) {
    counter = loadMockGithubStore(persisted, repos);
    lastVaultName = persisted.lastVaultName || null;
  }
  const log = [];
  const persist = () => {
    if (!persistEnabled) return;
    const store = mockSessionStore();
    if (!store) return;
    try {
      store.setItem(
        MOCK_GITHUB_STORE_KEY,
        JSON.stringify(dumpMockGithubStore(login, counter, lastVaultName, repos)),
      );
    } catch { /* quota / private mode */ }
  };

  const key = (repo) => `${repo?.owner}/${repo?.name}`;
  function repoState(repo) {
    const state = repos.get(key(repo));
    if (!state) throw new GitAdapterError('not_found', `Repo ${key(repo)} not found`);
    return state;
  }
  function info(state) {
    return {
      owner: state.owner,
      name: state.name,
      private: state.private,
      defaultBranch: state.defaultBranch,
      empty: state.branches.size === 0,
    };
  }
  function resolveRef(state, ref) {
    if (ref == null || ref === '') ref = state.defaultBranch;
    if (state.branches.has(ref)) return state.branches.get(ref);
    if (state.commits.has(ref)) return ref;
    return null;
  }
  function ancestors(state, sha) {
    const seen = new Map();
    const queue = [[sha, 0]];
    while (queue.length) {
      const [s, d] = queue.shift();
      if (!s || seen.has(s)) continue;
      seen.set(s, d);
      for (const p of state.commits.get(s)?.parents || []) queue.push([p, d + 1]);
    }
    return seen;
  }
  function contentToken(content) {
    if (content instanceof Uint8Array) return gitBlobSha(content);
    return String(content);
  }
  function blobShaOf(content) {
    if (content instanceof Uint8Array) return gitBlobSha(content);
    return mockSha(`blob\0${String(content)}`);
  }
  function contentEqual(a, b) {
    if (a === b) return true;
    if (a instanceof Uint8Array && b instanceof Uint8Array) {
      if (a.byteLength !== b.byteLength) return false;
      for (let i = 0; i < a.byteLength; i += 1) if (a[i] !== b[i]) return false;
      return true;
    }
    return false;
  }
  function makeCommit(state, parent, tree, message) {
    counter += 1;
    const body = [parent || '', message, counter, ...[...tree.entries()].sort().map(([p, c]) => `${p}\0${contentToken(c)}`)].join('\n');
    const sha = mockSha(body);
    state.commits.set(sha, { sha, parents: parent ? [parent] : [], tree, message });
    return sha;
  }
  function seedFiles(state, files, message = 'Seed') {
    const tree = new Map();
    for (const [p, c] of Object.entries(files)) {
      tree.set(p, c instanceof Uint8Array ? c.slice() : String(c));
    }
    const sha = makeCommit(state, null, tree, message);
    state.branches.set(state.defaultBranch, sha);
    return sha;
  }
  function findBlob(state, sha) {
    for (const commit of state.commits.values()) {
      for (const content of commit.tree.values()) {
        if (blobShaOf(content) === sha) return content;
      }
    }
    return undefined;
  }

  const adapter = {
    kind: 'mock',

    async getViewer() {
      return { login };
    },

    async getRepo(repo) {
      const state = repos.get(key(repo));
      return state ? info(state) : null;
    },

    async createRepo({ name, private: isPrivate = true, description = '' } = {}) {
      if (!REPO_NAME_RE.test(String(name || '')) || name === '.' || name === '..') {
        throw new GitAdapterError('invalid', `Invalid repo name "${name}"`);
      }
      const k = `${login}/${name}`;
      if ([...repos.keys()].some((r) => r.toLowerCase() === k.toLowerCase())) {
        throw new GitAdapterError('name_exists', `Repo ${k} already exists`);
      }
      const state = {
        owner: login,
        name,
        private: isPrivate !== false,
        description,
        defaultBranch: 'main',
        commits: new Map(),
        branches: new Map(),
      };
      repos.set(k, state);
      lastVaultName = name;
      persist();
      log.push({ op: 'createRepo', repo: k });
      return info(state);
    },

    async listBranches(repo) {
      const state = repoState(repo);
      return [...state.branches.entries()]
        .map(([name, sha]) => ({ name, sha }))
        .sort((a, b) => a.name.localeCompare(b.name));
    },

    async getBranch(repo, branch) {
      const state = repoState(repo);
      const sha = state.branches.get(branch);
      return sha ? { name: branch, sha } : null;
    },

    async createBranch(repo, branch, fromSha) {
      const state = repoState(repo);
      if (!branch || state.branches.has(branch)) {
        throw new GitAdapterError('name_exists', `Branch ${branch} already exists`);
      }
      const sha = resolveRef(state, fromSha);
      if (!sha) throw new GitAdapterError('not_found', `Commit ${fromSha} not found`);
      state.branches.set(branch, sha);
      persist();
      log.push({ op: 'createBranch', repo: key(repo), branch, sha });
      return { name: branch, sha };
    },

    async deleteBranch(repo, branch) {
      const state = repoState(repo);
      if (!branch) throw new GitAdapterError('invalid', 'Branch name required');
      if (branch === 'main') throw new GitAdapterError('invalid', 'Cannot delete main');
      if (!state.branches.has(branch)) {
        throw new GitAdapterError('not_found', `Branch ${branch} not found`);
      }
      state.branches.delete(branch);
      persist();
      log.push({ op: 'deleteBranch', repo: key(repo), branch });
    },

    async listTree(repo, ref, { prefix = '' } = {}) {
      const state = repoState(repo);
      const sha = resolveRef(state, ref);
      if (!sha) {
        throw new GitAdapterError('not_found', `Ref ${ref || '(empty)'} not found`);
      }
      const out = [];
      for (const [path, content] of state.commits.get(sha).tree) {
        if (prefix && !path.startsWith(prefix)) continue;
        out.push({ path, type: 'blob', sha: blobShaOf(content) });
      }
      return out.sort((a, b) => a.path.localeCompare(b.path));
    },

    async readFile(repo, path, ref) {
      const state = repoState(repo);
      const sha = resolveRef(state, ref);
      if (!sha) return null;
      const content = state.commits.get(sha).tree.get(path);
      if (content == null) return null;
      return { path, content, sha: blobShaOf(content) };
    },

    async readBlob(repo, sha) {
      const state = repoState(repo);
      const content = findBlob(state, sha);
      if (content == null) return null;
      if (content instanceof Uint8Array) return content.slice();
      return new TextEncoder().encode(String(content));
    },

    async commitFiles(repo, { branch, message, files, baseSha, onLargeFile } = {}) {
      const state = repoState(repo);
      const target = branch || state.defaultBranch;
      if (!Array.isArray(files) || files.length === 0) {
        throw new GitAdapterError('invalid', 'commitFiles needs at least one file');
      }
      const prepared = await prepareCommitFiles(files);
      if (typeof onLargeFile === 'function') {
        for (const item of prepared.largeFiles) onLargeFile(item);
      }
      const head = state.branches.get(target) || null;
      if (!head && state.branches.size > 0) {
        throw new GitAdapterError('not_found', `Branch ${target} not found`);
      }
      if (baseSha !== undefined && (baseSha || null) !== head) {
        throw new GitAdapterError('non_fast_forward', `${target} moved: head ${head}, base ${baseSha}`);
      }
      const tree = new Map(head ? state.commits.get(head).tree : []);
      for (const f of prepared.files) {
        const path = normalizeRepoPath(f?.path);
        if (!path) throw new GitAdapterError('invalid', `Bad path "${f?.path}"`);
        if (f.delete) tree.delete(path);
        else if (f.binary) tree.set(path, f.content.slice());
        else tree.set(path, String(f.content ?? ''));
      }
      const sha = makeCommit(state, head, tree, String(message || 'Update'));
      state.branches.set(target, sha);
      lastVaultName = repo?.name || lastVaultName;
      persist();
      log.push({ op: 'commitFiles', repo: key(repo), branch: target, sha, paths: files.map((f) => f.path) });
      return { sha, parents: head ? [head] : [], branch: target, largeFiles: prepared.largeFiles };
    },

    async squashMerge(repo, { base = 'main', head, message } = {}) {
      const state = repoState(repo);
      if (!state) throw new GitAdapterError('not_found', `Repo ${repo.owner}/${repo.name} not found`);
      if (!head) throw new GitAdapterError('invalid', 'squashMerge needs head');
      const baseSha = resolveRef(state, base);
      const headSha = resolveRef(state, head);
      if (!baseSha) throw new GitAdapterError('not_found', `Branch ${base} not found`);
      if (!headSha) throw new GitAdapterError('not_found', `Branch ${head} not found`);
      const headCommit = state.commits.get(headSha);
      if (!headCommit) throw new GitAdapterError('not_found', `Commit ${headSha} not found`);
      const msg = String(message || '').trim() || `Squash merge ${head} into ${base}`;
      // Clone head tree Map so base commit owns a distinct snapshot.
      const tree = new Map(headCommit.tree);
      const sha = makeCommit(state, baseSha, tree, msg);
      state.branches.set(base, sha);
      persist();
      log.push({ op: 'squashMerge', repo: key(repo), base, head, sha });
      return { sha, base, head, parents: [baseSha] };
    },

    async compare(repo, base, head) {
      const state = repoState(repo);
      const baseSha = resolveRef(state, base);
      const headSha = resolveRef(state, head);
      if (!baseSha || !headSha) throw new GitAdapterError('not_found', `Cannot compare ${base}...${head}`);
      const fromBase = ancestors(state, baseSha);
      const fromHead = ancestors(state, headSha);
      let mergeBaseSha = null;
      let best = Infinity;
      for (const [s, d] of fromHead) {
        if (fromBase.has(s) && d + fromBase.get(s) < best) {
          best = d + fromBase.get(s);
          mergeBaseSha = s;
        }
      }
      const aheadBy = [...fromHead.keys()].filter((s) => !fromBase.has(s)).length;
      const behindBy = [...fromBase.keys()].filter((s) => !fromHead.has(s)).length;
      let status = 'identical';
      if (aheadBy && behindBy) status = 'diverged';
      else if (aheadBy) status = 'ahead';
      else if (behindBy) status = 'behind';
      const a = mergeBaseSha ? state.commits.get(mergeBaseSha).tree : new Map();
      const b = state.commits.get(headSha).tree;
      const files = [];
      for (const [p, c] of b) {
        if (!a.has(p)) files.push({ path: p, status: 'added' });
        else if (!contentEqual(a.get(p), c)) files.push({ path: p, status: 'modified' });
      }
      for (const p of a.keys()) if (!b.has(p)) files.push({ path: p, status: 'removed' });
      files.sort((x, y) => x.path.localeCompare(y.path));
      return {
        status,
        aheadBy,
        behindBy,
        mergeBaseSha,
        baseSha,
        headSha,
        files,
        truncated: files.length >= GITHUB_COMPARE_FILE_LIMIT,
      };
    },

    // ---- test hooks (not part of the interface) ----
    _log: log,
    /** Add a repo owned by anyone, optionally with a seed commit on main. */
    _seedRepo({ owner = login, name, private: isPrivate = true, files = null } = {}) {
      const state = {
        owner, name, private: isPrivate, description: '',
        defaultBranch: 'main', commits: new Map(), branches: new Map(),
      };
      repos.set(`${owner}/${name}`, state);
      lastVaultName = name;
      if (files) seedFiles(state, files);
      persist();
      return info(state);
    },
  };

  return assertGithubAdapter(adapter);
}

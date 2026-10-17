/**
 * GitHub adapter (real) — same surface as mockGithubAdapter /
 * githubAdapterInterface.js.
 *
 * Takes a user-to-server OAuth access token (browser-only). All GitHub calls
 * go through `fetch` with `Authorization: Bearer <token>`. Inject `fetchImpl`
 * in tests to mock the network. No secrets, no server storage.
 *
 * Empty repos (`auto_init: false`, no refs): Git Data API blobs return 409.
 * `commitFiles` bootstraps via the Contents API (creates `main`), then — for
 * multi-file first commits — builds the full tree with Git Data and force-updates
 * the ref to one root commit with the intended message.
 */
import { GitAdapterError, assertGithubAdapter } from './githubAdapterInterface.js';
import { normalizeRepoPath } from '../assembly.js';
import { decodeBase64, encodeBase64, prepareCommitFiles } from './binaryContent.js';
import { parseVaultPath, VAULT_MARKER_PATH } from './vaultLayout.js';
import { isVaultMarker, vaultWriteRefusalMessage } from './vaultNames.js';

/**
 * GitHub Contents API path. Each segment is encodeURIComponent; slashes stay
 * separators. A space becomes `%20`. Parentheses are left as-is
 * (`Assembly (1)` → `Assembly%20(1)`), which is what encodeURIComponent does
 * and what the Contents API accepts.
 */
export function encodeGitHubContentsPath(path) {
  const p = normalizeRepoPath(path);
  if (!p) return '';
  return p.split('/').map((seg) => encodeURIComponent(seg)).join('/');
}

const API = 'https://api.github.com';
const REPO_NAME_RE = /^[A-Za-z0-9._-]{1,100}$/;


/**
 * Build unauthorized GitAdapterError from a 401/403 Response.
 * Surfaces GitHub `message` and `X-Accepted-GitHub-Permissions` when present
 * (needed when App lacks Administration R/W for POST /user/repos).
 */
async function unauthorizedFromResponse(res) {
  let data = null;
  try {
    const bodyText = await res.text();
    if (bodyText) {
      try { data = JSON.parse(bodyText); } catch { data = { message: bodyText }; }
    }
  } catch { /* ignore body read failures */ }
  const accepted = headerGet(res, 'X-Accepted-GitHub-Permissions')
    || headerGet(res, 'x-accepted-github-permissions');
  const githubMessage = (data && typeof data.message === 'string' && data.message.trim())
    ? data.message.trim()
    : null;
  const parts = [githubMessage || `GitHub ${res.status}`];
  if (accepted) parts.push(`required permissions: ${accepted}`);
  if (res.status === 403 && /not accessible by integration|Resource not accessible/i.test(githubMessage || '')) {
    parts.push('GitHub App needs Administration R/W (and Contents R/W to seed); approve updated permissions / re-authorize, then Connect again');
  }
  return new GitAdapterError('unauthorized', parts.join(' — '), {
    status: res.status,
    acceptedPermissions: accepted || null,
    githubMessage,
  });
}

function headerGet(res, name) {
  try {
    return res.headers?.get?.(name) || null;
  } catch {
    return null;
  }
}

export function createGithubAdapter({ token, fetchImpl = globalThis.fetch, apiBase = API } = {}) {
  if (!token) {
    throw new GitAdapterError('unauthorized', 'GitHub token required');
  }
  const doFetch = fetchImpl;

  async function api(path, { method = 'GET', body, headers = {} } = {}) {
    const url = path.startsWith('http') ? path : `${apiBase}${path}`;
    let res;
    try {
      res = await doFetch(url, {
        method,
        // Safari / iOS often HTTP-cache GET /branches; after createBranch the
        // pane refresh must see the new ref without a full document reload.
        cache: 'no-store',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'X-GitHub-Api-Version': '2022-11-28',
          ...(body != null ? { 'Content-Type': 'application/json' } : {}),
          ...headers,
        },
        body: body != null ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      throw new GitAdapterError('invalid', `GitHub network error: ${err?.message || err}`);
    }
    if (res.status === 401 || res.status === 403) {
      throw await unauthorizedFromResponse(res);
    }
    return res;
  }

  async function json(path, opts) {
    const res = await api(path, opts);
    if (res.status === 204) return { res, data: null };
    let data = null;
    const text = await res.text();
    if (text) {
      try { data = JSON.parse(text); } catch { data = { message: text }; }
    }
    return { res, data };
  }

  function repoPath(repo) {
    return `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`;
  }

  function infoFromRepo(r) {
    return {
      owner: r.owner?.login || r.owner,
      name: r.name,
      private: !!r.private,
      defaultBranch: r.default_branch || 'main',
      empty: r.size === 0,
    };
  }

  async function resolveSha(repo, ref) {
    if (ref == null || ref === '') return null;
    const br = await getBranchInner(repo, ref);
    if (br) return br.sha;
    if (/^[0-9a-f]{40}$/i.test(String(ref))) return String(ref);
    return null;
  }

  function filesIncludeVaultMarker(files) {
    for (const file of files || []) {
      if (!file || file.delete) continue;
      const path = normalizeRepoPath(file.path);
      if (path === VAULT_MARKER_PATH && isVaultMarker(String(file.content ?? ''))) return true;
    }
    return false;
  }

  async function readMarkerContent(repo, ref) {
    const q = ref ? `?ref=${encodeURIComponent(ref)}` : '';
    const { res, data } = await json(
      `${repoPath(repo)}/contents/${encodeURIComponent(VAULT_MARKER_PATH)}${q}`,
    );
    if (res.status === 404) return null;
    if (!res.ok) throw new GitAdapterError('invalid', data?.message || 'readFile failed');
    if (data?.type !== 'file') return null;
    if (data.encoding === 'base64' && data.content) {
      return decodeBase64Utf8(String(data.content).replace(/\n/g, ''));
    }
    return typeof data.content === 'string' ? data.content : null;
  }

  async function listBranchNames(repo) {
    const { res, data } = await json(`${repoPath(repo)}/branches?per_page=100`);
    if (res.status === 404) return [];
    if (!res.ok) throw new GitAdapterError('invalid', data?.message || 'listBranches failed');
    return (data || []).map((branch) => branch.name).filter(Boolean);
  }

  /**
   * Confirm surfcad.json before any contents PUT or ref PATCH/DELETE/POST.
   * An empty repo may be seeded only when `seed` is set and the commit
   * itself writes a valid marker — that is the repo find-or-create just created.
   */
  async function guardVaultWrite(repo, { seed = false, files = null, ref = null } = {}) {
    const { res, data } = await json(repoPath(repo));
    if (res.status === 404) {
      throw new GitAdapterError('not_found', `Repo ${repo.owner}/${repo.name} not found`);
    }
    if (!res.ok) throw new GitAdapterError('invalid', data?.message || 'getRepo failed');
    const info = infoFromRepo(data);
    const canonical = { owner: info.owner || repo.owner, name: info.name || repo.name };
    const refuse = () => {
      throw new GitAdapterError('not_a_vault', vaultWriteRefusalMessage(canonical));
    };
    const marked = async (branchName) => {
      const content = await readMarkerContent(canonical, branchName);
      return !!(content && isVaultMarker(content));
    };

    const target = ref || info.defaultBranch || 'main';
    const head = await getBranchInner(canonical, target);
    if (head?.sha) {
      if (await marked(target)) return canonical;
      return refuse();
    }

    const defaultBranch = info.defaultBranch || 'main';
    if (target !== defaultBranch) {
      const defaultHead = await getBranchInner(canonical, defaultBranch);
      if (defaultHead?.sha) {
        if (await marked(defaultBranch)) return canonical;
        return refuse();
      }
    }

    const branches = await listBranchNames(canonical);
    if (branches.length > 0) {
      if (await marked(branches[0])) return canonical;
      return refuse();
    }

    if (seed && filesIncludeVaultMarker(files)) return canonical;
    return refuse();
  }

  async function getBranchInner(repo, branch) {
    const { res, data } = await json(
      `${repoPath(repo)}/branches/${encodeURIComponent(branch)}`,
    );
    if (res.status === 404) return null;
    if (!res.ok) throw new GitAdapterError('invalid', data?.message || 'getBranch failed');
    return { name: data.name, sha: data.commit?.sha };
  }

  /**
   * First commit on an empty GitHub repo (no refs).
   * Contents API creates the branch; multi-file then replaces with one root
   * commit via Git Data + force-update so callers still see parents: [].
   */
  function blobApiBody(file) {
    if (file?.binary) return { content: encodeBase64(file.content), encoding: 'base64' };
    return { content: String(file?.content ?? ''), encoding: 'utf-8' };
  }

  function contentsBase64(file) {
    if (file?.binary) return encodeBase64(file.content);
    return encodeBase64Utf8(file?.content ?? '');
  }

  async function commitFilesOnEmptyRepo(repo, { target, message, files }) {
    const writes = [];
    for (const f of files) {
      const path = normalizeRepoPath(f?.path);
      if (!path) throw new GitAdapterError('invalid', `Bad path "${f?.path}"`);
      if (f.delete) continue; // nothing to delete on an empty repo
      writes.push({ path, content: f.content, binary: !!f.binary });
    }
    if (writes.length === 0) {
      throw new GitAdapterError('invalid', 'commitFiles needs at least one file');
    }

    const msg = String(message || 'Update');
    const first = writes[0];
    const encoded = encodeGitHubContentsPath(first.path);
    const { res: putRes, data: putData } = await json(
      `${repoPath(repo)}/contents/${encoded}`,
      {
        method: 'PUT',
        body: {
          message: writes.length === 1 ? msg : 'Initialize empty repository',
          content: contentsBase64(first),
          branch: target,
        },
      },
    );
    if (!putRes.ok) {
      throw new GitAdapterError('invalid', putData?.message || 'contents create failed');
    }
    const bootstrapSha = putData.commit?.sha;
    if (!bootstrapSha) {
      throw new GitAdapterError('invalid', 'contents create returned no commit sha');
    }

    if (writes.length === 1) {
      return { sha: bootstrapSha, parents: [], branch: target };
    }

    // Repo now has a ref — Git Data API works. Build the full intended tree as
    // an orphan commit and force-update so main has one root commit.
    const treeEntries = [];
    for (const w of writes) {
      const { res, data } = await json(`${repoPath(repo)}/git/blobs`, {
        method: 'POST',
        body: blobApiBody(w),
      });
      if (!res.ok) throw new GitAdapterError('invalid', data?.message || 'blob create failed');
      treeEntries.push({ path: w.path, mode: '100644', type: 'blob', sha: data.sha });
    }

    const { res: treeRes, data: treeData } = await json(`${repoPath(repo)}/git/trees`, {
      method: 'POST',
      body: { tree: treeEntries },
    });
    if (!treeRes.ok) {
      throw new GitAdapterError('invalid', treeData?.message || 'tree create failed');
    }

    const { res: commitRes, data: commitData } = await json(`${repoPath(repo)}/git/commits`, {
      method: 'POST',
      body: {
        message: msg,
        tree: treeData.sha,
        parents: [],
      },
    });
    if (!commitRes.ok) {
      throw new GitAdapterError('invalid', commitData?.message || 'commit create failed');
    }
    const newSha = commitData.sha;

    const { res: refRes, data: refData } = await json(
      `${repoPath(repo)}/git/refs/heads/${encodeURIComponent(target)}`,
      { method: 'PATCH', body: { sha: newSha, force: true } },
    );
    if (!refRes.ok) {
      throw new GitAdapterError('invalid', refData?.message || 'ref force-update failed');
    }

    return { sha: newSha, parents: [], branch: target };
  }

  const adapter = {
    kind: 'real',

    async getViewer() {
      const { res, data } = await json('/user');
      if (!res.ok) throw new GitAdapterError('unauthorized', data?.message || 'getViewer failed');
      return { login: data.login };
    },

    async getRepo(repo) {
      const { res, data } = await json(repoPath(repo));
      if (res.status === 404) return null;
      if (!res.ok) throw new GitAdapterError('invalid', data?.message || 'getRepo failed');
      return infoFromRepo(data);
    },

    async createRepo({ name, private: isPrivate = true, description = '' } = {}) {
      if (!REPO_NAME_RE.test(String(name || '')) || name === '.' || name === '..') {
        throw new GitAdapterError('invalid', `Invalid repo name "${name}"`);
      }
      const { res, data } = await json('/user/repos', {
        method: 'POST',
        body: {
          name,
          private: isPrivate !== false,
          description: description || '',
          auto_init: false,
        },
      });
      if (res.status === 422) {
        throw new GitAdapterError('name_exists', data?.message || `Repo ${name} already exists`);
      }
      if (!res.ok) throw new GitAdapterError('invalid', data?.message || 'createRepo failed');
      return {
        owner: data.owner?.login,
        name: data.name,
        private: !!data.private,
        defaultBranch: data.default_branch || 'main',
        empty: true,
      };
    },

    async listBranches(repo) {
      const { res, data } = await json(`${repoPath(repo)}/branches?per_page=100`);
      if (res.status === 404) {
        throw new GitAdapterError('not_found', `Repo ${repo.owner}/${repo.name} not found`);
      }
      if (!res.ok) throw new GitAdapterError('invalid', data?.message || 'listBranches failed');
      return (data || [])
        .map((b) => ({ name: b.name, sha: b.commit?.sha }))
        .sort((a, b) => a.name.localeCompare(b.name));
    },

    async getBranch(repo, branch) {
      return getBranchInner(repo, branch);
    },

    async createBranch(repo, branch, fromSha) {
      if (!branch) throw new GitAdapterError('name_exists', 'Branch name required');
      repo = await guardVaultWrite(repo);
      const { res, data } = await json(`${repoPath(repo)}/git/refs`, {
        method: 'POST',
        body: { ref: `refs/heads/${branch}`, sha: fromSha },
      });
      if (res.status === 422) {
        // Existing ref or invalid sha — distinguish by message when possible.
        const msg = data?.message || '';
        if (/already exists|Reference already exists/i.test(msg)) {
          throw new GitAdapterError('name_exists', `Branch ${branch} already exists`);
        }
        if (/not found|Object does not exist|is not a valid/i.test(msg)) {
          throw new GitAdapterError('not_found', `Commit ${fromSha} not found`);
        }
        throw new GitAdapterError('name_exists', msg || `Branch ${branch} already exists`);
      }
      if (res.status === 404) {
        throw new GitAdapterError('not_found', data?.message || `Commit ${fromSha} not found`);
      }
      if (!res.ok) throw new GitAdapterError('invalid', data?.message || 'createBranch failed');
      return { name: branch, sha: data.object?.sha || fromSha };
    },

    async deleteBranch(repo, branch) {
      if (!branch) throw new GitAdapterError('invalid', 'Branch name required');
      if (branch === 'main') throw new GitAdapterError('invalid', 'Cannot delete main');
      repo = await guardVaultWrite(repo);
      const { res, data } = await json(
        `${repoPath(repo)}/git/refs/heads/${encodeURIComponent(branch)}`,
        { method: 'DELETE' },
      );
      if (res.status === 404) {
        throw new GitAdapterError('not_found', data?.message || `Branch ${branch} not found`);
      }
      if (res.status === 401 || res.status === 403) {
        throw new GitAdapterError('unauthorized', data?.message || 'deleteBranch unauthorized');
      }
      if (!res.ok && res.status !== 204) {
        throw new GitAdapterError('invalid', data?.message || 'deleteBranch failed');
      }
    },

    async listTree(repo, ref, { prefix = '' } = {}) {
      const sha = await resolveSha(repo, ref);
      if (!sha) {
        throw new GitAdapterError('not_found', `Ref ${ref || '(empty)'} not found`);
      }
      let treeSha = sha;
      const commitRes = await json(`${repoPath(repo)}/git/commits/${encodeURIComponent(sha)}`);
      if (!commitRes.res.ok) {
        throw new GitAdapterError(
          commitRes.res.status === 404 ? 'not_found' : 'invalid',
          commitRes.data?.message || 'listTree failed',
        );
      }
      if (commitRes.data?.tree?.sha) treeSha = commitRes.data.tree.sha;
      const { res, data } = await json(
        `${repoPath(repo)}/git/trees/${encodeURIComponent(treeSha)}?recursive=1`,
      );
      if (!res.ok) {
        throw new GitAdapterError(
          res.status === 404 ? 'not_found' : 'invalid',
          data?.message || 'listTree failed',
        );
      }
      return filterTree(data?.tree, prefix);
    },

    async readFile(repo, path, ref) {
      const p = normalizeRepoPath(path);
      if (!p) return null;
      const q = ref ? `?ref=${encodeURIComponent(ref)}` : '';
      const encoded = encodeGitHubContentsPath(p);
      const { res, data } = await json(`${repoPath(repo)}/contents/${encoded}${q}`);
      if (res.status === 404) return null;
      if (!res.ok) throw new GitAdapterError('invalid', data?.message || 'readFile failed');
      if (data?.type !== 'file') return null;
      let content = '';
      if (data.encoding === 'base64' && data.content) {
        content = decodeBase64Utf8(data.content.replace(/\n/g, ''));
      } else if (typeof data.content === 'string') {
        content = data.content;
      }
      return { path: p, content, sha: data.sha };
    },

    /**
     * Binary read. GET /git/blobs/:sha (base64). Never the Contents API.
     * Returns a Uint8Array, or null when the sha is missing.
     */
    async readBlob(repo, sha) {
      const id = String(sha || '');
      if (!id) return null;
      const { res, data } = await json(`${repoPath(repo)}/git/blobs/${encodeURIComponent(id)}`);
      if (res.status === 404) return null;
      if (!res.ok) throw new GitAdapterError('invalid', data?.message || 'readBlob failed');
      if (data?.encoding && data.encoding !== 'base64') {
        throw new GitAdapterError('invalid', `Unexpected blob encoding ${data.encoding}`);
      }
      return decodeBase64(data?.content || '');
    },

    async commitFiles(repo, { branch, message, files, baseSha, seed = false, onLargeFile } = {}) {
      if (!Array.isArray(files) || files.length === 0) {
        throw new GitAdapterError('invalid', 'commitFiles needs at least one file');
      }
      const prepared = await prepareCommitFiles(files);
      if (typeof onLargeFile === 'function') {
        for (const item of prepared.largeFiles) onLargeFile(item);
      }
      repo = await guardVaultWrite(repo, { seed, files, ref: branch || null });
      const info = await this.getRepo(repo);
      if (!info) throw new GitAdapterError('not_found', `Repo ${repo.owner}/${repo.name} not found`);
      const target = branch || info.defaultBranch || 'main';

      let head = null;
      const br = await getBranchInner(repo, target);
      if (br) head = br.sha;
      else if (!info.empty) {
        const branches = await this.listBranches(repo);
        if (branches.length > 0) {
          throw new GitAdapterError('not_found', `Branch ${target} not found`);
        }
      }

      if (baseSha !== undefined && (baseSha || null) !== head) {
        throw new GitAdapterError(
          'non_fast_forward',
          `${target} moved: head ${head}, base ${baseSha}`,
        );
      }

      // Empty repo: Git Data API (POST /git/blobs) returns 409 "Git Repository
      // is empty." Contents API can create the first commit and the branch.
      if (!head) {
        const created = await commitFilesOnEmptyRepo(repo, { target, message, files: prepared.files });
        return { ...created, largeFiles: prepared.largeFiles };
      }

      let baseEntries = [];
      let parentTreeSha = null;
      {
        const { res: cRes, data: cData } = await json(
          `${repoPath(repo)}/git/commits/${encodeURIComponent(head)}`,
        );
        if (!cRes.ok) throw new GitAdapterError('invalid', cData?.message || 'parent commit failed');
        parentTreeSha = cData.tree.sha;
        const { res: tRes, data: tData } = await json(
          `${repoPath(repo)}/git/trees/${encodeURIComponent(parentTreeSha)}?recursive=1`,
        );
        if (!tRes.ok) throw new GitAdapterError('invalid', tData?.message || 'parent tree failed');
        baseEntries = (tData.tree || []).filter((e) => e.type === 'blob');
      }

      const byPath = new Map(baseEntries.map((e) => [e.path, e]));
      for (const f of prepared.files) {
        const path = normalizeRepoPath(f?.path);
        if (!path) throw new GitAdapterError('invalid', `Bad path "${f?.path}"`);
        if (f.delete) {
          byPath.delete(path);
        } else {
          const { res, data } = await json(`${repoPath(repo)}/git/blobs`, {
            method: 'POST',
            body: blobApiBody(f),
          });
          if (!res.ok) throw new GitAdapterError('invalid', data?.message || 'blob create failed');
          byPath.set(path, { path, mode: '100644', type: 'blob', sha: data.sha });
        }
      }

      const fullTree = [...byPath.values()].map((e) => ({
        path: e.path,
        mode: e.mode || '100644',
        type: 'blob',
        sha: e.sha,
      }));

      // Deletes need a full tree (no base_tree). Adds/edits can use base_tree.
      const hasDelete = files.some((f) => f.delete);
      const treeBody = (!hasDelete && parentTreeSha)
        ? { base_tree: parentTreeSha, tree: treeDiff(baseEntries, fullTree) }
        : { tree: fullTree };

      const { res: treeRes, data: treeData } = await json(`${repoPath(repo)}/git/trees`, {
        method: 'POST',
        body: treeBody,
      });
      if (!treeRes.ok) {
        throw new GitAdapterError('invalid', treeData?.message || 'tree create failed');
      }

      const { res: commitRes, data: commitData } = await json(`${repoPath(repo)}/git/commits`, {
        method: 'POST',
        body: {
          message: String(message || 'Update'),
          tree: treeData.sha,
          parents: [head],
        },
      });
      if (!commitRes.ok) {
        throw new GitAdapterError('invalid', commitData?.message || 'commit create failed');
      }
      const newSha = commitData.sha;

      const { res: refRes, data: refData } = await json(
        `${repoPath(repo)}/git/refs/heads/${encodeURIComponent(target)}`,
        { method: 'PATCH', body: { sha: newSha, force: false } },
      );
      if (refRes.status === 422) {
        throw new GitAdapterError('non_fast_forward', refData?.message || `${target} moved`);
      }
      if (!refRes.ok) {
        throw new GitAdapterError('invalid', refData?.message || 'ref update failed');
      }

      return { sha: newSha, parents: [head], branch: target, largeFiles: prepared.largeFiles };
    },

    /**
     * Squash `head` onto `base`: one new commit on base with head's tree and
     * parent = base tip. Caller must ensure head is ahead-only (not behind).
     */
    async squashMerge(repo, { base = 'main', head, message } = {}) {
      if (!head) throw new GitAdapterError('invalid', 'squashMerge needs head');
      repo = await guardVaultWrite(repo, { ref: base });
      const baseBr = await getBranchInner(repo, base);
      const headBr = await getBranchInner(repo, head);
      if (!baseBr?.sha) throw new GitAdapterError('not_found', `Branch ${base} not found`);
      if (!headBr?.sha) throw new GitAdapterError('not_found', `Branch ${head} not found`);

      const { res: cRes, data: cData } = await json(
        `${repoPath(repo)}/git/commits/${encodeURIComponent(headBr.sha)}`,
      );
      if (!cRes.ok) throw new GitAdapterError('invalid', cData?.message || 'head commit failed');
      const treeSha = cData?.tree?.sha;
      if (!treeSha) throw new GitAdapterError('invalid', 'head commit has no tree');

      const msg = String(message || '').trim() || `Squash merge ${head} into ${base}`;
      const { res: commitRes, data: commitData } = await json(`${repoPath(repo)}/git/commits`, {
        method: 'POST',
        body: {
          message: msg,
          tree: treeSha,
          parents: [baseBr.sha],
        },
      });
      if (!commitRes.ok) {
        throw new GitAdapterError('invalid', commitData?.message || 'squash commit failed');
      }
      const newSha = commitData.sha;

      const { res: refRes, data: refData } = await json(
        `${repoPath(repo)}/git/refs/heads/${encodeURIComponent(base)}`,
        { method: 'PATCH', body: { sha: newSha, force: false } },
      );
      if (refRes.status === 422) {
        throw new GitAdapterError('non_fast_forward', refData?.message || `${base} moved`);
      }
      if (!refRes.ok) {
        throw new GitAdapterError('invalid', refData?.message || 'ref update failed');
      }
      return { sha: newSha, base, head, parents: [baseBr.sha] };
    },

    async compare(repo, base, head) {
      const { res, data } = await json(
        `${repoPath(repo)}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`,
      );
      if (res.status === 404) {
        throw new GitAdapterError('not_found', `Cannot compare ${base}...${head}`);
      }
      if (!res.ok) throw new GitAdapterError('invalid', data?.message || 'compare failed');

      let headSha = data.commits?.length
        ? data.commits[data.commits.length - 1].sha
        : null;
      let baseSha = data.base_commit?.sha || null;
      if (!headSha) headSha = await resolveSha(repo, head);
      if (!baseSha) baseSha = await resolveSha(repo, base);
      // identical → head == merge base
      if (!headSha && data.status === 'identical') {
        headSha = data.merge_base_commit?.sha || baseSha;
      }

      const files = (data.files || [])
        .map((f) => ({ path: f.filename, status: mapFileStatus(f.status) }))
        .sort((a, b) => a.path.localeCompare(b.path));

      return {
        status: data.status || 'identical',
        aheadBy: data.ahead_by || 0,
        behindBy: data.behind_by || 0,
        mergeBaseSha: data.merge_base_commit?.sha || null,
        baseSha,
        headSha,
        files,
      };
    },
  };

  return assertGithubAdapter(adapter);
}

/**
 * Read one asset by path. The sha comes from the git tree; the bytes come
 * from GET /git/blobs/:sha. Contents GET is not used.
 * -> { path, sha, bytes: Uint8Array } | null
 */
export async function readVaultAsset(adapter, repo, path, ref) {
  const p = normalizeRepoPath(path);
  if (!p) return null;
  const info = parseVaultPath(p);
  if (info?.kind !== 'asset') return null;
  if (typeof adapter?.listTree !== 'function' || typeof adapter?.readBlob !== 'function') {
    throw new GitAdapterError('invalid', 'Adapter cannot read a binary asset');
  }
  const tree = await adapter.listTree(repo, ref);
  const entry = (tree || []).find((item) => item?.path === p);
  if (!entry?.sha) return null;
  const bytes = await adapter.readBlob(repo, entry.sha);
  if (!(bytes instanceof Uint8Array)) return null;
  return { path: p, sha: entry.sha, bytes };
}

function filterTree(tree, prefix) {
  const out = [];
  for (const e of tree || []) {
    if (e.type !== 'blob') continue;
    if (prefix && !e.path.startsWith(prefix)) continue;
    out.push({ path: e.path, type: 'blob', sha: e.sha });
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

function treeDiff(baseEntries, nextEntries) {
  const base = new Map(baseEntries.map((e) => [e.path, e.sha]));
  const changes = [];
  for (const e of nextEntries) {
    if (base.get(e.path) !== e.sha) {
      changes.push({ path: e.path, mode: e.mode || '100644', type: 'blob', sha: e.sha });
    }
  }
  return changes;
}

function mapFileStatus(s) {
  if (s === 'added') return 'added';
  if (s === 'removed') return 'removed';
  return 'modified';
}

function encodeBase64Utf8(text) {
  const Buf = globalThis.Buffer;
  if (typeof Buf !== 'undefined') {
    return Buf.from(String(text), 'utf8').toString('base64');
  }
  const bytes = new TextEncoder().encode(String(text));
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function decodeBase64Utf8(b64) {
  const Buf = globalThis.Buffer;
  if (typeof Buf !== 'undefined') {
    return Buf.from(b64, 'base64').toString('utf8');
  }
  const bin = atob(b64);
  if (typeof TextDecoder !== 'undefined') {
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder('utf-8').decode(bytes);
  }
  return bin;
}

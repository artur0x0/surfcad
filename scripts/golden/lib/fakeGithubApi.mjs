/**
 * Throwaway in-memory GitHub REST backend for browser goldens.
 *
 * Serves the subset of api.github.com the real adapter calls (repos,
 * branches, contents, git blobs / trees / commits / refs, compare). State
 * lives in this process and dies with it — no network, no real repo.
 * Wire it with `installFakeGithub(page, fake)`; every commit is kept so a
 * golden can assert exactly which files one commit wrote.
 */
import { createHash } from 'node:crypto';

const API = 'https://api.github.com';

function sha1(text) {
  return createHash('sha1').update(text).digest('hex');
}

export function createFakeGithub({ login = 'golden-agent', repo = 'surfcad-vault', marker } = {}) {
  const blobs = new Map();
  const trees = new Map();
  const commits = new Map();
  const branches = new Map();
  const unhandled = [];
  let counter = 0;

  const putBlob = (content) => {
    const sha = sha1(`blob\0${content}`);
    blobs.set(sha, content);
    return sha;
  };
  const putTree = (entries) => {
    const sorted = new Map([...entries.entries()].sort(([a], [b]) => a.localeCompare(b)));
    const sha = sha1(`tree\0${JSON.stringify([...sorted])}`);
    trees.set(sha, sorted);
    return sha;
  };
  const putCommit = ({ tree, parents, message }) => {
    counter += 1;
    const sha = sha1(`commit\0${counter}\0${tree}\0${parents.join(',')}\0${message}`);
    commits.set(sha, { sha, tree, parents, message, order: counter });
    return sha;
  };

  const seed = new Map([['surfcad.json', putBlob(marker || `${JSON.stringify({ kind: 'surfcad-vault', version: 1 }, null, 2)}\n`)]]);
  branches.set('main', putCommit({ tree: putTree(seed), parents: [], message: 'Create SurfCAD vault' }));

  const repoInfo = () => ({
    name: repo,
    owner: { login },
    private: true,
    default_branch: 'main',
    size: 1,
  });

  /** Files one commit changed against its first parent. */
  function commitFiles(sha) {
    const commit = commits.get(sha);
    if (!commit) return [];
    const after = trees.get(commit.tree) || new Map();
    const parent = commit.parents[0] ? commits.get(commit.parents[0]) : null;
    const before = parent ? (trees.get(parent.tree) || new Map()) : new Map();
    const out = [];
    for (const [path, blob] of after) {
      if (before.get(path) !== blob) out.push({ path, status: before.has(path) ? 'modified' : 'added' });
    }
    for (const path of before.keys()) {
      if (!after.has(path)) out.push({ path, status: 'removed' });
    }
    return out.sort((a, b) => a.path.localeCompare(b.path));
  }

  function log(branch = 'main') {
    const out = [];
    let sha = branches.get(branch);
    while (sha) {
      const commit = commits.get(sha);
      out.push({ sha, message: commit.message, files: commitFiles(sha) });
      sha = commit.parents[0];
    }
    return out;
  }

  function readFile(path, branch = 'main') {
    const commit = commits.get(branches.get(branch));
    const blob = commit && trees.get(commit.tree)?.get(path);
    return blob ? blobs.get(blob) : null;
  }

  function handle(method, rawUrl, body) {
    const url = new URL(rawUrl);
    const path = decodeURIComponent(url.pathname);
    const json = (status, data) => ({ status, data });
    if (method === 'GET' && path === '/user') return json(200, { login });
    const prefix = `/repos/${login}/${repo}`;
    if (!path.startsWith(`/repos/`)) return null;
    if (!path.startsWith(prefix)) return json(404, { message: 'Not Found' });
    const rest = path.slice(prefix.length);

    if (method === 'GET' && rest === '') return json(200, repoInfo());
    if (method === 'GET' && rest === '/branches') {
      return json(200, [...branches].map(([name, sha]) => ({ name, commit: { sha } })));
    }
    let m = rest.match(/^\/branches\/(.+)$/);
    if (method === 'GET' && m) {
      const sha = branches.get(m[1]);
      return sha ? json(200, { name: m[1], commit: { sha } }) : json(404, { message: 'Branch not found' });
    }
    m = rest.match(/^\/contents\/(.+)$/);
    if (method === 'GET' && m) {
      const ref = url.searchParams.get('ref') || 'main';
      const commit = commits.get(branches.get(ref) || ref);
      const blob = commit && trees.get(commit.tree)?.get(m[1]);
      if (!blob) return json(404, { message: 'Not Found' });
      return json(200, {
        type: 'file',
        path: m[1],
        sha: blob,
        encoding: 'base64',
        content: Buffer.from(blobs.get(blob), 'utf8').toString('base64'),
      });
    }
    m = rest.match(/^\/git\/commits\/([0-9a-f]{40})$/);
    if (method === 'GET' && m) {
      const commit = commits.get(m[1]);
      if (!commit) return json(404, { message: 'Not Found' });
      return json(200, {
        sha: commit.sha,
        message: commit.message,
        tree: { sha: commit.tree },
        parents: commit.parents.map((sha) => ({ sha })),
      });
    }
    m = rest.match(/^\/git\/trees\/([0-9a-f]{40})$/);
    if (method === 'GET' && m) {
      const tree = trees.get(m[1]);
      if (!tree) return json(404, { message: 'Not Found' });
      return json(200, {
        sha: m[1],
        tree: [...tree].map(([p, sha]) => ({ path: p, mode: '100644', type: 'blob', sha })),
        truncated: false,
      });
    }
    m = rest.match(/^\/git\/blobs\/([0-9a-f]{40})$/);
    if (method === 'GET' && m) {
      const content = blobs.get(m[1]);
      if (content == null) return json(404, { message: 'Not Found' });
      return json(200, { sha: m[1], encoding: 'base64', content: Buffer.from(content, 'utf8').toString('base64') });
    }
    if (method === 'POST' && rest === '/git/blobs') {
      const content = body?.encoding === 'base64'
        ? Buffer.from(String(body.content || ''), 'base64').toString('utf8')
        : String(body?.content ?? '');
      return json(201, { sha: putBlob(content) });
    }
    if (method === 'POST' && rest === '/git/trees') {
      const entries = new Map(body?.base_tree ? trees.get(body.base_tree) || [] : []);
      for (const entry of body?.tree || []) {
        if (entry.sha == null) entries.delete(entry.path);
        else entries.set(entry.path, entry.sha);
      }
      return json(201, { sha: putTree(entries) });
    }
    if (method === 'POST' && rest === '/git/commits') {
      return json(201, { sha: putCommit({ tree: body.tree, parents: body.parents || [], message: body.message || '' }) });
    }
    m = rest.match(/^\/git\/refs\/heads\/(.+)$/);
    if (method === 'PATCH' && m) {
      const current = branches.get(m[1]);
      const next = commits.get(body?.sha);
      if (!next) return json(422, { message: 'Object does not exist' });
      if (!body.force && current && !next.parents.includes(current)) {
        return json(422, { message: 'Update is not a fast forward' });
      }
      branches.set(m[1], body.sha);
      return json(200, { ref: `refs/heads/${m[1]}`, object: { sha: body.sha } });
    }
    if (method === 'POST' && rest === '/git/refs') {
      const name = String(body?.ref || '').replace(/^refs\/heads\//, '');
      if (branches.has(name)) return json(422, { message: 'Reference already exists' });
      if (!commits.has(body?.sha)) return json(422, { message: 'Object does not exist' });
      branches.set(name, body.sha);
      return json(201, { ref: body.ref, object: { sha: body.sha } });
    }
    m = rest.match(/^\/compare\/(.+)\.\.\.(.+)$/);
    if (method === 'GET' && m) {
      const base = branches.get(m[1]) || m[1];
      const head = branches.get(m[2]) || m[2];
      const same = base === head;
      return json(200, {
        status: same ? 'identical' : 'ahead',
        ahead_by: same ? 0 : 1,
        behind_by: 0,
        base_commit: { sha: base },
        merge_base_commit: { sha: base },
        commits: same ? [] : [{ sha: head }],
        files: same ? [] : commitFiles(head).map((f) => ({ filename: f.path, status: f.status })),
      });
    }
    unhandled.push(`${method} ${path}`);
    return json(404, { message: `fake GitHub: unhandled ${method} ${path}` });
  }

  return { login, repo, handle, log, readFile, commitFiles, unhandled, branches };
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
  'access-control-expose-headers': '*',
};

/** Route every api.github.com request from `page` into `fake`. */
export async function installFakeGithub(page, fake, { onRequest } = {}) {
  await page.route(`${API}/**`, async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: CORS, body: '' });
      return;
    }
    let body = null;
    try { body = req.postData() ? JSON.parse(req.postData()) : null; } catch { body = null; }
    const out = fake.handle(req.method(), req.url(), body)
      || { status: 404, data: { message: 'Not Found' } };
    onRequest?.(req.method(), req.url(), out.status);
    await route.fulfill({
      status: out.status,
      headers: { ...CORS, 'content-type': 'application/json' },
      body: JSON.stringify(out.data),
    });
  });
}

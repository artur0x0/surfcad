/**
 * Test adapter that records commitFiles / createRepo / compare (§8 Harness).
 * Not a production writer — production commits go through writeVaultCommit.
 */
import { assertGithubAdapter } from './githubAdapterInterface.js';
import { createMockGithubAdapter } from './mockGithubAdapter.js';

/**
 * Wrap an adapter (default: in-memory mock) and record the three write/compare
 * methods. `hooks` may intercept a method; the inner adapter is the third arg.
 */
export function createSpyGithubAdapter(inner, hooks = {}) {
  const base = inner || createMockGithubAdapter();
  const calls = [];
  const adapter = {
    ...base,
    async createRepo(opts) {
      calls.push({ op: 'createRepo', opts });
      if (typeof hooks.createRepo === 'function') return hooks.createRepo(opts, base);
      return base.createRepo(opts);
    },
    async commitFiles(repo, opts) {
      calls.push({ op: 'commitFiles', repo, opts });
      if (typeof hooks.commitFiles === 'function') return hooks.commitFiles(repo, opts, base);
      return base.commitFiles(repo, opts);
    },
    async compare(repo, baseRef, headRef) {
      calls.push({ op: 'compare', repo, base: baseRef, head: headRef });
      if (typeof hooks.compare === 'function') return hooks.compare(repo, baseRef, headRef, base);
      return base.compare(repo, baseRef, headRef);
    },
  };
  assertGithubAdapter(adapter);
  adapter._calls = calls;
  return adapter;
}

export function spyCalls(adapter, op) {
  const rows = adapter?._calls || [];
  return op ? rows.filter((row) => row.op === op) : rows;
}

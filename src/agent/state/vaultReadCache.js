/**
 * Short-lived read cache for one agent `open_assembly` call.
 *
 * The name lookup lists the vault, then the open lists it again
 * (`surfcad.json` plus two tree listings, about 7 GitHub GETs). Wrapping
 * the adapter for that one call makes the second pass a hit. The wrapper
 * is private to that call: the shared adapter stays live, so a Save during
 * the open never reads this cache. A write through the wrapper drops the
 * cache before it delegates. A failed read is not cached, so a retry still
 * hits the network.
 *
 * When the caller has already read the branch tip, reads of that branch
 * name and of that sha share one key. `getBranch` stays live: if it
 * returns a different sha, the memo is dropped before the open lists
 * the sidecar tree.
 */

function repoKey(repo) {
  const owner = typeof repo?.owner === 'string'
    ? repo.owner
    : (typeof repo?.owner?.login === 'string' ? repo.owner.login : '');
  const name = typeof repo?.name === 'string' ? repo.name : '';
  return `${owner}\0${name}`;
}

/** Stable key for a read, or '' when the call should not be cached. */
export function vaultReadKey(method, args) {
  const repo = repoKey(args?.[0]);
  if (!repo || repo === '\0') return '';
  if (method === 'listTree') {
    const ref = args[1] == null ? '' : String(args[1]);
    const prefix = args[2] && args[2].prefix != null ? String(args[2].prefix) : '';
    return `listTree\0${repo}\0${ref}\0${prefix}`;
  }
  if (method === 'readFile') {
    const path = args[1] == null ? '' : String(args[1]);
    const ref = args[2] == null ? '' : String(args[2]);
    return `readFile\0${repo}\0${path}\0${ref}`;
  }
  return '';
}

const CACHED_READS = ['listTree', 'readFile'];

/** Mutations. `commitFiles` is the vault write; the other names are the same idea. */
const WRITE_METHODS = [
  'writeFile',
  'deleteFile',
  'commit',
  'commitFiles',
  'createRepo',
  'createBranch',
  'deleteBranch',
  'squashMerge',
];

/**
 * Adapter that memoizes successful `listTree` and `readFile` calls.
 * A write clears that memo before it delegates, including a read that is
 * still in flight, so the next read cannot store the pre-write result.
 *
 * `pin.tip` is the branch sha read before the name lookup. Reads of
 * `pin.branch` are stored under that sha, so a later read of the sha
 * (lastCommit) is the same snapshot. A live `getBranch` that disagrees
 * drops the memo and the following read uses the new tip.
 */
export function cacheVaultReads(adapter, pin = null) {
  if (!adapter || typeof adapter !== 'object') return adapter;
  const cache = new Map();
  const inflight = new Map();
  let generation = 0;
  const branchName = typeof pin?.branch === 'string' ? pin.branch : '';
  let pinned = typeof pin?.tip === 'string' && pin.tip ? pin.tip : '';
  const drop = () => {
    generation += 1;
    cache.clear();
    inflight.clear();
  };
  const keyFor = (method, args) => {
    if (!pinned) return vaultReadKey(method, args);
    const ref = method === 'listTree' ? args[1] : method === 'readFile' ? args[2] : null;
    const text = ref == null ? '' : String(ref);
    if (text !== pinned && text !== branchName) return vaultReadKey(method, args);
    const copy = args.slice();
    if (method === 'listTree') copy[1] = pinned;
    else copy[2] = pinned;
    return vaultReadKey(method, copy);
  };
  const wrapped = { ...adapter };
  for (const name of CACHED_READS) {
    const fn = adapter[name];
    if (typeof fn !== 'function') continue;
    wrapped[name] = (...args) => {
      const key = keyFor(name, args);
      if (!key) return fn.apply(adapter, args);
      if (cache.has(key)) {
        const hit = cache.get(key);
        return Promise.resolve(Array.isArray(hit) ? hit.slice() : hit);
      }
      const pending = inflight.get(key);
      if (pending) return pending;
      const gen = generation;
      const next = Promise.resolve()
        .then(() => fn.apply(adapter, args))
        .then((result) => {
          inflight.delete(key);
          if (gen === generation) cache.set(key, result);
          return Array.isArray(result) ? result.slice() : result;
        }, (err) => {
          inflight.delete(key);
          throw err;
        });
      inflight.set(key, next);
      return next;
    };
  }
  for (const name of WRITE_METHODS) {
    const fn = adapter[name];
    if (typeof fn !== 'function') continue;
    wrapped[name] = (...args) => {
      drop();
      return fn.apply(adapter, args);
    };
  }
  const readBranch = adapter.getBranch;
  if (typeof readBranch === 'function') {
    wrapped.getBranch = async (...args) => {
      const info = await readBranch.apply(adapter, args);
      const name = args[1] == null ? '' : String(args[1]);
      const sha = info?.sha ? String(info.sha) : '';
      if (pinned && branchName && name === branchName && sha && sha !== pinned) {
        drop();
        pinned = sha;
      }
      return info;
    };
  }
  return wrapped;
}

/**
 * Short-lived read cache for one `open_assembly` call.
 *
 * The name lookup lists the vault, then the open lists it again
 * (`surfcad.json` plus two tree listings, about 7 GitHub GETs). Wrapping
 * the adapter for that one call makes the second pass a hit. Writes are
 * not cached. A failed read is not cached, so a retry still hits the network.
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

/**
 * Adapter that memoizes successful `listTree` and `readFile` calls.
 * Everything else, including writes, goes straight through.
 */
export function cacheVaultReads(adapter) {
  if (!adapter || typeof adapter !== 'object') return adapter;
  const cache = new Map();
  const inflight = new Map();
  const wrapped = { ...adapter };
  for (const name of CACHED_READS) {
    const fn = adapter[name];
    if (typeof fn !== 'function') continue;
    wrapped[name] = (...args) => {
      const key = vaultReadKey(name, args);
      if (!key) return fn.apply(adapter, args);
      if (cache.has(key)) {
        const hit = cache.get(key);
        return Promise.resolve(Array.isArray(hit) ? hit.slice() : hit);
      }
      const pending = inflight.get(key);
      if (pending) return pending;
      const next = Promise.resolve()
        .then(() => fn.apply(adapter, args))
        .then((result) => {
          cache.set(key, result);
          inflight.delete(key);
          return Array.isArray(result) ? result.slice() : result;
        }, (err) => {
          inflight.delete(key);
          throw err;
        });
      inflight.set(key, next);
      return next;
    };
  }
  return wrapped;
}

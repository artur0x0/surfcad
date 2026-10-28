/**
 * `Promise.all` with a concurrency cap: `fn(item, index)` runs for every
 * item, at most `limit` at a time, results in input order. The vault reads
 * use it so an Open costs about N/8 round-trip-equivalents instead of N
 * sequential ones, without hitting GitHub's secondary rate limit the way an
 * uncapped burst of 60 requests would. The first rejection rejects the
 * whole call, as `Promise.all` does; items already started finish on their
 * own.
 */
export const VAULT_READ_CONCURRENCY = 8;

export async function mapLimit(items, limit, fn) {
  const list = Array.isArray(items) ? items : [...(items || [])];
  const n = Math.max(1, Math.floor(Number(limit) || 1));
  const out = new Array(list.length);
  let next = 0;
  let failed = null;
  async function worker() {
    while (next < list.length) {
      if (failed) return;
      const i = next;
      next += 1;
      try {
        out[i] = await fn(list[i], i);
      } catch (err) {
        if (!failed) failed = { err };
        throw err;
      }
    }
  }
  const workers = [];
  for (let k = 0; k < Math.min(n, list.length); k += 1) workers.push(worker());
  await Promise.all(workers);
  return out;
}

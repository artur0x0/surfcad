/**
 * Git timings: how many adapter calls and HTTP round trips an operation
 * made, and how long each took. The vault is GitHub's REST API called from
 * the browser, one round trip per call and most callers run them one after
 * another, so the round-trip count is the whole cost model (B17).
 *
 * - `wrapAdapter(adapter)` times every adapter method (mock or real).
 * - `wrapFetch(fetchImpl)` times every HTTP request the real adapter makes
 *   (`listTree` is three requests, `commitFiles` is a dozen).
 * - `begin(op)` opens a span (`open`, `save`); the calls made until `end()`
 *   are summarised and kept as `last()` / `history()`.
 *
 * Nothing here changes what the adapter does; it only counts. The summary
 * is always kept (it is a few hundred bytes); the per-call console lines
 * print only in dev or with `globalThis.__SURFCAD_GIT_TIMING = true`.
 */
import { GITHUB_ADAPTER_METHODS } from './githubAdapterInterface.js';

export const GIT_TIMING_FLAG = '__SURFCAD_GIT_TIMING';
export const GIT_TIMINGS_LAST = '__SURFCAD_GIT_TIMINGS';
const HISTORY_MAX = 20;
const ROWS_MAX = 400;

export function gitTimingOn() {
  try {
    if (globalThis[GIT_TIMING_FLAG]) return true;
  } catch { /* no globalThis */ }
  try {
    return import.meta.env?.DEV === true;
  } catch {
    return false;
  }
}

function nowMs() {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function round1(ms) {
  return Math.round(ms * 10) / 10;
}

/** `GET git/trees/:sha` from a full GitHub URL: the shape, not the ids. */
export function endpointLabel(method, url) {
  let path = String(url || '');
  try {
    const u = new URL(path);
    path = u.pathname;
  } catch { /* relative or odd */ }
  const parts = path.split('/').filter(Boolean);
  // /repos/:owner/:repo/<rest>
  if (parts[0] === 'repos' && parts.length >= 3) parts.splice(0, 3);
  const shaped = parts.map((p) => (/^[0-9a-f]{40}$/i.test(p) ? ':sha' : p));
  // contents/<path...> and branches/<name> keep only the first segment.
  const head = shaped[0];
  if ((head === 'contents' || head === 'branches') && shaped.length > 1) shaped.splice(1, shaped.length - 1, ':path');
  if (head === 'compare' && shaped.length > 1) shaped.splice(1, shaped.length - 1, ':range');
  return `${String(method || 'GET').toUpperCase()} ${shaped.join('/') || '/'}`;
}

function bump(map, key, ms, ok) {
  const row = map[key] || (map[key] = { n: 0, ms: 0, failed: 0 });
  row.n += 1;
  row.ms = round1(row.ms + ms);
  if (!ok) row.failed += 1;
}

/**
 * @param {{ now?: () => number, log?: (line: string) => void, on?: () => boolean }} [deps]
 */
export function createGitTimings({ now = nowMs, log = (line) => console.info(line), on = gitTimingOn } = {}) {
  let span = null;
  let last = null;
  const history = [];
  let unscoped = { calls: 0, http: 0 };

  function record(row) {
    if (on()) {
      const what = row.kind === 'http' ? row.endpoint : row.method;
      log(`[git] ${what} ${round1(row.ms)} ms${row.ok ? '' : ' (failed)'}`);
    }
    if (!span) {
      if (row.kind === 'http') unscoped.http += 1; else unscoped.calls += 1;
      return;
    }
    if (row.kind === 'http') {
      span.http += 1;
      bump(span.byEndpoint, row.endpoint, row.ms, row.ok);
    } else {
      span.calls += 1;
      bump(span.byMethod, row.method, row.ms, row.ok);
    }
    if (span.rows.length < ROWS_MAX) span.rows.push(row);
  }

  function begin(op) {
    // A span that was never ended (a thrown open) is closed by the next one.
    if (span) finish(span, false);
    span = {
      op: String(op || 'op'),
      startedAt: now(),
      calls: 0,
      http: 0,
      byMethod: {},
      byEndpoint: {},
      rows: [],
    };
    const mine = span;
    return (ok = true) => (span === mine ? finish(mine, ok) : null);
  }

  function finish(s, ok) {
    const summary = {
      op: s.op,
      ok: !!ok,
      ms: round1(now() - s.startedAt),
      calls: s.calls,
      http: s.http,
      byMethod: s.byMethod,
      byEndpoint: s.byEndpoint,
      rows: s.rows.map((r) => ({ ...r, ms: round1(r.ms) })),
      at: Date.now(),
    };
    span = null;
    last = summary;
    history.push(summary);
    if (history.length > HISTORY_MAX) history.shift();
    try { globalThis[GIT_TIMINGS_LAST] = summary; } catch { /* no globalThis */ }
    if (on()) {
      const http = summary.http ? `, ${summary.http} HTTP` : '';
      log(`[git] ${summary.op}: ${summary.calls} adapter calls${http}, ${(summary.ms / 1000).toFixed(1)} s${ok ? '' : ' (failed)'}`);
    }
    return summary;
  }

  /** Run `fn` inside a span; the span closes however `fn` ends. */
  async function measure(op, fn) {
    const end = begin(op);
    try {
      const out = await fn();
      end(true);
      return out;
    } catch (err) {
      end(false);
      throw err;
    }
  }

  function wrapAdapter(adapter) {
    if (!adapter || typeof adapter !== 'object' || adapter.__gitTimed) return adapter;
    const timed = new Map();
    for (const name of GITHUB_ADAPTER_METHODS) {
      const inner = adapter[name];
      if (typeof inner !== 'function') continue;
      timed.set(name, async function timedAdapterCall(...args) {
        const t0 = now();
        let ok = true;
        try {
          return await inner.apply(adapter, args);
        } catch (err) {
          ok = false;
          throw err;
        } finally {
          record({ kind: 'adapter', method: name, ms: now() - t0, ok });
        }
      });
    }
    return new Proxy(adapter, {
      get(target, key, receiver) {
        if (key === '__gitTimed') return true;
        if (timed.has(key)) return timed.get(key);
        return Reflect.get(target, key, receiver);
      },
    });
  }

  function wrapFetch(fetchImpl) {
    if (typeof fetchImpl !== 'function') return fetchImpl;
    return async function timedFetch(url, init) {
      const t0 = now();
      const method = init?.method || 'GET';
      const endpoint = endpointLabel(method, typeof url === 'string' ? url : url?.url);
      let ok = true;
      try {
        const res = await fetchImpl(url, init);
        ok = !!res?.ok;
        return res;
      } catch (err) {
        ok = false;
        throw err;
      } finally {
        record({ kind: 'http', method, endpoint, ms: now() - t0, ok });
      }
    };
  }

  return {
    begin,
    measure,
    wrapAdapter,
    wrapFetch,
    record,
    last: () => last,
    history: () => history.slice(),
    /** What the agent command returns: the last span and the recent ones without their rows. */
    snapshot: () => ({
      last,
      history: history.map(({ rows, ...rest }) => ({ ...rest, rowCount: rows.length })),
      unscoped: { ...unscoped },
    }),
    reset: () => { span = null; last = null; history.length = 0; unscoped = { calls: 0, http: 0 }; },
  };
}

/** The app's recorder: `ensureGitAdapter` wraps through it, Open and Save span through it. */
export const gitTimings = createGitTimings();

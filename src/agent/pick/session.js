/**
 * Agent pick sessions (H9).
 *
 * One session at a time per bridge. A session targets one consumer: the
 * plain viewport selection, or one open picker card (Fillet, Shell, ...).
 * The store keeps what the agent picked; the Viewport keeps what is shown.
 * Every change republishes the whole list (base + agent picks) so the
 * consumer ends in the same state a run of taps would leave.
 *
 * An entry is one consumer item (a face pick or an edge segment) with an
 * `id` the Viewport computed. A pick is one agent key and the entries it
 * resolved to: a grouped edge key can be a whole tangent chain.
 */

export const PICK_DEFAULT_TIMEOUT_MS = 120000;
export const PICK_MIN_TIMEOUT_MS = 1000;
export const PICK_MAX_TIMEOUT_MS = 1800000;

function round(value, step) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const r = Math.round(n / step) * step;
  return Object.is(r, -0) ? 0 : Number(r.toFixed(6));
}

function faceKeyId(key) {
  if (!key || typeof key !== 'object' || Array.isArray(key)) return null;
  if (!Array.isArray(key.at) || !Array.isArray(key.n)) return null;
  const parts = [
    key.at.slice(0, 3).map((v) => round(v, 1e-3)).join(','),
    key.n.slice(0, 3).map((v) => round(v, 1e-4)).join(','),
    String(round(key.area, 1e-3)),
  ];
  if (Number.isInteger(key.src)) parts.push(`s${key.src}`);
  if (Number.isInteger(key.ord)) parts.push(`o${key.ord}`);
  return parts.join('|');
}

/** Stable id for an agent key, used to dedupe and to match `remove`. */
export function pickKeyId(kind, key) {
  if (kind === 'face') {
    const id = faceKeyId(key);
    return id ? `f:${id}` : null;
  }
  if (typeof key === 'string' && key) return `e:${key}`;
  if (key && typeof key === 'object' && !Array.isArray(key)) {
    const a = faceKeyId(key.faceKeyA || key.faceA || key.faceKeys?.[0]);
    const b = faceKeyId(key.faceKeyB || key.faceB || key.faceKeys?.[1]);
    if (!a || !b) return null;
    const [lo, hi] = a < b ? [a, b] : [b, a];
    return `p:${lo}#${hi}`;
  }
  return null;
}

function copyEntries(list) {
  const out = [];
  for (const row of Array.isArray(list) ? list : []) {
    if (row && typeof row.id === 'string' && row.id) out.push({ id: row.id, entry: row.entry });
  }
  return out;
}

/** Base entries, then each pick's entries, first occurrence wins. */
export function sessionEntries(session) {
  const seen = new Set();
  const out = [];
  const push = (row) => {
    if (seen.has(row.id)) return;
    seen.add(row.id);
    out.push(row);
  };
  for (const row of session.base) push(row);
  for (const pick of session.picks) for (const row of pick.entries) push(row);
  return out;
}

/** Items the min/max rule counts: seeded entries plus agent keys. */
export function sessionCount(session) {
  return session.base.length + session.picks.length;
}

/**
 * Add resolved picks. `resolved` is `[{ key, id, entries }]`, one per agent
 * key, in call order. A key that is already picked is skipped, not toggled.
 */
export function addPicks(session, resolved) {
  const have = new Set(session.picks.map((pick) => pick.id));
  const fresh = [];
  let skipped = 0;
  for (const row of resolved) {
    if (have.has(row.id)) {
      skipped += 1;
      continue;
    }
    have.add(row.id);
    fresh.push({ key: row.key, id: row.id, entries: copyEntries(row.entries) });
  }
  const total = sessionCount(session) + fresh.length;
  if (Number.isInteger(session.max) && total > session.max) {
    return {
      error: {
        code: 'pick_limit',
        message: `This pick takes at most ${session.max}; ${total} would be picked`,
        details: { max: session.max, count: sessionCount(session), adding: fresh.length },
      },
    };
  }
  return {
    session: { ...session, picks: [...session.picks, ...fresh] },
    added: fresh.length,
    skipped,
  };
}

/**
 * Remove resolved picks. An agent key drops its pick. A key that matches
 * seeded entries (a preselection or an edit card's stored edges) drops
 * those entries, the same as tapping them off.
 */
export function removePicks(session, resolved) {
  const ids = new Set(resolved.map((row) => row.id));
  const entryIds = new Set();
  for (const row of resolved) for (const entry of row.entries || []) entryIds.add(entry.id);
  const picks = session.picks.filter((pick) => !ids.has(pick.id)
    && !pick.entries.some((entry) => entryIds.has(entry.id)));
  const base = session.base.filter((row) => !entryIds.has(row.id));
  const removed = (session.picks.length - picks.length) + (session.base.length - base.length);
  if (!removed) {
    return { error: { code: 'not_picked', message: 'None of those keys are picked in this session' } };
  }
  return { session: { ...session, picks, base }, removed };
}

export function popPick(session) {
  if (!session.picks.length) {
    return { error: { code: 'nothing_to_undo', message: 'No agent pick to undo in this session' } };
  }
  return { session: { ...session, picks: session.picks.slice(0, -1) } };
}

export function clearPicks(session) {
  return { ...session, base: [], picks: [] };
}

/**
 * `min` / `max` / `timeout_ms` from args. Returns `{ min, max, timeoutMs }`
 * or `{ error }`.
 */
export function readPickLimits(args = {}) {
  const min = args.min == null ? 1 : args.min;
  if (!Number.isInteger(min) || min < 0) {
    return { error: { code: 'bad_args', message: 'min must be an integer >= 0' } };
  }
  let max = null;
  if (args.max != null) {
    if (!Number.isInteger(args.max) || args.max < 1 || args.max < min) {
      return { error: { code: 'bad_args', message: 'max must be an integer >= 1 and >= min' } };
    }
    max = args.max;
  }
  const timeoutMs = args.timeout_ms == null ? PICK_DEFAULT_TIMEOUT_MS : args.timeout_ms;
  if (!Number.isInteger(timeoutMs) || timeoutMs < PICK_MIN_TIMEOUT_MS || timeoutMs > PICK_MAX_TIMEOUT_MS) {
    return {
      error: {
        code: 'bad_args',
        message: `timeout_ms must be an integer from ${PICK_MIN_TIMEOUT_MS} to ${PICK_MAX_TIMEOUT_MS}`,
      },
    };
  }
  return { min, max, timeoutMs };
}

/**
 * The bridge's session slot. A session idle past its `timeoutMs` expires:
 * the next call that needs it gets `pick_timeout` once, then the slot is
 * free. What was picked stays in the viewport, the same as walking away
 * from a card.
 */
export function createPickSessions({ now = () => Date.now() } = {}) {
  let session = null;
  let expired = null;
  let seq = 0;

  function sweep() {
    if (session && now() - session.lastAt > session.timeoutMs) {
      expired = { id: session.id, target: session.target, idleMs: now() - session.lastAt };
      session = null;
    }
  }

  return {
    /** Live session or null. Does not consume an expiry. */
    peek() {
      sweep();
      return session;
    },
    /** `{ session }`, or `{ error }` for none / expired. An expiry is reported once. */
    take() {
      sweep();
      if (session) return { session };
      if (expired) {
        const gone = expired;
        expired = null;
        return {
          error: {
            code: 'pick_timeout',
            message: `Pick session ${gone.id} expired after ${gone.idleMs} ms idle`,
            details: { session: gone.id, target: gone.target, idleMs: gone.idleMs },
          },
        };
      }
      return { error: { code: 'no_pick_session', message: 'No pick session is open. Call pick_begin first.' } };
    },
    begin(fields) {
      seq += 1;
      const t = now();
      expired = null;
      session = {
        id: `pick-${seq}`,
        kind: fields.kind,
        target: fields.target,
        tool: fields.tool || null,
        opened: !!fields.opened,
        editing: !!fields.editing,
        min: fields.min,
        max: fields.max ?? null,
        timeoutMs: fields.timeoutMs,
        original: copyEntries(fields.original),
        base: copyEntries(fields.base),
        picks: [],
        startedAt: t,
        lastAt: t,
      };
      return session;
    },
    /** Store an updated session and reset its idle clock. */
    save(next) {
      session = { ...next, lastAt: now() };
      return session;
    },
    end() {
      const out = session;
      session = null;
      expired = null;
      return out;
    },
    expiresInMs(s) {
      return Math.max(0, s.timeoutMs - (now() - s.lastAt));
    },
  };
}

/** JSON summary of a session for command results. */
export function summarizeSession(store, session) {
  return {
    session: session.id,
    target: session.target,
    tool: session.tool,
    kind: session.kind,
    count: sessionCount(session),
    seeded: session.base.length,
    picks: session.picks.map((pick) => JSON.parse(JSON.stringify(pick.key))),
    entries: sessionEntries(session).length,
    min: session.min,
    max: session.max,
    opened: session.opened,
    editing: session.editing,
    expiresInMs: store.expiresInMs(session),
  };
}

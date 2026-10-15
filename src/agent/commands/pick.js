/**
 * H9 pick sessions: `pick_begin` → `pick_next`* → `pick_done`.
 *
 * A session feeds the same consumer a tap would: the viewport selection
 * (what `use_selection` reads) or the open picker card (Fillet, Chamfer,
 * Shell, Draft, Move Face, Delete Face). Keys are the stable ids from
 * `list_faces` / `list_feature_edges`, never screen points.
 *
 * `pick_done { accept: true }` presses the card's own Accept, so the card's
 * gates and compose run unchanged, then records one undo step and waits
 * for the run.
 */

import {
  addPicks,
  clearPicks,
  pickKeyId,
  popPick,
  readPickLimits,
  removePicks,
  sessionCount,
  sessionEntries,
  summarizeSession,
} from '../pick/session.js';
import {
  PICK_KINDS,
  PICK_TOOLS,
  PICK_TOOL_IDS,
  PICK_TOOL_UI_ENTRIES,
  checkToolParams,
  pickerBusyError,
} from '../pick/tools.js';

/** How long a published pick may take to show in the viewport. */
export const PICK_SETTLE_MS = 6000;
const POLL_MS = 16;

const HOST_FNS = ['pickInfo', 'pickEnter', 'pickResolve', 'pickRead', 'pickWrite', 'pickParams', 'pickAccept', 'pickExit'];

function missingHost(ctx) {
  for (const name of HOST_FNS) {
    if (typeof ctx[name] !== 'function') {
      return { error: { code: 'internal', message: `${name} handler is missing` } };
    }
  }
  if (!ctx.pickSessions) return { error: { code: 'internal', message: 'pick session store is missing' } };
  return null;
}

function wait(ctx, ms) {
  if (typeof ctx.wait === 'function') return ctx.wait(ms);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Poll `read` until `done(value)`; resolves to the last value and whether it passed. */
async function until(ctx, read, done, ms = PICK_SETTLE_MS) {
  const steps = Math.max(1, Math.ceil(ms / POLL_MS));
  let value = read();
  for (let i = 0; i < steps && !done(value); i++) {
    await wait(ctx, POLL_MS);
    value = read();
  }
  return { value, ok: done(value) };
}

function keysFrom(args) {
  if (Array.isArray(args?.keys)) return args.keys;
  if (args?.key != null) return [args.key];
  return [];
}

function settleError(target, want, got) {
  return {
    code: 'pick_timeout',
    message: `The ${target} picker did not show the pick within ${PICK_SETTLE_MS} ms`,
    details: { target, expected: want, shown: got },
  };
}

/** Publish the session's entries and wait for the consumer to show them. */
async function publish(ctx, session) {
  const entries = sessionEntries(session);
  const wrote = ctx.pickWrite({ entries });
  if (wrote?.error) return { error: wrote.error };
  const want = Number.isInteger(wrote?.count) ? wrote.count : entries.length;
  const ids = Array.isArray(wrote?.ids) ? wrote.ids.join('\n') : null;
  const shown = await until(
    ctx,
    () => ctx.pickRead(),
    (read) => !!read && read.settled === true && read.entries.length === want
      && (ids == null || read.entries.map((row) => row.id).join('\n') === ids),
  );
  if (!shown.ok) return { error: settleError(session.target, want, shown.value?.entries?.length ?? null) };
  if (want < entries.length) {
    return {
      error: {
        code: 'pick_rejected',
        message: `The ${session.target} picker kept ${want} of ${entries.length} picks`,
        details: { target: session.target, expected: entries.length, shown: want },
      },
    };
  }
  return { ok: true };
}

/** Live session whose consumer is still the one it began on. */
function liveSession(ctx) {
  const taken = ctx.pickSessions.take();
  if (taken.error) return taken;
  const info = ctx.pickInfo() || {};
  const moved = info.target !== taken.session.target
    || (info.target === 'selection' && info.kind !== taken.session.kind);
  if (moved) {
    ctx.pickSessions.end();
    return {
      error: {
        code: 'pick_closed',
        message: `The ${taken.session.target} picker closed during the pick session`,
        details: { target: taken.session.target, now: info.target ?? null, viewport: info.busy ?? null },
      },
    };
  }
  return { session: taken.session };
}

function resolveKeys(ctx, kind, keys) {
  const ids = [];
  for (let i = 0; i < keys.length; i++) {
    const id = pickKeyId(kind, keys[i]);
    if (!id) {
      const want = kind === 'face'
        ? 'a list_faces key { at, n, area }'
        : 'a list_feature_edges id (eN), a list_edges key, or { faceKeyA, faceKeyB }';
      return { error: { code: 'bad_args', message: `key at index ${i} is not ${want}` } };
    }
    ids.push(id);
  }
  const out = ctx.pickResolve({ kind, keys });
  if (out?.error) return { error: out.error };
  const groups = Array.isArray(out?.groups) ? out.groups : [];
  if (groups.length !== keys.length) {
    return { error: { code: 'internal', message: 'pickResolve returned the wrong number of groups' } };
  }
  return {
    resolved: keys.map((key, i) => ({ key, id: ids[i], entries: groups[i] })),
  };
}

const KEY_PROPS = Object.freeze({
  keys: { type: 'array', description: 'Face keys (list_faces) or edge ids (list_feature_edges eN, list_edges key, or { faceKeyA, faceKeyB })' },
  key: { description: 'One key; same forms as keys' },
});

const BEGIN_PROPS = Object.freeze({
  kind: { type: 'string', enum: PICK_KINDS.slice(), description: 'face or edge. Required for the plain selection; must match the card when one is open.' },
  tool: { type: 'string', enum: PICK_TOOL_IDS.slice(), description: 'Open this picker card, the same as its rail button. Omit to feed the open card or the selection.' },
  keep: { type: 'boolean', description: 'Keep picks already there. Default: false for the selection, true for a card (its preselection or stored edges).' },
  min: { type: 'integer', minimum: 0, description: 'Fewest picks pick_done accepts. Default 1.' },
  max: { type: 'integer', minimum: 1, description: 'Most picks. Default no limit.' },
  timeout_ms: { type: 'integer', minimum: 1000, maximum: 1800000, description: 'Idle time before the session expires. Default 120000.' },
  params: { type: 'object', additionalProperties: true, description: 'Card fields: fillet radius, chamfer chamfer, shell wall/openingMode, draft angle/flip, moveFace distance/flip.' },
  replace: { type: 'boolean', description: 'End a live session instead of failing with pick_open.' },
});

function checkBeginArgs(args) {
  if (args.kind != null && !PICK_KINDS.includes(args.kind)) {
    return { code: 'bad_args', message: 'kind must be face or edge' };
  }
  if (args.tool != null && !PICK_TOOLS[args.tool]) {
    return { code: 'bad_args', message: `tool must be one of: ${PICK_TOOL_IDS.join(', ')}` };
  }
  if (args.keep != null && typeof args.keep !== 'boolean') {
    return { code: 'bad_args', message: 'keep must be a boolean' };
  }
  if (args.replace != null && typeof args.replace !== 'boolean') {
    return { code: 'bad_args', message: 'replace must be a boolean' };
  }
  const limits = readPickLimits(args);
  if (limits.error) return limits.error;
  if (args.tool && args.params != null) return checkToolParams(args.tool, args.params);
  if (args.params != null && (typeof args.params !== 'object' || Array.isArray(args.params))) {
    return { code: 'bad_args', message: 'params must be an object' };
  }
  return null;
}

function checkKeyArgs(name) {
  return (args) => {
    if (!keysFrom(args).length) return { code: 'bad_args', message: `${name} needs keys or key` };
    if (args.remove != null && typeof args.remove !== 'boolean') {
      return { code: 'bad_args', message: 'remove must be a boolean' };
    }
    return null;
  };
}

function wrongKind(kind, target, want) {
  return {
    code: 'wrong_kind',
    message: `${target} picks ${want}s, not ${kind}s`,
    details: { target, kind: want },
  };
}

export async function beginPick(ctx, args) {
  const missing = missingHost(ctx);
  if (missing) return missing;
  const store = ctx.pickSessions;
  const live = store.peek();
  if (live && !args.replace) {
    return {
      error: {
        code: 'pick_open',
        message: `Pick session ${live.id} is open on ${live.target}. Finish it, cancel it, or pass replace: true.`,
        details: summarizeSession(store, live),
      },
    };
  }
  if (live) store.end();

  const limits = readPickLimits(args);
  if (limits.error) return { error: limits.error };

  // An edit card opened by open_feature launches after an async preview run.
  const settled = await until(ctx, () => ctx.pickInfo() || {}, (info) => !info.opening);
  let info = settled.value;
  if (info.opening) {
    return { error: { code: 'pick_timeout', message: 'The edit card did not finish opening', details: { target: null } } };
  }
  if (info.hasMesh === false) return { error: { code: 'no_mesh', message: 'No mesh to pick on' } };
  if (info.busy) return { error: pickerBusyError(info.busy, args.tool || null) };

  let target = info.target;
  let opened = false;
  let kind;
  if (args.tool) {
    const spec = PICK_TOOLS[args.tool];
    if (args.kind && args.kind !== spec.kind) return { error: wrongKind(args.kind, args.tool, spec.kind) };
    kind = spec.kind;
    if (target !== args.tool) {
      if (target !== 'selection') {
        return { error: pickerBusyError(PICK_TOOLS[target]?.viewport || target, args.tool) };
      }
      const entered = ctx.pickEnter({ tool: args.tool });
      if (entered?.error) return { error: entered.error };
      opened = true;
      const shown = await until(ctx, () => ctx.pickInfo() || {}, (row) => row.target === args.tool);
      if (!shown.ok) {
        return { error: { code: 'pick_timeout', message: `${args.tool} card did not open`, details: { target: args.tool } } };
      }
      info = shown.value;
      target = args.tool;
    }
  } else if (target === 'selection') {
    if (!args.kind) {
      return { error: { code: 'bad_args', message: 'pick_begin needs kind (face or edge) or tool when no picker card is open' } };
    }
    if (args.params != null) {
      return { error: { code: 'bad_args', message: 'params need a picker card (tool)' } };
    }
    kind = args.kind;
    const entered = ctx.pickEnter({ kind });
    if (entered?.error) return { error: entered.error };
  } else {
    const want = PICK_TOOLS[target].kind;
    if (args.kind && args.kind !== want) return { error: wrongKind(args.kind, target, want) };
    kind = want;
    const bad = checkToolParams(target, args.params);
    if (bad) return { error: bad };
  }

  const fail = (error) => {
    if (opened) ctx.pickExit();
    return { error };
  };

  if (args.params != null) {
    const set = ctx.pickParams({ params: args.params });
    if (set?.error) return fail(set.error);
  }

  const first = await until(ctx, () => ctx.pickRead(), (read) => !!read && read.settled === true);
  if (!first.ok) return fail(settleError(target, null, null));
  const original = first.value.entries;
  const keep = args.keep ?? (target !== 'selection');
  let session = store.begin({
    kind,
    target,
    tool: target === 'selection' ? null : target,
    opened,
    editing: !!info.editing,
    min: limits.min,
    max: limits.max,
    timeoutMs: limits.timeoutMs,
    original,
    base: keep ? original : [],
  });
  if (!keep && original.length) {
    const shown = await publish(ctx, session);
    if (shown.error) {
      store.end();
      return fail(shown.error);
    }
  }
  if (Number.isInteger(session.max) && sessionCount(session) > session.max) {
    store.end();
    return fail({
      code: 'pick_limit',
      message: `${sessionCount(session)} picks are already there; max is ${session.max}. Pass keep: false to start empty.`,
      details: { max: session.max, count: sessionCount(session) },
    });
  }
  session = store.save(session);
  return { result: summarizeSession(store, session) };
}

export async function nextPick(ctx, args) {
  const missing = missingHost(ctx);
  if (missing) return missing;
  const store = ctx.pickSessions;
  const live = liveSession(ctx);
  if (live.error) return live;
  const resolved = resolveKeys(ctx, live.session.kind, keysFrom(args));
  if (resolved.error) {
    store.save(live.session);
    return resolved;
  }
  const changed = args.remove
    ? removePicks(live.session, resolved.resolved)
    : addPicks(live.session, resolved.resolved);
  if (changed.error) {
    store.save(live.session);
    return changed;
  }
  const shown = await publish(ctx, changed.session);
  if (shown.error) {
    // Put the consumer back to what the session last showed.
    await publish(ctx, live.session);
    store.save(live.session);
    return shown;
  }
  const session = store.save(changed.session);
  const result = summarizeSession(store, session);
  if (args.remove) result.removed = changed.removed;
  else {
    result.added = changed.added;
    result.skipped = changed.skipped;
  }
  return { result };
}

async function editPick(ctx, edit) {
  const missing = missingHost(ctx);
  if (missing) return missing;
  const store = ctx.pickSessions;
  const live = liveSession(ctx);
  if (live.error) return live;
  const changed = edit(live.session);
  if (changed.error) {
    store.save(live.session);
    return changed;
  }
  const shown = await publish(ctx, changed.session);
  if (shown.error) {
    store.save(live.session);
    return shown;
  }
  return { result: summarizeSession(store, store.save(changed.session)) };
}

function countError(session) {
  const count = sessionCount(session);
  if (count >= session.min) return null;
  if (count === 0) {
    return {
      code: 'empty_pick',
      message: `Nothing is picked on ${session.target}`,
      details: { target: session.target, min: session.min },
    };
  }
  return {
    code: 'pick_count',
    message: `${session.target} needs at least ${session.min} picks; ${count} picked`,
    details: { target: session.target, min: session.min, count },
  };
}

export async function donePick(ctx, args = {}) {
  const missing = missingHost(ctx);
  if (missing) return missing;
  const store = ctx.pickSessions;
  const live = liveSession(ctx);
  if (live.error) return live;
  const session = live.session;
  const short = countError(session);
  if (short) {
    store.save(session);
    return { error: short };
  }
  const summary = summarizeSession(store, session);
  if (!args.accept) {
    store.end();
    return { result: { ...summary, done: true, accepted: false } };
  }
  if (session.target === 'selection') {
    store.save(session);
    return {
      error: {
        code: 'no_card',
        message: 'accept needs a picker card. For the selection, call the helper with use_selection.',
      },
    };
  }

  const before = ctx.getScript();
  const history = ctx.cloneHistory(ctx.readHistory());
  ctx.pickAccept();
  const closed = await until(ctx, () => ctx.pickInfo() || {}, (info) => info.target !== session.target, POLL_MS * 4);
  if (!closed.ok) {
    // The card refused: its gate toasts the reason and stays open.
    const toast = await until(ctx, () => ctx.pickInfo() || {}, (info) => !!info.toast, 500);
    store.save(session);
    return {
      error: {
        code: 'accept_refused',
        message: toast.value?.toast || `${session.target} did not accept`,
        details: { target: session.target },
      },
    };
  }
  store.end();
  const after = ctx.getScript();
  let outcome = { ok: true, errors: [], status: ctx.readStatus?.() };
  const changed = after !== before;
  if (changed) {
    // Accept wrote the buffer and pushed its own step, and queued the UI run.
    // Let that run start, then put the stack back and record one agent step;
    // mutate's run supersedes the UI one and is the one awaited.
    await wait(ctx, 0);
    ctx.writeHistory(history);
    outcome = await ctx.mutate(after, `Agent pick: ${session.target}`);
  }
  if (session.editing) ctx.dismissFeatureConfirmSession?.();
  return {
    result: {
      ...summary,
      done: true,
      accepted: true,
      unchanged: !changed,
      ok: outcome.ok === true,
      errors: outcome.errors || [],
      status: outcome.status,
    },
  };
}

export async function cancelPick(ctx) {
  const missing = missingHost(ctx);
  if (missing) return missing;
  const store = ctx.pickSessions;
  const taken = store.take();
  if (taken.error) return taken;
  const session = taken.session;
  store.end();
  const info = ctx.pickInfo() || {};
  if (info.target !== session.target) {
    return { result: { session: session.id, target: session.target, cancelled: true, restored: false } };
  }
  if (session.opened) {
    ctx.pickExit();
    return { result: { session: session.id, target: session.target, cancelled: true, closed: true } };
  }
  const restore = await publish(ctx, { ...session, base: session.original, picks: [] });
  if (restore.error) return restore;
  return { result: { session: session.id, target: session.target, cancelled: true, restored: true } };
}

export const pickBeginCommand = Object.freeze({
  name: 'pick_begin',
  uiEntry: PICK_TOOL_UI_ENTRIES.slice(),
  schema: Object.freeze({
    type: 'object',
    additionalProperties: true,
    properties: BEGIN_PROPS,
  }),
  example: { tool: 'filletEdges', params: { radius: 1 } },
  checkArgs: checkBeginArgs,
  run: beginPick,
});

export const pickNextCommand = Object.freeze({
  name: 'pick_next',
  schema: Object.freeze({
    type: 'object',
    additionalProperties: true,
    properties: {
      ...KEY_PROPS,
      remove: { type: 'boolean', description: 'Tap these picks off instead of on' },
    },
  }),
  example: { keys: ['e3'] },
  checkArgs: checkKeyArgs('pick_next'),
  run: nextPick,
});

export const pickUndoCommand = Object.freeze({
  name: 'pick_undo',
  schema: Object.freeze({ type: 'object', additionalProperties: true, properties: {} }),
  example: {},
  run(ctx) {
    return editPick(ctx, popPick);
  },
});

export const pickClearCommand = Object.freeze({
  name: 'pick_clear',
  schema: Object.freeze({ type: 'object', additionalProperties: true, properties: {} }),
  example: {},
  run(ctx) {
    return editPick(ctx, (session) => ({ session: clearPicks(session) }));
  },
});

export const pickDoneCommand = Object.freeze({
  name: 'pick_done',
  schema: Object.freeze({
    type: 'object',
    additionalProperties: true,
    properties: {
      accept: { type: 'boolean', description: 'Press the card Accept (one undo step, waits for the run). Omit to leave the picks for use_selection or a later Accept.' },
    },
  }),
  example: { accept: true },
  checkArgs(args) {
    if (args.accept != null && typeof args.accept !== 'boolean') {
      return { code: 'bad_args', message: 'accept must be a boolean' };
    }
    return null;
  },
  run: donePick,
});

export const pickCancelCommand = Object.freeze({
  name: 'pick_cancel',
  schema: Object.freeze({ type: 'object', additionalProperties: true, properties: {} }),
  example: {},
  run: cancelPick,
});

export const pickStateCommand = Object.freeze({
  name: 'pick_state',
  schema: Object.freeze({ type: 'object', additionalProperties: true, properties: {} }),
  example: {},
  immediate: true,
  run(ctx) {
    const info = typeof ctx.pickInfo === 'function' ? (ctx.pickInfo() || {}) : {};
    const store = ctx.pickSessions;
    const session = store ? store.peek() : null;
    return {
      result: {
        session: session ? summarizeSession(store, session) : null,
        target: info.target ?? null,
        kind: info.kind ?? null,
        viewport: info.busy ?? null,
        editing: !!info.editing,
      },
    };
  },
});

/** begin → next → done in one call; any failure after begin cancels the session. */
function oneShot(kind) {
  return async (ctx, args) => {
    const begun = await beginPick(ctx, { ...args, kind, replace: false });
    if (begun.error) return begun;
    const next = await nextPick(ctx, { keys: keysFrom(args) });
    if (next.error) {
      await cancelPick(ctx);
      return next;
    }
    const done = await donePick(ctx, { accept: args.accept === true });
    if (done.error && ctx.pickSessions.peek()) await cancelPick(ctx);
    return done;
  };
}

function oneShotSchema(kind) {
  const rest = { ...BEGIN_PROPS };
  delete rest.kind;
  delete rest.replace;
  return Object.freeze({
    type: 'object',
    additionalProperties: true,
    properties: {
      ...KEY_PROPS,
      ...rest,
      tool: {
        ...BEGIN_PROPS.tool,
        enum: PICK_TOOL_IDS.filter((id) => PICK_TOOLS[id].kind === kind),
      },
      accept: { type: 'boolean', description: 'Press the card Accept after picking (needs tool or an open card)' },
    },
  });
}

function checkOneShot(name, kind) {
  const keyCheck = checkKeyArgs(name);
  return (args) => {
    const bad = keyCheck(args);
    if (bad) return bad;
    if (args.tool != null && PICK_TOOLS[args.tool]?.kind !== kind) {
      return {
        code: 'bad_args',
        message: `${name} tool must be one of: ${PICK_TOOL_IDS.filter((id) => PICK_TOOLS[id].kind === kind).join(', ')}`,
      };
    }
    if (args.accept != null && typeof args.accept !== 'boolean') {
      return { code: 'bad_args', message: 'accept must be a boolean' };
    }
    return checkBeginArgs({ ...args, kind });
  };
}

export const pickFacesCommand = Object.freeze({
  name: 'pick_faces',
  schema: oneShotSchema('face'),
  example: { keys: [{ at: [0, 0, 10], n: [0, 0, 1], area: 400 }] },
  checkArgs: checkOneShot('pick_faces', 'face'),
  run: oneShot('face'),
});

export const pickEdgesCommand = Object.freeze({
  name: 'pick_edges',
  schema: oneShotSchema('edge'),
  example: { keys: ['e3'], tool: 'filletEdges', params: { radius: 1 }, accept: true },
  checkArgs: checkOneShot('pick_edges', 'edge'),
  run: oneShot('edge'),
});

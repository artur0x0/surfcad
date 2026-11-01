/**
 * Which row `create_part` just added. The host activates this id even when
 * the document's active id did not move, and runs its script (blank starter
 * included) before the call returns, so the new part is never not_run_yet.
 */

/**
 * The single part row present in `after` and absent from `before`.
 * Null when nothing new was added, or when more than one row appeared.
 * @param {{ parts?: Array<{ id?: string }> }|null|undefined} before
 * @param {{ parts?: Array<{ id?: string }> }|null|undefined} after
 */
export function createdPartFromDocs(before, after) {
  const beforeIds = new Set((before?.parts || []).map((row) => String(row?.id)));
  const created = (after?.parts || []).filter((row) => (
    row && row.id != null && row.id !== '' && !beforeIds.has(String(row.id))
  ));
  if (created.length !== 1) return null;
  return created[0];
}

/** In-flight key. A later create of the same name is a new part, not a replay. */
export function partCreateKey(name, script) {
  const title = String(name ?? '').trim();
  const text = typeof script === 'string' ? script : '';
  return `${title}\0${text}`;
}

/**
 * Serialize part creates. Calls that share a key while one is running share
 * its promise, so a double-dispatched create_part adds one row. After that
 * promise settles, the same name creates the next numbered part.
 */
export function createPartQueue() {
  let tail = Promise.resolve();
  const inflight = new Map();
  return function enqueue(key, run) {
    const existing = inflight.get(key);
    if (existing) return existing;
    const work = tail.then(() => run(), () => run());
    const tracked = work.finally(() => {
      if (inflight.get(key) === tracked) inflight.delete(key);
    });
    inflight.set(key, tracked);
    tail = tracked.then(() => {}, () => {});
    return tracked;
  };
}

/**
 * One part row, read from `state` at call time. The caller holds the create
 * queue, so a second create sees the row and script the first one wrote.
 * An empty editor buffer does not replace a stored script.
 */
export function commitPartCreate(state, partName, opts = {}, deps) {
  const doc = state?.doc;
  if (!doc || !deps) return null;
  const scripts = { ...(state.scripts || {}) };
  const prev = doc.activeId;
  const live = state.editorText;
  if (state.flushEditor !== false && prev && typeof live === 'string') {
    const stored = typeof scripts[prev] === 'string' ? scripts[prev] : '';
    if (live.trim() || !stored.trim()) scripts[prev] = live;
  }
  const id = typeof opts.id === 'string' && opts.id ? opts.id : deps.mintId();
  const takenNames = (doc.parts || []).map((part) => part.name);
  const rawName = String(partName ?? '').trim();
  const name = rawName
    ? deps.nextNumberedName(rawName, takenNames, { bareFirst: true })
    : deps.nextNumberedName('Part', takenNames);
  const order = (doc.parts || []).length;
  const rowPosition = Object.prototype.hasOwnProperty.call(opts, 'rowPosition')
    ? opts.rowPosition
    : deps.newPartRowPosition?.(order, { fromAgent: opts.fromAgent, position: opts.position });
  let starter;
  let surfId = null;
  if (typeof opts.starter === 'string') {
    starter = opts.starter;
    if (doc.source === 'git') surfId = id;
  } else {
    starter = typeof opts?.script === 'string' && opts.script.trim()
      ? deps.wrapRawScript(opts.script)
      : deps.starterScript();
    if (doc.source === 'git') {
      surfId = id;
      starter = deps.withSurfId(starter, surfId);
    }
  }
  const part = {
    id,
    name,
    visible: true,
    order,
    ...(rowPosition != null ? { position: rowPosition } : {}),
    ...(surfId ? { surfId, isSynced: false } : {}),
  };
  scripts[id] = starter;
  return {
    doc: { ...doc, activeId: id, parts: [...(doc.parts || []), part] },
    scripts,
    part,
    starter,
  };
}

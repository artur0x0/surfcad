/**
 * Compare live part scripts to a snapshot taken at open or last save/export.
 */

/**
 * Live editor text folded into agent snapshot / dirty.
 *
 * Same family as `gitDirtyLiveScript`: after open or reload the buffer can
 * still be the previous part (or '') until Monaco is live for this id.
 *
 * @returns {{ liveId: string, liveScript: string } | null}
 */
export function liveEditorOverride({
  editorLive = false,
  activeId = null,
  script = null,
} = {}) {
  if (editorLive !== true) return null;
  if (activeId == null || activeId === '') return null;
  if (typeof script !== 'string') return null;
  return { liveId: String(activeId), liveScript: script };
}

/** @param {Record<string, string>|null|undefined} scripts */
export function snapshotPartScripts(scripts, { liveId = null, liveScript = null } = {}) {
  const out = {};
  if (scripts && typeof scripts === 'object') {
    for (const [id, text] of Object.entries(scripts)) {
      if (typeof text === 'string') out[String(id)] = text;
    }
  }
  if (liveId != null && liveId !== '' && typeof liveScript === 'string') {
    out[String(liveId)] = liveScript;
  }
  return out;
}

/**
 * Part ids whose script text differs from the snapshot (or are new since snapshot).
 *
 * @param {Record<string, string>|null|undefined} snapshot
 * @param {Record<string, string>|null|undefined} scripts
 * @param {{ liveId?: string|null, liveScript?: string, partIds?: string[] }} [opts]
 * @returns {string[]}
 */
export function editedPartIdsSinceSnapshot(snapshot, scripts, opts = {}) {
  const snap = snapshot && typeof snapshot === 'object' ? snapshot : {};
  const live = scripts && typeof scripts === 'object' ? scripts : {};
  const ids = new Set();
  for (const id of opts.partIds || []) ids.add(String(id));
  for (const id of Object.keys(snap)) ids.add(String(id));
  for (const id of Object.keys(live)) ids.add(String(id));
  const liveId = opts.liveId != null && opts.liveId !== '' ? String(opts.liveId) : null;
  const liveScript = typeof opts.liveScript === 'string' ? opts.liveScript : null;
  const edited = [];
  for (const id of ids) {
    let current = live[id];
    if (liveId === id && liveScript != null) current = liveScript;
    if (typeof current !== 'string') continue;
    const base = snap[id];
    if (typeof base !== 'string' || current !== base) edited.push(id);
  }
  edited.sort();
  return edited;
}

/**
 * Identity of the open document for the `dirty.editedSinceLoad` snapshot:
 * the assembly id (else its name) and source. Part ids are not part of it,
 * so adding or removing a part does not re-baseline the parts that were
 * already edited (Pi 5 C1: the base's edits vanished when the lid was added).
 */
export function agentSnapshotDocKey(doc) {
  if (!doc || typeof doc !== 'object') return '';
  const identity = doc.id != null && doc.id !== '' ? `id:${doc.id}` : `name:${doc.name ?? ''}`;
  return `${identity}\0${doc.source ?? ''}`;
}

/**
 * Add parts that are new since the snapshot, with their current script as
 * their baseline. Parts already in the snapshot keep theirs. Returns a new
 * object; the input is not mutated.
 */
export function extendPartScriptSnapshot(snapshot, scripts, partIds = []) {
  const out = { ...(snapshot && typeof snapshot === 'object' ? snapshot : {}) };
  const live = scripts && typeof scripts === 'object' ? scripts : {};
  for (const raw of partIds || []) {
    const id = raw != null ? String(raw) : '';
    if (!id || typeof out[id] === 'string') continue;
    const text = live[id];
    out[id] = typeof text === 'string' ? text : '';
  }
  return out;
}

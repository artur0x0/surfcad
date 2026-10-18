/**
 * Assembly document and the rules that turn rows into a viewport.
 *
 * The saved JSON lists parts by id. It never contains script source.
 * The row id is a stable id for the part's life. Git parts also store a
 * repo `path`. Local ids are bare IndexedDB keys, with no sync prefix.
 * A position, when present, is the translation. A placement, when present,
 * is that translation plus a unit quaternion. Joints name parts by surf id
 * and live on this document. Part scripts are not modified.
 */

import { normalizeSheetMetalBinding } from './scs/scsCatalog.js';
import { isSurfId, partSurfId } from './git/surfId.js';
import {
  jointedSurfIds,
  normalizeAssemblyJoints,
  partPlacement,
  poseFieldsForPart,
} from './jointSchema.js';

export const ASSEMBLY_VERSION = 1;

export function sortParts(parts) {
  return [...(parts || [])].sort((a, b) => {
    const ao = Number.isFinite(Number(a?.order)) ? Number(a.order) : 0;
    const bo = Number.isFinite(Number(b?.order)) ? Number(b.order) : 0;
    if (ao !== bo) return ao - bo;
    return String(a?.id || '').localeCompare(String(b?.id || ''));
  });
}

/** [x, y, z] when the row stores a finite position, otherwise null. */
export function partPosition(part) {
  const p = part?.position;
  if (!Array.isArray(p) || p.length < 3) return null;
  const x = Number(p[0]);
  const y = Number(p[1]);
  const z = Number(p[2]);
  if (![x, y, z].every(Number.isFinite)) return null;
  return [x, y, z];
}

/**
 * Initial translation for a new part row. UI creation staggers along +X so
 * bodies do not overlap in the viewport. Agent `create_part` defaults to the
 * assembly origin unless `position` is set.
 */
export function newPartRowPosition(order, { fromAgent = false, position = null } = {}) {
  if (Array.isArray(position) && position.length >= 3) {
    const t = [Number(position[0]), Number(position[1]), Number(position[2])];
    if (t.every(Number.isFinite)) return t;
  }
  if (fromAgent) return undefined;
  return order === 0 ? undefined : [order * 40, 0, 0];
}

export function missingRowAction(source) {
  return source === 'git' ? 'add-to-repo' : 'upload';
}

/**
 * Resolve a row id to script text.
 * The script map is separate from the assembly document.
 * Scripts are keyed by the part row id.
 */
export function resolvePartId(source, id, scripts) {
  const key = id == null ? '' : String(id);
  const script = scripts && typeof scripts[key] === 'string' ? scripts[key] : null;
  if (script != null) return { ok: true, id: key, script };
  return {
    ok: false,
    id: key,
    missing: true,
    action: missingRowAction(source),
  };
}

/** Repo-relative path. Rejects empty, absolute, and parent-segment paths. */
export function normalizeRepoPath(path) {
  const id = String(path || '').trim().replace(/\\/g, '/').replace(/^\.\//, '');
  if (!id || id.startsWith('/') || id.split('/').includes('..')) return null;
  return id;
}

/**
 * Permanent IndexedDB row id. Sync is `isSynced`, never a prefix on the id.
 * Uses `crypto.randomUUID` when the page has it. Otherwise time plus random,
 * which is what an iPhone shows when `randomUUID` is missing.
 */
export function newLocalPartId() {
  const rnd = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return rnd;
}

/**
 * Document shape:
 * {
 *   version: 1,
 *   source: 'git' | 'local',
 *   name: string,
 *   activeId: string | null,
 *   parts: [{ id, name, visible, order, path?, position?, placement?, surfId?, isSynced? }]
 *   groups?: [{ id, name, source, partIds }]
 *   colors?: { [surfId]: { part?: '#rrggbb', faces?: [...] } }
 *   joints?: [{ id, name, type, value?, sense?, opposed?, a, b? }]
 * }
 * `name` is the assembly name. A blank name is saved as Assembly.
 * `script` and any other fields are dropped. `isSynced` is local only
 * (never written to `.surf.json`). `colors` is per assembly, keyed by
 * surf id. An empty map is omitted. A key whose surf id is not on a row
 * is dropped.
 * `groups` lists parts inserted from another assembly. `partIds` are surf
 * ids. A part is in at most one group. Empty groups and dangling ids are
 * dropped. No `groups` key when there are none. `source` is the source
 * assembly path, or null after that assembly is deleted (the name stays).
 * `joints` name parts by surf id. A joint whose part is gone is dropped.
 * No `joints` key when there are none. `placement` is `{ t, q }`. It is
 * written when the quaternion is not identity, or when a joint names the
 * part. `position` stays the translation and equals `t` when both exist.
 */

/** Shown and saved when a document has no name of its own. */
export const DEFAULT_ASSEMBLY_NAME = 'Assembly';

/** Default part label used when seeding a blank assembly. */
export const DEFAULT_PART_NAME = 'Part (1)';

/**
 * Auto-number form. A generated number is always `Base (n)`.
 * Saved names are not rewritten. `Part` + 1 is `Part (1)`, not `Part 1`.
 */
export function numberedName(base, n) {
  const stem = String(base ?? '').replace(/\s+/g, ' ').trim();
  const i = Number(n);
  if (!stem || !Number.isInteger(i) || i < 1) return stem;
  return `${stem} (${i})`;
}

/**
 * Next free generated name.
 * Without `bareFirst`: `Base (1)`, then `Base (2)`, … (a new part, a new sheet).
 * With `bareFirst`: `Base` when it is free, otherwise `Base (2)`, `Base (3)`, …
 * (a copy, an import, or a rename that collided). An existing `Base (n)`
 * occupies n, so the next free slot is n+1 when every lower slot is taken.
 * `start` overrides that first parenthesis (a new assembly passes `1` so the
 * second name is `Assembly (1)`, not `Assembly (2)`).
 * `taken` is an iterable of names. Matching is exact unless `caseInsensitive`.
 */
export function nextNumberedName(base, taken, {
  bareFirst = false,
  caseInsensitive = false,
  start = null,
} = {}) {
  const stem = String(base ?? '').replace(/\s+/g, ' ').trim() || 'Part';
  const keyOf = (value) => {
    const text = String(value ?? '').replace(/\s+/g, ' ').trim();
    return caseInsensitive ? text.toLowerCase() : text;
  };
  const used = new Set();
  for (const item of taken || []) used.add(keyOf(item));
  const free = (name) => !used.has(keyOf(name));
  if (bareFirst && free(stem)) return stem;
  const from = (Number.isInteger(start) && start >= 1) ? start : (bareFirst ? 2 : 1);
  for (let n = from; n < 1000; n += 1) {
    const name = numberedName(stem, n);
    if (free(name)) return name;
  }
  return numberedName(stem, Date.now());
}

/**
 * Next assembly name. One helper, the part rule above.
 * A new assembly (no `preferred`) is `Assembly`, then `Assembly (1)`,
 * `Assembly (2)`. A copy, an import, or a rename keeps the requested name
 * when it is free, otherwise `Name (2)`, `Name (3)`, … (`bareFirst`).
 * Saved names are not rewritten. This only picks a name for a new write.
 * Matching is case-insensitive: the name is a repo folder.
 */
export function nextAssemblyName(taken, { preferred = '', caseInsensitive = true } = {}) {
  const want = sanitizeAssemblyName(preferred);
  if (!want) {
    return nextNumberedName(DEFAULT_ASSEMBLY_NAME, taken, {
      bareFirst: true,
      start: 1,
      caseInsensitive,
    });
  }
  return nextNumberedName(want, taken, { bareFirst: true, caseInsensitive });
}

/**
 * Name to store when a file is opened into a workspace that may already
 * have that assembly. A free name is kept. A collision uses `nextAssemblyName`
 * (the part copy/import rule). Opening a repo assembly does not come through
 * here — that name is already saved.
 */
export function assemblyNameForImport(raw, filename, taken = []) {
  return nextAssemblyName(taken, { preferred: assemblyNameForLoad(raw, filename) });
}

/**
 * True when the working copy is blank or still the stock default assembly
 * (name Assembly / blank, zero or one stock part name, script empty or a known starter).
 * A saved `Part 1` from before the parenthesis form is still the stock name.
 * Used so Assembly New/Existing can skip the Save|Discard leave guard.
 */
export function isDefaultBlankAssembly(doc, scripts = {}, {
  defaultScripts = [],
  liveId = null,
  liveScript = null,
} = {}) {
  if (!doc || typeof doc !== 'object') return true;
  const name = storedAssemblyName(doc);
  if (name && name !== DEFAULT_ASSEMBLY_NAME) return false;
  const parts = Array.isArray(doc.parts) ? doc.parts : [];
  if (parts.length === 0) return true;
  if (parts.length !== 1) return false;
  const part = parts[0];
  const pname = String(part?.name || '').trim();
  if (pname && pname !== DEFAULT_PART_NAME && pname !== 'Part 1' && pname !== 'part1') return false;
  let script = scripts?.[part.id];
  if (liveId != null && String(liveId) === String(part.id) && typeof liveScript === 'string') {
    script = liveScript;
  }
  const text = String(script ?? '');
  if (!text.trim()) return true;
  const known = (Array.isArray(defaultScripts) ? defaultScripts : [])
    .map((s) => String(s ?? ''))
    .filter(Boolean);
  if (!known.length) return false;
  return known.some((s) => s === text);
}

/**
 * True when leaving the current assembly for New/Existing should ask Save|Discard.
 * Skip when blank/default, or when Git is known-saved (has baseline and not dirty).
 */
export function needsAssemblyLeaveGuard(doc, {
  sourceDirty = false,
  hasBaseline = false,
  source = 'local',
  scripts = {},
  defaultScripts = [],
  liveId = null,
  liveScript = null,
} = {}) {
  if (isDefaultBlankAssembly(doc, scripts, { defaultScripts, liveId, liveScript })) {
    return false;
  }
  if (source === 'git' && hasBaseline && !sourceDirty) return false;
  return true;
}


/** Trimmed name stored on the document, or '' when it has none. */
function storedAssemblyName(doc) {
  if (!doc || typeof doc.name !== 'string') return '';
  return doc.name.trim();
}

/**
 * Assembly name for a document. A blank or whitespace name is Assembly.
 * No document stays ''. A custom name is returned unchanged, aside from trim.
 */
export function assemblyName(doc) {
  if (!doc || typeof doc !== 'object') return '';
  return storedAssemblyName(doc) || DEFAULT_ASSEMBLY_NAME;
}

/**
 * Name to store when a file is opened.
 * A custom document name wins. A blank document takes the file name, then Assembly.
 */
export function assemblyNameForLoad(raw, filename) {
  const stored = storedAssemblyName(raw);
  if (stored) return stored;
  return assemblyNameFromFile(filename) || DEFAULT_ASSEMBLY_NAME;
}

/**
 * Path-safe label for a part or an assembly. Same rules as the title chip:
 * no path characters, collapsed whitespace, 60 characters.
 */
export function sanitizeAssemblyName(raw) {
  return String(raw ?? '')
    .replace(/[/\\:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
}

/**
 * CAD title. With an assembly name: "part1 in Assembly".
 * With a blank string: the part alone. No empty "in", no dash.
 * Callers pass assemblyName(), which turns a blank document into Assembly.
 */
export function formatViewerTitle(partName, assemblyNameValue, opts = {}) {
  const assembly = String(assemblyNameValue ?? '').trim();
  if (opts.partSelected === false) {
    const text = assembly || 'Untitled';
    return { part: '', assembly, connector: '', text };
  }
  const part = String(partName ?? '').trim() || 'Untitled';
  if (!assembly) return { part, assembly: '', connector: '', text: part };
  return { part, assembly, connector: 'in', text: `${part} in ${assembly}` };
}

/**
 * Delete asks first.
 * - cancel / dismiss → keep
 * - confirm / assembly → drop from assembly only (legacy confirm = assembly)
 * - repo → drop from assembly and delete the vault file when applicable
 *
 * `repo` here is the committed choice. The first tap on that button does
 * not call this: `partDeleteChoice` holds it for a second confirm.
 */
export function partListDeleteAction(choice) {
  if (choice === 'confirm' || choice === 'assembly') return 'drop';
  if (choice === 'repo') return 'drop-repo';
  return 'keep';
}

/**
 * Assembly delete drops on the first tap. Repo delete opens a second
 * confirm and drops only when that step commits. Cancel keeps the part.
 */
export function partDeleteChoice(step, choice) {
  if (choice === 'repo' && step !== 'confirm-repo') {
    return { step: 'confirm-repo', action: 'keep' };
  }
  return { step: null, action: partListDeleteAction(choice) };
}

/** Vault script basename. The repo-delete confirm names this file. */
export function partRepoFileName(partId) {
  const base = String(partId || '').replace(/\\/g, '/').split('/').filter(Boolean).pop() || '';
  return base;
}

/**
 * Second confirm for a repo file delete. Assembly-only delete has no
 * second copy: its Undo toast already covers that drop.
 */
export function partRepoDeleteConfirmCopy(partId) {
  const file = partRepoFileName(partId) || 'this file';
  return `Delete ${file} from the repo? This can't be undone from SurfCAD.`;
}

/** True when Parts delete can offer "Delete from assembly & repo". */
export function partCanDeleteFromRepo(source, partId, path) {
  if (source !== 'git') return false;
  const candidate = String(path || partId || '');
  if (!candidate || candidate.startsWith('local:')) return false;
  // Vault part scripts only (assembly-owned or shared). After stable surf
  // ids the row id is not a `.js` path — callers pass `row.path`.
  return /\.(js)$/i.test(candidate) && !candidate.includes('..');
}

/**
 * Basename of a loaded assembly file, without a trailing `.json`.
 * '' when that file has no name of its own.
 */
export function assemblyNameFromFile(filename) {
  const base = String(filename || '').replace(/\\/g, '/').split('/').pop().trim();
  if (!base || base === '.' || base === '..') return '';
  return base.replace(/\.json$/i, '').trim();
}

/**
 * Keep groups whose part ids still match a row. First group wins when a
 * surf id is listed twice. A group with nothing left is dropped.
 */
export function normalizeGroups(groups, parts) {
  const live = new Set(
    (parts || []).map((part) => partSurfId(part)).filter(Boolean),
  );
  const seenParts = new Set();
  const seenIds = new Set();
  const out = [];
  for (const group of Array.isArray(groups) ? groups : []) {
    if (!group || typeof group !== 'object') continue;
    const id = String(group.id || '').trim();
    const name = sanitizeAssemblyName(group.name);
    let source = null;
    if (group.source == null) {
      if (group.source !== null) continue;
    } else {
      source = normalizeRepoPath(group.source);
      if (!source || source !== String(group.source)) continue;
    }
    if (!isSurfId(id) || !name || seenIds.has(id)) continue;
    const partIds = [];
    for (const pid of Array.isArray(group.partIds) ? group.partIds : []) {
      if (!isSurfId(pid) || !live.has(pid) || seenParts.has(pid)) continue;
      seenParts.add(pid);
      partIds.push(pid);
    }
    if (!partIds.length) continue;
    seenIds.add(id);
    out.push({ id, name, source, partIds });
  }
  return out;
}

const FACE_COLOR_RE = /^#[0-9a-f]{6}$/;
const COLOR_ENTRY_KEYS = new Set(['part', 'faces']);
const COLOR_FACE_KEYS = new Set(['color', 'key']);
const COLOR_KEY_FIELDS = new Set(['at', 'n', 'area', 'src', 'ord']);

/** Lowercase `#rrggbb`. */
export function isFaceColor(value) {
  return typeof value === 'string' && FACE_COLOR_RE.test(value);
}

function isVec3(value) {
  return Array.isArray(value)
    && value.length === 3
    && value.every((n) => typeof n === 'number' && Number.isFinite(n));
}

function colorKeyErrors(key, at) {
  const errors = [];
  if (!key || typeof key !== 'object' || Array.isArray(key)) {
    errors.push(`${at} must be an object`);
    return errors;
  }
  for (const k of Object.keys(key)) {
    if (!COLOR_KEY_FIELDS.has(k)) errors.push(`${at} unknown key "${k}"`);
  }
  if (!isVec3(key.at)) errors.push(`${at}.at must be [x, y, z] numbers`);
  if (!isVec3(key.n)) errors.push(`${at}.n must be [x, y, z] numbers`);
  if (typeof key.area !== 'number' || !Number.isFinite(key.area) || !(key.area > 0)) {
    errors.push(`${at}.area must be a number greater than 0`);
  }
  const hasSrc = key.src !== undefined;
  const hasOrd = key.ord !== undefined;
  if (hasSrc !== hasOrd) errors.push(`${at} src and ord are set together`);
  if (hasSrc && (!Number.isInteger(key.src) || key.src >= 0)) {
    errors.push(`${at}.src must be a negative integer`);
  }
  if (hasOrd && (!Number.isInteger(key.ord) || key.ord < 0)) {
    errors.push(`${at}.ord must be a non-negative integer`);
  }
  return errors;
}

function colorFaceErrors(face, at) {
  const errors = [];
  if (!face || typeof face !== 'object' || Array.isArray(face)) {
    errors.push(`${at} must be an object`);
    return errors;
  }
  for (const k of Object.keys(face)) {
    if (!COLOR_FACE_KEYS.has(k)) errors.push(`${at} unknown key "${k}"`);
  }
  if (!isFaceColor(face.color)) errors.push(`${at}.color must be a lowercase #rrggbb`);
  errors.push(...colorKeyErrors(face.key, `${at}.key`));
  return errors;
}

function colorEntryErrors(entry, at) {
  const errors = [];
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    errors.push(`${at} must be an object`);
    return errors;
  }
  for (const k of Object.keys(entry)) {
    if (!COLOR_ENTRY_KEYS.has(k)) errors.push(`${at} unknown key "${k}"`);
  }
  if (entry.part !== undefined && !isFaceColor(entry.part)) {
    errors.push(`${at}.part must be a lowercase #rrggbb`);
  }
  if (entry.faces !== undefined) {
    if (!Array.isArray(entry.faces) || entry.faces.length === 0) {
      errors.push(`${at}.faces must be a non-empty array`);
    } else {
      entry.faces.forEach((face, i) => {
        errors.push(...colorFaceErrors(face, `${at}.faces[${i}]`));
      });
    }
  }
  if (entry.part === undefined && entry.faces === undefined) {
    errors.push(`${at} needs part or faces`);
  }
  return errors;
}

/**
 * Problems in a `colors` map. `liveIds` is the surf ids that name a part.
 * A key that is not one of those is an error here; load and save prune
 * those keys before validating.
 */
export function assemblyColorErrors(colors, liveIds) {
  const errors = [];
  if (!colors || typeof colors !== 'object' || Array.isArray(colors)) {
    errors.push('colors must be an object');
    return errors;
  }
  const keys = Object.keys(colors);
  if (!keys.length) {
    errors.push('colors must be omitted when empty');
    return errors;
  }
  const live = liveIds instanceof Set ? liveIds : new Set(liveIds || []);
  for (const id of keys) {
    const at = `colors["${id}"]`;
    if (!isSurfId(id)) {
      errors.push(`${at} must be a surf id`);
      continue;
    }
    if (!live.has(id)) errors.push(`${at} is not a part in this file`);
    errors.push(...colorEntryErrors(colors[id], at));
  }
  return errors;
}

/**
 * Drop keys that are real surf ids but not in `liveIds`. Anything else
 * stays so validation can reject it. Null means the map is now empty.
 */
export function pruneColorMap(colors, liveIds) {
  if (!colors || typeof colors !== 'object' || Array.isArray(colors)) return colors;
  const live = liveIds instanceof Set ? liveIds : new Set(liveIds || []);
  let dropped = false;
  const next = {};
  for (const [id, entry] of Object.entries(colors)) {
    if (isSurfId(id) && !live.has(id)) {
      dropped = true;
      continue;
    }
    next[id] = entry;
  }
  if (!dropped) return colors;
  return Object.keys(next).length ? next : null;
}

function canonicalColorEntry(entry) {
  if (colorEntryErrors(entry, 'colors').length) return null;
  const out = {};
  if (entry.part !== undefined) out.part = entry.part;
  if (Array.isArray(entry.faces) && entry.faces.length) {
    out.faces = entry.faces.map((face) => {
      const key = {
        at: [face.key.at[0], face.key.at[1], face.key.at[2]],
        n: [face.key.n[0], face.key.n[1], face.key.n[2]],
        area: face.key.area,
      };
      if (face.key.src !== undefined) {
        key.src = face.key.src;
        key.ord = face.key.ord;
      }
      return { color: face.color, key };
    });
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Colors worth keeping on an in-app document. Keyed by surf id. Empty,
 * dangling, and malformed entries are dropped. Null when nothing remains.
 */
export function normalizeAssemblyColors(colors, parts) {
  if (!colors || typeof colors !== 'object' || Array.isArray(colors)) return null;
  const live = (parts || []).map((part) => partSurfId(part)).filter(Boolean);
  const pruned = pruneColorMap(colors, live);
  if (!pruned || typeof pruned !== 'object' || Array.isArray(pruned)) return null;
  const liveSet = new Set(live);
  const out = {};
  for (const [id, entry] of Object.entries(pruned)) {
    if (!liveSet.has(id)) continue;
    const clean = canonicalColorEntry(entry);
    if (clean) out[id] = clean;
  }
  return Object.keys(out).length ? out : null;
}

export function serializeAssembly(doc) {
  const source = doc?.source === 'git' ? 'git' : 'local';
  const drafted = sortParts(doc?.parts).map((part, index) => {
    const row = {
      id: String(part?.id || ''),
      name: String(part?.name || 'Part'),
      visible: part?.visible !== false,
      order: index,
    };
    const sheetMetal = normalizeSheetMetalBinding(part?.sheetMetal);
    if (sheetMetal) row.sheetMetal = sheetMetal;
    if (typeof part?.path === 'string' && part.path) row.path = part.path;
    if (typeof part?.surfId === 'string' && part.surfId) row.surfId = part.surfId;
    if (typeof part?.copiedFrom === 'string' && part.copiedFrom) row.copiedFrom = part.copiedFrom;
    if (typeof part?.isSynced === 'boolean') row.isSynced = part.isSynced;
    if (part?.missing === true) row.missing = true;
    return { row, part };
  }).filter((item) => item.row.id);
  const joints = normalizeAssemblyJoints(doc?.joints, drafted.map((item) => item.row));
  const jointed = jointedSurfIds(joints);
  const parts = drafted.map(({ row, part }) => {
    const pose = poseFieldsForPart(part, jointed.has(partSurfId(row)), partPosition(part));
    if (pose.position) row.position = pose.position;
    if (pose.placement) row.placement = pose.placement;
    return row;
  });
  const wanted = doc?.activeId != null ? String(doc.activeId) : '';
  const activeId = parts.some((part) => part.id === wanted)
    ? wanted
    : (parts[0]?.id || null);
  const name = storedAssemblyName(doc) || DEFAULT_ASSEMBLY_NAME;
  const groups = normalizeGroups(doc?.groups, parts);
  const colors = normalizeAssemblyColors(doc?.colors, parts);
  const out = {
    version: ASSEMBLY_VERSION,
    source,
    name,
    activeId,
    parts,
  };
  if (isSurfId(doc?.id)) out.id = doc.id;
  if (doc?.vaultLayout === 'legacy' || doc?.vaultLayout === 'v2') {
    out.vaultLayout = doc.vaultLayout;
  }
  if (groups.length) out.groups = groups;
  if (colors) out.colors = colors;
  if (joints) out.joints = joints;
  return out;
}

export function parseAssemblyDocument(input) {
  const raw = typeof input === 'string' ? JSON.parse(input) : input;
  if (!raw || !Array.isArray(raw.parts)) {
    throw new Error('Assembly has no parts');
  }
  return serializeAssembly({
    version: ASSEMBLY_VERSION,
    source: raw.source,
    name: raw.name,
    activeId: raw.activeId,
    id: raw.id,
    vaultLayout: raw.vaultLayout,
    parts: raw.parts.map((part, index) => ({
      id: part?.id,
      name: part?.name,
      visible: part?.visible,
      order: part?.order ?? index,
      path: part?.path,
      position: part?.position,
      placement: part?.placement,
      sheetMetal: part?.sheetMetal,
      surfId: part?.surfId,
      copiedFrom: part?.copiedFrom,
      isSynced: part?.isSynced,
      missing: part?.missing === true,
    })),
    groups: raw.groups,
    colors: raw.colors,
    joints: raw.joints,
  });
}

/** Part names land in `${name}.js` downloads, so keep them path-safe and short. */
export function sanitizePartName(raw) {
  return String(raw ?? '')
    .replace(/[/\\:*?"<>|]/g, '')   // path + Windows-illegal characters
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
}

/**
 * The part a rename from the viewer title lands on: the part the title shows
 * (the CAD-selected part, which a face / edge / body pick on another part
 * moves without moving the editor), else the editor's active part.
 */
export function renameTargetId(doc, shownId = null) {
  const parts = doc?.parts || [];
  if (shownId != null && parts.some((part) => part.id === shownId)) return shownId;
  return doc?.activeId && parts.some((part) => part.id === doc.activeId) ? doc.activeId : null;
}

/** Rename one part by id. Other rows are untouched; unknown id or blank name → same doc. */
export function renamePart(doc, id, name) {
  const next = sanitizePartName(name);
  const parts = doc?.parts || [];
  if (!next || id == null || !parts.some((part) => part.id === id)) return doc;
  return serializeAssembly({
    ...doc,
    parts: parts.map((part) => (part.id === id ? { ...part, name: next } : part)),
  });
}

export function setPartVisible(doc, id, visible) {
  return serializeAssembly({
    ...doc,
    parts: (doc?.parts || []).map((part) => (
      part.id === id ? { ...part, visible: !!visible } : part
    )),
  });
}

/** The SendCutSend SKU bound to a part (S1 sheet metal), or null. */
export function partSheetMetal(doc, id) {
  const part = (doc?.parts || []).find((row) => row.id === id);
  return normalizeSheetMetalBinding(part?.sheetMetal);
}

/** Bind (or clear with null) a part's SendCutSend SKU. Unknown id → same doc. */
export function setPartSheetMetal(doc, id, binding) {
  if (id == null || !(doc?.parts || []).some((part) => part.id === id)) return doc;
  const clean = normalizeSheetMetalBinding(binding);
  return serializeAssembly({
    ...doc,
    parts: (doc?.parts || []).map((part) => {
      if (part.id !== id) return part;
      const rest = { ...part };
      delete rest.sheetMetal;
      return clean ? { ...rest, sheetMetal: clean } : rest;
    }),
  });
}

/**
 * Drop one part. Other rows stay, including position.
 * A joint that named the dropped part is dropped with it.
 * The active id stays on a remaining row, or is empty when none remain.
 */
export function removePart(doc, id) {
  const key = id == null ? '' : String(id);
  const parts = (doc?.parts || []).filter((part) => String(part?.id || '') !== key);
  return serializeAssembly({ ...doc, parts });
}

/** Copy a script map or a run map without one part id. */
export function dropPartRecord(map, id) {
  const key = id == null ? '' : String(id);
  const next = { ...(map || {}) };
  delete next[key];
  return next;
}

export function reorderParts(doc, fromIndex, toIndex) {
  const parts = sortParts(doc?.parts);
  const from = Number(fromIndex);
  const to = Number(toIndex);
  if (!Number.isInteger(from) || !Number.isInteger(to)) return serializeAssembly(doc);
  if (from < 0 || to < 0 || from >= parts.length || to >= parts.length) {
    return serializeAssembly(doc);
  }
  const next = parts.slice();
  const [row] = next.splice(from, 1);
  next.splice(to, 0, row);
  return serializeAssembly({ ...doc, parts: next.map((part, index) => ({ ...part, order: index })) });
}

/** Script Monaco should load for this row. Never reads a script off the document. */
export function scriptForRow(doc, scripts, id) {
  const part = (doc?.parts || []).find((row) => row.id === id);
  if (!part) return { ok: false, reason: 'unknown-row' };
  const resolved = resolvePartId(doc.source, id, scripts);
  if (!resolved.ok) {
    return { ok: false, reason: 'missing', action: resolved.action, part };
  }
  return { ok: true, script: resolved.script, part };
}

/** Plain `{ min, max }` mm box, or null when any coordinate is missing. */
export function cloneRunBbox(bbox) {
  if (!bbox || bbox.min == null || bbox.max == null) return null;
  const min = [Number(bbox.min[0]), Number(bbox.min[1]), Number(bbox.min[2])];
  const max = [Number(bbox.max[0]), Number(bbox.max[1]), Number(bbox.max[2])];
  if (![...min, ...max].every(Number.isFinite)) return null;
  return { min, max };
}

/** Volume / bbox / bodyCount from a worker or viewport execute result (or a cached run). */
export function geometryFromExecuteResult(result) {
  const volume = Number(result?.volume);
  const bodyCount = Number.isFinite(result?.bodyCount)
    ? result.bodyCount
    : (Array.isArray(result?.bodyCentroids) ? result.bodyCentroids.length : null);
  return {
    volume: Number.isFinite(volume) ? volume : null,
    bbox: cloneRunBbox(result?.boundingBox || result?.bbox),
    bodyCount: Number.isFinite(bodyCount) ? bodyCount : null,
  };
}

/**
 * Replace one part's latest run. A failure stores no mesh.
 * `previousMesh` and a mesh attached to a failed outcome are ignored,
 * including a mesh already stored for this id.
 */
export function recordPartRun(runs, id, outcome) {
  const next = { ...(runs || {}) };
  const mesh = outcome?.mesh;
  const ok = outcome?.ok === true && !!(mesh && mesh.vertProperties);
  const geom = geometryFromExecuteResult(outcome);
  next[id] = ok
    ? {
      ok: true,
      mesh,
      error: null,
      volume: geom.volume,
      bbox: geom.bbox,
      ...(geom.bodyCount != null ? { bodyCount: geom.bodyCount } : {}),
    }
    : {
      ok: false,
      mesh: null,
      error: outcome?.error || (outcome?.missing ? 'missing' : 'failed'),
      missing: !!outcome?.missing,
      empty: !!outcome?.empty,
      skipped: !!outcome?.skipped,
      volume: null,
      bbox: null,
    };
  return next;
}

/**
 * Solids the viewport draws. Hidden rows and failed runs are omitted.
 * The latest run is the only source — there is no shadow solid.
 */
export function composeViewportParts(doc, runs) {
  const out = [];
  for (const part of sortParts(doc?.parts)) {
    if (part.visible === false) continue;
    const run = runs?.[part.id];
    if (!run || run.ok !== true || !run.mesh || !run.mesh.vertProperties) continue;
    const pose = partPlacement(part);
    out.push({
      id: part.id,
      surfId: partSurfId(part),
      mesh: run.mesh,
      position: pose.t,
      placement: pose,
    });
  }
  return out;
}

export function partRowFlags(run) {
  if (!run || run.skipped) return { error: false, missing: false };
  if (run.missing) return { error: false, missing: true };
  if (run.empty) return { error: false, missing: false };
  if (run.ok === false) return { error: true, missing: false };
  return { error: false, missing: false };
}

/**
 * A visibility refresh runs only the parts the viewport draws, then
 * replaces the run map. A hidden row is absent from that map, or the
 * active hidden row is stored with a null mesh. The parts-list thumbnail
 * reads this map, so copy the last successful mesh back onto each hidden
 * row. `composeViewportParts` still skips `visible === false`. A run that
 * never succeeded has no mesh to keep.
 */
export function preserveHiddenPartRuns(doc, nextRuns, prevRuns) {
  const runs = { ...(nextRuns || {}) };
  const prev = prevRuns || {};
  for (const part of doc?.parts || []) {
    if (!part || part.visible !== false || part.id == null) continue;
    const earlier = prev[part.id];
    const mesh = earlier?.ok === true && earlier.mesh?.vertProperties ? earlier.mesh : null;
    if (!mesh) continue;
    const current = runs[part.id];
    if (current?.ok === true && current.mesh?.vertProperties) continue;
    const kept = { ok: true, mesh, error: null };
    if (Number.isFinite(earlier.bodyCount)) kept.bodyCount = earlier.bodyCount;
    runs[part.id] = kept;
  }
  return runs;
}

/** Feed rows. Mesh is present only for a successful latest run. */
export function feedRows(doc, runs, scripts) {
  const source = doc?.source === 'git' ? 'git' : 'local';
  return sortParts(doc?.parts).map((part) => {
    const hasScript = !!(scripts && typeof scripts[part.id] === 'string');
    const run = runs?.[part.id] || null;
    const missing = part.missing === true || !hasScript;
    const error = !missing && !!run && run.ok === false && !run.empty && !run.skipped;
    return {
      id: part.id,
      path: typeof part.path === 'string' ? part.path : null,
      name: part.name,
      visible: part.visible !== false,
      order: part.order,
      error,
      missing,
      action: missing ? missingRowAction(source) : null,
      mesh: !missing && run && run.ok === true ? run.mesh : null,
      surfId: partSurfId(part),
      copiedFrom: part.copiedFrom || null,
      isSynced: typeof part.isSynced === 'boolean' ? part.isSynced : undefined,
    };
  });
}

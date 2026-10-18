/**
 * Stable part identity.
 *
 * Format (UTC): yyyy-mm-dd-hh-mm-ss-SSSS-<4 hex>
 *   2026-10-07-20-56-31-0423-a3f9
 * Minted once. A push does not change it. Whether the part has been pushed
 * is `isSynced` on the local part record, never part of the id and never
 * written to `.surf.json`.
 *
 * A legacy id may still carry a `local-` prefix. That prefix is accepted on
 * read and stripped once by the id migration. New ids are minted without it.
 *
 * The id lives as the first line of the part script:
 *   // @surf-id <id>
 * `.surf.json` stores `{ id, path }`. The in-app row `id` is that stable
 * id for the part's life; `path` is the repo file. Blob SHA is never an
 * identity.
 */

const SURF_ID_BODY = String.raw`\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}-\d{4}-[0-9a-f]{4}`;
export const SURF_ID_RE = new RegExp(`^(?:local-)?${SURF_ID_BODY}$`);
/** v2 ids never carry a `local-` prefix. v1 `isSurfId` still accepts one. */
export const SURF_ID_V2_RE = new RegExp(`^${SURF_ID_BODY}$`);
// Spaces and tabs only. `\s` would eat the blank line after the header and
// any indent on the next line. The line ending is captured so CRLF stays CRLF.
const HEADER_RE = /^\/\/ @surf-id (\S+)([ \t]*)(\r\n|\n|\r)?/;
// Display name may contain spaces. Capture the rest of the line; trim on read.
const NAME_HEADER_RE = /^\/\/ @name ([^\r\n]*?)[ \t]*(\r\n|\n|\r|$)/;
// Same class the v2 validator rejects: C0 controls (tabs included), DEL, LS, PS.
// eslint-disable-next-line no-control-regex
const SURF_NAME_CONTROL_RE = /[\u0000-\u001f\u007f\u2028\u2029]/;

/** Collapse control characters and line separators to a space, then trim. */
export function sanitizeSurfName(name) {
  return String(name ?? '').replace(new RegExp(`${SURF_NAME_CONTROL_RE.source}+`, 'g'), ' ').trim();
}

/** Non-empty after trim, and no control characters or line separators. */
export function isLabelName(value) {
  return typeof value === 'string' && !!value.trim() && !SURF_NAME_CONTROL_RE.test(value);
}

/** First `\r\n`, `\n`, or `\r` in `text`. */
function firstLineBreak(text, from = 0) {
  const cr = text.indexOf('\r', from);
  const lf = text.indexOf('\n', from);
  if (cr < 0 && lf < 0) return null;
  if (cr >= 0 && (lf < 0 || cr < lf)) {
    return lf === cr + 1
      ? { index: cr, ending: '\r\n' }
      : { index: cr, ending: '\r' };
  }
  return { index: lf, ending: '\n' };
}

export function isSurfId(value) {
  return SURF_ID_RE.test(String(value || ''));
}

export function isV2SurfId(value) {
  return SURF_ID_V2_RE.test(String(value || ''));
}

/**
 * Permanent paint / joint / color identity for a working-copy row.
 * After collapse, `id` is the surf-id and `surfId` is gone.
 */
export function partSurfId(part) {
  if (isSurfId(part?.surfId)) return part.surfId;
  if (isSurfId(part?.id)) return part.id;
  return null;
}

export function isLocalSurfId(value) {
  return isSurfId(value) && String(value).startsWith('local-');
}

/** Drop a `local-` prefix. Already-promoted ids pass through. */
export function promoteSurfId(value) {
  const id = String(value || '');
  return id.startsWith('local-') ? id.slice('local-'.length) : id;
}

function pad(n, width) {
  return String(n).padStart(width, '0');
}

function randomHex4() {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const bytes = new Uint8Array(2);
    crypto.getRandomValues(bytes);
    return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  return Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');
}

/**
 * Mint an id. `now` is a Date or epoch ms (tests pin it).
 * `rand` is 4 hex chars (tests pin it); otherwise random.
 * The id is permanent. A `local` option is ignored so a caller cannot prefix it.
 */
export function mintSurfId({ now = new Date(), rand } = {}) {
  const date = now instanceof Date ? now : new Date(now);
  const stamp = [
    pad(date.getUTCFullYear(), 4),
    pad(date.getUTCMonth() + 1, 2),
    pad(date.getUTCDate(), 2),
    pad(date.getUTCHours(), 2),
    pad(date.getUTCMinutes(), 2),
    pad(date.getUTCSeconds(), 2),
    pad(date.getUTCMilliseconds(), 4),
  ].join('-');
  const hex = String(rand != null ? rand : randomHex4())
    .toLowerCase()
    .replace(/[^0-9a-f]/g, '')
    .padStart(4, '0')
    .slice(0, 4);
  return `${stamp}-${hex}`;
}

function splitSurfHeader(script) {
  const text = String(script ?? '');
  const match = HEADER_RE.exec(text);
  if (!match || !isSurfId(match[1])) return null;
  return {
    id: match[1],
    trailing: match[2] || '',
    ending: match[3] || '',
    body: text.slice(match[0].length),
  };
}

/** Id from the first line, or null when the header is missing or invalid. */
export function readSurfId(script) {
  return splitSurfHeader(script)?.id || null;
}

/** Script text with the surf-id header line removed. A following blank line stays. */
export function stripSurfId(script) {
  const split = splitSurfHeader(script);
  return split ? split.body : String(script ?? '');
}

/**
 * Exact bytes after the header line, split on the first line ending only.
 * A script with no header returns the whole text. This does not use the
 * header regex, so a regex that swallows a blank line still fails a compare.
 */
export function bytesAfterHeaderLine(script) {
  const text = String(script ?? '');
  if (!text.startsWith('// @surf-id ')) return text;
  const br = firstLineBreak(text);
  if (!br) return '';
  return text.slice(br.index + br.ending.length);
}

/** Line ending of a header line: `\r\n`, `\n`, `\r`, ``, or null when there is no header. */
export function headerLineEnding(script) {
  const text = String(script ?? '');
  if (!text.startsWith('// @surf-id ')) return null;
  const br = firstLineBreak(text);
  return br ? br.ending : '';
}

/**
 * First line is `// @surf-id <id>`. Replaces an existing header and keeps
 * the trailing spaces and the original line ending. Bytes after that line stay.
 */
export function withSurfId(script, id) {
  if (!isSurfId(id)) throw new Error(`Bad surf id: ${id}`);
  const split = splitSurfHeader(script);
  if (split) return `// @surf-id ${id}${split.trailing}${split.ending}${split.body}`;
  const text = String(script ?? '');
  const sep = text.length && !text.startsWith('\n') && !text.startsWith('\r') ? '\n' : '';
  return `// @surf-id ${id}${sep}${text}`;
}

/**
 * Split a leading `// @surf-id` line even when the id is invalid, so
 * `@name` is never inserted above a bogus id comment.
 */
function splitLeadingSurfComment(script) {
  const text = String(script ?? '');
  const valid = splitSurfHeader(text);
  if (valid) {
    return {
      surf: valid,
      prefix: text.slice(0, text.length - valid.body.length),
      rest: valid.body,
    };
  }
  if (!text.startsWith('// @surf-id ')) return { surf: null, prefix: '', rest: text };
  const br = firstLineBreak(text);
  if (!br) return { surf: { ending: '' }, prefix: text, rest: '' };
  return {
    surf: { ending: br.ending },
    prefix: text.slice(0, br.index + br.ending.length),
    rest: text.slice(br.index + br.ending.length),
  };
}

function splitNameHeader(script) {
  const { surf, prefix, rest } = splitLeadingSurfComment(script);
  const match = NAME_HEADER_RE.exec(rest);
  if (!match) return { found: false, name: null, prefix, rest, ending: '', body: rest, surf };
  const name = match[1].trim() || null;
  return {
    found: true,
    name,
    prefix,
    rest,
    ending: match[2] || '',
    body: rest.slice(match[0].length),
    surf,
  };
}

/** Display name from `// @name`, or null when the header is missing. */
export function readSurfName(script) {
  return splitNameHeader(script).name;
}

/**
 * First or second line is `// @name <display>`. Sits under `// @surf-id`
 * when that header is present. Replaces an existing name line and keeps
 * its line ending. Bytes after the name line stay.
 */
export function withSurfName(script, name) {
  const display = sanitizeSurfName(name);
  if (!display) throw new Error(`Bad surf name: ${name}`);
  const split = splitNameHeader(script);
  const nl = (split.surf && split.surf.ending) || (split.found && split.ending) || '\n';
  if (split.found) {
    return `${split.prefix}// @name ${display}${split.ending || nl}${split.body}`;
  }
  if (split.prefix) {
    const prefix = split.prefix.endsWith('\n') || split.prefix.endsWith('\r')
      ? split.prefix
      : `${split.prefix}${nl}`;
    return `${prefix}// @name ${display}${nl}${split.rest}`;
  }
  const text = String(script ?? '');
  const sep = text.length && !text.startsWith('\n') && !text.startsWith('\r') ? nl : '';
  return `// @name ${display}${sep}${text}`;
}

/**
 * A repo part path (`parts/…js`, this assembly's file, or a legacy nested
 * path). Kept here so surf-id code does not import the vault layout.
 * Same cases as `isVaultPartPath`.
 */
function isRepoPartRow(id) {
  const text = String(id || '').trim().replace(/\\/g, '/').replace(/^\.\//, '');
  if (!text || text.startsWith('/') || text.split('/').includes('..')) return false;
  return /^parts\/[^/]+\.js$/i.test(text)
    || /^assemblies\/[^/]+\/[^/]+\.js$/i.test(text)
    || /^assemblies\/[^/]+\/parts\/[^/]+\.js$/i.test(text);
}

/**
 * Add to Repo when the part has not been pushed. `isSynced === true` never
 * qualifies. `isSynced === false` always does. When the flag is unset, a
 * row that is not a repo path still qualifies (a bare id, or a legacy
 * `local:` / `local-` key). A surf id is not the signal. An in-repo path
 * with the flag unset does not qualify.
 */
export function showAddToRepo(part) {
  if (!part) return false;
  if (part.isSynced === true) return false;
  if (part.isSynced === false) return true;
  // Stable part ids are not repo paths. Prefer `path` (same as partRepoPath).
  const path = typeof part.path === 'string' && part.path.trim() ? part.path : part.id;
  return !isRepoPartRow(path);
}

/**
 * Assign a stable id to every part that lacks one.
 * Header wins, then an existing surfId, then the path index, then a new id.
 * Does not rewrite script text (that happens on the next save / push).
 * Idempotent: a second call with the returned index mints nothing.
 * -> { doc, index, minted }
 */
export function backfillSurfIds(doc, pathIndex = {}, { now, randFor } = {}) {
  const index = { ...(pathIndex || {}) };
  let minted = 0;
  const parts = (doc?.parts || []).map((part, i) => {
    const path = (typeof part?.path === 'string' && part.path) || String(part?.id || '');
    if (part?.surfId && isSurfId(part.surfId)) {
      if (path) index[path] = part.surfId;
      return part;
    }
    if (isSurfId(part?.id)) {
      if (path) index[path] = part.id;
      return { ...part, surfId: part.id };
    }
    const cached = path && index[path];
    if (cached && isSurfId(cached)) {
      return { ...part, surfId: cached };
    }
    if (part?.id && part.id !== path) return part;
    const id = mintSurfId({
      now,
      rand: typeof randFor === 'function' ? randFor(part, i) : undefined,
    });
    if (path) index[path] = id;
    minted += 1;
    return { ...part, surfId: id };
  });
  return { doc: { ...doc, parts }, index, minted };
}

/** Header wins over a stored surfId when the script already carries one. */
export function surfIdFromScript(part, script) {
  const header = readSurfId(script);
  if (header) return header;
  if (part?.surfId && isSurfId(part.surfId)) return part.surfId;
  return null;
}

/**
 * Legacy helper used by the one-time id migration. Replaces `local-` surf
 * ids in part headers and `.surf.json` id fields, including `colors` keys.
 * A push does not call this.
 * `map` is filled with localId → bare id. Files with no local id are
 * returned unchanged (same array when nothing changes).
 */
export function promoteFiles(files) {
  const list = Array.isArray(files) ? files : [];
  const map = new Map();
  let touched = false;
  const next = list.map((file) => {
    if (!file || file.delete || typeof file.content !== 'string') return file;
    if (!String(file.path || '').endsWith('.js')) return file;
    const id = readSurfId(file.content);
    if (!id || !isLocalSurfId(id)) return file;
    const promoted = promoteSurfId(id);
    map.set(id, promoted);
    touched = true;
    return { ...file, content: withSurfId(file.content, promoted) };
  });
  if (!map.size) return { files: list, map: {} };
  const rewritten = next.map((file) => {
    if (!file || file.delete || typeof file.content !== 'string') return file;
    if (!isSurfJsonPath(file.path)) return file;
    const content = rewriteSurfIdFields(file.content, map);
    if (content !== file.content) touched = true;
    return content === file.content ? file : { ...file, content };
  });
  return { files: touched ? rewritten : list, map: Object.fromEntries(map) };
}

export function isSurfJsonPath(path) {
  return String(path || '').endsWith('/.surf.json') || String(path || '').endsWith('.surf.json');
}

/**
 * Rename `colors` keys through a localId → bare id map. A bare key already
 * in the map wins over the prefixed duplicate. The same object comes back
 * when nothing changes.
 */
export function rewriteColorMap(colors, map) {
  if (!colors || typeof colors !== 'object' || Array.isArray(colors)) return colors;
  const get = (id) => (map instanceof Map ? map.get(id) : map?.[id]);
  const next = {};
  const pending = [];
  for (const [id, entry] of Object.entries(colors)) {
    const mapped = get(id);
    if (mapped && mapped !== id) pending.push([mapped, entry]);
    else next[id] = entry;
  }
  if (!pending.length) return colors;
  for (const [key, entry] of pending) {
    if (!Object.prototype.hasOwnProperty.call(next, key)) next[key] = entry;
  }
  return next;
}

/**
 * Rewrite joint ids and the part surf ids they name through a
 * localId → bare id map. The same array comes back when nothing changes.
 */
export function rewriteJointSurfIds(joints, map) {
  if (!Array.isArray(joints)) return joints;
  const get = (id) => (map instanceof Map ? map.get(id) : map?.[id]);
  let changed = false;
  const next = joints.map((joint) => {
    if (!joint || typeof joint !== 'object' || Array.isArray(joint)) return joint;
    const id = get(joint.id);
    const aPart = joint.a && typeof joint.a === 'object' ? get(joint.a.part) : null;
    const bPart = joint.b && typeof joint.b === 'object' ? get(joint.b.part) : null;
    const nextId = id && id !== joint.id ? id : null;
    const nextA = aPart && aPart !== joint.a.part ? aPart : null;
    const nextB = bPart && bPart !== joint.b.part ? bPart : null;
    if (!nextId && !nextA && !nextB) return joint;
    changed = true;
    return {
      ...joint,
      ...(nextId ? { id: nextId } : {}),
      ...(nextA ? { a: { ...joint.a, part: nextA } } : {}),
      ...(nextB ? { b: { ...joint.b, part: nextB } } : {}),
    };
  });
  return changed ? next : joints;
}

/** Rewrite surf-id fields in a `.surf.json` text, including `colors` keys and joint part refs. Unknown JSON is returned as-is. */
export function rewriteSurfIdFields(text, map) {
  if (!map || (typeof map.size === 'number' ? map.size === 0 : !Object.keys(map).length)) {
    return text;
  }
  const get = (id) => (map instanceof Map ? map.get(id) : map[id]);
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return text;
  }
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.parts)) return text;
  let changed = false;
  for (const part of raw.parts) {
    const next = get(part?.id);
    if (next && next !== part.id) {
      part.id = next;
      changed = true;
    }
    const copied = get(part?.copiedFrom);
    if (copied && copied !== part.copiedFrom) {
      part.copiedFrom = copied;
      changed = true;
    }
  }
  if (Array.isArray(raw.groups)) {
    for (const group of raw.groups) {
      const nextId = get(group?.id);
      if (nextId && nextId !== group.id) {
        group.id = nextId;
        changed = true;
      }
      if (!Array.isArray(group?.partIds)) continue;
      group.partIds = group.partIds.map((id) => {
        const next = get(id);
        if (next && next !== id) {
          changed = true;
          return next;
        }
        return id;
      });
    }
  }
  if (raw.colors && typeof raw.colors === 'object' && !Array.isArray(raw.colors)) {
    const colors = rewriteColorMap(raw.colors, map);
    if (colors !== raw.colors) {
      raw.colors = colors;
      changed = true;
    }
  }
  if (Array.isArray(raw.joints)) {
    const joints = rewriteJointSurfIds(raw.joints, map);
    if (joints !== raw.joints) {
      raw.joints = joints;
      changed = true;
    }
  }
  if (!changed) return text;
  return `${JSON.stringify(raw, null, 2)}\n`;
}

/** Apply a localId → repo id map to the working copy (row surfId + script header). */
export function applyIdPromotion(doc, scripts, map) {
  const table = map instanceof Map ? Object.fromEntries(map) : (map || {});
  const keys = Object.keys(table);
  if (!keys.length) return { doc, scripts: scripts || {}, changed: false };
  const parts = (doc?.parts || []).map((part) => {
    const next = table[part?.surfId];
    const copied = table[part?.copiedFrom];
    if (!next && !copied) return part;
    return {
      ...part,
      ...(next ? { surfId: next } : {}),
      ...(copied ? { copiedFrom: copied } : {}),
    };
  });
  const groups = Array.isArray(doc?.groups)
    ? doc.groups.map((group) => ({
      ...group,
      id: table[group?.id] || group?.id,
      partIds: (group.partIds || []).map((id) => table[id] || id),
    }))
    : doc?.groups;
  const colors = rewriteColorMap(doc?.colors, table);
  const joints = rewriteJointSurfIds(doc?.joints, table);
  const nextScripts = {};
  for (const [path, text] of Object.entries(scripts || {})) {
    const id = readSurfId(text);
    nextScripts[path] = id && table[id] ? withSurfId(text, table[id]) : text;
  }
  const nextDoc = { ...doc, parts, ...(Array.isArray(groups) ? { groups } : {}) };
  if (colors !== doc?.colors) nextDoc.colors = colors;
  if (joints !== doc?.joints) nextDoc.joints = joints;
  return {
    doc: nextDoc,
    scripts: nextScripts,
    changed: true,
  };
}

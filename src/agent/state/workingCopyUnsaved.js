/**
 * dirty.unsaved: working copy vs last AssemblyCommit (§3.4).
 * Changing activeId is not dirty. Rename / hide / remove are.
 */
import { gitBlobSha } from '../../utils/git/binaryContent.js';
import { assemblyIdPath, parseIdPath, partIdPath } from '../../utils/git/idPaths.js';
import { toSurfJsonV2 } from '../../utils/git/surfJsonV2.js';
import { sanitizeSurfName, withSurfId, withSurfName } from '../../utils/git/surfId.js';

function textBlobSha(text) {
  return gitBlobSha(new TextEncoder().encode(String(text ?? '')));
}

function cloneJson(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
}

function stableJson(value) {
  return JSON.stringify(value);
}

/** Assembly payload with view-state `activeId` cleared. */
export function assemblyComparePayload(json) {
  const raw = cloneJson(json);
  if (!raw || typeof raw !== 'object') return null;
  raw.activeId = null;
  return raw;
}

function committedPartIds(assemblyCommit) {
  const ids = new Set();
  const parts = assemblyCommit?.json?.parts;
  if (Array.isArray(parts)) {
    for (const row of parts) {
      if (typeof row?.id === 'string' && row.id) ids.add(row.id);
    }
  }
  const files = assemblyCommit?.files;
  if (files && typeof files === 'object') {
    for (const path of Object.keys(files)) {
      const parsed = parseIdPath(path);
      if (parsed?.kind === 'part') ids.add(parsed.id);
    }
  }
  return ids;
}

/**
 * Save stamps `// @surf-id` / `// @name` on the blob. The working copy may
 * still be the pre-stamp editor bytes, so treat either hash as a match.
 */
function stampedPartScript(text, id, name) {
  try {
    return withSurfName(withSurfId(text, id), sanitizeSurfName(name) || 'Part');
  } catch {
    return text;
  }
}

function partScriptMatchesCommit(text, committedHash, id, name) {
  if (!committedHash || typeof text !== 'string') return false;
  if (textBlobSha(text) === committedHash) return true;
  const stamped = stampedPartScript(text, id, name);
  return stamped !== text && textBlobSha(stamped) === committedHash;
}

function instanceDirty(wcPart, committedPart) {
  if (!committedPart) return true;
  if ((wcPart.name || '') !== (committedPart.name || '')) return true;
  if ((wcPart.visible !== false) !== (committedPart.visible !== false)) return true;
  if ((Number.isInteger(wcPart.order) ? wcPart.order : 0)
    !== (Number.isInteger(committedPart.order) ? committedPart.order : 0)) {
    return true;
  }
  if (stableJson(wcPart.position || null) !== stableJson(committedPart.position || null)) return true;
  if (stableJson(wcPart.placement || null) !== stableJson(committedPart.placement || null)) return true;
  if (stableJson(wcPart.copiedFrom || null) !== stableJson(committedPart.copiedFrom || null)) return true;
  return false;
}

/**
 * @param {{
 *   doc?: object | null,
 *   scripts?: Record<string, string>,
 *   liveId?: string | null,
 *   liveScript?: string | null,
 *   assemblyCommit?: object | null,
 *   pendingSave?: boolean,
 *   sidecarDirty?: boolean,
 * }} input
 */
export function compareWorkingCopyToCommit(input = {}) {
  const doc = input.doc;
  const partIds = [];
  const empty = {
    unsaved: input.pendingSave === true || input.sidecarDirty === true,
    assemblyDirty: input.sidecarDirty === true,
    partIds,
    pendingSave: input.pendingSave === true,
  };
  if (!doc || doc.source !== 'git') return empty;

  const scripts = { ...(input.scripts || {}) };
  if (input.liveId && typeof input.liveScript === 'string') {
    scripts[input.liveId] = input.liveScript;
  }

  const commit = input.assemblyCommit && typeof input.assemblyCommit === 'object'
    ? input.assemblyCommit
    : null;
  const files = commit?.files && typeof commit.files === 'object' ? commit.files : {};
  const hasCommit = !!(commit && (commit.json || Object.keys(files).length));

  if (!hasCommit) {
    return {
      unsaved: true,
      assemblyDirty: true,
      partIds: (doc.parts || []).map((row) => String(row.id)),
      pendingSave: input.pendingSave === true,
    };
  }

  const committedIds = committedPartIds(commit);
  const committedById = new Map(
    (Array.isArray(commit.json?.parts) ? commit.json.parts : [])
      .filter((row) => row && typeof row.id === 'string')
      .map((row) => [row.id, row]),
  );
  let assemblyDirty = input.sidecarDirty === true;
  const wcIds = new Set();

  for (const row of doc.parts || []) {
    const id = String(row.id || '');
    if (!id) continue;
    wcIds.add(id);
    const committed = committedById.get(id);
    if (!committedIds.has(id)) {
      partIds.push(id);
      assemblyDirty = true;
      continue;
    }
    if (row.missing !== true) {
      const path = (() => {
        try { return partIdPath(id); } catch { return null; }
      })();
      const committedHash = path && files[path] ? files[path].contentHash : null;
      const text = scripts[id];
      if (typeof text === 'string') {
        if (!committedHash || !partScriptMatchesCommit(text, committedHash, id, row.name)) {
          partIds.push(id);
        }
      } else if (committedHash && row.missing !== true) {
        partIds.push(id);
      }
    }
    if (instanceDirty(row, committed)) assemblyDirty = true;
  }

  for (const id of committedIds) {
    if (!wcIds.has(id)) assemblyDirty = true;
  }

  try {
    const wcJson = toSurfJsonV2(doc);
    const committedJson = commit.json || null;
    if (committedJson) {
      const wcCmp = assemblyComparePayload(wcJson);
      const tipCmp = assemblyComparePayload(committedJson);
      if (stableJson(wcCmp) !== stableJson(tipCmp)) assemblyDirty = true;
    } else {
      const asmPath = assemblyIdPath(doc.id);
      const hash = files[asmPath]?.contentHash;
      if (hash && textBlobSha(`${JSON.stringify(wcJson, null, 2)}\n`) !== hash) {
        assemblyDirty = true;
      }
    }
  } catch {
    assemblyDirty = true;
  }

  const unsaved = partIds.length > 0
    || assemblyDirty
    || input.pendingSave === true
    || input.sidecarDirty === true;
  return {
    unsaved,
    assemblyDirty,
    partIds,
    pendingSave: input.pendingSave === true,
  };
}

/**
 * `.surf.json` — the assembly document as stored in the git vault
 * (nameless file at assemblies/<Name>/.surf.json).
 *
 * {
 *   "format": "surfcad.assembly",
 *   "version": 1,
 *   "name": "Gearbox",
 *   "activeId": "parts/Bracket.js" | null,
 *   "parts": [
 *     { "id": "2026-10-07-20-56-31-0423-a3f9", "path": "parts/Bracket.js",
 *       "name": "Bracket", "visible": true, "order": 0, "position": [x, y, z]? },
 *     { "path": "parts/M3 bolt.js", "name": "M3 bolt", "visible": true, "order": 1 },
 *     { "id": "2026-10-07-20-56-31-0424-b10c", "path": "assemblies/Cover/Plate.js",
 *       "name": "Plate", "visible": true, "order": 2, "copiedFrom": "2026-10-07-20-56-31-0999-abcd"? }
 *   ],
 *   "groups": [
 *     { "id": "2026-10-08-02-00-00-0001-ab12", "name": "Cover",
 *       "source": "assemblies/Cover/.surf.json",
 *       "partIds": ["2026-10-07-20-56-31-0424-b10c"] }
 *   ]
 * }
 *
 * `id` is the stable part id (surf id or UUID; optional on read so older
 * repos still load). `path` is a full repo path: this assembly's folder
 * (`assemblies/<Name>/<Part>.js`), a leftover `parts/` file, or another
 * assembly's folder (a link). Legacy `assemblies/<Name>/parts/<P>.js`
 * paths are accepted on read. The in-app row `id` is that stable id;
 * `path` stays the repo file. No script source in the file. `groups` is
 * optional. Each group names parts by surf id (`partIds`).
 * `source` is the source assembly path (`assemblies/<Name>/.surf.json`),
 * or null after that assembly is deleted. The group name stays.
 * A missing `groups` key loads as no groups. Dangling part ids are dropped
 * on read; a group left empty is dropped. `colors` is optional and omitted
 * when empty. It is keyed by surf id. A key for a surf id that is not in
 * `parts` is dropped on load and save. `joints` is optional and omitted
 * when empty. A joint names parts by surf id. One whose part is gone is
 * dropped on load and save. `placement` on a part is `{ t, q }`. Unknown
 * keys are rejected so a typo cannot silently drop data. `version` stays 1.
 */
import {
  ASSEMBLY_VERSION,
  assemblyColorErrors,
  partPosition,
  pruneColorMap,
  serializeAssembly,
} from '../assembly.js';
import { normalizeRepoPath } from '../assembly.js';
import { normalizeSheetMetalBinding } from '../scs/scsCatalog.js';
import { PART_EXT, isVaultPartPath, vaultSegment } from './vaultLayout.js';
import { isSurfId } from './surfId.js';
import { isStablePartId, partRepoPath, stabilizePartIdentities } from './partIdentity.js';
import { rewriteSurfJsonLocalIds } from './localPartIdMigration.js';
import {
  assemblyJointErrors,
  placementErrors,
  pruneDanglingSurfJoints,
} from '../jointSchema.js';

export const SURF_JSON_FORMAT = 'surfcad.assembly';
export const SURF_JSON_VERSION = 1;

const TOP_KEYS = new Set(['format', 'version', 'name', 'activeId', 'parts', 'groups', 'colors', 'joints']);
const PART_KEYS = new Set(['id', 'path', 'name', 'visible', 'order', 'position', 'placement', 'sheetMetal', 'copiedFrom']);
const GROUP_KEYS = new Set(['id', 'name', 'source', 'partIds']);

/**
 * Drop part ids that are real surf ids but not in `parts`, and drop a group
 * that has nothing left. Invalid ids stay so validation can reject them.
 * First group keeps a surf id when two groups list it.
 */
export function pruneDanglingGroupPartIds(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !Array.isArray(raw.groups)) return raw;
  const live = new Set((raw.parts || []).map((part) => part?.id).filter((id) => isSurfId(id)));
  const seen = new Set();
  const groups = [];
  for (const group of raw.groups) {
    if (!group || typeof group !== 'object' || Array.isArray(group) || !Array.isArray(group.partIds)) {
      groups.push(group);
      continue;
    }
    const partIds = [];
    for (const id of group.partIds) {
      if (!isSurfId(id)) {
        partIds.push(id);
        continue;
      }
      if (!live.has(id) || seen.has(id)) continue;
      seen.add(id);
      partIds.push(id);
    }
    if (!partIds.length) continue;
    groups.push({ ...group, partIds });
  }
  return { ...raw, groups };
}

/**
 * Drop color keys that are real surf ids but not in `parts`. Invalid keys
 * stay so validation can reject them. An empty map omits `colors`.
 */
export function pruneDanglingColors(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !Array.isArray(raw.parts)) return raw;
  if (raw.colors == null) return raw;
  const live = raw.parts.map((part) => part?.id).filter((id) => isSurfId(id));
  const colors = pruneColorMap(raw.colors, live);
  if (colors === raw.colors) return raw;
  if (!colors) {
    const rest = { ...raw };
    delete rest.colors;
    return rest;
  }
  return { ...raw, colors };
}

/** { ok, errors: [string] } — every problem, not just the first. */
export function validateSurfJson(input) {
  const errors = [];
  let raw = input;
  if (typeof input === 'string') {
    try {
      raw = JSON.parse(input);
    } catch (err) {
      return { ok: false, errors: [`not JSON: ${err.message}`] };
    }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, errors: ['not an object'] };
  }
  for (const k of Object.keys(raw)) if (!TOP_KEYS.has(k)) errors.push(`unknown key "${k}"`);
  if (raw.format !== SURF_JSON_FORMAT) errors.push(`format must be "${SURF_JSON_FORMAT}"`);
  if (raw.version !== SURF_JSON_VERSION) errors.push(`version must be ${SURF_JSON_VERSION}`);
  const name = typeof raw.name === 'string' ? raw.name : null;
  if (!name || !vaultSegment(name)) errors.push('name must be a non-empty string');
  else if (vaultSegment(name) !== name) errors.push(`name "${name}" is not path-safe`);
  if (!Array.isArray(raw.parts)) {
    errors.push('parts must be an array');
  } else {
    const seen = new Set();
    const seenIds = new Set();
    raw.parts.forEach((part, i) => {
      const at = `parts[${i}]`;
      if (!part || typeof part !== 'object' || Array.isArray(part)) {
        errors.push(`${at} must be an object`);
        return;
      }
      for (const k of Object.keys(part)) if (!PART_KEYS.has(k)) errors.push(`${at} unknown key "${k}"`);
      const path = normalizeRepoPath(part.path);
      if (!path || path !== part.path) errors.push(`${at}.path must be a repo-relative path`);
      else if (!path.endsWith(PART_EXT)) errors.push(`${at}.path must end in ${PART_EXT}`);
      else if (!isVaultPartPath(path)) {
        errors.push(`${at}.path must be a vault part script`);
      }
      if (part.id !== undefined && !isStablePartId(part.id)) errors.push(`${at}.id must be a surf id or UUID`);
      if (part.copiedFrom !== undefined && !isSurfId(part.copiedFrom)) {
        errors.push(`${at}.copiedFrom must be a surf id`);
      }
      if (part.id && seenIds.has(part.id)) errors.push(`${at}.id duplicates ${part.id}`);
      if (part.id) seenIds.add(part.id);
      if (path && seen.has(path)) errors.push(`${at}.path duplicates ${path}`);
      if (path) seen.add(path);
      if (typeof part.name !== 'string' || !part.name.trim()) errors.push(`${at}.name must be a non-empty string`);
      if (typeof part.visible !== 'boolean') errors.push(`${at}.visible must be a boolean`);
      if (!Number.isInteger(part.order) || part.order < 0) errors.push(`${at}.order must be a non-negative integer`);
      if (part.position !== undefined && !partPosition(part)) errors.push(`${at}.position must be [x, y, z] numbers`);
      if (part.placement !== undefined) {
        errors.push(...placementErrors(part.placement, `${at}.placement`));
        const pos = part.position !== undefined ? partPosition(part) : null;
        const t = part.placement && part.placement.t;
        if (pos && Array.isArray(t) && t.length === 3
          && (pos[0] !== t[0] || pos[1] !== t[1] || pos[2] !== t[2])) {
          errors.push(`${at}.position must equal placement.t`);
        }
      }
      if (part.sheetMetal !== undefined && !normalizeSheetMetalBinding(part.sheetMetal)) {
        errors.push(`${at}.sheetMetal must be { sku: string, … }`);
      }
    });
    if (raw.activeId != null && !seen.has(raw.activeId) && !seenIds.has(raw.activeId)) {
      errors.push('activeId must be null or one of the part ids or paths');
    }
  }
  if (raw.groups !== undefined) {
    if (!Array.isArray(raw.groups)) {
      errors.push('groups must be an array');
    } else {
      const seenGroups = new Set();
      const seenPartIds = new Set();
      raw.groups.forEach((group, i) => {
        const at = `groups[${i}]`;
        if (!group || typeof group !== 'object' || Array.isArray(group)) {
          errors.push(`${at} must be an object`);
          return;
        }
        for (const k of Object.keys(group)) if (!GROUP_KEYS.has(k)) errors.push(`${at} unknown key "${k}"`);
        if (!isSurfId(group.id)) errors.push(`${at}.id must be a surf id`);
        if (group.id && seenGroups.has(group.id)) errors.push(`${at}.id duplicates ${group.id}`);
        if (group.id) seenGroups.add(group.id);
        if (typeof group.name !== 'string' || !group.name.trim()) errors.push(`${at}.name must be a non-empty string`);
        if (group.source == null) {
          if (group.source !== null) errors.push(`${at}.source must be a repo-relative path or null`);
        } else {
          const source = normalizeRepoPath(group.source);
          if (typeof group.source !== 'string' || !source || source !== group.source) {
            errors.push(`${at}.source must be a repo-relative path or null`);
          }
        }
        if (!Array.isArray(group.partIds) || !group.partIds.length) {
          errors.push(`${at}.partIds must be a non-empty array`);
        } else {
          group.partIds.forEach((pid, j) => {
            if (!isSurfId(pid)) errors.push(`${at}.partIds[${j}] must be a surf id`);
            else if (seenPartIds.has(pid)) errors.push(`${at}.partIds[${j}] duplicates a grouped part`);
            else seenPartIds.add(pid);
          });
        }
      });
    }
  }
  if (raw.activeId !== undefined && raw.activeId !== null && typeof raw.activeId !== 'string') {
    errors.push('activeId must be a string or null');
  }
  if (raw.colors !== undefined) {
    const live = new Set(
      (Array.isArray(raw.parts) ? raw.parts : []).map((part) => part?.id).filter((id) => isSurfId(id)),
    );
    errors.push(...assemblyColorErrors(raw.colors, live));
  }
  if (raw.joints !== undefined) {
    const live = (Array.isArray(raw.parts) ? raw.parts : [])
      .map((part) => part?.id)
      .filter((id) => isSurfId(id));
    errors.push(...assemblyJointErrors(raw.joints, live));
  }
  return { ok: errors.length === 0, errors };
}

/**
 * In-app assembly document -> .surf.json object. Each row must already
 * have a vault `path` (git mode). Does not assign vault paths — the save
 * path (`ensureAssemblyVaultPaths` / `assembleCommitFiles`) does that first.
 * Throws when the result does not validate.
 */
export function toSurfJson(doc) {
  const flat = serializeAssembly({ ...doc, source: 'git' });
  const name = vaultSegment(flat.name);
  const active = (flat.parts || []).find((p) => p.id === flat.activeId);
  const activePath = partRepoPath(active) || (flat.activeId && isVaultPartPath(flat.activeId) ? flat.activeId : null);
  const out = {
    format: SURF_JSON_FORMAT,
    version: SURF_JSON_VERSION,
    name,
    activeId: activePath || null,
    parts: flat.parts.map((p) => {
      const row = {};
      const id = isStablePartId(p.id) ? p.id : p.surfId;
      if (id) row.id = id;
      row.path = partRepoPath(p);
      row.name = p.name;
      row.visible = p.visible;
      row.order = p.order;
      if (p.position) row.position = p.position;
      if (p.placement) {
        row.placement = { t: p.placement.t.slice(), q: p.placement.q.slice() };
      }
      if (p.sheetMetal) row.sheetMetal = p.sheetMetal;
      if (p.copiedFrom) row.copiedFrom = p.copiedFrom;
      return row;
    }),
  };
  if (flat.groups?.length) {
    out.groups = flat.groups.map((group) => ({
      id: group.id,
      name: group.name,
      source: group.source,
      partIds: group.partIds,
    }));
  }
  if (flat.colors) out.colors = flat.colors;
  if (flat.joints) out.joints = flat.joints;
  const check = validateSurfJson(out);
  if (!check.ok) {
    throw new Error(`Invalid .surf.json: ${check.errors.join('; ')}`);
  }
  return out;
}

/** Stable text for a commit: 2-space indent, trailing newline. */
export function stringifySurfJson(doc) {
  return `${JSON.stringify(toSurfJson(doc), null, 2)}\n`;
}

/** .surf.json text or object -> in-app assembly document (source 'git'). Throws on invalid. */
export function parseSurfJson(input) {
  // A legacy `local:` path or color key fails validation. Strip it before
  // the check. Surf ids that use the older `local-` prefix stay for the
  // surf-id migration.
  let prepared = input;
  if (typeof input === 'string') {
    prepared = rewriteSurfJsonLocalIds(input);
  } else if (input && typeof input === 'object') {
    const text = JSON.stringify(input);
    const rewritten = rewriteSurfJsonLocalIds(text);
    prepared = rewritten === text ? input : JSON.parse(rewritten);
  }
  const parsed = typeof prepared === 'string' ? JSON.parse(prepared) : prepared;
  const raw = pruneDanglingSurfJoints(pruneDanglingColors(pruneDanglingGroupPartIds(parsed)));
  const check = validateSurfJson(raw);
  if (!check.ok) throw new Error(`Invalid .surf.json: ${check.errors.join('; ')}`);
  const loaded = serializeAssembly({
    version: ASSEMBLY_VERSION,
    source: 'git',
    name: raw.name,
    activeId: raw.activeId,
    parts: raw.parts.map((p) => ({
      id: isStablePartId(p.id) ? p.id : p.path,
      path: p.path,
      surfId: isSurfId(p.id) ? p.id : undefined,
      copiedFrom: p.copiedFrom,
      name: p.name,
      visible: p.visible,
      order: p.order,
      position: p.position,
      placement: p.placement,
      sheetMetal: p.sheetMetal,
    })),
    groups: raw.groups,
    colors: raw.colors,
    joints: raw.joints,
  });
  const mappedActive = (loaded.parts || []).find((part) => (
    part.id === raw.activeId || part.path === raw.activeId
  ));
  const withActive = mappedActive
    ? { ...loaded, activeId: mappedActive.id }
    : loaded;
  return stabilizePartIdentities(withActive).doc;
}

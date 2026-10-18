/**
 * v2 `.surf.json` — assembly document at `assemblies/<assembly-id>.surf.json`.
 *
 * {
 *   "format": "surfcad.assembly",
 *   "version": 2,
 *   "id": "<assembly surf id>",
 *   "name": "Gearbox",
 *   "activeId": "<part surf id>" | null,
 *   "parts": [
 *     { "id": "<part surf id>", "name": "Bracket", "visible": true, "order": 0 }
 *   ]
 * }
 *
 * No `path` on parts. Top-level `id` is required. `name` is a label, not a
 * path segment. `groups[].source` is an assembly id (or null).
 *
 * The v1 parser in `surfJson.js` stays the legacy reader and rejects a v2
 * file. This module rejects a v1 file. Nothing here writes git or opens a
 * vault.
 */
import {
  ASSEMBLY_VERSION,
  assemblyColorErrors,
  partPosition,
  serializeAssembly,
} from '../assembly.js';
import { normalizeSheetMetalBinding } from '../scs/scsCatalog.js';
import { isLabelName, isSurfId, isV2SurfId } from './surfId.js';
import {
  SURF_JSON_FORMAT,
  pruneDanglingColors,
  pruneDanglingGroupPartIds,
} from './surfJson.js';
import {
  assemblyJointErrors,
  placementErrors,
  pruneDanglingSurfJoints,
} from '../jointSchema.js';

export const SURF_JSON_VERSION_V2 = 2;

const TOP_KEYS = new Set(['format', 'version', 'id', 'name', 'activeId', 'parts', 'groups', 'colors', 'joints']);
const PART_KEYS = new Set(['id', 'name', 'visible', 'order', 'position', 'placement', 'sheetMetal', 'copiedFrom']);
const GROUP_KEYS = new Set(['id', 'name', 'source', 'partIds']);

function asObject(input) {
  if (typeof input === 'string') {
    try {
      return { raw: JSON.parse(input) };
    } catch (err) {
      return { errors: [`not JSON: ${err.message}`] };
    }
  }
  return { raw: input };
}

/** { ok, errors: [string] } — every problem, not just the first. */
export function validateSurfJsonV2(input) {
  const errors = [];
  const loaded = asObject(input);
  if (loaded.errors) return { ok: false, errors: loaded.errors };
  const raw = loaded.raw;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, errors: ['not an object'] };
  }
  for (const k of Object.keys(raw)) if (!TOP_KEYS.has(k)) errors.push(`unknown key "${k}"`);
  if (raw.format !== SURF_JSON_FORMAT) errors.push(`format must be "${SURF_JSON_FORMAT}"`);
  if (raw.version !== SURF_JSON_VERSION_V2) errors.push(`version must be ${SURF_JSON_VERSION_V2}`);
  if (raw.id === undefined) errors.push('id is required');
  else if (!isV2SurfId(raw.id)) errors.push('id must be a surf id');
  if (!isLabelName(raw.name)) {
    errors.push('name must be a non-empty string');
  }
  if (!Array.isArray(raw.parts)) {
    errors.push('parts must be an array');
  } else {
    const seenIds = new Set();
    raw.parts.forEach((part, i) => {
      const at = `parts[${i}]`;
      if (!part || typeof part !== 'object' || Array.isArray(part)) {
        errors.push(`${at} must be an object`);
        return;
      }
      if (Object.prototype.hasOwnProperty.call(part, 'path')) {
        errors.push(`${at}.path is forbidden`);
      }
      for (const k of Object.keys(part)) {
        if (k === 'path') continue;
        if (!PART_KEYS.has(k)) errors.push(`${at} unknown key "${k}"`);
      }
      if (part.id === undefined) errors.push(`${at}.id is required`);
      else if (!isV2SurfId(part.id)) errors.push(`${at}.id must be a surf id`);
      if (part.copiedFrom !== undefined && !isV2SurfId(part.copiedFrom)) {
        errors.push(`${at}.copiedFrom must be a surf id`);
      }
      if (part.id && seenIds.has(part.id)) errors.push(`${at}.id duplicates ${part.id}`);
      if (part.id) seenIds.add(part.id);
      if (!isLabelName(part.name)) errors.push(`${at}.name must be a non-empty string`);
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
    if (raw.activeId != null && (!isV2SurfId(raw.activeId) || !seenIds.has(raw.activeId))) {
      errors.push('activeId must be null or one of the part ids');
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
        if (!isV2SurfId(group.id)) errors.push(`${at}.id must be a surf id`);
        if (group.id && seenGroups.has(group.id)) errors.push(`${at}.id duplicates ${group.id}`);
        if (group.id) seenGroups.add(group.id);
        if (!isLabelName(group.name)) errors.push(`${at}.name must be a non-empty string`);
        if (group.source == null) {
          if (group.source !== null) errors.push(`${at}.source must be a surf id or null`);
        } else if (!isV2SurfId(group.source)) {
          errors.push(`${at}.source must be a surf id or null`);
        }
        if (!Array.isArray(group.partIds) || !group.partIds.length) {
          errors.push(`${at}.partIds must be a non-empty array`);
        } else {
          group.partIds.forEach((pid, j) => {
            if (!isV2SurfId(pid)) errors.push(`${at}.partIds[${j}] must be a surf id`);
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
      (Array.isArray(raw.parts) ? raw.parts : []).map((part) => part?.id).filter((id) => isV2SurfId(id)),
    );
    errors.push(...assemblyColorErrors(raw.colors, live));
  }
  if (raw.joints !== undefined) {
    const live = (Array.isArray(raw.parts) ? raw.parts : [])
      .map((part) => part?.id)
      .filter((id) => isV2SurfId(id));
    errors.push(...assemblyJointErrors(raw.joints, live));
    if (Array.isArray(raw.joints)) {
      raw.joints.forEach((joint, i) => {
        if (!joint || typeof joint !== 'object' || Array.isArray(joint)) return;
        if (joint.id != null && isSurfId(joint.id) && !isV2SurfId(joint.id)) {
          errors.push(`joints[${i}].id must be a surf id`);
        }
      });
    }
  }
  return { ok: errors.length === 0, errors };
}

/** v2 .surf.json text or object → in-app assembly document. Throws on invalid. */
export function parseSurfJsonV2(input) {
  const parsed = typeof input === 'string' ? JSON.parse(input) : input;
  const raw = pruneDanglingSurfJoints(pruneDanglingColors(pruneDanglingGroupPartIds(parsed)));
  const check = validateSurfJsonV2(raw);
  if (!check.ok) throw new Error(`Invalid .surf.json: ${check.errors.join('; ')}`);
  const loaded = serializeAssembly({
    version: ASSEMBLY_VERSION,
    source: 'git',
    name: raw.name,
    activeId: raw.activeId,
    parts: raw.parts.map((p) => ({
      id: p.id,
      // TODO(PR 2): drop surfId; v2 row id is the only id after WC migration (§2.2).
      surfId: p.id,
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
  return {
    ...loaded,
    id: raw.id,
    activeId: raw.activeId == null ? null : loaded.activeId,
  };
}

// Heuristic fill flags and generic resin suggestions.
// The stand-in flow length is the longest outside edge, not a melt path.
// Nothing here prices a quote or claims a mold-flow result.

import { getMaterial } from '../fea/materials.js';

export const FILL_DISCLAIMER = 'Heuristic. Not a mold-flow result.';

/** Longest outside edge divided by the shortest. */
export const HIGH_ASPECT_RATIO = 8;

/** Stand-in flow length divided by nominal wall. */
export const LONG_FLOW_RATIO = 150;

/** Used only when the nominal wall is unknown. */
export const LONG_EDGE_MM = 200;

/** A structural safety factor under this prefers a stiffer library grade. */
export const STIFF_SAFETY = 1.5;

const SUGGESTION_LIMIT = 3;

function finite(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function round1(value) {
  const n = finite(value);
  if (n == null) return null;
  return Math.round(n * 10) / 10;
}

function edgeLengths(bounds) {
  if (!bounds?.min || !bounds?.max) return [];
  const lengths = [0, 1, 2].map((axis) => bounds.max[axis] - bounds.min[axis]);
  if (lengths.some((n) => !Number.isFinite(n) || n <= 0)) return [];
  return lengths.sort((a, b) => b - a);
}

export function heuristicFillFlags({ bounds, wall } = {}) {
  const edges = edgeLengths(bounds);
  const longest = edges[0] ?? null;
  const shortest = edges[edges.length - 1] ?? null;
  const nominal = finite(wall?.nominal);
  const thinCount = finite(wall?.thinCount) ?? 0;
  const flags = [];
  if (thinCount > 0) {
    flags.push({
      code: 'thin_sections',
      heuristic: true,
      text: 'Thin sections: the wall check marked thin triangles.',
    });
  }
  if (longest != null && shortest != null && longest / shortest >= HIGH_ASPECT_RATIO) {
    const ratio = round1(longest / shortest);
    flags.push({
      code: 'high_aspect',
      heuristic: true,
      text: `High aspect ratio: the longest outside edge is ${ratio}× the shortest.`,
    });
  }
  const ratio = longest != null && nominal != null && nominal > 0 ? longest / nominal : null;
  if (ratio != null && ratio >= LONG_FLOW_RATIO) {
    flags.push({
      code: 'long_flow',
      heuristic: true,
      text: `Long stand-in flow: the longest outside edge is ${round1(longest)} mm over a ${round1(nominal)} mm nominal wall. That edge is not a melt path.`,
    });
  } else if (nominal == null && longest != null && longest >= LONG_EDGE_MM) {
    flags.push({
      code: 'long_flow',
      heuristic: true,
      text: `Long stand-in flow: the longest outside edge is ${round1(longest)} mm. That edge is not a melt path.`,
    });
  }
  return {
    heuristic: true,
    disclaimer: FILL_DISCLAIMER,
    standInFlowMm: longest == null ? null : round1(longest),
    flags,
  };
}

/**
 * Stiffness hint from a study session already in memory.
 * `lookup` resolves a library material id. Modal, stale, and missing
 * results return null. This does not read a stress field.
 */
export function studyStiffnessHint(session, lookup = getMaterial) {
  const result = session?.result;
  const study = session?.study;
  if (!result || result.stale === true) return null;
  if (result.source === 'modal' || study?.type === 'modal') return null;
  const material = study?.material;
  let modulus = finite(material?.E_MPa);
  let materialName = typeof material?.name === 'string' ? material.name.trim() : '';
  if (!(modulus > 0) && typeof material?.id === 'string' && lookup) {
    const row = lookup(material.id);
    modulus = finite(row?.E_MPa);
    if (!materialName && typeof row?.name === 'string') materialName = row.name;
  }
  if (!(modulus > 0)) return null;
  const safetyFactor = finite(result.safetyFactor);
  const p95Mpa = finite(result.p95);
  if (safetyFactor == null && p95Mpa == null) return null;
  return {
    heuristic: true,
    modulusMpa: modulus,
    materialName,
    safetyFactor,
    p95Mpa,
    preferStiffer: safetyFactor != null && safetyFactor < STIFF_SAFETY,
  };
}

export function formatStudyHint(study) {
  if (!study) return '';
  const name = study.materialName ? `${study.materialName}, ` : '';
  const safety = study.safetyFactor == null ? '' : `, safety factor ${round1(study.safetyFactor)}`;
  return `Structural study still in memory (${name}${round1(study.modulusMpa)} MPa${safety}). A stiffness hint, not a fill result.`;
}

function resinReason(resin, { nominal, longFlow, study }) {
  if (nominal != null && nominal < resin.wallMinMm) {
    return `nominal wall ${round1(nominal)} mm is under the ${resin.wallMinMm} mm band`;
  }
  if (nominal != null && nominal > resin.wallMaxMm) {
    return `nominal wall ${round1(nominal)} mm is over the ${resin.wallMaxMm} mm band`;
  }
  if (study?.preferStiffer && resin.tensileModulusMpa >= study.modulusMpa) {
    return 'stiffer than the study material';
  }
  if (longFlow) return `shrink up to ${resin.shrinkHighPct}%`;
  if (nominal != null) {
    return `nominal wall ${round1(nominal)} mm is inside ${resin.wallMinMm}–${resin.wallMaxMm} mm`;
  }
  return 'generic library grade';
}

function resinScore(resin, { nominal, longFlow, study }) {
  let score = 0;
  if (nominal != null) {
    if (nominal >= resin.wallMinMm && nominal <= resin.wallMaxMm) score += 3;
    else if (nominal < resin.wallMinMm) score -= 2;
    else score -= 1;
  }
  if (longFlow) score -= Number(resin.shrinkHighPct) || 0;
  if (study?.preferStiffer) {
    score += resin.tensileModulusMpa >= study.modulusMpa ? 2 : -1;
  }
  return score;
}

export function suggestResins(resins, { wall, fill, study } = {}) {
  const rows = Array.isArray(resins) ? resins : [];
  const nominal = finite(wall?.nominal);
  const longFlow = Array.isArray(fill?.flags) && fill.flags.some((flag) => flag.code === 'long_flow');
  const ctx = { nominal, longFlow, study: study || null };
  return rows
    .map((resin, index) => ({ resin, index, score: resinScore(resin, ctx) }))
    .filter((row) => row.resin && typeof row.resin.grade === 'string' && row.resin.grade)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, SUGGESTION_LIMIT)
    .map((row) => ({
      grade: row.resin.grade,
      tensileModulusMpa: row.resin.tensileModulusMpa,
      reason: resinReason(row.resin, ctx),
    }));
}

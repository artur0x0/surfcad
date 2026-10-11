/**
 * Feature cards name saved contours. They do not carry a profile tool
 * or a contour size. The feature's own parameters stay on the card:
 * extrude distance and sense, revolve angle, axis, segments, and sense,
 * sweep reverse and closed, and a loft station's offset along the
 * contour normal. Sweep has a profile slot and a path slot.
 */

import {
  defaultContourParams,
  defaultExtrudeParams,
  defaultRevolveParams,
  isLoftEntry,
  isSolidContourEntry,
  isSweepEntry,
  REVOLVE_SEGMENTS,
} from './contourMode.js';
import { SEPARATE_BODY_CALL } from './featureMarkers.js';
import { inferExtrudeSense } from './featureSheetWriteback.js';
import { parseLoftReferences } from './loftReference.js';
import {
  parseExtrudeReference,
  parseRevolveReference,
  parseSweepReferences,
} from './solidReference.js';

export const FEATURE_SLOT_TITLE = {
  makeExtrude: 'Extrude',
  makeRevolve: 'Revolve',
  makeLoft: 'Loft',
  makeSweep: 'Sweep',
};

const LOFT_MAX = 8;

function blankStation(id, offset) {
  return { id, contourId: null, contourName: null, label: '', offset };
}

export function emptyFeatureSlotCard(kind) {
  const base = { kind, featureId: null, combine: 'add', merge: true };
  if (kind === 'makeLoft') {
    return {
      ...base,
      stations: [blankStation('p0', 0), blankStation('p1', 20)],
    };
  }
  if (kind === 'makeSweep') {
    return { ...base, profile: null, path: null, sweep: { reverse: false, closed: false } };
  }
  if (kind === 'makeRevolve') {
    return {
      ...base,
      profile: null,
      revolve: { ...defaultRevolveParams(), segments: REVOLVE_SEGMENTS },
    };
  }
  return { ...base, profile: null, extrude: { ...defaultExtrudeParams() } };
}

function refOf(contour) {
  if (!contour?.name) return { contourId: null, contourName: null, label: '', plane: null };
  return {
    contourId: contour.id || contour.name,
    contourName: contour.name,
    label: contour.label || contour.name,
    plane: contour.plane || null,
  };
}

function faceOf(ref) {
  const plane = ref?.plane;
  if (!plane?.center || !plane?.normal || !plane?.x || !plane?.y) return null;
  return {
    type: 'planar',
    planeFrame: {
      center: plane.center.slice(),
      normal: plane.normal.slice(),
      x: plane.x.slice(),
      y: plane.y.slice(),
    },
  };
}

function named(ref) {
  return !!(ref && ref.contourName);
}

/**
 * After a contour rename, every slot that stored this id shows the new name.
 * Offsets and the other slots stay.
 */
export function renameFeatureSlotRefs(card, contourId, contour) {
  if (!card || !contourId || !contour?.name) return card;
  const ref = refOf(contour);
  const hit = (row) => row?.contourId === contourId;
  let next = card;
  if (hit(card.profile)) next = { ...next, profile: { ...card.profile, ...ref } };
  if (hit(card.path)) next = { ...next, path: { ...card.path, ...ref } };
  if (next.stations) {
    next = {
      ...next,
      stations: next.stations.map((row) => (hit(row) ? { ...row, ...ref } : row)),
    };
  }
  return next;
}

/** Empty every slot that stored this contour. Offsets on other stations stay. */
export function clearFeatureSlotRefs(card, contourId) {
  if (!card || !contourId) return card;
  const hit = (row) => row?.contourId === contourId;
  const blank = { contourId: null, contourName: null, label: '', plane: null };
  let next = card;
  if (hit(card.profile)) next = { ...next, profile: null };
  if (hit(card.path)) next = { ...next, path: null };
  if (next.stations) {
    next = {
      ...next,
      stations: next.stations.map((row) => (
        hit(row) ? { ...row, ...blank, offset: row.offset } : row
      )),
    };
  }
  return next;
}

/** Fill one slot. Every other slot, offset, and combine flag stays. */
export function assignFeatureSlot(card, slot, contour) {
  if (!card || !slot) return card;
  const ref = refOf(contour);
  if (isLoftEntry(card.kind) || slot.role === 'station') {
    const stations = (card.stations || []).map((row, i) => (
      i === slot.index ? { ...row, ...ref } : row
    ));
    return { ...card, stations };
  }
  if (slot.role === 'path') {
    const closed = typeof contour?.params?.closed === 'boolean'
      ? contour.params.closed
      : !!card.sweep?.closed;
    return {
      ...card,
      path: named(ref) ? ref : null,
      sweep: { reverse: !!card.sweep?.reverse, closed },
    };
  }
  return { ...card, profile: named(ref) ? ref : null };
}

export function setFeatureStationOffset(card, index, offset) {
  if (!card?.stations) return card;
  return {
    ...card,
    stations: card.stations.map((row, i) => (i === index ? { ...row, offset } : row)),
  };
}

export function addFeatureStation(card) {
  if (!isLoftEntry(card?.kind) || card.stations.length >= LOFT_MAX) return card;
  const n = card.stations.length;
  return {
    ...card,
    stations: [...card.stations, blankStation(`p${n}`, n * 20)],
  };
}

export function removeFeatureStation(card, index) {
  if (!isLoftEntry(card?.kind) || card.stations.length <= 2) return card;
  return {
    ...card,
    stations: card.stations.filter((_, i) => i !== index),
  };
}

function positive(value, max = Infinity) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 && n <= max;
}

export function featureSlotReady(card) {
  if (!card) return false;
  if (isLoftEntry(card.kind)) {
    return card.stations.length >= 2 && card.stations.every((row) => (
      named(row) && Number.isFinite(Number(row.offset))
    ));
  }
  if (isSweepEntry(card.kind)) return named(card.profile) && named(card.path);
  if (card.kind === 'makeRevolve') {
    const segments = Number(card.revolve?.segments);
    return named(card.profile)
      && positive(card.revolve?.angle, 360)
      && Number.isFinite(segments)
      && segments >= 3;
  }
  return named(card.profile) && positive(card.extrude?.distance);
}

/** Hover wins. Otherwise the filled profile (or the first filled station) stays lit. */
export function featureSlotGhostId(card, hoverId) {
  if (hoverId) return hoverId;
  if (!card) return null;
  if (card.profile?.contourId) return card.profile.contourId;
  if (isLoftEntry(card.kind)) {
    const hit = (card.stations || []).find((row) => row.contourId);
    return hit?.contourId || null;
  }
  return card.path?.contourId || null;
}

export function contoursForSlot(contours, role) {
  const list = Array.isArray(contours) ? contours : [];
  if (role === 'path') return list.filter((row) => row.tool === 'path');
  return list.filter((row) => row.tool !== 'path');
}

const ENTRY_BY_KIND = {
  extrude: 'makeExtrude',
  revolve: 'makeRevolve',
  loft: 'makeLoft',
  sweep: 'makeSweep',
};

function featureIdFromBlock(block) {
  const m = String(block || '').match(/\bid=([A-Za-z_$][\w$]*)(?![\w$-])/);
  return m ? m[1] : null;
}

function contourRef(name, contours) {
  if (!name) return null;
  const row = (contours || []).find((item) => item.name === name || item.id === name);
  if (row) return refOf(row);
  return { contourId: name, contourName: name, label: name, plane: null };
}

function revolveNumbers(block) {
  const m = String(block || '').match(/,\s*(\d+)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)(?:\.rotate)?/);
  if (!m) return null;
  return { segments: Number(m[1]), angle: Number(m[2]) };
}

/** V-axis is `[u, v]`. U-axis is `[-v, u]`. Anything else stays on V. */
function revolveAxisFromBlock(block) {
  const map = String(block || '').match(
    /ring\.map\(\s*\(\s*\[\s*u\s*,\s*v\s*\]\s*\)\s*=>\s*\[\s*([^,\]]+)\s*,\s*([^\]]+)\s*\]/,
  );
  if (!map) return 'v';
  const radial = map[1].replace(/\s+/g, '');
  const height = map[2].replace(/\s+/g, '');
  if (radial === 'u' && height === 'v') return 'v';
  if (radial === '-v' && height === 'u') return 'u';
  return 'v';
}

function revolveSenseFromBlock(block, angle) {
  const rot = String(block || '').match(/\.rotate\(\s*\[\s*0\s*,\s*0\s*,\s*(-?\d+(?:\.\d+)?)\s*\]\s*\)/);
  if (!rot) return 'positive';
  const start = Number(rot[1]);
  const a = Number(angle);
  if (Number.isFinite(a) && Math.abs(start + a) < 1e-6) return 'negative';
  if (Number.isFinite(a) && Math.abs(start + a / 2) < 1e-6) return 'both';
  return 'positive';
}

/**
 * Slot card for a saved Extrude, Revolve, Loft, or Sweep block.
 * A named contour fills that slot. An inline profile with no name stays
 * empty, so the chip reads Pick a contour. Confirm rewrites `id=` when
 * the marker carries one. A positional chip id such as `extrude-0` does not.
 */
export function featureSlotCardFromEdit(session, contours = []) {
  const entry = session?.entry || ENTRY_BY_KIND[session?.kind] || ENTRY_BY_KIND[session?.feature?.kind];
  const card = emptyFeatureSlotCard(isSolidContourEntry(entry) ? entry : 'makeExtrude');
  const block = String(session?.block || '');
  const fields = session?.fields || {};
  card.featureId = featureIdFromBlock(block);
  card.combine = /\.subtract\s*\(/.test(block) ? 'subtract' : 'add';
  card.merge = card.combine === 'subtract' ? true : !SEPARATE_BODY_CALL.test(block);

  if (card.kind === 'makeExtrude') {
    const parsed = parseExtrudeReference(block);
    const distance = parsed?.distance ?? fields.distance;
    const sense = parsed
      ? inferExtrudeSense(parsed.distance, parsed.w)
      : (fields.sense || card.extrude.sense);
    return {
      ...card,
      profile: contourRef(parsed?.name, contours),
      extrude: {
        ...card.extrude,
        ...(distance != null ? { distance } : {}),
        sense,
      },
    };
  }

  if (card.kind === 'makeRevolve') {
    const parsed = parseRevolveReference(block);
    const nums = revolveNumbers(block);
    const angle = fields.angle ?? nums?.angle ?? card.revolve.angle;
    return {
      ...card,
      profile: contourRef(parsed?.name, contours),
      revolve: {
        ...card.revolve,
        angle,
        segments: nums?.segments ?? card.revolve.segments,
        sense: revolveSenseFromBlock(block, angle),
        axis: revolveAxisFromBlock(block),
      },
    };
  }

  if (card.kind === 'makeSweep') {
    const parsed = parseSweepReferences(block);
    const lit = block.match(/closed:\s*(true|false)/);
    let closed = lit ? lit[1] === 'true' : !!card.sweep?.closed;
    if (!lit && parsed?.path) {
      const path = (contours || []).find((item) => item.name === parsed.path || item.id === parsed.path);
      if (typeof path?.params?.closed === 'boolean') closed = path.params.closed;
    }
    return {
      ...card,
      profile: contourRef(parsed?.profile, contours),
      path: contourRef(parsed?.path, contours),
      sweep: {
        reverse: /\.slice\(\)\.reverse\(\)/.test(block) || !!fields.reverse,
        closed,
      },
    };
  }

  const stations = parseLoftReferences(block);
  if (stations.length >= 2) {
    return {
      ...card,
      stations: stations.map((row, index) => ({
        id: `p${index}`,
        ...contourRef(row.name, contours),
        offset: row.offset,
      })),
    };
  }
  return card;
}

/**
 * Confirm payload. Names that already exist are kept. Distance, sense,
 * angle, axis, segments, reverse, and closed come from the card.
 */
export function featureSlotCommitPayload(card) {
  const combine = card.combine === 'subtract' ? 'subtract' : 'add';
  const merge = combine === 'subtract' ? true : card.merge !== false;
  const featureId = card.featureId || null;
  const circle = { tool: 'circle', params: { ...defaultContourParams('circle') } };
  if (card.kind === 'makeExtrude') {
    return {
      entry: 'makeExtrude',
      ...circle,
      face: faceOf(card.profile),
      combine,
      merge,
      featureId,
      contourId: card.profile.contourId,
      contourName: card.profile.contourName,
      extrude: { ...defaultExtrudeParams(), ...card.extrude },
    };
  }
  if (card.kind === 'makeRevolve') {
    return {
      entry: 'makeRevolve',
      ...circle,
      face: faceOf(card.profile),
      combine,
      merge,
      featureId,
      contourId: card.profile.contourId,
      contourName: card.profile.contourName,
      revolve: { ...defaultRevolveParams(), segments: REVOLVE_SEGMENTS, ...card.revolve },
    };
  }
  if (card.kind === 'makeSweep') {
    return {
      entry: 'makeSweep',
      ...circle,
      face: faceOf(card.profile),
      combine,
      merge,
      featureId,
      contourId: card.profile.contourId,
      contourName: card.profile.contourName,
      pathContourId: card.path.contourId,
      pathContourName: card.path.contourName,
      sweep: {
        reverse: !!card.sweep?.reverse,
        closed: !!card.sweep?.closed,
      },
      edges: [],
    };
  }
  return {
    entry: 'makeLoft',
    face: null,
    combine,
    merge,
    featureId,
    loft: {
      selected: 0,
      profiles: card.stations.map((row) => ({
        id: row.id,
        tool: 'circle',
        params: { ...defaultContourParams('circle') },
        offset: Number(row.offset) || 0,
        contourId: row.contourId,
        contourName: row.contourName,
      })),
    },
  };
}

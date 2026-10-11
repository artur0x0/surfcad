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
  isSweepEntry,
  REVOLVE_SEGMENTS,
} from './contourMode.js';

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

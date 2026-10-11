/**
 * Feature cards name saved contours. They do not carry a profile tool,
 * a size, or a solid dimension. A Loft station keeps an optional offset
 * along that contour's normal. Sweep has a profile slot and a path slot.
 */

import {
  defaultContourParams,
  defaultExtrudeParams,
  defaultRevolveParams,
  isLoftEntry,
  isSweepEntry,
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
  if (kind === 'makeSweep') return { ...base, profile: null, path: null };
  return { ...base, profile: null };
}

function refOf(contour) {
  if (!contour?.name) return { contourId: null, contourName: null, label: '' };
  return {
    contourId: contour.id || contour.name,
    contourName: contour.name,
    label: contour.label || contour.name,
  };
}

function named(ref) {
  return !!(ref && ref.contourName);
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
    return { ...card, path: named(ref) ? ref : null };
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

export function featureSlotReady(card) {
  if (!card) return false;
  if (isLoftEntry(card.kind)) {
    return card.stations.length >= 2 && card.stations.every((row) => (
      named(row) && Number.isFinite(Number(row.offset))
    ));
  }
  if (isSweepEntry(card.kind)) return named(card.profile) && named(card.path);
  return named(card.profile);
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
 * Confirm payload. Names that already exist are kept. Distance, angle,
 * axis, and sense stay at the composer defaults because those fields
 * are not on the card.
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
      face: null,
      combine,
      merge,
      featureId,
      contourId: card.profile.contourId,
      contourName: card.profile.contourName,
      extrude: { ...defaultExtrudeParams() },
    };
  }
  if (card.kind === 'makeRevolve') {
    return {
      entry: 'makeRevolve',
      ...circle,
      face: null,
      combine,
      merge,
      featureId,
      contourId: card.profile.contourId,
      contourName: card.profile.contourName,
      revolve: { ...defaultRevolveParams() },
    };
  }
  if (card.kind === 'makeSweep') {
    return {
      entry: 'makeSweep',
      ...circle,
      face: null,
      combine,
      merge,
      featureId,
      contourId: card.profile.contourId,
      contourName: card.profile.contourName,
      pathContourId: card.path.contourId,
      pathContourName: card.path.contourName,
      sweep: { reverse: false },
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

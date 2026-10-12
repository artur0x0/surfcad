/**
 * Slice Mobile C — parse / surgically rewrite params inside a marked feature
 * block so the CAD-stage feature sheet can edit Extrude / Fillet / Revolve
 * without entering Monaco.
 *
 * Writeback prefers literal replacement inside the existing marked region
 * (same begin…end comments composers already emit). Types we cannot param-edit
 * yet return stub: true → sheet shows "Edit script" only.
 */

import { parseFeatureMarkers } from './featureMarkers.js';
import { readSheetMetalSpec } from './sheetMetal/sheetMetalScript.js';

/** Kinds with real numeric writeback in Slice C. */
export const FEATURE_SHEET_EDITABLE = Object.freeze(['extrude', 'fillet', 'revolve']);

export function isFeatureSheetEditable(kind) {
  return FEATURE_SHEET_EDITABLE.includes(kind);
}

/**
 * Slice a feature's marked block text from the full script.
 * @param {string} script
 * @param {{ startOffset: number, endOffset: number }} feature
 */
export function featureBlockText(script, feature) {
  if (!feature || typeof script !== 'string') return '';
  const a = Math.max(0, feature.startOffset | 0);
  const b = Math.max(a, feature.endOffset | 0);
  return script.slice(a, b);
}

function numOr(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Infer Extrude sense from placeInFrame local-Z offset vs distance.
 * Matches contourMode / helperPaletteSnippets emit rules.
 */
export function inferExtrudeSense(distance, w) {
  const d = numOr(distance, 0);
  const offset = numOr(w, 0);
  if (!(d > 0)) return 'positive';
  if (Math.abs(offset + d) < 1e-6) return 'negative';
  if (Math.abs(offset + d / 2) < 1e-6) return 'both';
  if (Math.abs(offset) < 1e-6) return 'positive';
  // Unknown offset — treat as positive so Accept rewrites cleanly.
  return 'positive';
}

export function extrudeSenseOffset(distance, sense) {
  const d = Math.max(0.1, numOr(distance, 10));
  if (sense === 'negative') return +((-d).toFixed(4));
  if (sense === 'both') return +((-d / 2).toFixed(4));
  return 0;
}

/**
 * A sheet cut drawn on one face used to stop on that plane. The bend arc
 * sits about one inner radius on the other side of the tangent, so a
 * one-sided 10 mm depth left a skin on the arc. A subtract on a sheet
 * spans at least `t + r + 1` mm both ways from the sketch plane, and still
 * covers whatever depth was requested. The shift is symmetric, so the card
 * reads it back as sense `both`. No sheet spec leaves the span alone.
 */
export function sheetCutExtrudeSpan(script, distance, w) {
  const spec = readSheetMetalSpec(script);
  const t = Number(spec?.t) || 0;
  const bendR = Number(spec?.r) || 0;
  const d = Number(distance);
  const shift = Number(w);
  if (!(t > 0) || !(d > 0) || !Number.isFinite(shift)) {
    return { distance: d, w: Number.isFinite(shift) ? shift : 0 };
  }
  const reach = t + Math.max(0, bendR) + 1;
  const z0 = shift;
  const z1 = shift + d;
  const lo = Math.min(z0, -reach);
  const hi = Math.max(z1, reach);
  const half = Math.max(-lo, hi);
  return {
    distance: +((half * 2).toFixed(4)),
    w: +((-half).toFixed(4)),
  };
}

/**
 * Parse editable params from a marked block.
 * @returns {{ editable: boolean, stub?: boolean, params: object, message?: string }}
 */
export function parseFeatureSheetParams(kind, blockText) {
  const text = String(blockText || '');
  if (kind === 'extrude') {
    const distM = text.match(/makeExtrude\s*\(\s*[^,]+,\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)\s*\)/);
    if (!distM) {
      return { editable: false, stub: true, params: {}, message: 'No makeExtrude distance found' };
    }
    const distance = numOr(distM[1], 10);
    // placeInFrame(plane, makeExtrude(...), [0, 0, w]) — w is the third vector component
    const wM = text.match(
      /placeInFrame\s*\(\s*[^,]+,\s*makeExtrude\s*\([^)]*\)\s*,\s*\[\s*[-+.\deE]+\s*,\s*[-+.\deE]+\s*,\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)\s*\]\s*\)/,
    );
    const w = wM ? numOr(wM[1], 0) : 0;
    const sense = inferExtrudeSense(distance, w);
    return {
      editable: true,
      params: { distance, sense },
    };
  }

  if (kind === 'fillet') {
    // filletAlongPath(body, path, R, …) or filletEdges(body, edges, R, …)
    const along = text.match(
      /filletAlongPath\s*\(\s*[^,]+,\s*[^,]+,\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/,
    );
    const edges = text.match(
      /filletEdges\s*\(\s*[^,]+,\s*[^,]+,\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/,
    );
    const m = along || edges;
    if (!m) {
      return { editable: false, stub: true, params: {}, message: 'No fillet radius found' };
    }
    return {
      editable: true,
      params: { radius: Math.max(0.01, numOr(m[1], 2)) },
    };
  }

  if (kind === 'revolve') {
    // makeRevolve(contours, segs, angle)
    const m = text.match(
      /makeRevolve\s*\(\s*[^,]+,\s*[^,]+,\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)\s*\)/,
    );
    if (!m) {
      return { editable: false, stub: true, params: {}, message: 'No makeRevolve angle found' };
    }
    return {
      editable: true,
      params: { angle: Math.max(0.1, Math.min(360, numOr(m[1], 360))) },
    };
  }

  return {
    editable: false,
    stub: true,
    params: {},
    message: 'Param sheet not available — use Edit script',
  };
}

function rewriteExtrudeBlock(block, params, script) {
  let distance = Math.max(0.1, numOr(params.distance, 10));
  const sense = params.sense === 'negative' || params.sense === 'both'
    ? params.sense
    : 'positive';
  let w = extrudeSenseOffset(distance, sense);
  if (/part\s*=\s*part\.subtract\(/.test(block)) {
    const span = sheetCutExtrudeSpan(script, distance, w);
    distance = span.distance;
    w = span.w;
  }
  const distLit = Number.isInteger(distance) ? String(distance) : String(+distance.toFixed(4));
  const wLit = Number.isInteger(w) ? String(w) : String(+Number(w).toFixed(4));

  let next = block.replace(
    /makeExtrude\s*\(\s*([^,]+),\s*[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?\s*\)/g,
    (_m, contours) => `makeExtrude(${contours}, ${distLit})`,
  );
  next = next.replace(
    /(placeInFrame\s*\(\s*[^,]+,\s*makeExtrude\s*\([^)]*\)\s*,\s*\[\s*)[-+.\deE]+(\s*,\s*)[-+.\deE]+(\s*,\s*)[-+.\deE]+(\s*\]\s*\))/g,
    (_m, a, b, c, d) => `${a}0${b}0${c}${wLit}${d}`,
  );
  return next;
}

function rewriteFilletBlock(block, params) {
  const radius = Math.max(0.01, numOr(params.radius, 2));
  const lit = Number.isInteger(radius) ? String(radius) : String(+radius.toFixed(4));
  let next = block.replace(
    /(filletAlongPath\s*\(\s*[^,]+,\s*[^,]+,\s*)[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g,
    (_m, head) => `${head}${lit}`,
  );
  next = next.replace(
    /(filletEdges\s*\(\s*[^,]+,\s*[^,]+,\s*)[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g,
    (_m, head) => `${head}${lit}`,
  );
  return next;
}

function rewriteRevolveBlock(block, params) {
  const angle = Math.max(0.1, Math.min(360, numOr(params.angle, 360)));
  const lit = Number.isInteger(angle) ? String(angle) : String(+angle.toFixed(4));
  return block.replace(
    /(makeRevolve\s*\(\s*[^,]+,\s*[^,]+,\s*)[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?(\s*\))/g,
    (_m, head, tail) => `${head}${lit}${tail}`,
  );
}

/**
 * Replace the marked feature block with a param-updated copy.
 * @returns {{ ok: true, buffer: string, run: true } | { ok: false, message: string }}
 */
export function writeFeatureSheetParams(script, feature, params) {
  if (!feature || typeof script !== 'string') {
    return { ok: false, message: 'writeFeatureSheetParams: missing feature' };
  }
  if (!isFeatureSheetEditable(feature.kind)) {
    return { ok: false, message: 'Param writeback not available for this feature — use Edit script.' };
  }
  const before = script.slice(0, feature.startOffset);
  const block = script.slice(feature.startOffset, feature.endOffset);
  const after = script.slice(feature.endOffset);
  if (!block) {
    return { ok: false, message: 'writeFeatureSheetParams: empty block' };
  }

  let nextBlock;
  if (feature.kind === 'extrude') nextBlock = rewriteExtrudeBlock(block, params || {}, script);
  else if (feature.kind === 'fillet') nextBlock = rewriteFilletBlock(block, params || {});
  else if (feature.kind === 'revolve') nextBlock = rewriteRevolveBlock(block, params || {});
  else {
    return { ok: false, message: 'Param writeback not available for this feature — use Edit script.' };
  }

  if (nextBlock === block) {
    // Still ok — Accept with unchanged values is a no-op write.
    return { ok: true, buffer: script, run: true };
  }

  // Sanity: markers must survive.
  if (!nextBlock.includes('begin') || !nextBlock.includes('end')) {
    return { ok: false, message: 'writeFeatureSheetParams: markers lost — refusing write.' };
  }
  return { ok: true, buffer: before + nextBlock + after, run: true };
}

/**
 * Pick a default feature to open from a long-press (prefer Extrude → Fillet → Revolve → first).
 */

/**
 * Remove a marked feature block from the script (Delete on the feature sheet).
 * Surgically drops [startOffset, endOffset) and collapses one bordering blank
 * line so neighboring features do not leave a hole. Caller Auto-Runs.
 * @returns {{ ok: true, buffer: string, run: true } | { ok: false, message: string }}
 */
export function deleteFeatureBlock(script, feature) {
  if (!feature || typeof script !== 'string') {
    return { ok: false, message: 'deleteFeatureBlock: missing feature' };
  }
  const a = Math.max(0, feature.startOffset | 0);
  const b = Math.max(a, feature.endOffset | 0);
  if (!(b > a) || b > script.length) {
    return { ok: false, message: 'deleteFeatureBlock: invalid range' };
  }
  let before = script.slice(0, a);
  let after = script.slice(b);
  // Swallow one bordering newline so we do not leave an extra blank row.
  if (/(?:\r?\n)[ \t]*$/u.test(before) && /^(?:\r?\n)/u.test(after)) {
    after = after.replace(/^(?:\r?\n)/u, '');
  }
  if (!after) {
    before = before.replace(/(?:\r?\n){2,}$/u, '\n');
  } else if (!before) {
    after = after.replace(/^(?:\r?\n)+/u, '');
  }
  return { ok: true, buffer: before + after, run: true };
}

export function pickDefaultFeatureSheetTarget(script) {
  const features = parseFeatureMarkers(script);
  if (!features.length) return null;
  const prefer = ['extrude', 'fillet', 'revolve'];
  for (const kind of prefer) {
    // Most recent of that kind (last in script order).
    for (let i = features.length - 1; i >= 0; i--) {
      if (features[i].kind === kind) return features[i];
    }
  }
  return features[features.length - 1];
}

export function listFeatureSheetTargets(script) {
  return parseFeatureMarkers(script);
}

/**
 * The sheet's `feature` as it is in `script` now: the same id and kind, else
 * the same kind at the same index. Null when that block is not in this
 * script. Never the caller's own offsets: those can come from another part's
 * script (the strip shows the picked part), and a Delete with them either
 * hit "invalid range" or cut the wrong text out of this part.
 */
export function liveSheetFeature(script, feature) {
  if (!feature || typeof script !== 'string') return null;
  const list = parseFeatureMarkers(script);
  return list.find((f) => f.id === feature.id && f.kind === feature.kind)
    || list.find((f) => f.kind === feature.kind && f.index === feature.index)
    || null;
}

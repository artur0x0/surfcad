/**
 * Who uses a named contour, and how an edit of that contour is saved.
 *
 * The contour editor rewrites the contour statement by id. Feature blocks
 * already name it, so they stay put unless the binding is renamed.
 * A rename rewrites bare identifiers after the geometry write, so the
 * id lookup still sees the old binding.
 */

import { parseFeatureMarkers } from './featureMarkers.js';
import { contourStatements, renameNamedContour, upsertNamedContour } from './namedContour.js';
import { composeContourProfile, planeFromContourFace } from './contourMode.js';
import { emitPathProfileExpr } from './solidReference.js';

const USER_KINDS = new Set(['extrude', 'revolve', 'loft', 'sweep']);

const KIND_TITLE = {
  extrude: 'Extrude',
  revolve: 'Revolve',
  loft: 'Loft',
  sweep: 'Sweep',
};

function isIdentChar(ch) {
  return /[A-Za-z0-9_$]/.test(ch || '');
}

/**
 * True when `name` is a bare identifier in `text`.
 * `c1` does not match `c10`. A property (`obj.c1`) is not a reference.
 * Strings and comments are not references.
 */
export function mentionsIdentifier(text, name) {
  const src = String(text || '');
  const wanted = String(name || '');
  if (!wanted) return false;
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') {
      const nl = src.indexOf('\n', i);
      i = nl < 0 ? src.length : nl;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      i = end < 0 ? src.length : end + 2;
      continue;
    }
    if (c === '\'' || c === '"' || c === '`') {
      const q = c;
      i += 1;
      while (i < src.length && src[i] !== q) {
        i += src[i] === '\\' ? 2 : 1;
      }
      if (i < src.length) i += 1;
      continue;
    }
    if (isIdentChar(c) && !isIdentChar(src[i - 1])) {
      let j = i + 1;
      while (isIdentChar(src[j])) j += 1;
      const word = src.slice(i, j);
      const prev = i > 0 ? src[i - 1] : '';
      if (word === wanted && prev !== '.') return true;
      i = j;
      continue;
    }
    i += 1;
  }
  return false;
}

/**
 * "Extrude 1" from `extrude1`. A positional id (`extrude-0`) keeps the chip label.
 */
export function featureLabelFromBlock(feature) {
  const kind = feature?.kind || '';
  const title = KIND_TITLE[kind] || feature?.label || kind || 'Feature';
  const id = String(feature?.id || '');
  const numbered = kind ? id.match(new RegExp(`^${kind}(\\d+)$`)) : null;
  if (numbered) return `${title} ${numbered[1]}`;
  if (feature?.chipLabel) return feature.chipLabel;
  return title;
}

/**
 * Extrude, Revolve, Loft, and Sweep blocks that name this contour, in script order.
 * @returns {Array<{ id: string, kind: string, label: string, startOffset: number }>}
 */
export function contourFeatureUsers(buffer, contourName) {
  const text = String(buffer || '');
  const name = String(contourName || '');
  if (!name) return [];
  return parseFeatureMarkers(text)
    .filter((feature) => USER_KINDS.has(feature.kind))
    .filter((feature) => mentionsIdentifier(text.slice(feature.startOffset, feature.endOffset), name))
    .map((feature) => ({
      id: feature.id,
      kind: feature.kind,
      label: featureLabelFromBlock(feature),
      startOffset: feature.startOffset,
    }));
}

/** "Used by Loft 1, Extrude 2", or "Unused". */
export function contourUsedByText(buffer, contourName) {
  const users = contourFeatureUsers(buffer, contourName);
  if (!users.length) return 'Unused';
  return `Used by ${users.map((user) => user.label).join(', ')}`;
}

/**
 * Feature chips plus one chip per named contour, in source order.
 * A contour chip has no type index, so the strip draws no badge.
 */
export function featuresWithContours(script) {
  const text = String(script || '');
  const features = parseFeatureMarkers(text);
  const contours = contourStatements(text).map((stmt) => ({
    id: `contour:${stmt.id}`,
    kind: 'contour',
    label: stmt.name,
    chipLabel: stmt.name,
    startOffset: stmt.start,
    endOffset: stmt.end,
    external: false,
    separate: false,
    index: null,
    typeIndex: null,
    contourId: stmt.id,
  }));
  return [...features, ...contours].sort((a, b) => (
    a.startOffset - b.startOffset || String(a.id).localeCompare(String(b.id))
  ));
}

function pathPoints(params) {
  let pts = Array.isArray(params?.points)
    ? params.points.map((p) => [Number(p[0]), Number(p[1])])
    : [];
  if (pts.some((p) => !Number.isFinite(p[0]) || !Number.isFinite(p[1]))) return null;
  if (pts.length >= 2) {
    const a = pts[0];
    const b = pts[pts.length - 1];
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6) pts = pts.slice(0, -1);
  }
  return pts.length >= 2 ? pts : null;
}

/**
 * Rewrite this contour's statement. The binding name stays until a following
 * rename, so references update only when the editor name differs.
 *
 * @returns {{ ok: true, buffer: string, id: string, name: string, run: true } | { ok: false, message: string }}
 */
export function saveEditedContour(buffer, spec = {}) {
  const id = spec.id ? String(spec.id) : '';
  const stmt = contourStatements(buffer).find((row) => row.id === id);
  if (!stmt) return { ok: false, message: 'No contour with that id.' };
  const editorName = String(spec.name || stmt.name).trim();
  if (editorName !== stmt.name) {
    const gate = renameNamedContour(buffer, id, editorName);
    if (!gate.ok) return gate;
  }
  const tool = spec.tool || 'circle';
  const params = spec.params || {};
  const face = spec.face && spec.face.type === 'planar' ? spec.face : null;
  let next;
  if (tool === 'path') {
    const pts = pathPoints(params);
    if (!pts) return { ok: false, message: 'Path needs at least 2 points.' };
    const closed = typeof params.closed === 'boolean' ? params.closed : pts.length >= 3;
    const saved = upsertNamedContour(buffer, {
      id,
      name: stmt.name,
      frame: planeFromContourFace(face),
      profileExpr: emitPathProfileExpr(pts, closed),
    });
    if (!saved.ok) return saved;
    next = saved.buffer;
  } else {
    const saved = composeContourProfile(buffer, {
      face,
      tool,
      params,
      contourId: id,
      contourName: stmt.name,
    });
    if (!saved.ok) return saved;
    next = saved.buffer;
  }
  if (editorName !== stmt.name) {
    const renamed = renameNamedContour(next, id, editorName);
    if (!renamed.ok) return renamed;
    next = renamed.buffer;
  }
  return { ok: true, buffer: next, id, name: editorName, run: true };
}

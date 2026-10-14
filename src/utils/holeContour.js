/**
 * Write a Hole feature that names a centres contour.
 *
 * The contour is its own statement (`role=centers`). The hole block only
 * names it, so a second Hole can share the contour. Both inserts land
 * immediately before the script's `return part;`. `commitScriptAtRollback`
 * then moves a fresh centres statement with the hole that first names it.
 * An old hole(), clearanceHole, tapDrillHole, cboreHole, cskHole, or
 * holePattern block is left as written.
 */

import {
  featureMarkersBalanced,
  findFeatureBlocks,
  markerWithId,
  mintBlockId,
} from './featureBlockId.js';
import { HOLE_BEGIN, HOLE_END, declaredNames } from './helperPaletteSnippets.js';
import { emitSolveContour, parseScriptValue, parseSolveContour } from './contourScript.js';
import {
  contourStatements,
  insertBeforeScriptReturn,
  upsertNamedContour,
} from './namedContour.js';

function num(value, label) {
  const n = Number(value);
  if (!Number.isFinite(n)) return { ok: false, message: `Hole ${label} must be a finite number.` };
  return { ok: true, n };
}

function ident(value, label) {
  const text = String(value || '');
  if (!/^[A-Za-z0-9#./_-]+$/.test(text)) {
    return { ok: false, message: `Hole ${label} is not a size.` };
  }
  return { ok: true, text };
}

function normalizeEnd(raw, label) {
  if (raw == null || raw === 'none') return { ok: true, end: null };
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, message: `Hole ${label} must be none or { kind, dia, depth }.` };
  }
  const kind = raw.kind == null ? 'none' : String(raw.kind);
  if (kind === 'none') return { ok: true, end: { kind: 'none' } };
  if (kind !== 'cbore' && kind !== 'csk') {
    return { ok: false, message: `Hole ${label} kind must be none, cbore, or csk.` };
  }
  const dia = num(raw.dia, `${label} dia`);
  if (!dia.ok) return dia;
  const depth = num(raw.depth, `${label} depth`);
  if (!depth.ok) return depth;
  if (!(dia.n > 0) || !(depth.n > 0)) {
    return { ok: false, message: `Hole ${label} needs a dia and a depth.` };
  }
  return { ok: true, end: { kind, dia: dia.n, depth: depth.n } };
}

function normalizeSpec(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const hasDepth = src.depth != null && src.depth !== '';
  if (src.through === true && hasDepth) {
    return { ok: false, message: 'Hole sets through or depth, not both.' };
  }
  const blind = src.through === false || (hasDepth && src.through !== true);
  let side = 1;
  if (src.side != null && src.side !== '') {
    const parsed = num(src.side, 'side');
    if (!parsed.ok) return parsed;
    side = parsed.n;
    if (side !== 1 && side !== -1) return { ok: false, message: 'Hole side must be 1 or -1.' };
  }
  if (src.flip === true && src.side != null && src.side !== '' && side !== -1) {
    return { ok: false, message: 'Hole flip and side disagree.' };
  }
  if (src.flip === true) side = -1;

  let dia = null;
  let type = null;
  let size = null;
  let fit = null;
  if (src.dia != null && src.dia !== '') {
    const parsed = num(src.dia, 'dia');
    if (!parsed.ok) return parsed;
    if (!(parsed.n > 0)) return { ok: false, message: 'Hole dia must be > 0.' };
    dia = parsed.n;
  } else {
    type = src.type == null || src.type === 'clearance'
      ? 'clearance'
      : (src.type === 'tap' || src.type === 'tapDrill' ? 'tapDrill' : null);
    if (!type) return { ok: false, message: 'Hole type must be clearance or tapDrill.' };
    const sized = ident(src.size, 'size');
    if (!sized.ok) return sized;
    size = sized.text;
    if (type === 'clearance') {
      const fitted = ident(src.fit || 'normal', 'fit');
      if (!fitted.ok) return fitted;
      fit = fitted.text;
    }
  }
  const near = normalizeEnd(src.near, 'near');
  if (!near.ok) return near;
  const far = normalizeEnd(src.far, 'far');
  if (!far.ok) return far;
  if (blind && far.end && far.end.kind !== 'none') {
    return { ok: false, message: 'A blind hole has no far end.' };
  }
  if (dia != null) {
    for (const end of [near.end, far.end]) {
      if (end && end.kind && end.kind !== 'none' && !(end.dia > dia)) {
        return { ok: false, message: 'Hole end dia must be greater than the hole dia.' };
      }
    }
  }
  if (!blind) {
    return { ok: true, spec: { dia, type, size, fit, through: true, side, near: near.end, far: far.end } };
  }
  const depth = num(src.depth, 'depth');
  if (!depth.ok) return depth;
  if (!(depth.n > 0)) return { ok: false, message: 'Hole depth must be > 0.' };
  return {
    ok: true,
    spec: { dia, type, size, fit, through: false, depth: depth.n, side, near: near.end, far: far.end },
  };
}

function emitNum(n) {
  return String(n);
}

function emitEnd(end) {
  if (!end) return null;
  if (end.kind === 'none') return `{ kind: 'none' }`;
  return `{ kind: '${end.kind}', dia: ${emitNum(end.dia)}, depth: ${emitNum(end.depth)} }`;
}

function emitHoleCall(name, spec) {
  const fields = [];
  if (spec.dia != null) fields.push(`dia: ${emitNum(spec.dia)}`);
  else {
    fields.push(`type: '${spec.type}'`);
    fields.push(`size: '${spec.size}'`);
    if (spec.type === 'clearance') fields.push(`fit: '${spec.fit}'`);
  }
  if (spec.through) fields.push('through: true');
  else fields.push(`through: false, depth: ${emitNum(spec.depth)}`);
  fields.push(`side: ${spec.side}`);
  const near = emitEnd(spec.near);
  const far = emitEnd(spec.far);
  if (near) fields.push(`near: ${near}`);
  if (far) fields.push(`far: ${far}`);
  return `part = holesOnContour(part, ${name}, { ${fields.join(', ')} });`;
}

function listHoleBlocks(buffer) {
  return findFeatureBlocks(buffer, HOLE_BEGIN, HOLE_END);
}

function isContourHole(text) {
  return /holesOnContour\s*\(/.test(String(text || ''));
}

function contourNameInBlock(text) {
  return holeName(text);
}

function holeName(text) {
  const match = String(text || '').match(/holesOnContour\s*\(\s*part\s*,\s*([A-Za-z_$][\w$]*)/);
  return match ? match[1] : null;
}

function centreCount(contour) {
  return Array.isArray(contour?.points) ? contour.points.length : 0;
}

function profileExpr(contour) {
  const lines = (contour.lines || []).map((line) => ({ ...line, construction: line.construction !== false }));
  return emitSolveContour({
    centers: true,
    points: contour.points || [],
    lines,
    arcs: contour.arcs || [],
    dimensions: contour.dimensions || [],
    constraints: contour.constraints || [],
    refs: contour.refs || [],
  });
}

function holeBlock(id, name, spec) {
  return [
    markerWithId(HOLE_BEGIN, id),
    emitHoleCall(name, spec),
    markerWithId(HOLE_END, id),
  ].join('\n');
}

function replaceBlock(buffer, block, body) {
  const text = String(buffer || '');
  let head = text.slice(0, block.start);
  let rest = text.slice(block.end);
  if (head && !head.endsWith('\n')) head = `${head}\n`;
  if (rest && !rest.startsWith('\n')) rest = `\n${rest}`;
  return `${head}${body}${rest}`;
}

/**
 * @returns {{ ok: true, buffer: string, run: true, featureId: string, contourId: string, contourName: string, createdContour: boolean }
 *   | { ok: true, buffer: string, empty: true }
 *   | { ok: false, message: string }}
 */
export function composeHoleOnContour(buffer, {
  frame = null,
  contour = null,
  contourId = null,
  contourName = null,
  featureId = null,
  spec = {},
  planeOffset,
} = {}) {
  const text = String(buffer || '');
  if (!featureMarkersBalanced(text, HOLE_BEGIN, HOLE_END)) {
    return { ok: false, message: 'Hole markers are unbalanced.' };
  }
  if (!declaredNames(text).has('part')) {
    return { ok: false, message: 'Hole needs a part.' };
  }
  const normalized = normalizeSpec(spec);
  if (!normalized.ok) return normalized;

  const blocks = listHoleBlocks(text);
  const requested = blocks.find((block) => block.id === featureId);
  if (requested && !isContourHole(requested.text)) {
    return { ok: false, message: 'That hole is not a contour hole.' };
  }
  const finalId = requested ? requested.id : (featureId && !blocks.some((block) => block.id === featureId)
    ? String(featureId)
    : mintBlockId(blocks, 'hole'));
  if (!/^[A-Za-z_$][\w$]*$/.test(finalId)) {
    return { ok: false, message: 'Hole id is not an identifier.' };
  }

  const named = contourNameInBlock(requested?.text || '');
  const wantedName = contourName || named || null;
  const wantedId = contourId || null;
  const existing = contourStatements(text).find((stmt) => (
    (wantedId && stmt.id === wantedId)
    || (wantedName && (stmt.name === wantedName || stmt.id === wantedName))
  ));

  const creating = !requested && !existing;
  if (creating && centreCount(contour) === 0) {
    return { ok: true, buffer: text, empty: true };
  }

  let next = text;
  let contourStmt = existing;
  let createdContour = false;
  if (!existing) {
    if (!frame?.center || !frame?.normal || !frame?.x || !frame?.y) {
      return { ok: false, message: 'Hole needs a plane.' };
    }
    if (!contour) return { ok: false, message: 'Hole needs a contour.' };
    const saved = upsertNamedContour(next, {
      id: wantedId,
      name: wantedName,
      frame,
      profileExpr: profileExpr(contour),
      role: 'centers',
      ...(planeOffset !== undefined ? { planeOffset } : {}),
    });
    if (!saved.ok) return saved;
    next = saved.buffer;
    contourStmt = contourStatements(next).find((stmt) => stmt.id === saved.id);
    createdContour = true;
  } else if (requested && contour) {
    const plane = frame || frameFromStatement(existing);
    if (!plane) return { ok: false, message: 'Hole needs a plane.' };
    const saved = upsertNamedContour(next, {
      id: existing.id,
      name: existing.name,
      frame: plane,
      profileExpr: profileExpr(contour),
      role: 'centers',
      ...(planeOffset !== undefined ? { planeOffset } : {}),
    });
    if (!saved.ok) return saved;
    next = saved.buffer;
    contourStmt = contourStatements(next).find((stmt) => stmt.id === saved.id);
  }
  if (!contourStmt) return { ok: false, message: 'Hole could not find its contour.' };

  const body = holeBlock(finalId, contourStmt.name, normalized.spec);
  const hole = listHoleBlocks(next).find((block) => block.id === finalId && isContourHole(block.text));
  next = hole ? replaceBlock(next, hole, body) : insertBeforeScriptReturn(next, body);
  if (!isContourHole(listHoleBlocks(next).find((block) => block.id === finalId)?.text || '')) {
    return { ok: false, message: 'Hole block was not written.' };
  }
  return {
    ok: true,
    buffer: next,
    run: true,
    featureId: finalId,
    contourId: contourStmt.id,
    contourName: contourStmt.name,
    createdContour,
  };
}

function specObjectSource(text) {
  const src = String(text || '');
  const at = src.search(/holesOnContour\s*\(/);
  if (at < 0) return '';
  const brace = src.indexOf('{', at);
  return brace < 0 ? '' : src.slice(brace);
}

/**
 * A contour hole block and the centres contour it names.
 * An old `hole()` block is not one of these, so the helper sheet still opens.
 *
 * @returns {{ featureId: string, contourName: string, contourId: string|null, spec: object } | null}
 */
export function readContourHole(buffer, featureId) {
  const block = listHoleBlocks(buffer).find((row) => row.id === featureId);
  if (!block || !isContourHole(block.text)) return null;
  const name = holeName(block.text);
  if (!name) return null;
  let raw;
  try {
    raw = parseScriptValue(specObjectSource(block.text));
  } catch {
    return null;
  }
  const normalized = normalizeSpec(raw);
  if (!normalized.ok) return null;
  const stmt = contourStatements(buffer).find((row) => row.name === name || row.id === name);
  return {
    featureId: block.id,
    contourName: name,
    contourId: stmt?.id || null,
    spec: normalized.spec,
  };
}

/**
 * The baked centres contour. Empty points stay a contour. A profile contour
 * is not one of these.
 *
 * @returns {{ id: string, name: string, frame: object, contour: object } | null}
 */
export function readCentersContour(buffer, contourId) {
  const stmt = contourStatements(buffer).find((row) => row.id === contourId && row.role === 'centers');
  if (!stmt) return null;
  let contour;
  try {
    contour = parseSolveContour(stmt.profileExpr);
  } catch {
    return null;
  }
  const frame = frameFromStatement(stmt);
  if (!frame) return null;
  return {
    id: stmt.id,
    name: stmt.name,
    frame,
    contour,
    planeOffset: Number.isFinite(Number(stmt.planeOffset)) ? Number(stmt.planeOffset) : 0,
  };
}

/**
 * Rewrite one centres statement. Hole blocks that name it stay where they are.
 *
 * @returns {{ ok: true, buffer: string, changed: boolean, run: boolean, contourId: string, contourName: string }
 *   | { ok: false, message: string }}
 */
export function rewriteCentersContour(buffer, {
  contourId = null,
  contour = null,
  frame = null,
  planeOffset,
} = {}) {
  const text = String(buffer || '');
  const stmt = contourStatements(text).find((row) => row.id === contourId && row.role === 'centers');
  if (!stmt) return { ok: false, message: 'Hole could not find its contour.' };
  const baked = frame?.center && frame?.normal && frame?.x && frame?.y
    ? frame
    : frameFromStatement(stmt);
  if (!baked) return { ok: false, message: 'Hole needs a plane.' };
  const model = contour && Array.isArray(contour.points) ? contour : { points: [] };
  const saved = upsertNamedContour(text, {
    id: stmt.id,
    name: stmt.name,
    frame: baked,
    profileExpr: profileExpr(model),
    role: 'centers',
    ...(planeOffset !== undefined ? { planeOffset } : {}),
  });
  if (!saved.ok) return saved;
  const changed = saved.buffer !== text;
  return {
    ok: true,
    buffer: saved.buffer,
    changed,
    run: changed,
    contourId: saved.id,
    contourName: saved.name,
  };
}

function frameFromStatement(stmt) {
  const expr = String(stmt?.planeExpr || '');
  const numAt = (key) => {
    const match = expr.match(new RegExp(`${key}\\s*:\\s*\\[([^\\]]+)\\]`));
    if (!match) return null;
    const parts = match[1].split(',').map((part) => Number(part.trim()));
    if (parts.length < 3 || parts.some((n) => !Number.isFinite(n))) return null;
    return parts.slice(0, 3);
  };
  const center = numAt('center');
  const normal = numAt('normal');
  const x = numAt('x');
  const y = numAt('y');
  if (!center || !normal || !x || !y) return null;
  return { center, normal, x, y };
}

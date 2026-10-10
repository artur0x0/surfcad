/**
 * Saved contours for the contour-pick menu.
 *
 * Profile Confirm and Advanced solids both emit `makeCrossSection(...)`.
 * The picker used to open with nothing to list because those calls were
 * never read back out of the script, so the menu and the viewport ghosts
 * stayed empty. This module is the read path: parse, label, ghost rings,
 * and seed Extrude / Revolve / Sweep / Loft from the chosen contour.
 */

import {
  buildProfileFromParams,
  contoursToWorldRings,
} from './crossSectionSubstrate.js';
import {
  isLoftEntry,
  isSolidContourEntry,
  toolToProfileParams,
  writeLoftSelected,
} from './contourMode.js';
import { parseSolveContour } from './contourScript.js';
import { contourStatements } from './namedContour.js';

function splitArgs(src) {
  const args = [];
  let depth = 0;
  let start = 0;
  const s = String(src || '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '(' || c === '[' || c === '{') depth += 1;
    else if (c === ')' || c === ']' || c === '}') depth -= 1;
    else if (c === ',' && depth === 0) {
      args.push(s.slice(start, i).trim());
      start = i + 1;
    }
  }
  const last = s.slice(start).trim();
  if (last) args.push(last);
  return args;
}

function findCalls(src, name) {
  const out = [];
  const text = String(src || '');
  const needle = `${name}(`;
  let from = 0;
  while (from < text.length) {
    const i = text.indexOf(needle, from);
    if (i < 0) break;
    if (i > 0 && /[\w$]/.test(text[i - 1])) {
      from = i + 1;
      continue;
    }
    const open = i + name.length;
    let depth = 0;
    let end = -1;
    for (let j = open; j < text.length; j++) {
      const c = text[j];
      if (c === '(' || c === '[' || c === '{') depth += 1;
      else if (c === ')' || c === ']' || c === '}') {
        depth -= 1;
        if (depth === 0) {
          end = j;
          break;
        }
      }
    }
    if (end < 0) break;
    out.push({
      start: i,
      end,
      args: splitArgs(text.slice(open + 1, end)),
    });
    from = end + 1;
  }
  return out;
}

function parseVec(body) {
  const nums = String(body || '').split(',').map((part) => Number(part.trim()));
  if (nums.length < 3 || nums.some((n) => !Number.isFinite(n))) return null;
  return nums.slice(0, 3);
}

function parseFrameObject(text) {
  const grab = (key) => {
    const m = String(text || '').match(new RegExp(`${key}\\s*:\\s*\\[([^\\]]+)\\]`));
    return m ? parseVec(m[1]) : null;
  };
  const center = grab('center');
  const normal = grab('normal');
  const x = grab('x');
  const y = grab('y');
  if (!center || !normal || !x || !y) return null;
  return { center, normal, x, y };
}

function offsetPlane(plane, offset) {
  const n = plane.normal;
  const w = Number(offset) || 0;
  return {
    center: [
      plane.center[0] + w * n[0],
      plane.center[1] + w * n[1],
      plane.center[2] + w * n[2],
    ],
    normal: n.slice(),
    x: plane.x.slice(),
    y: plane.y.slice(),
  };
}

function indexPlanes(src) {
  const planes = [];
  const re = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*/g;
  let m;
  while ((m = re.exec(src))) {
    const name = m[1];
    const exprStart = m.index + m[0].length;
    const expr = src.slice(exprStart, exprStart + 500);
    if (expr.startsWith('{')) {
      const close = expr.indexOf('}');
      if (close < 0) continue;
      const frame = parseFrameObject(expr.slice(0, close + 1));
      if (frame) planes.push({ name, end: exprStart, plane: frame, host: false });
    } else if (expr.startsWith('offsetPlaneFrame')) {
      const call = findCalls(expr, 'offsetPlaneFrame')[0];
      const baseName = call?.args?.[0]?.trim();
      const off = Number(call?.args?.[1]);
      const base = [...planes].reverse().find((p) => p.name === baseName && p.plane);
      if (base && Number.isFinite(off)) {
        planes.push({
          name,
          end: exprStart,
          host: false,
          plane: offsetPlane(base.plane, off),
        });
      }
    } else if (expr.startsWith('workplaneFromFace')) {
      planes.push({ name, end: exprStart, plane: null, host: true });
    }
  }
  return planes;
}

function resolvePlaneExpr(expr, planes, pos) {
  const t = String(expr || '').trim();
  if (!t) return { plane: null, host: true };
  if (t.startsWith('{')) {
    const frame = parseFrameObject(t);
    return { plane: frame, host: !frame };
  }
  if (t.startsWith('offsetPlaneFrame')) {
    const call = findCalls(t, 'offsetPlaneFrame')[0];
    const baseName = call?.args?.[0]?.trim();
    const off = Number(call?.args?.[1]);
    const base = [...planes].reverse().find((p) => p.name === baseName && p.end <= pos && p.plane);
    if (base && Number.isFinite(off)) return { plane: offsetPlane(base.plane, off), host: false };
    return { plane: null, host: true };
  }
  if (t.startsWith('workplaneFromFace')) return { plane: null, host: true };
  if (/^[A-Za-z_$][\w$]*$/.test(t)) {
    const hit = [...planes].reverse().find((p) => p.name === t && p.end <= pos);
    if (!hit) return { plane: null, host: true };
    return { plane: hit.plane, host: !!hit.host && !hit.plane };
  }
  return { plane: null, host: true };
}

function parseProfile(expr) {
  const t = String(expr || '').trim();
  let m = t.match(/^profileCircle\(\s*([-+.\d]+)\s*,\s*([-+.\d]+)\s*\)$/);
  if (m) {
    const radius = Number(m[1]);
    const segments = Number(m[2]);
    if (!(radius > 0) || !(segments >= 3)) return null;
    return { tool: 'circle', params: { radius, segments } };
  }
  m = t.match(/^profileRectangle\(\s*([-+.\d]+)\s*,\s*([-+.\d]+)\s*,\s*(true|false)\s*\)$/);
  if (m) {
    const width = Number(m[1]);
    const height = Number(m[2]);
    if (!(width > 0) || !(height > 0)) return null;
    return {
      tool: 'rectangle',
      params: { width, height, centered: m[3] === 'true' },
    };
  }
  if (/^solveContour\s*\(/.test(t)) {
    try {
      const contour = parseSolveContour(t);
      const points = (contour.points || []).map((p) => [Number(p.at?.[0]), Number(p.at?.[1])]);
      if (!points.length || points.some((p) => !Number.isFinite(p[0]) || !Number.isFinite(p[1]))) {
        return null;
      }
      return { tool: 'polyline', params: { points, contour } };
    } catch {
      return null;
    }
  }
  m = t.match(/^profilePolygon\(\s*(\[[\s\S]*\])\s*\)$/);
  if (m) {
    let pts;
    try {
      pts = JSON.parse(m[1]);
    } catch {
      return null;
    }
    if (!Array.isArray(pts) || pts.length < 3) return null;
    const points = pts.map((p) => [Number(p?.[0]), Number(p?.[1])]);
    if (points.some((p) => !Number.isFinite(p[0]) || !Number.isFinite(p[1]))) return null;
    return { tool: 'polyline', params: { points } };
  }
  return null;
}

function contourLabel(name, tool, params) {
  if (tool === 'circle') return `${name} · circle r${params.radius}`;
  if (tool === 'rectangle') {
    return `${name} · rect ${params.width}×${params.height}`;
  }
  const n = Array.isArray(params.points) ? params.points.length : 0;
  return `${name} · ${n} pt${n === 1 ? '' : 's'}`;
}

/**
 * Script-backed saved contours, oldest first. The last entry is the most
 * recently generated named contour.
 *
 * Identity is the `@contour id=` marker, or the binding name when a
 * hand-written call has no marker. It is never a character offset.
 * An unbound `makeCrossSection` is not a contour.
 *
 * @returns {Array<{ id: string, name: string, tool: string, params: object, plane: object|null, host: boolean, label: string }>}
 */
export function listSavedContours(buffer) {
  const text = String(buffer || '');
  if (!text.trim()) return [];
  const planes = indexPlanes(text);
  const out = [];
  for (const stmt of contourStatements(text)) {
    const profile = parseProfile(stmt.profileExpr);
    if (!profile) continue;
    const resolved = resolvePlaneExpr(stmt.planeExpr, planes, stmt.start);
    out.push({
      id: stmt.id,
      name: stmt.name,
      tool: profile.tool,
      params: profile.params,
      plane: resolved.plane,
      host: resolved.host,
      label: contourLabel(stmt.name, profile.tool, profile.params),
    });
  }
  return out;
}

export function mostRecentSavedContour(contours) {
  if (!Array.isArray(contours) || !contours.length) return null;
  return contours[contours.length - 1];
}

/**
 * World-space wire rings for a saved contour. Host-plane contours (Profile
 * Confirm via workplaneFromFace) use `hostPlane` — typically the part top.
 */
export function savedContourRings(contour, hostPlane = null) {
  if (!contour) return [];
  const plane = contour.plane || hostPlane;
  if (!plane?.center || !plane?.x || !plane?.y) return [];
  try {
    const built = buildProfileFromParams(toolToProfileParams(contour.tool, contour.params));
    return contoursToWorldRings(plane, built.contours);
  } catch {
    return [];
  }
}

function planeFaceFromFrame(plane) {
  return {
    type: 'planar',
    center: plane.center.slice(),
    normal: plane.normal.slice(),
    area: 400,
    triangleCount: 2,
    selectionMode: 'coplanar',
    planeFrame: {
      center: plane.center.slice(),
      normal: plane.normal.slice(),
      x: plane.x.slice(),
      y: plane.y.slice(),
    },
  };
}

/** Seed in-mode tool / params (and plane, when the script has a literal frame). */
export function applySavedContour(state, contour) {
  if (!state || !contour) return state;
  const params = { ...(contour.params || {}) };
  let next = {
    ...state,
    tool: contour.tool,
    params,
    pickedContourId: contour.id,
  };
  if (contour.plane) next.planeFace = planeFaceFromFrame(contour.plane);
  if (isLoftEntry(state.entry)) {
    next = writeLoftSelected(next, { tool: contour.tool, params });
    next = { ...next, pickedContourId: contour.id };
  }
  return next;
}

/**
 * On enter Extrude / Revolve / Sweep / Loft, select the most recent saved
 * contour when the picker has at least one. Profile stays a fresh draw.
 * Returns the same state when there is nothing to pick.
 */
/**
 * Literal construction planes in the script (`const fr = { center, normal, x, y }`).
 * Host queries (`workplaneFromFace`) are not construction planes — they need a solid.
 */
export function listConstructionPlanes(buffer) {
  return indexPlanes(String(buffer || ''))
    .filter((p) => p.plane && !p.host)
    .map((p) => ({
      id: `${p.name}@${p.end}`,
      name: p.name,
      plane: p.plane,
    }));
}

function _raySegDist(origin, dir, a, b) {
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const dd = dir[0] * dir[0] + dir[1] * dir[1] + dir[2] * dir[2];
  if (!(dd > 1e-18)) return Infinity;
  const uu = u[0] * u[0] + u[1] * u[1] + u[2] * u[2];
  const ud = u[0] * dir[0] + u[1] * dir[1] + u[2] * dir[2];
  const w = [origin[0] - a[0], origin[1] - a[1], origin[2] - a[2]];
  const wd = w[0] * dir[0] + w[1] * dir[1] + w[2] * dir[2];
  const wu = w[0] * u[0] + w[1] * u[1] + w[2] * u[2];
  const den = uu * dd - ud * ud;
  let s = den > 1e-12 ? (ud * wd - dd * wu) / den : 0;
  if (s < 0) s = 0;
  if (s > 1) s = 1;
  const px = a[0] + s * u[0];
  const py = a[1] + s * u[1];
  const pz = a[2] + s * u[2];
  const t = ((px - origin[0]) * dir[0] + (py - origin[1]) * dir[1] + (pz - origin[2]) * dir[2]) / dd;
  if (!(t >= 0)) return Infinity;
  const qx = origin[0] + t * dir[0];
  const qy = origin[1] + t * dir[1];
  const qz = origin[2] + t * dir[2];
  return Math.hypot(px - qx, py - qy, pz - qz);
}

/**
 * Nearest saved contour to a world ray. `maxDist` is world units (caller
 * scales it with camera distance so a finger can hit the wire).
 */
export function pickContourByRay(origin, dir, contours, hostPlane = null, maxDist = 2) {
  if (!origin || !dir || !contours?.length) return null;
  let best = null;
  let bestD = maxDist;
  for (const contour of contours) {
    const rings = savedContourRings(contour, hostPlane);
    for (const ring of rings) {
      if (!ring || ring.length < 2) continue;
      for (let i = 0; i < ring.length; i++) {
        const d = _raySegDist(origin, dir, ring[i], ring[(i + 1) % ring.length]);
        if (d < bestD) {
          bestD = d;
          best = contour;
        }
      }
    }
  }
  return best;
}

export function withAutoPickedContour(state, contours) {
  if (!state || !isSolidContourEntry(state.entry)) return state;
  const last = mostRecentSavedContour(contours);
  if (!last) return { ...state, pickedContourId: null };
  return applySavedContour(state, last);
}

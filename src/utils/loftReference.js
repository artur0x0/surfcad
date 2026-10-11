/**
 * A loft references contours by name. The station adds only an offset
 * along that contour's normal. A zero offset is the name itself.
 *
 *   makeLoft([c_base, c_neck])
 *   makeLoft([c_base, { ...c_neck, plane: offsetPlaneFrame(c_neck.plane, 20) }])
 */

import { markerWithId } from './featureBlockId.js';

function splitTopLevel(src) {
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

export function contourSectionExpr(name, offset) {
  const w = +Number(offset || 0).toFixed(4);
  if (!Number.isFinite(w) || Math.abs(w) < 1e-12) return name;
  return `{ ...${name}, plane: offsetPlaneFrame(${name}.plane, ${w}) }`;
}

export function contourPlaneExpr(name, offset) {
  const w = +Number(offset || 0).toFixed(4);
  if (!Number.isFinite(w) || Math.abs(w) < 1e-12) return `${name}.plane`;
  return `offsetPlaneFrame(${name}.plane, ${w})`;
}

/**
 * Names and offsets inside one loft block.
 * @returns {Array<{ name: string, offset: number }>}
 */
export function parseLoftReferences(block) {
  const text = String(block || '');
  const call = text.match(/makeLoft\s*\(\s*\[([\s\S]*?)\]\s*\)/);
  if (!call) return [];
  const out = [];
  for (const arg of splitTopLevel(call[1])) {
    const spread = arg.match(/^\{\s*\.\.\.\s*([A-Za-z_$][\w$]*)/);
    const plain = arg.match(/^([A-Za-z_$][\w$]*)$/);
    const name = (spread || plain)?.[1];
    if (!name) continue;
    const off = arg.match(/offsetPlaneFrame\s*\(\s*[A-Za-z_$][\w$]*\.plane\s*,\s*(-?\d+(?:\.\d+)?)\s*\)/);
    out.push({ name, offset: off ? Number(off[1]) : 0 });
  }
  return out;
}

export function emitLoftReferenceLines({ begin, end, featureId, stations, placeIndex, partLine }) {
  const args = stations.map((s) => contourSectionExpr(s.name, s.offset)).join(', ');
  const at = stations[placeIndex] || stations[0];
  const solid = `makeLoft([${args}])`;
  const placed = partLine(`placeInFrame(${contourPlaneExpr(at.name, at.offset)}, ${solid})`);
  return [
    markerWithId(begin, featureId),
    placed,
    markerWithId(end, featureId),
  ];
}

/**
 * Contour reference edges for a sheet-metal part, taken from the sheet
 * model rather than the tessellated mesh.
 *
 * A flange edge can be one naked triangle, so the mesh boundary pass never
 * lists it, and the face-outline fallback then binds a hole chord. Bend
 * tangents are shallower than that pass's crease gate, and a hole rim is
 * one circle in the model and a ring of facet lines in the mesh. The B-rep
 * already knows the outer boundary, the bend tangents, the hole loops, and
 * the flange sides.
 *
 * Identity is `refKey`, a name from the spec (which panel, which edge,
 * which skin). Face ids are synthetic and unique so they cannot collide
 * with a mesh face. A missing key does not match a different edge.
 */
import { buildSheetBrep, sampleEdge } from './sheetBrep.js';
import { SHEET_METAL_BEGIN, SHEET_METAL_END } from './sheetMeshFlag.js';
import {
  normalizeSheetSpec,
  panelEdge,
  panelLocal,
  solveSheet,
  vDot,
  vSub,
} from './sheetModel.js';

const FACE_ID_BASE = 1_000_000_000;
const ON_EDGE_MM = 0.2;
const HOLE_SEG = 48;
const ARC_SEG = 24;

function dist3(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function near3(a, b, tol = 1e-3) {
  return dist3(a, b) <= tol;
}

function midOf(points) {
  const closed = points.length >= 2 && near3(points[0], points[points.length - 1]);
  const use = closed ? points.slice(0, -1) : points;
  const m = [0, 0, 0];
  for (const p of use) {
    m[0] += p[0];
    m[1] += p[1];
    m[2] += p[2];
  }
  const n = use.length || 1;
  return [m[0] / n, m[1] / n, m[2] / n];
}

function outward(face) {
  if (!face || face.surface?.type !== 'plane' || !face.surface.axis) return null;
  const a = face.surface.axis;
  const s = face.sameSense === false ? -1 : 1;
  return [s * a[0], s * a[1], s * a[2]];
}

function skinOf(face, panel) {
  const axis = face?.surface?.axis;
  if (!axis || !panel) return 0;
  return vDot(axis, panel.N) > 0 ? 1 : 0;
}

function edgeUsers(brep) {
  const users = Array.from({ length: brep.edges.length }, () => []);
  for (const face of brep.faces) {
    for (const loop of face.loops) {
      for (const oe of loop) {
        const list = users[oe.edge];
        if (!list.includes(face)) list.push(face);
      }
    }
  }
  return users;
}

function endsOf(brep, index) {
  const edge = brep.edges[index];
  return [brep.vertices[edge.v1], brep.vertices[edge.v2]];
}

/** Join sampled half-arcs that share an endpoint into one loop. */
function stitchChains(chains) {
  if (!chains.length) return [];
  let acc = chains[0].map((p) => p.slice());
  const rest = chains.slice(1).map((chain) => chain.map((p) => p.slice()));
  while (rest.length) {
    const end = acc[acc.length - 1];
    let found = -1;
    let reverse = false;
    let prepend = false;
    for (let i = 0; i < rest.length; i += 1) {
      const chain = rest[i];
      if (near3(chain[0], end)) { found = i; break; }
      if (near3(chain[chain.length - 1], end)) { found = i; reverse = true; break; }
    }
    if (found < 0) {
      const start = acc[0];
      for (let i = 0; i < rest.length; i += 1) {
        const chain = rest[i];
        if (near3(chain[chain.length - 1], start)) { found = i; prepend = true; break; }
        if (near3(chain[0], start)) { found = i; reverse = true; prepend = true; break; }
      }
    }
    if (found < 0) break;
    let chain = rest.splice(found, 1)[0];
    if (reverse) chain.reverse();
    if (prepend) acc = [...chain.slice(0, -1), ...acc];
    else acc.push(...chain.slice(1));
  }
  return acc;
}

function holeOf(curve, solved, t) {
  let best = null;
  let bestRadial = 1;
  for (const hole of solved.holes) {
    const rel = vSub(curve.center, hole.center);
    const along = vDot(rel, hole.N);
    const axial = [along * hole.N[0], along * hole.N[1], along * hole.N[2]];
    const radial = dist3(rel, axial);
    if (radial >= bestRadial) continue;
    bestRadial = radial;
    const skin = Math.abs(along) <= Math.abs(along - t) ? 0 : 1;
    best = { hole, skin };
  }
  return best;
}

function onPanelEdge(panel, a, b) {
  let best = null;
  for (const name of ['u+', 'u-', 'v+', 'v-']) {
    const frame = panelEdge(panel, name);
    const qa = vDot(vSub(a, frame.E0), frame.e);
    const qb = vDot(vSub(b, frame.E0), frame.e);
    const off = Math.abs(vDot(vSub(a, frame.E0), frame.d)) + Math.abs(vDot(vSub(b, frame.E0), frame.d));
    if (off > ON_EDGE_MM * 2) continue;
    const qmin = Math.min(qa, qb);
    const qmax = Math.max(qa, qb);
    if (qmin < frame.q0 - ON_EDGE_MM || qmax > frame.q1 + ON_EDGE_MM) continue;
    if (!best || off < best.off) best = { name, q: (qa + qb) / 2, off };
  }
  return best;
}

function notchOf(panel, notches, a, b) {
  const la = panelLocal(panel, a);
  const lb = panelLocal(panel, b);
  for (const notch of notches) {
    if ((notch.panel || 'base') !== panel.id) continue;
    const sides = [
      { axis: 'u', at: notch.u0, lo: notch.v0, hi: notch.v1, name: 'u0' },
      { axis: 'u', at: notch.u1, lo: notch.v0, hi: notch.v1, name: 'u1' },
      { axis: 'v', at: notch.v0, lo: notch.u0, hi: notch.u1, name: 'v0' },
      { axis: 'v', at: notch.v1, lo: notch.u0, hi: notch.u1, name: 'v1' },
    ];
    for (const side of sides) {
      const ca = side.axis === 'u' ? la[0] : la[1];
      const cb = side.axis === 'u' ? lb[0] : lb[1];
      const sa = side.axis === 'u' ? la[1] : la[0];
      const sb = side.axis === 'u' ? lb[1] : lb[0];
      if (Math.abs(ca - side.at) > 0.15 || Math.abs(cb - side.at) > 0.15) continue;
      const s0 = Math.min(sa, sb);
      const s1 = Math.max(sa, sb);
      if (s0 < side.lo - 0.15 || s1 > side.hi + 0.15) continue;
      const onOuter = side.axis === 'u'
        ? (Math.abs(side.at - panel.u0) < 0.15 || Math.abs(side.at - panel.u1) < 0.15)
        : (Math.abs(side.at - panel.v0) < 0.15 || Math.abs(side.at - panel.v1) < 0.15);
      if (onOuter) continue;
      const corner = (notch.corner || []).join('');
      return { key: `cutout:${panel.id}:${corner}:${side.name}`, q: (s0 + s1) / 2 };
    }
  }
  return null;
}

function tabOf(panel, tabs, a, b) {
  for (const tab of tabs) {
    if (tab.panel !== panel.id) continue;
    const qa = vDot(vSub(a, tab.E0), tab.e);
    const qb = vDot(vSub(b, tab.E0), tab.e);
    const oa = vDot(vSub(a, tab.E0), tab.d);
    const ob = vDot(vSub(b, tab.E0), tab.d);
    const qSpan = Math.abs(qa - qb);
    const oSpan = Math.abs(oa - ob);
    const q = (qa + qb) / 2;
    const off = (oa + ob) / 2;
    if (Math.abs(oa - tab.depth) < ON_EDGE_MM && Math.abs(ob - tab.depth) < ON_EDGE_MM && qSpan >= oSpan) {
      return { id: tab.id, which: 'outer', q };
    }
    const inDepth = off > -ON_EDGE_MM && off < tab.depth + ON_EDGE_MM;
    if (inDepth && oSpan >= qSpan && Math.abs(qa - tab.q0) < ON_EDGE_MM && Math.abs(qb - tab.q0) < ON_EDGE_MM) {
      return { id: tab.id, which: 'q0', q: off };
    }
    if (inDepth && oSpan >= qSpan && Math.abs(qa - tab.q1) < ON_EDGE_MM && Math.abs(qb - tab.q1) < ON_EDGE_MM) {
      return { id: tab.id, which: 'q1', q: off };
    }
  }
  return null;
}

function outlineRole(panelId, edgeName) {
  if (panelId !== 'base' && (edgeName === 'v+' || edgeName === 'v-')) return 'side';
  return 'outer';
}

function wallLabel(face, solved) {
  const piece = String(face.piece || '');
  const axis = face.surface?.axis || [0, 0, 0];
  const origin = face.surface?.origin || [0, 0, 0];
  if (piece.startsWith('bend:')) {
    const id = piece.slice(5);
    const bend = solved.bends.find((item) => item.id === id);
    if (!bend?.axis) return `bend:${id}:end`;
    const q = vDot(vSub(origin, bend.axis), bend.e);
    const end = Math.abs(q - bend.q0) <= Math.abs(q - bend.q1) ? 'q0' : 'q1';
    return `bend:${id}:end:${end}`;
  }
  const panel = solved.panels.find((item) => item.id === piece);
  if (!panel) return `wall:${piece}`;
  // A tab side has the same outward axis as some other panel edge, so the
  // point has to lie on the edge the normal names.
  let best = null;
  for (const name of ['u+', 'u-', 'v+', 'v-']) {
    const frame = panelEdge(panel, name);
    const align = vDot(axis, frame.d);
    if (align < 0.85) continue;
    const off = Math.abs(vDot(vSub(origin, frame.E0), frame.d));
    const q = vDot(vSub(origin, frame.E0), frame.e);
    if (off > 0.5 || q < frame.q0 - 0.5 || q > frame.q1 + 0.5) continue;
    if (!best || align > best.align) best = { name, align };
  }
  if (best) return `wall:${piece}:${best.name}`;
  for (const tab of solved.tabs) {
    if (tab.panel !== piece) continue;
    const off = vDot(vSub(origin, tab.E0), tab.d);
    const q = vDot(vSub(origin, tab.E0), tab.e);
    const negE = [-tab.e[0], -tab.e[1], -tab.e[2]];
    if (Math.abs(off - tab.depth) < 0.5 && q >= tab.q0 - 0.5 && q <= tab.q1 + 0.5 && vDot(axis, tab.d) > 0.85) {
      return `tab:${tab.id}:outer`;
    }
    const onSide = off >= -0.5 && off <= tab.depth + 0.5;
    if (!onSide) continue;
    if (Math.abs(q - tab.q0) < 0.5 && vDot(axis, negE) > 0.85) return `tab:${tab.id}:q0`;
    if (Math.abs(q - tab.q1) < 0.5 && vDot(axis, tab.e) > 0.85) return `tab:${tab.id}:q1`;
  }
  return `wall:${piece}`;
}

function bendEndKey(bend, curve, t, r) {
  const q = vDot(vSub(curve.center, bend.axis), bend.e);
  const end = Math.abs(q - bend.q0) <= Math.abs(q - bend.q1) ? 'q0' : 'q1';
  const band = curve.radius > r + t / 2 ? 'out' : 'in';
  return { key: `bend:${bend.id}:end:${end}:${band}`, q };
}

function collectItems(spec, solved, brep) {
  const users = edgeUsers(brep);
  const panels = new Map(solved.panels.map((panel) => [panel.id, panel]));
  const bends = new Map(solved.bends.map((bend) => [bend.id, bend]));
  const items = [];
  const holes = new Map();

  const push = (refKey, role, points, n0, n1, q) => {
    if (!points || points.length < 2) return;
    items.push({
      refKey,
      role,
      points,
      n0: n0 || null,
      n1: n1 || null,
      q: Number.isFinite(q) ? q : 0,
    });
  };

  for (let index = 0; index < brep.edges.length; index += 1) {
    const curve = brep.edges[index].curve;
    const faces = users[index];
    const kindOf = (face) => face?.kind;
    const holeFace = faces.find((face) => kindOf(face) === 'hole' || kindOf(face) === 'countersink');
    const panelFace = faces.find((face) => kindOf(face) === 'panel');
    const bendFace = faces.find((face) => kindOf(face) === 'bend');
    const wallFaces = faces.filter((face) => kindOf(face) === 'wall');

    if (holeFace) {
      if (panelFace && curve.type === 'circle') {
        const found = holeOf(curve, solved, spec.t);
        if (!found) continue;
        const nominal = (Number(found.hole.d) || 0) / 2;
        const plain = Math.abs(curve.radius - nominal) < 0.05;
        const radius = Math.round(curve.radius * 1000) / 1000;
        const refKey = plain
          ? `hole:${found.hole.id}:w${found.skin}`
          : `hole:${found.hole.id}:w${found.skin}:r${radius}`;
        const sampled = sampleEdge(brep, { edge: index, forward: true }, HOLE_SEG);
        if (!holes.has(refKey)) {
          holes.set(refKey, { refKey, n0: outward(panelFace), chains: [] });
        }
        holes.get(refKey).chains.push(sampled);
      }
      continue;
    }

    if (bendFace && panelFace && curve.type === 'line') {
      const bend = bends.get(bendFace.bend);
      const panel = panels.get(panelFace.piece);
      if (!bend || !panel) continue;
      const [a, b] = endsOf(brep, index);
      const skin = skinOf(panelFace, panel);
      const q = vDot(vSub(midOf([a, b]), bend.axis || panel.o), bend.e);
      push(`bend:${bend.id}:${panel.id}:w${skin}`, 'bend', [a, b], outward(panelFace), null, q);
      continue;
    }

    if (bendFace && wallFaces.length && curve.type === 'circle') {
      const bend = bends.get(bendFace.bend);
      if (!bend) continue;
      const named = bendEndKey(bend, curve, spec.t, spec.r);
      const sampled = sampleEdge(brep, { edge: index, forward: true }, ARC_SEG);
      push(named.key, 'side', sampled, outward(wallFaces[0]), null, named.q);
      continue;
    }

    if (panelFace && wallFaces.length === 1 && curve.type === 'line') {
      const panel = panels.get(panelFace.piece);
      if (!panel || wallFaces[0].piece !== panel.id) continue;
      const [a, b] = endsOf(brep, index);
      const skin = skinOf(panelFace, panel);
      const n0 = outward(panelFace);
      const n1 = outward(wallFaces[0]);
      const notch = notchOf(panel, solved.notches, a, b);
      if (notch) {
        push(`${notch.key}:w${skin}`, 'cutout', [a, b], n0, n1, notch.q);
        continue;
      }
      const tab = tabOf(panel, solved.tabs, a, b);
      if (tab) {
        push(`tab:${tab.id}:${tab.which}:w${skin}`, 'outer', [a, b], n0, n1, tab.q);
        continue;
      }
      const hosted = onPanelEdge(panel, a, b);
      if (hosted) {
        push(
          `wall:${panel.id}:${hosted.name}:w${skin}`,
          outlineRole(panel.id, hosted.name),
          [a, b],
          n0,
          n1,
          hosted.q,
        );
        continue;
      }
      const mid = midOf([a, b]);
      const q = (n) => Math.round(n * 100) / 100;
      push(`loose:${q(mid[0])}:${q(mid[1])}:${q(mid[2])}`, 'outer', [a, b], n0, n1, 0);
      continue;
    }

    if (wallFaces.length === 2 && curve.type === 'line') {
      const [a, b] = endsOf(brep, index);
      const labels = [wallLabel(wallFaces[0], solved), wallLabel(wallFaces[1], solved)].sort();
      push(`thick:${labels[0]}|${labels[1]}`, 'thick', [a, b], outward(wallFaces[0]), outward(wallFaces[1]), 0);
    }
  }

  for (const group of holes.values()) {
    const loop = stitchChains(group.chains);
    push(group.refKey, 'hole', loop, group.n0, null, 0);
    if (group.chains.length > 1 && loop.length < 8) {
      push(`${group.refKey}#dup`, 'hole', group.chains[0], group.n0, null, 1);
    }
  }
  return items;
}

function assignKeys(items) {
  const groups = new Map();
  for (const item of items) {
    if (!groups.has(item.refKey)) groups.set(item.refKey, []);
    groups.get(item.refKey).push(item);
  }
  const out = [];
  for (const [key, list] of groups) {
    if (list.length === 1) {
      out.push(list[0]);
      continue;
    }
    list.sort((a, b) => a.q - b.q || a.points[0][0] - b.points[0][0] || a.points[0][2] - b.points[0][2]);
    const split = key.startsWith('wall:') || key.startsWith('cutout:') || key.startsWith('tab:');
    list.forEach((item, i) => {
      const prev = list[i - 1];
      const samePlace = prev
        && Math.abs(item.q - prev.q) < 0.05
        && dist3(midOf(item.points), midOf(prev.points)) < 0.2;
      if (samePlace) item.refKey = `${key}#dup${i}`;
      else if (split) item.refKey = `${key}:${i}`;
      else if (i > 0) item.refKey = `${key}#dup${i}`;
      out.push(item);
    });
  }
  return out;
}

function toBoundary(item, id) {
  const points = item.points;
  let cursor = 0;
  const segments = [];
  for (let i = 1; i < points.length; i += 1) {
    if (dist3(points[i], points[i - 1]) < 1e-4) continue;
    const va = points[i - 1].slice();
    const vb = points[i].slice();
    const length = dist3(va, vb);
    segments.push({
      key: `${item.refKey}#${segments.length}`,
      a: cursor,
      b: cursor + 1,
      va,
      vb,
      length,
      mid: [(va[0] + vb[0]) / 2, (va[1] + vb[1]) / 2, (va[2] + vb[2]) / 2],
    });
    cursor += 1;
  }
  if (segments.length === 1) segments[0].key = item.refKey;
  let length = 0;
  const mid = [0, 0, 0];
  for (const seg of segments) {
    length += seg.length;
    mid[0] += seg.mid[0] * seg.length;
    mid[1] += seg.mid[1] * seg.length;
    mid[2] += seg.mid[2] * seg.length;
  }
  const faceA = FACE_ID_BASE + id * 2;
  return {
    id,
    refKey: item.refKey,
    role: item.role,
    faceA,
    faceB: faceA + 1,
    pairCount: 1,
    length,
    dihedralDeg: item.role === 'bend' ? 0 : 90,
    minFaceArea: 1,
    n0: item.n0 ? item.n0.slice() : undefined,
    n1: item.n1 ? item.n1.slice() : undefined,
    mid: length > 0 ? [mid[0] / length, mid[1] / length, mid[2] / length] : midOf(points),
    segments,
  };
}

/**
 * Reference topology for one sheet spec.
 * Null when the spec is not a sheet. A spec that will not fold returns an
 * empty sheet catalog, so a hole chord from the mesh is not a stand-in.
 */
export function sheetContourEdges(rawSpec) {
  const spec = normalizeSheetSpec(rawSpec);
  if (!spec) return null;
  try {
    const solved = solveSheet(spec);
    if (solved.errors?.length) return { sheet: true, faces: [], edges: [] };
    const brep = buildSheetBrep(spec);
    const items = assignKeys(collectItems(spec, solved, brep));
    items.sort((a, b) => (a.refKey < b.refKey ? -1 : a.refKey > b.refKey ? 1 : 0));
    return {
      sheet: true,
      faces: [],
      edges: items.map(toBoundary),
    };
  } catch {
    return { sheet: true, faces: [], edges: [] };
  }
}

function parseSpecObject(script) {
  const text = String(script || '');
  const re = /const sheetSpec\s*=\s*/g;
  let match = re.exec(text);
  while (match) {
    const start = match.index + match[0].length;
    if (text[start] !== '{') {
      match = re.exec(text);
      continue;
    }
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < text.length; i += 1) {
      const ch = text[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          try { return JSON.parse(text.slice(start, i + 1)); } catch { return null; }
        }
      }
    }
    return null;
  }
  return null;
}

/** The sheet spec in a part script, marker block or a bare `const sheetSpec`. */
export function sheetSpecInScript(script) {
  const text = String(script || '');
  const begin = text.indexOf(SHEET_METAL_BEGIN);
  if (begin >= 0) {
    const end = text.indexOf(SHEET_METAL_END, begin);
    if (end > begin) return parseSpecObject(text.slice(begin, end));
  }
  return parseSpecObject(text);
}

/**
 * Screen-pick segments for a sheet catalog. Null for a mesh catalog, so
 * fillet and box picks stay on their own edges.
 */
export function referencePickEdges(topo) {
  if (!topo?.sheet) return null;
  const out = [];
  for (const edge of topo.edges || []) {
    for (const seg of edge.segments || []) {
      out.push({
        key: seg.key,
        va: seg.va,
        vb: seg.vb,
        mid: seg.mid,
        length: seg.length,
        n0: edge.n0,
        n1: edge.n1,
        refKey: edge.refKey,
      });
    }
  }
  return out;
}

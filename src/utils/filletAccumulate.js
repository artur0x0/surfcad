/**
 * Sequential fillet picks accumulate into one op.
 *
 * Fillet the four vertical edges of a box, then pick the top rim: the rim's
 * corners are now the arcs the first fillet left, named `fillet1.round~seed.top`.
 * Wrapping a second fillet over those arcs cuts a sphere against a sail it is
 * tangent to, which is never clean. The names say exactly what the user
 * means: the same block, with more edges. So when a pick touches the faces of
 * an existing fillet block of the same radius, Accept extends that block's
 * `edgesNamed` list with the new pairs (by their pre-blend names, which the
 * straights still carry) and lets one op build the corner as a junction.
 *
 * Conditions: exactly one fillet block is touched; its radius equals the
 * pick's; it writes its edges by name; every other face the pick names comes
 * from a block at or before that one in the script (a later boss is not on
 * the solid the block cuts). Otherwise the pick is a new block, as before.
 */
import { parseFeatureMarkers } from './featureMarkers.js';

/** Radius a fillet block cuts with, from its filletAlongPath / filletEdges call. */
export function filletBlockRadius(blockText) {
  const text = String(blockText || '');
  const m = /\b(?:filletAlongPath|filletEdges)\s*\(\s*[^,()]+,\s*[^,()]+,\s*([0-9]*\.?[0-9]+(?:e-?\d+)?)/.exec(text);
  return m ? Number(m[1]) : null;
}

/** The names a block's edgesNamed call lists, in order. */
export function filletBlockNames(blockText) {
  const text = String(blockText || '');
  const m = /edgesNamed\s*\(\s*[^,()]+\s*,\s*([^)]*)\)/.exec(text);
  if (!m) return null;
  const out = [];
  const quoted = /(["'])((?:(?!\1)[^\\]|\\.)*)\1/g;
  let q;
  while ((q = quoted.exec(m[1]))) {
    const name = q[2].trim();
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}

function facePrefix(faceName) {
  const dot = faceName.indexOf('.');
  return dot > 0 ? faceName.slice(0, dot) : faceName;
}

/**
 * Which block, if any, a pick should extend.
 *
 * @param {string} buffer the part's script
 * @param {object[]} edges picked rows carrying `edgeName` / `edgeBase`
 * @param {number} radius the pick's radius (after the Accept gate)
 * @returns {{ feature: object, names: string[], added: string[], existing: string[] } | null}
 */
export function findFilletAccumulationTarget(buffer, edges, radius) {
  const text = String(buffer || '');
  const rows = (Array.isArray(edges) ? edges : []).filter(Boolean);
  if (!rows.length || !text) return null;
  const r = Number(radius);
  if (!(r > 0)) return null;
  // Every picked row must be named, or there is nothing stable to write.
  const pairs = [];
  for (const row of rows) {
    const name = typeof row.edgeName === 'string' && row.edgeName ? row.edgeName : null;
    if (!name) return null;
    const base = typeof row.edgeBase === 'string' && row.edgeBase ? row.edgeBase : name.replace(/\[\d+\]$/, '');
    const faces = base.split('~');
    if (faces.length !== 2) return null;
    pairs.push({ name, base, faces, pairChains: Number(row.edgePairChains) || 1, chainSize: Number(row.edgeChainSize) || 0, row });
  }
  const features = parseFeatureMarkers(text);
  const fillets = features.filter((f) => f.kind === 'fillet');
  if (!fillets.length) return null;
  const byId = new Map(features.map((f) => [f.id, f]));
  // Blocks whose blend faces (`.round`, `.corner[k]`) the pick touches.
  const touched = new Set();
  for (const p of pairs) {
    for (const face of p.faces) {
      const id = facePrefix(face);
      const role = face.slice(id.length + 1);
      if (byId.has(id) && byId.get(id).kind === 'fillet' && /^(round|corner)(\[\d+\])?$/.test(role)) touched.add(id);
    }
  }
  if (touched.size !== 1) return null;
  const target = byId.get([...touched][0]);
  const blockText = text.slice(target.startOffset, target.endOffset);
  const blockRadius = filletBlockRadius(blockText);
  if (blockRadius == null || Math.abs(blockRadius - r) > 1e-9) return null;
  const existing = filletBlockNames(blockText);
  if (!existing || !existing.length) return null;
  // Pairs on the block's own faces are the arcs it made: implied by the
  // junction, not edges of the solid the block cuts. Everything else must be
  // on that solid: no face from a later block.
  const added = [];
  for (const p of pairs) {
    const own = p.faces.some((face) => facePrefix(face) === target.id);
    if (own) continue;
    for (const face of p.faces) {
      const f = byId.get(facePrefix(face));
      if (f && f.index > target.index) return null;
    }
    // A whole pair is the bare name; a partial pick keeps its chain name.
    const whole = pairs.filter((q) => q.base === p.base).length >= p.pairChains && p.chainSize > 0;
    const name = whole ? p.base : p.name;
    if (!added.includes(name) && !existing.includes(name)) added.push(name);
  }
  if (!added.length) return null;
  return { feature: target, names: [...existing, ...added], added, existing };
}

/**
 * Rewrite the target block's edgesNamed call with the merged names.
 * @returns {{ ok: true, buffer: string, run: true, kernel: 'accumulate', feature: string, added: string[] } | { ok: false, message: string }}
 */
export function accumulateFilletCommit(buffer, target) {
  const text = String(buffer || '');
  const { feature, names } = target;
  const block = text.slice(feature.startOffset, feature.endOffset);
  const call = /edgesNamed\s*\(\s*([^,()]+)\s*,\s*[^)]*\)/.exec(block);
  if (!call) return { ok: false, message: 'accumulateFilletCommit: the fillet block has no edgesNamed call.' };
  const rewritten = `edgesNamed(${call[1].trim()}, ${names.map((n) => JSON.stringify(n)).join(', ')})`;
  const nextBlock = block.slice(0, call.index) + rewritten + block.slice(call.index + call[0].length);
  if (nextBlock === block) return { ok: false, message: 'accumulateFilletCommit: nothing to add.' };
  return {
    ok: true,
    buffer: text.slice(0, feature.startOffset) + nextBlock + text.slice(feature.endOffset),
    run: true,
    kernel: 'accumulate',
    feature: feature.id,
    added: target.added,
  };
}

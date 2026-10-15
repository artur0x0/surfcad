import { featureEdgesFromBoundary } from '../utils/boundaryEdgeIds.js';
import { edgeKey } from '../utils/selectEdge.js';

function pushUnique(out, seen, edge) {
  if (!edge) return;
  const key = edgeKey(edge);
  if (!key || seen.has(key)) return;
  seen.add(key);
  out.push(edge);
}

/**
 * Expand agent-resolved edges to the same richness as a viewport edge pick
 * (va/vb, normals, boundaryId) so sweep fillet / makeSweepPath can compose.
 *
 * @param {object[]} resolved from resolveEdgeKeys
 * @param {{ coherent?: object[], annotated?: object[], topo?: object }} graph
 */
export function expandResolvedEdgesForHelper(resolved, graph = {}) {
  const coherent = Array.isArray(graph.coherent) ? graph.coherent : [];
  const annotated = Array.isArray(graph.annotated) ? graph.annotated : [];
  const topo = graph.topo;
  const out = [];
  const seen = new Set();

  for (const edge of Array.isArray(resolved) ? resolved : []) {
    let boundaryId = Number.isFinite(edge.boundaryId) ? edge.boundaryId : null;
    if (boundaryId == null && typeof edge.key === 'string' && /^e(\d+)$/.test(edge.key)) {
      boundaryId = Number(edge.key.slice(1));
    }

    if (boundaryId != null) {
      const fromCoherent = coherent.filter((row) => row.boundaryId === boundaryId);
      if (fromCoherent.length) {
        for (const row of fromCoherent) pushUnique(out, seen, row);
        continue;
      }
      const fromAnnotated = annotated.filter((row) => row.boundaryId === boundaryId);
      if (fromAnnotated.length) {
        for (const row of fromAnnotated) pushUnique(out, seen, row);
        continue;
      }
      const boundary = topo?.edges?.find((row) => row.id === boundaryId);
      if (boundary) {
        for (const row of featureEdgesFromBoundary({ edges: [boundary] })) {
          pushUnique(out, seen, row);
        }
        continue;
      }
    }

    const key = edgeKey(edge);
    const coh = coherent.find((row) => edgeKey(row) === key)
      || coherent.find((row) => row.a === edge.a && row.b === edge.b);
    if (coh) {
      pushUnique(out, seen, coh);
      continue;
    }
    const ann = annotated.find((row) => edgeKey(row) === key);
    if (ann) {
      pushUnique(out, seen, ann);
      continue;
    }
    if (Array.isArray(edge.va) && Array.isArray(edge.vb)) {
      pushUnique(out, seen, edge);
    }
  }
  return out;
}

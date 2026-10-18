// TEMPORARY: remove after Artur's vault is upgraded
/**
 * Detect a v1 (path-named) vault tree. Callers use the folder entry point.
 */
import { isSurfId } from '../surfId.js';
import { vaultSegment } from '../vaultLayout.js';
import { VAULT_MARKER_KIND, VAULT_MARKER_PATH } from '../vaultNames.js';
import { assertGithubAdapter } from '../githubAdapterInterface.js';

export function normalizeLegacyPath(path) {
  const text = String(path || '').trim().replace(/\\/g, '/').replace(/^\.\//, '');
  if (!text || text.startsWith('/') || text.split('/').includes('..')) return null;
  return text;
}

/**
 * Classify a repo path as v1 folder-layout, v2 id-layout, or other.
 * v1 parsing of path-named trees lives in this folder only.
 */
export function parseLegacyVaultPath(path) {
  const p = normalizeLegacyPath(path);
  if (!p) return null;
  const seg = p.split('/');
  if (p === VAULT_MARKER_PATH) return { kind: 'marker', path: p };
  if (seg.length === 3 && seg[0] === 'assemblies' && seg[2] === '.surf.json') {
    return { kind: 'assembly-meta', assembly: seg[1], path: p };
  }
  if (seg.length === 3 && seg[0] === 'assemblies' && seg[2] === `${seg[1]}.surf.json`) {
    return { kind: 'assembly-meta', assembly: seg[1], path: p, named: true };
  }
  if (seg.length === 2 && seg[0] === 'assemblies' && seg[1].endsWith('.surf.json')) {
    const stem = seg[1].slice(0, -'.surf.json'.length);
    if (isSurfId(stem)) return { kind: 'v2-assembly', id: stem, path: p };
    return { kind: 'other', path: p };
  }
  if (seg.length === 3 && seg[0] === 'assemblies' && seg[2].endsWith('.js') && seg[2].length > 3) {
    return {
      kind: 'assembly-part',
      assembly: seg[1],
      part: seg[2].slice(0, -3),
      path: p,
    };
  }
  if (seg.length === 4 && seg[0] === 'assemblies' && seg[2] === 'parts'
    && seg[3].endsWith('.js') && seg[3].length > 3) {
    return {
      kind: 'assembly-part',
      assembly: seg[1],
      part: seg[3].slice(0, -3),
      path: p,
      nested: true,
    };
  }
  if (seg.length === 2 && seg[0] === 'parts' && seg[1].endsWith('.js') && seg[1].length > 3) {
    const stem = seg[1].slice(0, -3);
    if (isSurfId(stem)) return { kind: 'v2-part', id: stem, path: p };
    return { kind: 'shared-part', part: stem, path: p };
  }
  return { kind: 'other', path: p };
}

/** True when the tree still has a path-named v1 assembly or part file. */
export function isLegacyVaultTree(tree) {
  for (const entry of tree || []) {
    const info = parseLegacyVaultPath(entry?.path ?? entry);
    if (!info) continue;
    if (info.kind === 'assembly-meta' || info.kind === 'assembly-part' || info.kind === 'shared-part') {
      return true;
    }
  }
  return false;
}

export function listLegacyAssemblyNames(tree) {
  const names = [];
  const seen = new Set();
  for (const entry of tree || []) {
    const info = parseLegacyVaultPath(entry?.path ?? entry);
    if (info?.kind !== 'assembly-meta') continue;
    const key = String(info.assembly || '').toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    names.push(info.assembly);
  }
  return names.sort((a, b) => a.localeCompare(b));
}

export function assemblyMetaCandidates(assemblyName) {
  const name = vaultSegment(assemblyName);
  if (!name) return [];
  return [
    `assemblies/${name}/.surf.json`,
    `assemblies/${name}/${name}.surf.json`,
  ];
}

function markerVersionOf(content) {
  try {
    const marker = JSON.parse(String(content));
    if (marker?.kind !== VAULT_MARKER_KIND) return null;
    if (!Number.isInteger(marker.version)) return null;
    return marker.version;
  } catch {
    return null;
  }
}

/**
 * A vault is legacy when `surfcad.json` is version 1, or the tree still has
 * `assemblies/<Name>/.surf.json`, `assemblies/<Name>/<Part>.js`, or
 * `parts/<Name>.js` whose stem is not a surf-id.
 * -> { layout: 'legacy' | 'v2', markerVersion: number | null }
 */
export async function detectVaultLayout(adapter, repo, ref = 'main') {
  assertGithubAdapter(adapter);
  const marker = await adapter.readFile(repo, VAULT_MARKER_PATH, ref);
  const markerVersion = marker?.content != null ? markerVersionOf(marker.content) : null;
  const tree = await adapter.listTree(repo, ref);
  const legacyTree = isLegacyVaultTree(tree);
  if (markerVersion === 2 && !legacyTree) {
    return { layout: 'v2', markerVersion, legacyTree: false };
  }
  return {
    layout: 'legacy',
    markerVersion: markerVersion == null ? 1 : markerVersion,
    legacyTree,
  };
}

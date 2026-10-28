#!/usr/bin/env node
/**
 * Multi-part Fillet / Chamfer picks, and the part-switch caches.
 *
 * Two parts with the same local cube: every vertex-index key ("0-1") exists
 * on both. Picks on A, then on B, accumulate; a pick on B never removes A's
 * edge with the same key. A part switch keeps the picks only in Fillet /
 * Chamfer. Accept validates every part first, then writes one marked block
 * per part (the editor part on the live buffer, the other on its saved
 * script, append when that part already has the block). Both scripts run
 * and each cube loses exactly its own fillet volume.
 *
 * Part switch: the built solid and its edge graph are cached by mesh data /
 * geometry, so showing a part again is a cache hit; a pruned entry is
 * disposed; a new run (new mesh data) misses.
 */
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { Mesh } from 'three';
import {
  sameSelectedEdge,
  selectionEdgeKey,
  toggleEdgeSelection,
  toggleEdgeSelectionPropagated,
} from '../../src/utils/selectEdge.js';
import { stampBoundaryOnSelection } from '../../src/utils/boundaryEdgeIds.js';
import {
  activePartEdges,
  composeMultiPartEdgeCommit,
  foreignPartEdgeGroups,
  groupEdgesByPart,
  planMultiPartEdgeAccept,
  retargetKeepsEdgePicks,
} from '../../src/utils/multiPartEdges.js';
import {
  composeChamferCommit,
  composeFilletCommit,
  hasChamferModeBlock,
  hasFilletModeBlock,
  validateChamferAccept,
  validateFilletAccept,
} from '../../src/utils/filletMode.js';
import {
  buildSolidGeometry,
  cachedSolidGeometry,
  createSolidCache,
  featureGraphFor,
  pruneSolidCacheIn,
  releaseGeometryIn,
  solidEntryForGeometry,
} from '../../src/utils/partSolidCache.js';

const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

let failed = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`);
  }
}

register('./manifold-resolve-hook.mjs', import.meta.url);

const pending = new Map();
let msgId = 0;
const workerSelf = {
  onmessage: null,
  postMessage(msg) {
    if (msg.type === 'loaded') return;
    const waiter = pending.get(msg.id);
    if (!waiter) return;
    pending.delete(msg.id);
    if (msg.type === 'error') waiter.reject(new Error(msg.payload?.message || 'worker error'));
    else waiter.resolve(msg);
  },
};
globalThis.self = workerSelf;

function send(type, payload = {}) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    Promise.resolve().then(() => {
      workerSelf.onmessage({ data: { type, payload, id } });
    });
  });
}

await import('../../src/workers/sandboxWorker.js');
await send('init');

async function exec(script) {
  const res = await send('execute', { script, importedModels: {}, memoryLimitMB: 512 });
  return res.payload;
}

console.log('multi-part fillet — picks accumulate across parts, Accept writes each part');

const CUBE_A = 'let part = Manifold.cube([40, 30, 20], true);\nreturn part;';
const CUBE_B = 'let part = Manifold.cube([40, 30, 20], true);\nreturn part;';
const VOL = 40 * 30 * 20;
const R = 2;
const LEG = 20;
const ONE_CORNER = LEG * R * R * (1 - Math.PI / 4);

/** The viewport's pick graph for one part: cached geometry + coherent edges tagged with the part. */
function pickGraph(cache, mesh, partId) {
  const solid = cachedSolidGeometry(cache, mesh);
  const graph = featureGraphFor(solid.geometry, solid.faceIDs);
  for (const edge of graph.featureEdges) edge.partId = partId;
  return { ...solid, ...graph };
}

const runA = await exec(CUBE_A);
const runB = await exec(CUBE_B);
const cache = createSolidCache();
const A = pickGraph(cache, runA.mesh, 'local:A');
const B = pickGraph(cache, runB.mesh, 'local:B');
const vertA = A.featureEdges.filter((e) => Math.abs(e.tangent?.[2] || 0) > 0.99);
const vertB = B.featureEdges.filter((e) => Math.abs(e.tangent?.[2] || 0) > 0.99);
check('both parts expose four vertical corners', vertA.length === 4 && vertB.length === 4,
  `A=${vertA.length} B=${vertB.length}`);
const a0 = vertA[0];
const b0 = vertB.find((e) => e.key === a0.key) || vertB[0];
check('the same vertex key exists on both parts (ids collide)', b0.key === a0.key, `${a0.key} vs ${b0.key}`);

// ── Selection identity ───────────────────────────────────────────────────
{
  check('same key on another part is a different pick',
    !sameSelectedEdge(a0, b0) && sameSelectedEdge(a0, { ...a0 })
    && selectionEdgeKey(a0) !== selectionEdgeKey(b0));
  check('an untagged pick still matches on key alone (single part)',
    sameSelectedEdge({ ...a0, partId: undefined }, a0));
  let sel = toggleEdgeSelection([], a0);
  sel = toggleEdgeSelection(sel, b0);
  check('a pick on B keeps the pick on A with the same key',
    sel.length === 2 && sel[0].partId === 'local:A' && sel[1].partId === 'local:B');
  sel = toggleEdgeSelection(sel, b0);
  check('toggling B again removes only B', sel.length === 1 && sel[0].partId === 'local:A');

  let prop = toggleEdgeSelectionPropagated([], vertA[0], { propagate: true, featureEdges: A.featureEdges });
  const nA = prop.length;
  prop = toggleEdgeSelectionPropagated(prop, b0, { propagate: true, featureEdges: B.featureEdges });
  check('tangent-on pick on B appends B and keeps every A pick',
    prop.length > nA
    && prop.filter((e) => e.partId === 'local:A').length === nA
    && prop.some((e) => e.partId === 'local:B'),
    `A=${nA} total=${prop.length}`);
}

// ── Retarget keeps picks in Fillet / Chamfer only ────────────────────────
{
  check('a part switch keeps edge picks in Fillet and Chamfer',
    retargetKeepsEdgePicks({ filletMode: { entry: 'filletEdges' } }) === true
    && retargetKeepsEdgePicks({ filletMode: { entry: 'chamferEdges' } }) === true);
  check('a part switch outside Fillet / Chamfer still clears',
    retargetKeepsEdgePicks({ filletMode: null }) === false && retargetKeepsEdgePicks({}) === false);
}

const sel = [...vertA.slice(0, 2), ...vertB.slice(0, 1)].map((e) => toggleEdgeSelection([], e)[0]);

// ── Grouping, overlay split, boundary re-stamp ───────────────────────────
{
  const groups = groupEdgesByPart(sel, 'local:B');
  check('picks group by part in first-pick order',
    groups.length === 2 && groups[0].partId === 'local:A' && groups[0].edges.length === 2
    && groups[1].partId === 'local:B' && groups[1].edges.length === 1);
  check('the active part draws its own picks; the other part is drawn at its position',
    activePartEdges(sel, 'local:B').length === 1
    && foreignPartEdgeGroups(sel, 'local:B').length === 1
    && foreignPartEdgeGroups(sel, 'local:B')[0].partId === 'local:A');
  const poisoned = B.featureEdges.map((e) => ({ ...e, boundaryId: (e.boundaryId ?? 0) + 100, faceA: 99 }));
  const stamped = stampBoundaryOnSelection(sel, poisoned);
  check("re-stamping on B's graph leaves A's picks alone",
    stamped.filter((e) => e.partId === 'local:A').every((e, i) => e.faceA === sel[i].faceA && e.boundaryId === sel[i].boundaryId)
    && stamped.find((e) => e.partId === 'local:B').faceA === 99);
}

// ── Accept: validate every part, then one block per part ─────────────────
{
  const plan = planMultiPartEdgeAccept({
    edges: sel,
    activeId: 'local:B',
    validate: (list) => validateFilletAccept(list, { radius: R, strategy: 'sweep' }),
  });
  check('multi-part Accept validates two groups', plan.ok && plan.groups.length === 2, plan.message || '');
  const bad = planMultiPartEdgeAccept({
    edges: sel,
    activeId: 'local:B',
    validate: (list) => (list[0]?.partId === 'local:A' ? { ok: false, message: 'bad chain' } : { ok: true }),
    partName: (id) => (id === 'local:A' ? 'Bracket' : id),
  });
  check('one bad part fails the whole Accept, naming that part',
    bad.ok === false && /^Bracket: bad chain/.test(bad.message), bad.message);

  const parts = {
    'local:A': { script: CUBE_A, name: 'Bracket', ok: true },
    'local:B': { script: CUBE_B, name: 'Plate', ok: true },
  };
  const groups = plan.groups.map((g) => ({
    partId: g.partId,
    edges: g.edges,
    params: g.gate.normalized,
    filletClass: 'easy',
  }));
  const out = composeMultiPartEdgeCommit({
    groups,
    editorId: 'local:B',
    editorBuffer: CUBE_B,
    parts,
    compose: composeFilletCommit,
    hasBlock: hasFilletModeBlock,
  });
  check('Accept writes the editor part and one background part',
    out.ok && out.editor && out.writes.length === 1 && out.writes[0].id === 'local:A'
    && out.writes[0].message === 'Fillet mode' && out.writes[0].name === 'Bracket',
    out.message || '');
  if (out.ok) {
    check('each part gets its own fillet-mode block',
      hasFilletModeBlock(out.editor.buffer) && hasFilletModeBlock(out.writes[0].buffer)
      && (out.editor.buffer.match(/filletAlongPath\s*\(/g) || []).length === 1
      && (out.writes[0].buffer.match(/filletAlongPath\s*\(/g) || []).length === 1);
    check('no external copy is written for a fillet', !/externalBody\(/.test(out.editor.buffer + out.writes[0].buffer));
    const runEditor = await exec(out.editor.buffer);
    const runOther = await exec(out.writes[0].buffer);
    const removedB = VOL - runEditor.volume;
    const removedA = VOL - runOther.volume;
    check('B (editor) loses one corner', Math.abs(removedB - ONE_CORNER) / ONE_CORNER < 0.05,
      `removed=${removedB.toFixed(3)} want≈${ONE_CORNER.toFixed(3)}`);
    check('A (background) loses its two corners', Math.abs(removedA - 2 * ONE_CORNER) / (2 * ONE_CORNER) < 0.05,
      `removed=${removedA.toFixed(3)} want≈${(2 * ONE_CORNER).toFixed(3)}`);

    const again = composeMultiPartEdgeCommit({
      groups,
      editorId: 'local:B',
      editorBuffer: out.editor.buffer,
      parts: { ...parts, 'local:A': { ...parts['local:A'], script: out.writes[0].buffer } },
      compose: composeFilletCommit,
      hasBlock: hasFilletModeBlock,
    });
    check('a part that already has a fillet block gets an append',
      again.ok
      && (again.writes[0].buffer.match(/filletAlongPath\s*\(/g) || []).length === 2
      && (again.editor.buffer.match(/filletAlongPath\s*\(/g) || []).length === 2,
      again.message || '');
  }

  const failedPart = composeMultiPartEdgeCommit({
    groups,
    editorId: 'local:B',
    editorBuffer: CUBE_B,
    parts: { ...parts, 'local:A': { ...parts['local:A'], ok: false } },
    compose: composeFilletCommit,
    hasBlock: hasFilletModeBlock,
  });
  const noScript = composeMultiPartEdgeCommit({
    groups,
    editorId: 'local:B',
    editorBuffer: CUBE_B,
    parts: { ...parts, 'local:A': { ...parts['local:A'], script: null } },
    compose: composeFilletCommit,
    hasBlock: hasFilletModeBlock,
  });
  check('a failed or script-less part refuses the whole Accept',
    failedPart.ok === false && /failed its last run/.test(failedPart.message)
    && noScript.ok === false && /no script yet/.test(noScript.message));

  const onlyOther = composeMultiPartEdgeCommit({
    groups: [{ partId: 'local:B', edges: [] }, groups[0]],
    editorId: 'local:B',
    editorBuffer: CUBE_B,
    parts,
    compose: composeFilletCommit,
    hasBlock: hasFilletModeBlock,
  });
  check('picks only on another part write that part and leave the editor alone',
    onlyOther.ok && onlyOther.editor === null && onlyOther.writes.length === 1);

  const chamferPlan = planMultiPartEdgeAccept({
    edges: sel,
    activeId: 'local:B',
    validate: (list) => validateChamferAccept(list, { chamfer: R }),
  });
  const chamfer = composeMultiPartEdgeCommit({
    chamfer: true,
    groups: chamferPlan.groups.map((g) => ({ partId: g.partId, edges: g.edges, params: g.gate.normalized })),
    editorId: 'local:B',
    editorBuffer: CUBE_B,
    parts,
    compose: composeChamferCommit,
    hasBlock: hasChamferModeBlock,
  });
  check('Chamfer uses the same per-part Accept',
    chamferPlan.ok && chamfer.ok && hasChamferModeBlock(chamfer.editor.buffer)
    && hasChamferModeBlock(chamfer.writes[0].buffer) && chamfer.writes[0].message === 'Chamfer mode',
    chamfer.message || chamferPlan.message || '');
  if (chamfer.ok) {
    const runOther = await exec(chamfer.writes[0].buffer);
    const want = 2 * LEG * 0.5 * R * R;
    check('A bevels its two corners', Math.abs((VOL - runOther.volume) - want) / want < 0.05,
      `removed=${(VOL - runOther.volume).toFixed(3)}`);
  }
}

// ── Part-switch caches ───────────────────────────────────────────────────
{
  const hitGeom = cachedSolidGeometry(cache, runA.mesh);
  check('showing a part again reuses its built solid', hitGeom.geometry === A.geometry);
  const hitGraph = featureGraphFor(A.geometry, A.faceIDs);
  check('the edge graph of that solid is a cache hit', hitGraph.cached === true && hitGraph.featureEdges === A.featureEdges);
  check('a different faceID array is not a hit', featureGraphFor(A.geometry, null).cached === false);
  const fresh = buildSolidGeometry(runA.mesh);
  check('a fresh build of the same mesh matches the cached solid',
    fresh.geometry.index.count === A.geometry.index.count
    && fresh.geometry.attributes.position.count === A.geometry.attributes.position.count
    && !!fresh.geometry.attributes.faceID);
  const rerun = await exec(CUBE_A);
  check('a new run (new mesh data) misses', cachedSolidGeometry(cache, rerun.mesh).geometry !== A.geometry);
  check('the owner lookup finds a cached geometry', solidEntryForGeometry(cache, A.geometry)?.meshData === runA.mesh);

  let disposed = 0;
  A.geometry.addEventListener('dispose', () => { disposed += 1; });
  releaseGeometryIn(cache, A.geometry);
  check('releasing a cached solid does not dispose it', disposed === 0);
  const pick = new Mesh(B.geometry);
  const extras = new Map([['local:A', new Mesh(A.geometry)]]);
  pruneSolidCacheIn(cache, pick, extras);
  check('prune keeps solids still shown (pick mesh and other parts)',
    cache.entries.has(runA.mesh) && cache.entries.has(runB.mesh) && !cache.entries.has(rerun.mesh) && disposed === 0);
  extras.clear();
  pruneSolidCacheIn(cache, pick, extras);
  check('prune disposes a solid nothing shows', !cache.entries.has(runA.mesh) && disposed === 1);
}

// ── Wiring ───────────────────────────────────────────────────────────────
{
  const view = read('src/components/Viewport.jsx');
  const app = read('src/App.jsx');
  const feed = read('src/components/PartFeed.jsx');
  const arch = read('docs/architecture.md');
  const adopt = view.slice(view.indexOf('adoptActiveSolidRef.current = ('), view.indexOf('const upsertAssemblyExtra'));
  const accept = view.slice(view.indexOf('const acceptFillet = useCallback'), view.indexOf('const exitShellMode'));
  const commit = app.slice(app.indexOf('const handleCommitFillet'), app.indexOf('const handleCommitShell'));
  check('a part switch keeps Fillet / Chamfer picks instead of clearing them',
    /retargetKeepsEdgePicks\(\{ filletMode: filletModeRef\.current \}\)/.test(adopt)
    && /if \(!keepEdges\) setSelectedEdges\(\[\]\)/.test(adopt));
  check('Accept groups picks by part and hands the other parts to App',
    /planMultiPartEdgeAccept\(/.test(accept) && /otherParts/.test(accept));
  check('App composes every part, then writes the others as their own steps',
    /composeMultiPartEdgeCommit\(/.test(commit) && /writeOtherPartScripts\(writes\)/.test(commit));
  check('picks kept on another part are drawn at that part, and chips are part-scoped',
    /foreignPartEdgeGroups\(/.test(view) && /selectionEdgeKey\(e\)/.test(view));
  check('part switch reuses cached solids and pre-builds other parts in idle time',
    /cachedSolidGeometry\(/.test(view) && /prewarmPartGraphsRef\.current\(\)/.test(view)
    && /featureGraphFor\(/.test(view));
  check('parts list selection is blue; a failed row stays red',
    /bg-blue-500/.test(feed) && /bg-blue-950\/50/.test(feed) && /ring-red-500\/80/.test(feed));
  check('architecture documents multi-part Fillet picks and the switch cache',
    /Fillet and Chamfer picks accumulate across parts/.test(arch)
    && /blue bar/.test(arch)
    && /cached by mesh data/.test(arch));
  const pkg = JSON.parse(read('package.json'));
  check('package.json registers golden:multi-part-fillet',
    pkg.scripts['golden:multi-part-fillet'] === 'node scripts/golden/smoke_multi_part_fillet.mjs');
}

if (failed) {
  console.log(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nAll multi-part fillet checks passed.');
process.exit(0);

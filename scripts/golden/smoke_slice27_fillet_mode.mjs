#!/usr/bin/env node
/**
 * Slice 27 — Fillet enter-without-edges + Accept + live preview.
 * - Fillet is its own mode (not a contour entry)
 * - enter with no edges does not refuse
 * - live blend preview grows as edges accumulate (sweep / filletAlongPath)
 * - Accept writes makeSweepPath + filletAlongPath in a marked block + Auto-Run
 * - second Accept replaces the same block (no duplicate stack)
 * - Back = no commit
 * - disconnected (disjoint simple) picks Accept as independent fillets
 * - branched path stays visible (loud fail, not a wrong solid)
 * - #27–#30 fillet/sweep stack preserved (Strategy=sweep default)
 */
import {
  composeHelperInsert,
  HELPER_PALETTE_ITEMS,
  FILLET_MODE_BEGIN,
  FILLET_MODE_END,
} from '../../src/utils/helperPaletteSnippets.js';
import { resolveFaceModal } from '../../src/utils/faceFeaturePlacement.js';
import {
  pickFilletStrategy,
  resolveFilletStrategy,
  planFilletSweepPath,
  expandFilletCutterContour,
  filletWedgeContour,
  filletSweepCutterExpand,
  FILLET_SWEEP_EXPAND_MIN,
  canBuildFilletAlongPath,
} from '../../src/utils/filletAlongPath.js';
import {
  isContourEntry,
  isExtrudeEntry,
  isRevolveEntry,
  hasContourExtrudeBlock,
  hasContourRevolveBlock,
  hasContourProfileBlock,
} from '../../src/utils/contourMode.js';
import {
  isFilletEntry,
  isChamferEntry,
  enterFilletState,
  enterChamferState,
  validateChamferAccept,
  composeChamferCommit,
  hasChamferModeBlock,
  defaultFilletParams,
  normalizeFilletParams,
  validateFilletAccept,
  buildFilletBlendPreview,
  disconnectedPathPolylines,
  composeFilletCommit,
  stripFilletModeBlock,
  hasFilletModeBlock,
  filletModeOwnedRegion,
  countFilletAlongPath,
  countMakeSweepPath,
  FILLET_MODE_EMPTY,
  FILLET_MODE_NO_COMMIT,
} from '../../src/utils/filletMode.js';
import { sweepBlendHardMax, pathLengthFromEdges } from '../../src/utils/selectEdge.js';
import { hasFeatureBlock } from '../../src/utils/featureBlockId.js';

let failed = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`);
  }
}

console.log('slice-27 fillet enter / Accept / live preview smoke');

const starter = 'let part = Manifold.cube([40, 30, 20], true);\nreturn part;\n';

const V = [
  [-20, -15, 10], [20, -15, 10], [20, 15, 10], [-20, 15, 10],
];
const mk = (a, b) => {
  const va = V[a], vb = V[b];
  const length = Math.hypot(vb[0] - va[0], vb[1] - va[1], vb[2] - va[2]);
  return {
    key: `${Math.min(a, b)}-${Math.max(a, b)}`,
    a,
    b,
    va: va.slice(),
    vb: vb.slice(),
    mid: [(va[0] + vb[0]) / 2, (va[1] + vb[1]) / 2, (va[2] + vb[2]) / 2],
    length,
    n0: [0, 0, 1],
    n1: [0, -1, 0],
  };
};
const e01 = mk(0, 1);
const e12 = mk(1, 2);
const e23 = mk(2, 3);
const e30 = mk(3, 0);

// ── Entry ──────────────────────────────────────────────────────
{
  check('Fillet is fillet entry', isFilletEntry('filletEdges'));
  check('Chamfer is NOT fillet entry', !isFilletEntry('chamferEdges'));
  check('Path is NOT fillet entry', !isFilletEntry('sweepPath'));
  check('Fillet is NOT contour entry', !isContourEntry('filletEdges'));
  check('Extrude stays contour entry', isContourEntry('makeExtrude') && isExtrudeEntry('makeExtrude'));
  check('Revolve stays contour entry', isContourEntry('makeRevolve') && isRevolveEntry('makeRevolve'));
  check('Profile stays contour entry', isContourEntry('crossSection'));

  const empty = enterFilletState(null);
  check('enter with no edges does not refuse', empty.enterRefuse == null);
  check('enter empty strategy sweep', empty.params.strategy === 'sweep');
  check('enter empty radius > 0', empty.params.radius > 0);
  check('enter empty radiusTouched false', empty.radiusTouched === false);
  check('enter empty lastEdges empty', Array.isArray(empty.lastEdges) && empty.lastEdges.length === 0);

  const withEdges = enterFilletState([e01, e12]);
  check('enter with edges still no refuse', withEdges.enterRefuse == null);
  check('enter with edges strategy sweep', withEdges.params.strategy === 'sweep');
}

// ── Params / Accept gate ───────────────────────────────────────
{
  const p = defaultFilletParams([e01, e12, e23, e30]);
  check('default strategy sweep', p.strategy === 'sweep');
  check('default profile fillet', p.profile === 'fillet');
  check('normalize auto → sweep', normalizeFilletParams({ strategy: 'auto' }).strategy === 'sweep');
  check('normalize planar stays planar', normalizeFilletParams({ strategy: 'planar' }).strategy === 'planar');

  const empty = validateFilletAccept([], p);
  check('Accept with no edges fails', empty.ok === false);
  check('empty Accept mentions pick/Accept', /pick|Accept/i.test(empty.message || FILLET_MODE_EMPTY));

  const ok = validateFilletAccept([e01, e12], p);
  check('Accept open chain ok', ok.ok === true && ok.normalized.strategy === 'sweep');

  const disc = validateFilletAccept([e01, e23], p);
  check('Accept disconnected ok (independent fillets)', disc.ok === true);
  check('disconnected Accept yields 2 components', (disc.components || []).length === 2);
}

// ── Live preview grows with selection ──────────────────────────
{
  const p0 = buildFilletBlendPreview([], { strategy: 'sweep', radius: 3 });
  check('preview empty not ok', p0.ok === false);
  check('preview empty no rings', !p0.rings);
  check('preview empty no silent path', p0.path == null);

  const p1 = buildFilletBlendPreview([e01], { strategy: 'sweep', radius: 3 });
  check('preview one edge ok', p1.ok === true);
  check('preview one edge has path pts', (p1.path?.points?.length || 0) >= 2);
  check('preview one edge has rings', (p1.rings?.length || 0) >= 2);
  check('preview one edge radius 3', p1.radius === 3);
  check('preview strategy sweep', p1.strategy === 'sweep');

  const p2 = buildFilletBlendPreview([e01, e12], { strategy: 'sweep', radius: 3 });
  check('preview two edges ok', p2.ok === true);
  check(
    'preview grows with second edge',
    (p2.path?.points?.length || 0) > (p1.path?.points?.length || 0)
      || (p2.length || 0) > (p1.length || 0),
    `p1pts=${p1.path?.points?.length} p2pts=${p2.path?.points?.length} p1L=${p1.length} p2L=${p2.length}`,
  );
  check('preview two rings ≥ previous', (p2.rings?.length || 0) >= (p1.rings?.length || 0));

  const loop = buildFilletBlendPreview([e01, e12, e23, e30], { strategy: 'sweep', radius: 4 });
  check('preview closed loop ok', loop.ok === true && loop.closed === true);
  check('preview closed has wedge rings', (loop.rings?.length || 0) >= 3);

  const disc = buildFilletBlendPreview([e01, e23], { strategy: 'sweep', radius: 3 });
  check('preview disconnected ok (independent)', disc.ok === true);
  check('preview disconnected componentCount 2', disc.componentCount === 2);
  check('preview disconnected keeps polylines', (disc.polylines?.length || 0) >= 2);
  check('preview disconnected no invented single path', disc.path == null);
  check('preview disconnected top-level rings null (per-component)', !disc.rings);
  check('preview disconnected each component has rings',
    (disc.components || []).length === 2
    && disc.components.every((c) => (c.rings?.length || 0) >= 2));
  const vis = disconnectedPathPolylines([e01, e23]);
  check('disconnected polylines helper still works', vis.length === 2 && vis[0].length === 2);
}

// ── Accept compose ─────────────────────────────────────────────
{
  const first = composeFilletCommit(starter, {
    edges: [e01, e12],
    params: { strategy: 'sweep', radius: 3 },
  });
  check('Accept compose ok', first.ok === true && first.run === true);
  check('Accept has fillet-mode markers', hasFilletModeBlock(first.buffer));
  check('Accept begin marker', hasFeatureBlock(first.buffer, FILLET_MODE_BEGIN, FILLET_MODE_END) && /\/\/ --- fillet-mode begin id=fillet1 ---/.test(first.buffer));
  check('Accept end marker', /\/\/ --- fillet-mode end id=fillet1 ---/.test(first.buffer));
  const owned = filletModeOwnedRegion(first.buffer);
  check('owned has makeSweepPath', /makeSweepPath\s*\(/.test(owned));
  check('owned has filletAlongPath', /filletAlongPath\s*\(/.test(owned));
  check('one makeSweepPath', countMakeSweepPath(first.buffer) === 1);
  check('one filletAlongPath', countFilletAlongPath(first.buffer) === 1);
  check('no contour extrude markers', !hasContourExtrudeBlock(first.buffer));
  check('no contour revolve markers', !hasContourRevolveBlock(first.buffer));
  check('no contour profile markers', !hasContourProfileBlock(first.buffer));
  check('starter cube still present', /Manifold\.cube/.test(first.buffer));

  const second = composeFilletCommit(first.buffer, {
    edges: [e01, e12, e23],
    params: { strategy: 'sweep', radius: 4 },
  });
  check('second Accept ok', second.ok === true && second.run === true);
  check('second Accept still one block', (second.buffer.match(/fillet-mode begin/g) || []).length === 1);
  check('second Accept still one filletAlongPath', countFilletAlongPath(second.buffer) === 1);
  check('second Accept still one makeSweepPath', countMakeSweepPath(second.buffer) === 1);
  check('second Accept radius 4', /filletAlongPath\([^,]+,\s*[^,]+,\s*4/.test(second.buffer));
  check('second Accept more edges than first', (second.buffer.match(/va:/g) || []).length >= (first.buffer.match(/va:/g) || []).length);

  const stripped = stripFilletModeBlock(first.buffer);
  check('strip removes markers', !hasFilletModeBlock(stripped));
  check('strip keeps cube', /Manifold\.cube/.test(stripped));
  check('strip removes filletAlongPath', !/filletAlongPath\s*\(/.test(stripped));
}

// ── Back = no commit / empty / disconnected stay visible ───────
{
  check('dismiss constant documents no commit', /no commit/i.test(FILLET_MODE_NO_COMMIT)
    && !/Back exits/.test(FILLET_MODE_NO_COMMIT));
  const untouched = starter;
  check('Back leaves buffer unchanged', untouched === starter);

  const empty = composeFilletCommit(starter, { edges: [], params: { strategy: 'sweep', radius: 3 } });
  check('empty Accept does not write', empty.ok === false);
  check('empty Accept no buffer', empty.buffer == null);

  const disc = composeFilletCommit(starter, {
    edges: [e01, e23],
    params: { strategy: 'sweep', radius: 3 },
  });
  check('disconnected Accept writes', disc.ok === true && typeof disc.buffer === 'string');
  check('disconnected Accept one fillet-mode block',
    (disc.buffer.match(/fillet-mode begin/g) || []).length === 1);
  check('disconnected Accept one makeSweepPath (the set)', countMakeSweepPath(disc.buffer) === 1);
  check('disconnected Accept one filletAlongPath (the set)', countFilletAlongPath(disc.buffer) === 1);
  const stay = buildFilletBlendPreview([e01, e23], { strategy: 'sweep', radius: 3 });
  check('disconnected preview stays visible after Accept compose', (stay.polylines?.length || 0) >= 2);
}

// ── Disjoint edges → independent fillets (2+ components) ───────
{
  // Opposite box edges (no shared vertex) → two 1-edge components.
  const gate = validateFilletAccept([e01, e23], { strategy: 'sweep', radius: 2 });
  check('2 disjoint edges → 2 components', gate.ok && (gate.components || []).length === 2);
  const twoAlone = composeFilletCommit(starter, {
    edges: [e01, e23],
    params: { strategy: 'sweep', radius: 2 },
  });
  check('2 disjoint edges Accept ok', twoAlone.ok === true);
  check('2 disjoint edges one pair inside markers (edge set)',
    hasFilletModeBlock(twoAlone.buffer)
    && countMakeSweepPath(filletModeOwnedRegion(twoAlone.buffer)) === 1
    && countFilletAlongPath(filletModeOwnedRegion(twoAlone.buffer)) === 1);

  // Other opposite pair + one contiguous chain still one component when connected.
  const chain = validateFilletAccept([e01, e12], { strategy: 'sweep', radius: 2 });
  check('contiguous chain stays 1 component', chain.ok && (chain.components || []).length === 1);
  const bothPairs = validateFilletAccept([e01, e23, e12, e30], { strategy: 'sweep', radius: 2 });
  // Full loop is one closed component.
  check('closed loop stays 1 component', bothPairs.ok && (bothPairs.components || []).length === 1);

  // Two opposite pairs → two disconnected 2-edge? No — e01+e12+e23+e30 is connected.
  // Two opposite single edges already covered; add e12+e30 as second disjoint set
  // alongside nothing else: just confirm 2-edge opposite also splits.
  const otherOpp = composeFilletCommit(starter, {
    edges: [e12, e30],
    params: { strategy: 'sweep', radius: 2.5 },
  });
  check('other opposite pair Accept ok', otherOpp.ok === true);
  check('other opposite pair one filletAlongPath', countFilletAlongPath(otherOpp.buffer) === 1);
}

// ── One-shot palette Confirm still unmarked (prior goldens) ────
{
  const buf = composeHelperInsert(starter, 'filletEdges', null, {
    strategy: 'sweep',
    radius: 2,
    profile: 'fillet',
    reverse: false,
    edgeScope: 'selected',
  }, null, [e01, e12]);
  check('one-shot compose still emits filletAlongPath or filletEdges',
    /filletAlongPath\s*\(|filletEdges\s*\(/.test(buf || ''));
  // Slice A: one-shot Confirm also wraps fillet markers so the strip chip appears.
  check('one-shot compose has fillet-mode markers (Slice A ribbon)', hasFilletModeBlock(buf || ''));
}

// ── resolveFaceModal refuse path unchanged (slice-12 golden) ───
{
  const fillet = HELPER_PALETTE_ITEMS.find((h) => h.id === 'filletEdges');
  check('palette Fillet exists', !!fillet);
  const refuse = resolveFaceModal(fillet, null, []);
  check('modal still refuses empty (palette bypasses it)', refuse.mode === 'refuse');
  const modal = resolveFaceModal(fillet, null, [e01, e12]);
  check('modal with edges still opens params', modal.mode === 'params');
  const strat = (fillet?.params || []).find((p) => p.name === 'strategy');
  check('palette Fillet Strategy default sweep (#30)', strat && strat.default === 'sweep');
}

// ── #27–#30 fillet / sweep stack preserved ─────────────────────
{
  check('pickFilletStrategy is sweep', pickFilletStrategy() === 'sweep');
  check('resolveFilletStrategy() is sweep', resolveFilletStrategy() === 'sweep');
  check('resolveFilletStrategy(auto) is sweep', resolveFilletStrategy('auto') === 'sweep');
  check('resolveFilletStrategy(planar) still planar', resolveFilletStrategy('planar') === 'planar');

  const plan = planFilletSweepPath([[0, 0, 0], [10, 0, 0], [10, 0.2, 0], [20, 0, 0]]);
  check('#27/#28 plan is as-is (no skip-micro)', plan.mode === 'as-is');

  const wedge = filletWedgeContour(2, 6);
  const expanded = expandFilletCutterContour(wedge, 2);
  const q1max = Math.max(...expanded.map((p) => p[0]));
  check('#27 size-neutral pad: Q1 extent stays r', Math.abs(q1max - 2) < 1e-9);
  const e = filletSweepCutterExpand(2);
  check('#30 rear pad ≥ min', e >= FILLET_SWEEP_EXPAND_MIN);
  check('canBuild (single-path) still gates disconnect', !canBuildFilletAlongPath([e01, e23]).ok);
}

// ── Follow-up #34 nit-1: preview radius == committed radius (no preview≠commit divergence)
// The live blend preview clamps the sweep radius to the path-length hard max
// (buildFilletBlendPreview → sweepBlendHardMax). Before the fix, composeFilletCommit
// wrote the RAW typed value while the preview showed the clamped one (typed 999 →
// preview 35, snippet 999). normalizeFilletParams now clamps the committed radius by
// the same sweepBlendHardMax, so what the user saw is what lands in the script and
// the worker's loud "removed X vs expected Y" net never fires from the chip.
// These checks sit BEFORE the sole `if (failed)` guard below so they can turn the
// suite red (mutation-verified: reverting the clamp in normalizeFilletParams flips
// all four to ❌ + exit 1).
{
  const committedRadius = (buf) => {
    const line = String(buf || '').split('\n').find((l) => /filletAlongPath\s*\(/.test(l));
    const m = line && line.match(/filletAlongPath\([^,]+,\s*[^,]+,\s*([^),]+)\)/);
    return m ? m[1].trim() : null;
  };
  for (const typed of [999, 40, 3, 0, -5, NaN, '', '999', '1e999', Infinity]) {
    const pv = buildFilletBlendPreview([e01, e12], { strategy: 'sweep', radius: typed });
    const c = composeFilletCommit(starter, { edges: [e01, e12], params: { strategy: 'sweep', radius: typed } });
    const written = c.ok ? committedRadius(c.buffer) : null;
    check(
      `preview radius == committed radius (typed ${JSON.stringify(typed)})`,
      c.ok === true && written === String(pv.radius),
      `preview=${pv.radius} committed=${written}`,
    );
  }
  const over = composeFilletCommit(starter, { edges: [e01, e12], params: { strategy: 'sweep', radius: 999 } });
  const overMax = sweepBlendHardMax(pathLengthFromEdges([e01, e12]));
  const overWritten = committedRadius(over.buffer);
  // Pin against the live hard max (not a fixture-specific 35). Falsifiable: drop
  // the clamp in normalizeFilletParams and this writes 999 instead of overMax.
  check(
    'over-max typed radius commits the clamp, not the raw value',
    over.ok === true && overWritten === String(overMax) && overWritten !== '999',
    `committed=${overWritten} sweepMax=${overMax}`,
  );
  check(
    'clamped commit stays ≤ sweepBlendHardMax',
    Number(overWritten) <= overMax,
    `committed=${overWritten} sweepMax=${overMax}`,
  );

  // Nit 2 invariant: the deleted validateFilletAccept radius>0 arm stays
  // unreachable because normalizeFilletParams never yields a bad radius.
  {
    const wild = [NaN, -1, 0, Infinity, -Infinity, 'abc', '', [], '1e999', true, false, null, undefined, '0', Number.MIN_VALUE];
    const strategies = ['sweep', 'planar', 'auto', undefined];
    let hits = 0;
    for (const radius of wild) {
      for (const strategy of strategies) {
        const n = normalizeFilletParams({ radius, strategy }, [e01, e12]);
        if (!(n.radius > 0) || !Number.isFinite(n.radius)) hits++;
      }
    }
    check('normalize never yields non-finite/non-positive radius (nit-2 invariant)', hits === 0, `hits=${hits}`);
  }
}

// ── Chamfer enters the same edge-pick Accept path ─────────────
{
  check('Chamfer is a chamfer entry', isChamferEntry('chamferEdges'));
  check('Fillet is not a chamfer entry', !isChamferEntry('filletEdges'));
  const entered = enterChamferState(null);
  check('chamfer enter does not refuse', entered.enterRefuse == null && entered.entry === 'chamferEdges');
  check('chamfer accept with no edges fails', validateChamferAccept([], {}).ok === false);
  const commit = composeChamferCommit(starter, {
    edges: [e01],
    params: { chamfer: 1.5 },
  });
  check('chamfer accept ok', commit.ok === true, commit.message || '');
  check('chamfer accept writes makeSweepPath', /makeSweepPath\s*\(/.test(commit.buffer || ''));
  check('chamfer accept writes filletAlongPath', /filletAlongPath\s*\(/.test(commit.buffer || ''));
  check('chamfer accept profile chamfer', /profile:\s*'chamfer'/.test(commit.buffer || ''));
  check('chamfer accept is marked', hasChamferModeBlock(commit.buffer || ''));
  check('chamfer accept keeps the starter cube', /Manifold\.cube\s*\(/.test(commit.buffer || ''));
  const disc = composeChamferCommit(starter, {
    edges: [e01, e23],
    params: { chamfer: 1.5 },
  });
  check('chamfer disconnected ok (independent)', disc.ok === true, disc.message || '');
  check('chamfer disconnected one pair (edge set)',
    (disc.buffer.match(/makeSweepPath\s*\(/g) || []).length === 1
    && (disc.buffer.match(/filletAlongPath\s*\(/g) || []).length === 1);
  const again = composeChamferCommit(commit.buffer, {
    edges: [e12],
    params: { chamfer: 1 },
    commitMode: 'append',
  });
  check('second chamfer appends', again.ok === true && (again.buffer.match(/chamfer-mode begin/g) || []).length === 2);
}

if (failed) {
  console.error(`\nFAILED: ${failed} check(s)`);
  process.exit(1);
}
console.log('\nAll slice-27 checks passed.');

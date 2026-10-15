#!/usr/bin/env node
/**
 * Fillet and chamfer default size is 2 mm in every display unit.
 *
 * Inches show 0.0787. Edge length, path length, and the part box do not
 * change the seed, so a thin sheet stays at 2 mm. A typed radius still
 * applies to every part, including a typed 40 mm.
 *
 * Real solids (worker + pick graphs, like the viewport), Fillet mode's own
 * seed / Accept calls, and wiring checks on the Viewport seed effect.
 */
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { pathLengthFromEdges, toggleEdgeSelectionPropagated } from '../../src/utils/selectEdge.js';
import { formatDisplayNumber, lengthToDisplay } from '../../src/utils/displayUnit.js';
import { partEdgeParams, planMultiPartEdgeAccept } from '../../src/utils/multiPartEdges.js';
import {
  defaultFilletParams,
  defaultFilletRadius,
  enterChamferState,
  enterFilletState,
  FILLET_DEFAULT_RADIUS,
  normalizeFilletParams,
  solidMinExtent,
  validateFilletAccept,
} from '../../src/utils/filletMode.js';
import { cachedSolidGeometry, createSolidCache, featureGraphFor } from '../../src/utils/partSolidCache.js';


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

const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));

console.log('fillet default radius — 2 mm in every unit, typed is shared');

const PARTS = {
  A: 'let part = Manifold.cube([40, 30, 20], true);\nreturn part;',
  B: 'let part = Manifold.cube([20, 20, 20], true);\nreturn part;',
  T: 'let part = Manifold.cube([40, 30, 2], true);\nreturn part;',   // 2 mm sheet: too thin for 2
};
const cache = createSolidCache();
const graphs = {};
for (const [id, script] of Object.entries(PARTS)) {
  const run = await exec(script);
  const solid = cachedSolidGeometry(cache, run.mesh);
  const graph = featureGraphFor(solid.geometry, solid.faceIDs);
  for (const edge of graph.featureEdges) edge.partId = id;
  graphs[id] = { script, run, geometry: solid.geometry, edges: graph.featureEdges };
}
const pick = (sel, id, edge) => toggleEdgeSelectionPropagated(sel, edge, { propagate: true, featureEdges: graphs[id].edges });
/** Untouched size for any part's picks: 2 mm. */
const seedFor = () => defaultFilletRadius();
/** Straight edges of a part, longest first, so each pick adds path length. */
const straight = (id) => graphs[id].edges.filter((e) => e.length > 1).sort((a, b) => b.length - a.length);

// ── Pure helpers ───────────────────────────────────────────────
check('FILLET_DEFAULT_RADIUS is 2 mm', FILLET_DEFAULT_RADIUS === 2);
check('no picks → 2', defaultFilletRadius() === 2 && defaultFilletParams().radius === 2);
check('inches show 0.0787 for the 2 mm seed',
  formatDisplayNumber(lengthToDisplay(defaultFilletRadius(), 'in')) === '0.0787');
check('edges and minExtent do not size the radius',
  defaultFilletRadius({ minExtent: 4, picked: straight('A'), neighbors: graphs.A.edges }) === 2);
const edgeByLen = (id, len) => graphs[id].edges.find((e) => Math.abs(e.length - len) < 0.2);
check('cube 40 mm edge seeds 2 mm', seedFor('A', [edgeByLen('A', 40)]) === 2);
check('cube 20 mm edge seeds 2 mm', seedFor('A', [edgeByLen('A', 20)]) === 2,
  String(seedFor('A', [edgeByLen('A', 20)])));
check('chamfer enter seeds 2 mm', enterChamferState(straight('A')).params.chamfer === 2
  && enterChamferState(null).params.chamfer === 2);
check('solidMinExtent reads a plain box', solidMinExtent({ min: [0, 0, 0], max: [40, 30, 2] }) === 2);
check('solidMinExtent reads the solids (A 20, T 2)',
  near(solidMinExtent(graphs.A.geometry), 20) && near(solidMinExtent(graphs.T.geometry), 2));
check('enterFilletState / normalizeFilletParams seed 2 without a part',
  enterFilletState(straight('A')).params.radius === 2 && normalizeFilletParams({}, straight('A')).radius === 2);

// ── One part: the seed stays 2 as edges accumulate ─────────────
{
  let sel = [];
  const seeds = [];
  const lens = [];
  for (const edge of straight('A')) {
    if (sel.some((e) => e === edge)) continue;
    sel = pick(sel, 'A', edge);
    seeds.push(seedFor('A', sel));
    lens.push(pathLengthFromEdges(sel));
    if (sel.length >= 12) break;
  }
  check(`picked ${sel.length} edges on A, path ${lens[0]?.toFixed(0)} → ${lens.at(-1)?.toFixed(0)} mm`,
    sel.length >= 6 && lens.at(-1) > lens[0] * 3);
  check('seed stays 2 mm after every pick', seeds.every((r) => r === 2), seeds.join(' '));
  // Accept on an accumulated top loop (a closed loop the sweep takes) keeps 2.
  let loop = [];
  for (const edge of straight('A').filter((e) => e.mid[2] > 9.9)) loop = pick(loop, 'A', edge);
  const gate = validateFilletAccept(loop, { ...enterFilletState([]).params, radius: seedFor('A', loop) });
  check(`Accept on the ${loop.length}-edge top loop keeps 2 mm`, loop.length === 4 && gate.ok
    && gate.normalized.radius === 2, gate.message);
}

// ── Several parts: every part's untouched seed stays 2 ─────────
const multiPlan = (sel, activeId, state) => planMultiPartEdgeAccept({
  edges: sel,
  activeId,
  validate: (list) => validateFilletAccept(list, partEdgeParams(state.params, list, {
    touched: !!state.radiusTouched,
    seed: (picks) => seedFor(picks[0].partId, picks),
  })),
});
const radii = (plan) => Object.fromEntries(plan.groups.map((g) => [g.partId, g.gate.normalized.radius]));
{
  let sel = [];
  const rounds = [];
  const [ea, eb] = [straight('A'), straight('B')];
  for (let i = 0; i < 4; i++) {
    sel = pick(sel, 'A', ea[i * 2]);
    sel = pick(sel, 'B', eb[i * 2]);
    const state = { ...enterFilletState([]), radiusTouched: false };
    state.params = { ...state.params, radius: seedFor('B', sel.filter((e) => e.partId === 'B')) };
    const plan = multiPlan(sel, 'B', state);
    rounds.push(plan.ok ? radii(plan) : { err: plan.message });
  }
  check('A + B: every round, both parts seed 2 mm',
    rounds.every((r) => r.A === 2 && r.B === 2), JSON.stringify(rounds));
}

// ── Thin part keeps 2 mm, the same seed as the thick part ──────
let thinSel = [];
{
  const et = straight('T').filter((e) => e.length > 20);
  thinSel = pick(pick([], 'T', et[0]), 'T', et[1]);
  check('thin sheet (2 mm) still seeds 2 mm', seedFor('T', thinSel) === 2, String(seedFor('T', thinSel)));
  let sel = [...thinSel];
  sel = pick(sel, 'A', straight('A')[0]);
  for (const active of ['A', 'T']) {
    const state = enterFilletState([]);
    state.params = { ...state.params, radius: seedFor(active, sel.filter((e) => e.partId === active)) };
    const plan = multiPlan(sel, active, state);
    const r = plan.ok ? radii(plan) : {};
    check(`A + thin T, ${active} active: both seed 2`, r.A === 2 && r.T === 2, plan.message || JSON.stringify(r));
  }
}

// ── A typed radius is shared across parts ──────────────────────
{
  let sel = [...thinSel];
  sel = pick(sel, 'A', straight('A')[0]);
  sel = pick(sel, 'B', straight('B')[0]);
  const state = enterFilletState([]);
  const typed = { ...state, params: { ...state.params, radius: 0.5 }, radiusTouched: true };
  const plan = multiPlan(sel, 'A', typed);
  const r = plan.ok ? radii(plan) : {};
  check('typed 0.5 lands on A, B and the thin T', r.A === 0.5 && r.B === 0.5 && r.T === 0.5,
    plan.message || JSON.stringify(r));
  const typed3 = { ...state, params: { ...state.params, radius: 3 }, radiusTouched: true };
  const sel2 = pick(pick([], 'A', straight('A')[0]), 'B', straight('B')[0]);
  const plan3 = multiPlan(sel2, 'B', typed3);
  const r3 = plan3.ok ? radii(plan3) : {};
  check('typed 3 lands on A and B', r3.A === 3 && r3.B === 3, plan3.message || JSON.stringify(r3));
  const kept = partEdgeParams({ radius: 40 }, sel2, { touched: true, seed: () => 2 });
  check('typed 40 mm is kept', kept.radius === 40, String(kept.radius));
}

// ── Wiring ─────────────────────────────────────────────────────
{
  const vp = read('src/components/Viewport.jsx');
  check('seed effect uses the fixed radius',
    /const seeded = defaultFilletRadius\(\)/.test(vp));
  const i = vp.indexOf('const acceptFillet = useCallback');
  const body = vp.slice(i, vp.indexOf('const exitShellMode', i));
  check('Accept keeps an untouched size at the fixed radius',
    /touched: !!state\.radiusTouched/.test(body)
    && /seed: \(\) => defaultFilletRadius\(\)/.test(body));
  const fm = read('src/utils/filletMode.js');
  const def = fm.slice(fm.indexOf('export function defaultFilletParams'), fm.indexOf('export function enterFilletState'));
  check('defaultFilletParams does not read an edge length', !/pathLength|adjacentBlend|defaultSweepBlendSize/.test(def));
  check('helper-modal fillet default is the fixed radius too',
    !/adjacentBlend|defaultSweepBlendSize/.test(read('src/utils/faceFeaturePlacement.js')));
  const arch = read('docs/architecture.md');
  check('architecture.md documents the 2 mm default',
    /defaultFilletRadius/.test(arch) && /2 mm/.test(arch) && /golden:fillet-default-radius/.test(arch));
}

if (failed) {
  console.log(`\nfillet default radius: ${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nfillet default radius: all checks passed');
process.exit(0);

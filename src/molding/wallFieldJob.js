/**
 * Coarse then refined wall field, and the shared mold-analysis job.
 * `computeWallField` stays synchronous for the unit test. The worker uses
 * the async runners so a cancel can land between stages.
 */

import { dfmReport } from './dfmReport.js';
import {
  analyzeWallOnly,
  chooseMoldPull,
  finishMoldQuery,
  measureMoldWall,
  moldSearchPlan,
  openMoldQuery,
  scoreMoldDirection,
} from './pullDirection.js';

export function computeWallField(input, { onCoarse } = {}) {
  const mesh = {
    positions: input?.positions,
    indices: input?.indices,
    stamped: input?.stamped || null,
  };
  const coarse = analyzeWallOnly({ ...mesh, wallPass: 'centroid' });
  if (coarse?.error) return coarse;
  if (typeof onCoarse === 'function') onCoarse(coarse);
  return analyzeWallOnly({
    ...mesh,
    wallPass: 'refine',
    nominalHint: coarse.wall?.nominal ?? null,
  });
}

function yieldTick() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

/**
 * Coarse centroid field, a turn of the event loop, then the refined field.
 * `post` receives `{ phase, result?, error?, stage?, percent? }`.
 */
export async function runWallJob(input, { post, cancelled }) {
  const mesh = {
    positions: input?.positions,
    indices: input?.indices,
    stamped: input?.stamped || null,
  };
  if (!mesh.positions || !mesh.indices || mesh.indices.length < 3) {
    post({
      phase: 'error',
      error: { code: 'no_mesh', message: 'No mesh to score' },
    });
    return;
  }
  if (cancelled()) {
    post({ phase: 'dropped' });
    return;
  }
  post({ phase: 'progress', stage: 'Wall thickness', percent: 8 });
  const coarse = analyzeWallOnly({ ...mesh, wallPass: 'centroid' });
  if (coarse?.error) {
    post({ phase: 'error', error: coarse.error });
    return;
  }
  post({ phase: 'coarse', result: coarse });
  post({ phase: 'progress', stage: 'Wall thickness', percent: 45 });
  await yieldTick();
  if (cancelled()) {
    post({ phase: 'dropped' });
    return;
  }
  const refined = analyzeWallOnly({
    ...mesh,
    wallPass: 'refine',
    nominalHint: coarse.wall?.nominal ?? null,
  });
  if (refined?.error) {
    post({ phase: 'error', error: refined.error });
    return;
  }
  post({ phase: 'progress', stage: 'Wall thickness', percent: 100 });
  post({ phase: 'done', result: refined });
}

function finishChosen(query, chosen, wall, post) {
  const result = finishMoldQuery(query, chosen, wall);
  result.dfm = dfmReport(result);
  post({ phase: 'progress', stage: 'Parting', percent: 100 });
  post({ phase: 'done', result });
}

/**
 * Wall, pull search, parting, side actions, mold draft, and the DFM
 * summary. Yields before the wall pass and every eight pull candidates
 * so a cancel message can land. `input.pull` scores that axis.
 */
export async function runAnalysisJob(input, { post, cancelled }) {
  if (cancelled()) {
    post({ phase: 'dropped' });
    return;
  }
  post({ phase: 'progress', stage: 'Pull direction', percent: 4 });
  await yieldTick();
  if (cancelled()) {
    post({ phase: 'dropped' });
    return;
  }
  const query = openMoldQuery(input);
  if (query.error) {
    post({ phase: 'error', error: query.error });
    return;
  }
  post({ phase: 'progress', stage: 'Wall thickness', percent: 12 });
  await yieldTick();
  if (cancelled()) {
    post({ phase: 'dropped' });
    return;
  }
  const wall = measureMoldWall(query);
  if (query.override.pull) {
    post({ phase: 'progress', stage: 'Pull direction', percent: 55 });
    await yieldTick();
    if (cancelled()) {
      post({ phase: 'dropped' });
      return;
    }
    const scored = scoreMoldDirection(query, { pull: query.override.pull, principal: false });
    post({ phase: 'progress', stage: 'Parting', percent: 82 });
    await yieldTick();
    if (cancelled()) {
      post({ phase: 'dropped' });
      return;
    }
    finishChosen(query, {
      pull: scored.pull,
      pullSource: 'override',
      regions: scored.regions,
      undercutArea: scored.undercutArea,
      draftedArea: scored.draftedArea,
      candidates: [scored],
    }, wall, post);
    return;
  }
  const plan = moldSearchPlan(query);
  const candidates = [];
  const total = plan.dirs.length || 1;
  for (let i = 0; i < plan.dirs.length; i++) {
    if (i % 8 === 0) {
      const percent = 18 + Math.round((50 * i) / total);
      post({ phase: 'progress', stage: 'Pull direction', percent });
      await yieldTick();
      if (cancelled()) {
        post({ phase: 'dropped' });
        return;
      }
    }
    candidates.push(scoreMoldDirection(query, plan.dirs[i]));
  }
  const best = chooseMoldPull(query, candidates, plan.primary);
  post({ phase: 'progress', stage: 'Parting', percent: 82 });
  await yieldTick();
  if (cancelled()) {
    post({ phase: 'dropped' });
    return;
  }
  finishChosen(query, {
    pull: best.pull,
    pullSource: 'search',
    regions: best.regions,
    undercutArea: best.undercutArea,
    draftedArea: best.draftedArea,
    candidates,
  }, wall, post);
}

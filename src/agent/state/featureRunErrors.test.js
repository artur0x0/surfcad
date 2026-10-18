import assert from 'node:assert/strict';
import test from 'node:test';
import { createSurfcadBridge } from '../../utils/agentBridge.js';
import { buildToasts, viewportToastRows } from './toasts.js';

const UI = 'Hole failed: result is not a valid solid (NotManifold)';
const STACK = [
  'at eval (eval at executeScript (http://127.0.0.1:4178/src/lib/surfcad/runtime.js:9241:16), <anonymous>:5:7)',
  'at executeSkippingFailedFeatures (http://127.0.0.1:4178/src/lib/surfcad/runtime.js:9301:47)',
].join('\n');
const DETAIL = `RuntimeError\n${STACK}`;

const SCRIPT = `// --- cube begin id=cube1 ---
let part = Manifold.cube([10, 10, 10], true);
// --- cube end ---
// --- hole begin id=hole1 ---
part = part.subtract(Manifold.cylinder(12, 2, 2, 12, true));
// --- hole end ---
return part;
`;

const BBOX = { min: [-5, -5, -5], max: [5, 5, 5] };

/**
 * Host that records the viewport failure the way App.execute does: the
 * outcome carries a runFailure snapshot, and toasts read the popup text.
 */
function failingHost() {
  let buffer = SCRIPT;
  let executionError = null;
  /** Stale ref. A successful outcome passes runFailure: null and must ignore this. */
  let staleFailure = null;
  let mode = 'fail';
  const host = {
    getScript: () => buffer,
    setEditor(src) { buffer = src; },
    readHistory: () => ({ commits: [], head: -1 }),
    writeHistory() {},
    readParts: () => ({
      activeId: 'p1',
      assemblyName: 'Asm',
      parts: [{ id: 'p1', name: 'Part', visible: true }],
    }),
    readActivePartStatus: () => ({
      partId: 'p1',
      partName: 'Part',
      script: buffer,
      runState: 'ok',
      volume: 1000,
      bbox: BBOX,
      featureCount: 2,
      bodyCount: 1,
    }),
    setActivePart() { return { ok: true }; },
    readRunFailure: () => staleFailure,
    async agentUndo() {
      const outcome = await host.execute();
      return {
        handled: true,
        result: {
          ok: outcome.ok === true,
          kind: 'part',
          errors: outcome.errors || [],
          ...(Object.prototype.hasOwnProperty.call(outcome, 'runFailure')
            ? { runFailure: outcome.runFailure }
            : {}),
          status: {
            volume: outcome.volume ?? null,
            bbox: outcome.bbox ?? null,
            partName: outcome.partName || 'Part',
            featureCount: 2,
          },
        },
      };
    },
    readToasts: () => buildToasts(viewportToastRows({ executionError })),
    prepareHelperInsert() { return { source: SCRIPT }; },
    async execute() {
      if (mode === 'fail') {
        executionError = UI;
        const failure = {
          id: 'hole1',
          kind: 'hole',
          message: UI,
          detail: DETAIL,
        };
        staleFailure = failure;
        return {
          ok: false,
          errors: [UI, STACK],
          volume: null,
          bbox: null,
          partName: 'Part',
          runFailure: failure,
        };
      }
      if (mode === 'partial') {
        executionError = UI;
        const failure = {
          id: 'hole1',
          kind: 'hole',
          message: UI,
          detail: DETAIL,
        };
        staleFailure = failure;
        // Recovered mesh: the viewport returns ok and a solid.
        return {
          ok: true,
          errors: [],
          volume: 800,
          bbox: BBOX,
          partName: 'Part',
          runFailure: failure,
        };
      }
      executionError = null;
      return {
        ok: true,
        errors: [],
        volume: 1000,
        bbox: BBOX,
        partName: 'Part',
        runFailure: null,
      };
    },
  };
  return {
    host,
    setMode(next) { mode = next; },
    popup: () => executionError,
  };
}

function assertFeatureError(row) {
  assert.equal(row.code, 'feature_failed');
  assert.equal(row.message, UI);
  assert.equal(row.featureId, 'hole1');
  assert.equal(row.featureType, 'hole');
  assert.equal(row.featureLabel, 'Hole');
  assert.equal(row.featureIndex, 1);
  assert.equal(row.detail, 'RuntimeError');
  assert.equal(row.message.includes('Feature failed'), false);
}

function assertNoStackOrUrl(value) {
  const text = JSON.stringify(value);
  assert.equal(/https?:\/\//.test(text), false, text);
  assert.equal(/\bat\s+\S+/.test(text), false, text);
  assert.equal(/\.js:\d+/.test(text), false, text);
  assert.equal(/<anonymous>/.test(text), false, text);
}

test('errors and failures never include stack frames or URLs', async () => {
  const world = failingHost();
  const api = createSurfcadBridge({ resolve: () => world.host });
  const ran = await api.call('set_script', { part_id: 'p1', source: SCRIPT });
  assert.deepEqual(ran.result.errors, [UI]);
  assert.equal(ran.result.failures[0].detail, 'RuntimeError');
  assertNoStackOrUrl(ran.result.errors);
  assertNoStackOrUrl(ran.result.failures);
  const listed = await api.call('errors', {});
  assertNoStackOrUrl(listed.result.errors);
  assert.equal(listed.result.errors[0].message, UI);
  assert.equal(listed.result.errors[0].detail, 'RuntimeError');
});

test('a failing feature returns the viewport message, type, and label', async () => {
  const world = failingHost();
  const api = createSurfcadBridge({ resolve: () => world.host });
  const ran = await api.call('set_script', { part_id: 'p1', source: SCRIPT });
  assert.equal(ran.ok, true);
  assert.equal(ran.result.ok, false);
  assert.deepEqual(ran.result.errors, [UI]);
  assert.equal(ran.result.failures.length, 1);
  assertFeatureError(ran.result.failures[0]);
  assert.equal(ran.result.status.runState, 'failed');

  const listed = await api.call('errors', {});
  assert.equal(listed.result.errors.length, 1);
  assertFeatureError(listed.result.errors[0]);

  const inserted = await api.call('insert_cube', {});
  assert.equal(inserted.ok, true);
  assert.equal(inserted.result.ok, false);
  assert.equal(inserted.result.helperId, 'cube');
  assert.deepEqual(inserted.result.errors, [UI]);
  assertFeatureError(inserted.result.failures[0]);

  const toasts = await api.call('toasts', {});
  assert.equal(toasts.result.toasts.some((row) => row.id === 'execution-error' && row.message === UI), true);
});

test('the feature error stays until the next successful run, then clears', async () => {
  const world = failingHost();
  const api = createSurfcadBridge({ resolve: () => world.host });
  await api.call('run', {});
  assert.equal((await api.call('status', {})).result.runState, 'failed');
  assert.equal((await api.call('errors', {})).result.errors[0].message, UI);

  // Recovered-mesh status must not wipe the failure for this part.
  const switched = await api.call('set_active_part', { part_id: 'p1' });
  assert.equal(switched.ok, true);
  assert.equal((await api.call('status', {})).result.runState, 'failed');
  assert.equal((await api.call('errors', {})).result.errors[0].featureLabel, 'Hole');

  world.setMode('ok');
  const again = await api.call('run', {});
  assert.equal(again.result.ok, true);
  assert.deepEqual(again.result.errors, []);
  assert.deepEqual(again.result.failures, []);
  assert.equal(again.result.status.runState, 'ok');
  assert.deepEqual((await api.call('errors', {})).result.errors, []);
  assert.equal((await api.call('status', {})).result.runState, 'ok');
  assert.equal(world.popup(), null);
});

test('a partial failure is not reported as ok', async () => {
  const world = failingHost();
  world.setMode('partial');
  const api = createSurfcadBridge({ resolve: () => world.host });
  const ran = await api.call('run', {});
  assert.equal(ran.result.ok, false);
  assert.deepEqual(ran.result.errors, [UI]);
  assertFeatureError(ran.result.failures[0]);
  assert.equal(ran.result.status.runState, 'failed');
  assert.equal(ran.result.status.volume, null);
  assertFeatureError((await api.call('errors', {})).result.errors[0]);
});

test('undo of a good script clears a stale failure, and undo of a partial failure does not', async () => {
  const world = failingHost();
  const api = createSurfcadBridge({ resolve: () => world.host });
  await api.call('run', {});
  assert.equal((await api.call('errors', {})).result.errors[0].message, UI);

  world.setMode('ok');
  const undone = await api.call('undo', {});
  assert.equal(undone.result.ok, true);
  assert.deepEqual(undone.result.errors, []);
  assert.deepEqual((await api.call('errors', {})).result.errors, []);

  world.setMode('partial');
  const again = await api.call('undo', {});
  assert.equal(again.result.ok, false);
  assert.deepEqual(again.result.errors, [UI]);
  assertFeatureError((await api.call('errors', {})).result.errors[0]);
});

test('a successful run ignores a stale failure ref', async () => {
  const world = failingHost();
  const api = createSurfcadBridge({ resolve: () => world.host });
  await api.call('run', {});
  world.setMode('ok');
  const ran = await api.call('set_script', { part_id: 'p1', source: SCRIPT });
  assert.equal(ran.result.ok, true);
  assert.deepEqual((await api.call('errors', {})).result.errors, []);
  assert.equal((await api.call('status', {})).result.runState, 'ok');
});

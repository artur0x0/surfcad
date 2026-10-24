import assert from 'node:assert/strict';
import test from 'node:test';
import { v1Registry } from './index.js';
import { sketchEditOps } from './sketchEdit.js';

const edit = v1Registry.get('sketch_edit');
const editFeature = v1Registry.get('edit_feature');
const confirmFeature = v1Registry.get('confirm_feature');

/**
 * A host with one saved contour c1 (a 30 x 20 rectangle). open_feature on
 * contour:c1 opens the sketch; sketch handlers record what they were asked;
 * the commit rewrites the script.
 */
function host(overrides = {}) {
  const calls = [];
  let script = "const c1 = makeCrossSection(profileRectangle(30, 20, true)); // @contour id=c1\nreturn c1.extrude(5);\n";
  let sketch = null; // { contourId, tool, params, dims, cons }
  let session = null;
  return {
    calls,
    scriptNow: () => script,
    sketchOpen: () => sketch !== null,
    openFeature({ id }) {
      calls.push(`open:${id}`);
      if (id === 'contour:c1') {
        sketch = { contourId: 'c1', tool: 'rectangle', params: { width: 30, height: 20 }, dims: [], cons: [] };
        session = { id, kind: 'contour', index: 1, contourId: 'c1' };
        return { result: { id, kind: 'contour', index: 1, contourId: 'c1', sketchOpen: true } };
      }
      if (id === 'cube1') {
        session = { id, kind: 'cube', index: 0 };
        return { result: { id, kind: 'cube', index: 0 } };
      }
      return { error: { code: 'unknown_feature', message: `No feature ${id}` } };
    },
    readFeatureSession() {
      return {
        open: session !== null,
        id: session?.id ?? null,
        kind: session?.kind ?? null,
        index: session?.index ?? null,
        contourId: session?.contourId ?? null,
        sketchOpen: !!(session?.contourId && sketch),
        tool: sketch?.tool ?? null,
      };
    },
    sketchAdd({ tool, params }) {
      calls.push(`add:${tool}:${JSON.stringify(params)}`);
      if (!sketch) return { error: { code: 'no_sketch', message: 'Contour sketch is not open' } };
      sketch = { ...sketch, tool, params: { ...sketch.params, ...params } };
      return { result: { tool } };
    },
    prepareSketchDimension(args) {
      calls.push(`dim:${args.kind}:${args.edge ?? ''}:${args.value}`);
      if (!sketch) return { error: { code: 'no_sketch', message: 'Contour sketch is not open' } };
      if (args.edge === 'e9') return { error: { code: 'unknown_entity', message: 'No line e9' } };
      sketch.dims.push({ id: `d${sketch.dims.length}`, ...args });
      return { payload: { kind: 'dimension', args }, result: { id: `d${sketch.dims.length - 1}` } };
    },
    prepareSketchConstrain(args) {
      calls.push(`con:${args.kind}`);
      if (!sketch) return { error: { code: 'no_sketch', message: 'Contour sketch is not open' } };
      sketch.cons.push({ id: `c${sketch.cons.length}`, ...args });
      return { payload: { kind: 'constraint', args }, result: { id: `c${sketch.cons.length - 1}` } };
    },
    prepareContourMutate(payload) {
      calls.push(`mutate:${payload.kind}`);
      if (payload.kind === 'commit') {
        const p = sketch.params;
        const next = script.replace(/profileRectangle\([^)]*\)/, `profileRectangle(${p.width}, ${p.height}, true)`)
          .replace('// @contour id=c1', `// @contour id=c1 dims=${sketch.dims.length} cons=${sketch.cons.length}`);
        return { changed: next !== script, source: next, message: 'Edit contour', finish: { payload, fromSlot: false } };
      }
      return { changed: false };
    },
    async mutate(source) { calls.push('write'); script = source; return { ok: true, errors: [], status: { runState: 'ok' } }; },
    readStatus: () => ({ runState: 'ok' }),
    applyContourMutateExtras() {},
    finishSketchGesture() {},
    prepareSketchCommit() {
      calls.push('prepare-commit');
      if (!sketch) return { error: { code: 'no_sketch', message: 'Contour sketch is not open' } };
      return { payload: { kind: 'commit' } };
    },
    finishContourCommit() { calls.push('finish-commit'); sketch = null; },
    dismissFeatureConfirmSession() { session = null; },
    sketchCancel() { calls.push('cancel-sketch'); sketch = null; },
    cancelFeature() { calls.push('cancel-feature'); session = null; return { result: { cancelled: true } }; },
    sketchDeleteEntity({ id }) {
      calls.push(`delete:${id}`);
      if (id === 'zz') return { error: { code: 'unknown_entity', message: 'No entity zz' } };
      return { result: { removed: id } };
    },
    agentSketchUndo() { calls.push('undo'); return { ok: true, depth: 0 }; },
    listSketchEntities() {
      if (!sketch) return { error: { code: 'no_sketch', message: 'closed' } };
      return { result: { points: ['p0', 'p1', 'p2', 'p3'], lines: ['e0', 'e1', 'e2', 'e3'], arcs: [], dimensions: sketch.dims.map((d) => d.id), constraints: sketch.cons.map((c) => c.id) } };
    },
    editFeature({ params }) { return { result: { params } }; },
    ...overrides,
  };
}

test('sketch_edit checkArgs: a contour id and at least one well-formed op', () => {
  assert.match(edit.checkArgs({}).message, /needs contour_id/);
  assert.match(edit.checkArgs({ contour_id: 'c1' }).message, /at least one op/);
  assert.match(edit.checkArgs({ contour_id: 'c1', ops: [{ kind: 'length' }] }).message, /ops\[0\] needs op/);
  assert.equal(edit.checkArgs({ contour_id: 'c1', ops: [{ op: 'undo' }] }), null);
  assert.equal(edit.checkArgs({ id: 'contour:c1', params: { width: 44 } }), null);
  assert.deepEqual(sketchEditOps({ params: { width: 44 }, ops: [{ op: 'undo' }] }), [{ op: 'profile', width: 44 }, { op: 'undo' }]);
  assert.ok(edit.schema.properties.return, 'a mutating tool takes the return flag');
});

test('sketch_edit opens the contour, applies profile + dimension + constraint, saves and closes it, and reports the entities', async () => {
  const ctx = host();
  const out = await edit.run(ctx, {
    contour_id: 'c1',
    ops: [
      { op: 'profile', width: 44 },
      { op: 'dimension', kind: 'length', edge: 'e0', value: 44 },
      { op: 'constrain', kind: 'horizontal', picks: [{ kind: 'line', id: 'e0' }] },
    ],
  });
  assert.equal(out.error, undefined, JSON.stringify(out));
  assert.equal(out.result.ok, true);
  assert.equal(out.result.id, 'contour:c1');
  assert.equal(out.result.contourId, 'c1');
  assert.equal(out.result.sketchClosed, true);
  assert.equal(out.result.unchanged, false);
  assert.deepEqual(out.result.applied.map((a) => a.op), ['profile', 'dimension', 'constrain']);
  assert.deepEqual(out.result.applied[0].sketch, { tool: 'rectangle', params: { width: 44 } });
  assert.deepEqual(out.result.entities.dimensions, ['d0']);
  assert.deepEqual(out.result.entities.constraints, ['c0']);
  assert.match(ctx.scriptNow(), /profileRectangle\(44, 20, true\)/);
  assert.match(ctx.scriptNow(), /dims=1 cons=1/);
  assert.equal(ctx.sketchOpen(), false, 'no sketch left open');
  assert.equal(ctx.calls[0], 'open:contour:c1');
  assert.ok(ctx.calls.includes('prepare-commit') && ctx.calls.includes('write') && ctx.calls.includes('finish-commit'));
});

test('sketch_edit: params is shorthand for one profile op, and the chip id form is accepted', async () => {
  const ctx = host();
  const out = await edit.run(ctx, { id: 'contour:c1', params: { width: 50, height: 10 } });
  assert.equal(out.error, undefined, JSON.stringify(out));
  assert.match(ctx.scriptNow(), /profileRectangle\(50, 10, true\)/);
  assert.equal(ctx.sketchOpen(), false);
});

test('sketch_edit: a failing op names its index, closes the sketch without saving, writes nothing', async () => {
  const ctx = host();
  const before = ctx.scriptNow();
  const out = await edit.run(ctx, {
    contour_id: 'c1',
    ops: [{ op: 'profile', width: 44 }, { op: 'dimension', kind: 'length', edge: 'e9', value: 1 }],
  });
  assert.equal(out.error.code, 'unknown_entity');
  assert.equal(out.error.details.op, 1);
  assert.match(out.error.message, /ops\[1\] \(dimension\): No line e9/);
  assert.match(out.error.message, /closed without saving/);
  assert.equal(ctx.scriptNow(), before);
  assert.equal(ctx.sketchOpen(), false);
  assert.ok(ctx.calls.includes('cancel-sketch'));
  assert.ok(!ctx.calls.includes('write'));
});

test('sketch_edit: a bad profile op is bad_args with the hint and closes the sketch', async () => {
  const ctx = host();
  const out = await edit.run(ctx, { contour_id: 'c1', ops: [{ op: 'profile', distance: 5 }] });
  assert.equal(out.error.code, 'bad_args');
  assert.equal(out.error.details.op, 0);
  assert.match(out.error.message, /does not take distance/);
  assert.equal(ctx.sketchOpen(), false);
});

test('sketch_edit: a non-contour chip is not_a_contour and its card is closed; an unknown id is unknown_contour', async () => {
  const ctx = host();
  const cube = await edit.run(ctx, { id: 'cube1', ops: [{ op: 'undo' }] });
  assert.equal(cube.error.code, 'not_a_contour');
  assert.ok(ctx.calls.includes('cancel-feature'));
  const none = await edit.run(ctx, { contour_id: 'nope', ops: [{ op: 'undo' }] });
  assert.equal(none.error.code, 'unknown_contour');
  assert.equal(ctx.sketchOpen(), false);
});

test('sketch_edit delete and undo ops go through the sketch handlers', async () => {
  const ctx = host();
  const out = await edit.run(ctx, { contour_id: 'c1', ops: [{ op: 'delete', id: 'e3' }, { op: 'undo' }, { op: 'profile', width: 31 }] });
  assert.equal(out.error, undefined, JSON.stringify(out));
  assert.ok(ctx.calls.includes('delete:e3') && ctx.calls.includes('undo'));
  assert.equal(ctx.sketchOpen(), false);
});

test('edit_feature and confirm_feature on a reopened contour share the sketch_edit implementation', async () => {
  const ctx = host();
  ctx.openFeature({ id: 'contour:c1' });
  const patched = editFeature.run(ctx, { params: { width: 44, distance: 5 } });
  assert.equal(patched.error, undefined, JSON.stringify(patched));
  assert.deepEqual(patched.result.sketch, { tool: 'rectangle', params: { width: 44 } });
  assert.deepEqual(patched.result.ignored, ['distance']);
  assert.equal(patched.result.contourId, 'c1');
  const confirmed = await confirmFeature.run(ctx, {});
  assert.equal(confirmed.error, undefined, JSON.stringify(confirmed));
  assert.equal(confirmed.result.sketchClosed, true);
  assert.equal(confirmed.result.id, 'contour:c1');
  assert.match(ctx.scriptNow(), /profileRectangle\(44, 20, true\)/);
  assert.equal(ctx.sketchOpen(), false);
});

/**
 * `return` on the dispatcher: status | summary | full, and get_script range.
 * The bridge default is `full` (the UI and the goldens see no change); the
 * MCP server sends `status` unless the caller says otherwise.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSurfcadBridge } from './agentBridge.js';
import { emptyPartHistory } from './partHistory.js';

const HOLE = `// --- cube begin ---
let part = Manifold.cube([40, 30, 20], true);
// --- cube end ---
// --- hole begin ---
part = part.subtract(Manifold.cylinder(40, 6, 6, 48, true));
// --- hole end ---
return part;
`;

function world() {
  let buffer = '';
  let history = emptyPartHistory();
  const seen = [];
  const host = {
    getScript: () => buffer,
    setEditor(src) { buffer = src; },
    readHistory: () => history,
    writeHistory(next) { history = { commits: next.commits.slice(), head: next.head }; },
    async execute(src) {
      seen.push(src);
      return {
        ok: !src.includes('throw'),
        errors: src.includes('throw') ? ['boom'] : [],
        volume: 21738,
        bbox: { min: [-20, -15, -10], max: [20, 15, 10] },
        partName: 'Part (1)',
      };
    },
    readParts: () => ({ activeId: 'part-1', assemblyName: 'Asm', parts: [{ id: 'part-1', name: 'Part (1)', visible: true }] }),
  };
  return { host, buffer: () => buffer, seen };
}

async function call(api, name, args) {
  const env = await api.call(name, JSON.stringify(args ?? {}));
  assert.equal(env.v, 1);
  return env;
}

test('return: status drops status.script from a mutate result and keeps everything else', async () => {
  const w = world();
  const api = createSurfcadBridge(w.host);

  const full = await call(api, 'set_script', { part_id: 'part-1', source: HOLE });
  assert.equal(full.ok, true);
  assert.equal(full.result.status.script.includes('hole begin'), true, 'bridge default is full');

  const lean = await call(api, 'set_script', { part_id: 'part-1', source: HOLE, return: 'status' });
  assert.equal(lean.ok, true);
  assert.equal(lean.result.ok, true);
  assert.deepEqual(lean.result.errors, []);
  assert.equal(Object.prototype.hasOwnProperty.call(lean.result.status, 'script'), false);
  assert.equal(lean.result.status.partId, 'part-1');
  assert.equal(lean.result.status.runState, 'ok');
  assert.equal(lean.result.status.volume, 21738);
  assert.equal(lean.result.status.featureCount, 2);
  assert.deepEqual(lean.result.status.bbox, { min: [-20, -15, -10], max: [20, 15, 10] });
  // `return` never reached the command: the script written is the source as given.
  assert.equal(w.buffer().includes('return part;'), true);

  const explicitFull = await call(api, 'run', { return: 'full' });
  assert.equal(explicitFull.result.status.script, w.buffer());
});

test('return: summary lists the feature strip instead of the script', async () => {
  const w = world();
  const api = createSurfcadBridge(w.host);
  const out = await call(api, 'set_script', { part_id: 'part-1', source: HOLE, return: 'summary' });
  assert.equal(Object.prototype.hasOwnProperty.call(out.result.status, 'script'), false);
  assert.deepEqual(out.result.status.features.map((row) => `${row.kind}:${row.id}`), ['cube:cube-0', 'hole:hole-1']);
  assert.equal(out.result.status.features[0].label, 'Cube');
});

test('status, undo, and redo honour return; the cached status keeps the script', async () => {
  const w = world();
  const api = createSurfcadBridge(w.host);
  await call(api, 'set_script', { part_id: 'part-1', source: HOLE, return: 'status' });

  const status = await call(api, 'status', { return: 'status' });
  assert.equal(status.ok, true);
  assert.equal(Object.prototype.hasOwnProperty.call(status.result, 'script'), false);
  assert.equal(status.result.featureCount, 2);

  const again = await call(api, 'status', {});
  assert.equal(again.result.script, w.buffer(), 'the cache still holds the script');

  const summary = await call(api, 'status', { return: 'summary' });
  assert.equal(summary.result.features.length, 2);
});

test('a return value outside the enum is bad_args and runs nothing', async () => {
  const w = world();
  const api = createSurfcadBridge(w.host);
  const out = await call(api, 'set_script', { part_id: 'part-1', source: HOLE, return: 'tiny' });
  assert.equal(out.ok, false);
  assert.equal(out.error.code, 'bad_args');
  assert.match(out.error.message, /return must be one of/);
  assert.equal(w.seen.length, 0);
});

test('return on a command without status is stripped and ignored', async () => {
  const w = world();
  const api = createSurfcadBridge(w.host);
  await call(api, 'set_script', { part_id: 'part-1', source: HOLE });
  const out = await call(api, 'get_script', { return: 'status' });
  assert.equal(out.ok, true);
  assert.equal(out.result.source, w.buffer());
});

test('get_script range reads one span of feature blocks', async () => {
  const w = world();
  const api = createSurfcadBridge(w.host);
  await call(api, 'set_script', { part_id: 'part-1', source: HOLE });

  const whole = await call(api, 'get_script', {});
  assert.equal(whole.result.source, w.buffer());
  assert.equal(whole.result.range, undefined);

  const one = await call(api, 'get_script', { range: { fromFeature: 'hole-1' } });
  assert.equal(one.ok, true);
  assert.equal(one.result.source.startsWith('// --- hole begin ---'), true);
  assert.equal(one.result.source.includes('cube'), false);
  assert.equal(one.result.source.trimEnd().endsWith('// --- hole end ---'), true);
  assert.equal(one.result.range.fromFeature, 'hole-1');
  assert.equal(one.result.range.toFeature, 'hole-1');
  assert.equal(one.result.range.features, 1);
  assert.equal(w.buffer().slice(one.result.range.startOffset, one.result.range.endOffset), one.result.source);

  const upTo = await call(api, 'get_script', { range: { toFeature: 'cube-0' } });
  assert.equal(upTo.result.range.fromFeature, 'cube-0');
  assert.equal(upTo.result.source.includes('hole'), false);

  const span = await call(api, 'get_script', { range: { fromFeature: 'cube-0', toFeature: 'hole-1' } });
  assert.equal(span.result.range.features, 2);
  assert.equal(span.result.source.includes('return part;'), false, 'the trailing return is outside the blocks');

  const unknown = await call(api, 'get_script', { range: { fromFeature: 'fillet-9' } });
  assert.equal(unknown.ok, false);
  assert.equal(unknown.error.code, 'unknown_feature');

  const backwards = await call(api, 'get_script', { range: { fromFeature: 'hole-1', toFeature: 'cube-0' } });
  assert.equal(backwards.ok, false);
  assert.equal(backwards.error.code, 'bad_args');

  const badShape = await call(api, 'get_script', { range: 'hole-1' });
  assert.equal(badShape.ok, false);
  assert.equal(badShape.error.code, 'bad_args');
});

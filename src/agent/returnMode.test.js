import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  RETURN_ARG_SCHEMA,
  RETURN_NOTE,
  applyReturnMode,
  featureSummary,
  takeReturnMode,
  takesReturnArg,
  withReturnArg,
} from './returnMode.js';
import { v1Registry } from './commands/index.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const HOST_JSON = join(ROOT, 'src/agent/commands.json');

const HOLE = `// --- cube begin ---
let part = Manifold.cube([40, 30, 20], true);
// --- cube end ---
// --- hole begin ---
part = part.subtract(Manifold.cylinder(40, 6, 6, 48, true));
// --- hole end ---
return part;
`;

const STATUS = {
  partId: 'p1',
  partName: 'Part (1)',
  script: HOLE,
  runState: 'ok',
  volume: 21738,
  bbox: { min: [-20, -15, -10], max: [20, 15, 10] },
  featureCount: 2,
  bodyCount: 1,
};

test('takeReturnMode strips return and refuses an unknown mode', () => {
  assert.deepEqual(takeReturnMode({ part_id: 'p1' }), { args: { part_id: 'p1' }, mode: null });
  assert.deepEqual(takeReturnMode({ part_id: 'p1', return: 'summary' }), { args: { part_id: 'p1' }, mode: 'summary' });
  assert.deepEqual(takeReturnMode({ return: null }), { args: {}, mode: null });
  const bad = takeReturnMode({ return: 'tiny' });
  assert.equal(bad.error.code, 'bad_args');
  assert.match(bad.error.message, /status, summary, full/);
  assert.deepEqual(bad.args, {});
});

test('applyReturnMode drops the script and summary adds the strip', () => {
  const result = { ok: true, errors: [], status: STATUS };
  assert.equal(applyReturnMode('set_script', result, 'full'), result);
  assert.equal(applyReturnMode('set_script', result, null), result);

  const lean = applyReturnMode('set_script', result, 'status');
  assert.equal(Object.prototype.hasOwnProperty.call(lean.status, 'script'), false);
  assert.equal(lean.status.volume, 21738);
  assert.equal(lean.status.featureCount, 2);
  assert.equal(lean.ok, true);
  // The input is not mutated: the bridge keeps the full status in its cache.
  assert.equal(result.status.script, HOLE);

  const summary = applyReturnMode('insert_hole', result, 'summary');
  assert.equal(Object.prototype.hasOwnProperty.call(summary.status, 'script'), false);
  assert.deepEqual(summary.status.features.map((row) => [row.id, row.kind, row.index]), [
    ['cube-0', 'cube', 0],
    ['hole-1', 'hole', 1],
  ]);

  // `status` is the status object itself.
  const status = applyReturnMode('status', STATUS, 'status');
  assert.equal(Object.prototype.hasOwnProperty.call(status, 'script'), false);
  assert.equal(status.partId, 'p1');

  // Results without a status object are untouched.
  const faces = { faces: [] };
  assert.equal(applyReturnMode('list_faces', faces, 'status'), faces);
  assert.equal(applyReturnMode('errors', undefined, 'status'), undefined);
});

test('featureSummary matches feature_tree ids', () => {
  assert.deepEqual(featureSummary(HOLE)[1], { id: 'hole-1', kind: 'hole', label: 'Hole', chipLabel: 'Hole', index: 1 });
  assert.deepEqual(featureSummary(''), []);
});

test('withReturnArg adds the property once and leaves other commands alone', () => {
  const cmd = Object.freeze({ name: 'set_script', schema: { type: 'object', additionalProperties: false, properties: { source: { type: 'string' } } }, example: {}, run() {} });
  const wrapped = withReturnArg(cmd);
  assert.equal(wrapped.schema.properties.return, RETURN_ARG_SCHEMA);
  assert.equal(wrapped.schema.properties.source.type, 'string');
  assert.equal(wrapped.schema.additionalProperties, false);
  assert.equal(withReturnArg(wrapped), wrapped);
  const reader = Object.freeze({ name: 'list_faces', schema: { type: 'object', additionalProperties: false, properties: {} }, example: {}, run() {} });
  assert.equal(withReturnArg(reader), reader);
});

test('every command whose result carries status takes return, in the registry and in commands.json', () => {
  const host = JSON.parse(readFileSync(HOST_JSON, 'utf8'));
  let withArg = 0;
  for (const row of host.commands) {
    const expected = row.mutates === true || row.name === 'status';
    assert.equal(takesReturnArg(row.name), expected, row.name);
    const hasArg = Object.prototype.hasOwnProperty.call(row.args.properties, 'return');
    assert.equal(hasArg, expected, `${row.name} return arg`);
    assert.equal(row.description.endsWith(RETURN_NOTE), expected, `${row.name} description`);
    const live = v1Registry.get(row.name);
    assert.equal(Object.prototype.hasOwnProperty.call(live.schema.properties, 'return'), expected, `${row.name} registry`);
    if (expected) {
      assert.deepEqual(row.args.properties.return.enum, ['status', 'summary', 'full']);
      withArg += 1;
    }
  }
  assert.ok(withArg >= 70, `${withArg} commands take return`);
  for (const name of ['set_script', 'run', 'undo', 'redo', 'status', 'insert_cube', 'confirm_feature', 'git_save']) {
    assert.equal(takesReturnArg(name), true, name);
  }
  for (const name of ['get_script', 'errors', 'list_faces', 'list_commands', 'feature_tree', 'parts']) {
    assert.equal(takesReturnArg(name), false, name);
  }
});

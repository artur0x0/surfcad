/**
 * list_faces / list_edges / list_feature_edges filters and pages, and
 * list_commands names / group, through the dispatcher with a mocked host.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSurfcadBridge } from './agentBridge.js';
import { COMMAND_GROUP_NAMES } from '../agent/export/commandGroups.js';

const FACES = [
  { id: 'f0', type: 'planar', kind: 'planar', key: { at: [0, 0, 10], n: [0, 0, 1], area: 1200 }, center: [0, 0, 10], normal: [0, 0, 1], area: 1200, triangleCount: 2 },
  { id: 'f1', type: 'planar', kind: 'planar', key: { at: [0, 0, -10], n: [0, 0, -1], area: 1200 }, center: [0, 0, -10], normal: [0, 0, -1], area: 1200, triangleCount: 2 },
  { id: 'f2', type: 'planar', kind: 'planar', key: { at: [20, 0, 0], n: [1, 0, 0], area: 600 }, center: [20, 0, 0], normal: [1, 0, 0], area: 600, triangleCount: 2 },
  { id: 'f3', type: 'cylindrical', kind: 'cylindrical', key: { at: [0, 0, 5], n: [1, 0, 0], area: 250 }, center: [0, 0, 5], normal: [1, 0, 0], area: 250, triangleCount: 48, axis: { at: [0, 0, 5], dir: [0, 0, 1], radius: 4 }, radius: 4 },
];
const RAW_EDGES = [
  { key: '1-2', mid: [20, 0, 10], length: 30, faceKeyA: FACES[2].key, faceKeyB: FACES[0].key },
  { key: '2-3', mid: [20, 0, -10], length: 30, faceKeyA: FACES[2].key, faceKeyB: FACES[1].key },
  { key: '7-8', mid: [0, 0, 10], length: 1.2, faceKeyA: FACES[3].key, faceKeyB: FACES[0].key },
];
const GROUPED = [
  { key: 'e0', mid: [20, 0, 10], length: 30, faceKeyA: FACES[2].key, faceKeyB: FACES[0].key },
  { key: 'e1', mid: [0, 0, 10], length: 25.13, faceKeyA: FACES[3].key, faceKeyB: FACES[0].key },
];

function host() {
  const calls = [];
  return {
    calls,
    getScript: () => '',
    readParts: () => ({ activeId: 'p1', assemblyName: 'A', parts: [{ id: 'p1', name: 'Part', visible: true }] }),
    listFaces: ({ partId }) => { calls.push(['faces', partId]); return { partId: partId || 'p1', faces: FACES }; },
    listEdges: ({ partId }) => { calls.push(['edges', partId]); return { partId: partId || 'p1', raw: true, edges: RAW_EDGES }; },
    listFeatureEdges: ({ partId }) => { calls.push(['grouped', partId]); return { partId: partId || 'p1', grouped: true, edges: GROUPED }; },
  };
}

async function call(api, name, args) {
  const env = await api.call(name, JSON.stringify(args ?? {}));
  assert.equal(env.v, 1);
  return env;
}

test('list_faces without filter or page returns the first page with a total', async () => {
  const api = createSurfcadBridge(host());
  const out = await call(api, 'list_faces', {});
  assert.equal(out.ok, true);
  assert.equal(out.result.partId, 'p1');
  assert.deepEqual(out.result.faces, FACES);
  assert.equal(out.result.total, 4);
  assert.equal(out.result.returned, 4);
  assert.equal(out.result.frame, 'local');
  assert.equal(out.result.offset, 0);
  assert.equal(out.result.limit, 100);
  assert.equal('nextOffset' in out.result, false);
  assert.equal('filter' in out.result, false);
  const keys = Object.keys(out.result);
  assert.ok(keys.indexOf('total') < keys.indexOf('faces'));
});

test('list_faces filter keeps matching rows and page slices them', async () => {
  const h = host();
  const api = createSurfcadBridge(h);
  const tops = await call(api, 'list_faces', { part_id: 'p9', filter: { kind: 'planar', normalWithin: { n: [0, 0, 1], deg: 5 } } });
  assert.equal(tops.ok, true);
  assert.deepEqual(tops.result.faces.map((r) => r.id), ['f0']);
  assert.equal(tops.result.total, 1);
  assert.equal(tops.result.partId, 'p9');
  assert.deepEqual(tops.result.filter, { kind: 'planar', normalWithin: { n: [0, 0, 1], deg: 5 } });
  assert.deepEqual(h.calls.at(-1), ['faces', 'p9'], 'the host still builds the whole list once');

  const page = await call(api, 'list_faces', { filter: { kind: 'planar' }, page: { offset: 1, limit: 1 } });
  assert.deepEqual(page.result.faces.map((r) => r.id), ['f1']);
  assert.equal(page.result.total, 3);
  assert.equal(page.result.returned, 1);
  assert.equal(page.result.offset, 1);
  assert.equal(page.result.limit, 1);

  const bores = await call(api, 'list_faces', { filter: { kind: 'cylindrical', minArea: 100 } });
  assert.deepEqual(bores.result.faces.map((r) => r.id), ['f3']);
});

test('a bad filter or page is bad_args and never reaches the host', async () => {
  const h = host();
  const api = createSurfcadBridge(h);
  const kind = await call(api, 'list_faces', { filter: { kind: 'round' } });
  assert.equal(kind.ok, false);
  assert.equal(kind.error.code, 'bad_args');
  assert.match(kind.error.message, /filter\.kind/);
  const page = await call(api, 'list_faces', { page: { limit: 0 } });
  assert.equal(page.error.code, 'bad_args');
  const unknown = await call(api, 'list_faces', { filter: { colour: 'red' } });
  assert.match(unknown.error.message, /not a face filter/);
  const edge = await call(api, 'list_feature_edges', { filter: { between: ['f0', 'f2'] } });
  assert.equal(edge.error.code, 'bad_args');
  assert.deepEqual(h.calls, []);
});

test('list_edges and list_feature_edges filter by between and length, raw and grouped', async () => {
  const api = createSurfcadBridge(host());
  const raw = await call(api, 'list_edges', { filter: { between: [FACES[0].key, FACES[2].key] } });
  assert.equal(raw.ok, true);
  assert.equal(raw.result.raw, true);
  assert.equal(raw.result.frame, 'local');
  assert.deepEqual(raw.result.edges.map((r) => r.key), ['1-2']);
  assert.equal(raw.result.total, 1);

  const long = await call(api, 'list_edges', { filter: { minLength: 10 }, page: { limit: 1 } });
  assert.deepEqual(long.result.edges.map((r) => r.key), ['1-2']);
  assert.equal(long.result.total, 2);
  assert.equal(long.result.returned, 1);

  const grouped = await call(api, 'list_edges', { grouped: true, filter: { minLength: 26 } });
  assert.equal(grouped.result.grouped, true);
  assert.deepEqual(grouped.result.edges.map((r) => r.key), ['e0']);

  const feature = await call(api, 'list_feature_edges', { filter: { between: [FACES[3].key, FACES[0].key] } });
  assert.equal(feature.result.frame, 'local');
  assert.deepEqual(feature.result.edges.map((r) => r.key), ['e1']);
  assert.equal(feature.result.total, 1);

  const all = await call(api, 'list_feature_edges', {});
  assert.deepEqual(all.result.edges, GROUPED);
  assert.equal(all.result.total, 2);
  assert.equal(all.result.returned, 2);
});

test('list_commands group and names return only those rows, with group on every row', async () => {
  const api = createSurfcadBridge(host());
  const all = await call(api, 'list_commands', {});
  assert.equal(all.ok, true);
  assert.equal(all.result.commands.length, all.result.total);
  assert.ok(all.result.total > 150);
  for (const row of all.result.commands) assert.ok(COMMAND_GROUP_NAMES.includes(row.group), `${row.name} group`);
  assert.equal(Object.values(all.result.groups).reduce((a, b) => a + b, 0), all.result.total);

  const git = await call(api, 'list_commands', { group: 'git' });
  assert.equal(git.result.group, 'git');
  assert.ok(git.result.commands.length >= 8);
  assert.ok(git.result.commands.every((row) => row.name.startsWith('git_') && row.group === 'git'));
  assert.equal(git.result.total, all.result.total);
  assert.equal(git.result.commands.length, all.result.groups.git);

  const explicit = await call(api, 'list_commands', { group: 'all' });
  assert.equal(explicit.result.commands.length, all.result.total);
  assert.equal('group' in explicit.result, false);

  const names = await call(api, 'list_commands', { names: ['insert_hole', 'set_script', 'no_such_tool'] });
  assert.deepEqual(names.result.commands.map((row) => row.name), ['set_script', 'insert_hole'], 'catalog order');
  assert.deepEqual(names.result.missing, ['no_such_tool']);
  assert.equal(names.result.commands[1].schema.type, 'object');
  assert.equal(typeof names.result.commands[1].example, 'object');

  const both = await call(api, 'list_commands', { names: ['insert_hole', 'git_save'], group: 'insert' });
  assert.deepEqual(both.result.commands.map((row) => row.name), ['insert_hole']);

  const bad = await call(api, 'list_commands', { group: 'misc' });
  assert.equal(bad.ok, false);
  assert.equal(bad.error.code, 'bad_args');
  const badNames = await call(api, 'list_commands', { names: 'git_save' });
  assert.equal(badNames.error.code, 'bad_args');
});

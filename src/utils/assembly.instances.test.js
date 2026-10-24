/**
 * Part instances (docs/vault-schema.md, Instances): a row with `instanceOf`
 * is one placement of another row's definition. Scripts and runs are keyed
 * by the definition; the row keeps its own id, pose, visibility and name.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  composeViewportParts,
  definitionStillReferenced,
  feedRows,
  isDefaultBlankAssembly,
  parseAssemblyDocument,
  partDefinitionId,
  preserveHiddenPartRuns,
  scriptForRow,
  serializeAssembly,
} from './assembly.js';
import { mintSurfId } from './git/surfId.js';

const ROLLER = mintSurfId({ now: new Date('2026-10-24T19:00:00.004Z'), rand: 'r001' });
const ROLLER_2 = mintSurfId({ now: new Date('2026-10-24T19:05:00.011Z'), rand: 'r0b2' });
const ROLLER_3 = mintSurfId({ now: new Date('2026-10-24T19:05:00.012Z'), rand: 'r0c3' });
const FRAME = mintSurfId({ now: new Date('2026-10-24T19:00:00.002Z'), rand: 'f001' });

const MESH = { numProp: 3, vertProperties: [0, 0, 0, 1, 0, 0, 0, 1, 0], triVerts: [0, 1, 2] };

function trainer() {
  return {
    version: 1,
    source: 'git',
    name: 'Trainer',
    activeId: ROLLER_2,
    parts: [
      { id: FRAME, name: 'Frame', visible: true, order: 0 },
      { id: ROLLER, name: 'Roller', visible: true, order: 1, position: [-60, 0, 120] },
      { id: ROLLER_2, instanceOf: ROLLER, name: 'Roller (2)', visible: true, order: 2, position: [0, 0, 120] },
      { id: ROLLER_3, instanceOf: ROLLER, name: 'Roller (3)', visible: false, order: 3, position: [60, 0, 120] },
    ],
  };
}

test('partDefinitionId: instanceOf wins, else the row id; a self reference is ignored', () => {
  assert.equal(partDefinitionId({ id: ROLLER_2, instanceOf: ROLLER }), ROLLER);
  assert.equal(partDefinitionId({ id: ROLLER }), ROLLER);
  assert.equal(partDefinitionId({ id: ROLLER, instanceOf: ROLLER }), ROLLER);
  assert.equal(partDefinitionId({ id: ROLLER, instanceOf: '' }), ROLLER);
  assert.equal(partDefinitionId(null), '');
});

test('serialize keeps instanceOf on instance rows and drops a self reference', () => {
  const doc = serializeAssembly({
    ...trainer(),
    parts: [...trainer().parts, { id: FRAME + 'x', instanceOf: FRAME + 'x', name: 'Self', visible: true, order: 4 }],
  });
  const byId = new Map(doc.parts.map((row) => [row.id, row]));
  assert.equal(byId.get(ROLLER_2).instanceOf, ROLLER);
  assert.equal(byId.get(ROLLER_3).instanceOf, ROLLER);
  assert.equal('instanceOf' in byId.get(ROLLER), false);
  assert.equal('instanceOf' in byId.get(FRAME + 'x'), false);
  assert.equal(doc.activeId, ROLLER_2, 'an instance row can be the active row');
});

test('parse → serialize round trip preserves instanceOf and every row id', () => {
  const text = JSON.stringify(serializeAssembly(trainer()));
  const again = parseAssemblyDocument(text);
  assert.deepEqual(
    again.parts.map((row) => [row.id, row.instanceOf ?? null, row.name]),
    [[FRAME, null, 'Frame'], [ROLLER, null, 'Roller'], [ROLLER_2, ROLLER, 'Roller (2)'], [ROLLER_3, ROLLER, 'Roller (3)']],
  );
});

test('definitionStillReferenced counts the primary and every instance', () => {
  const { parts } = trainer();
  assert.equal(definitionStillReferenced(parts, ROLLER), true);
  assert.equal(definitionStillReferenced(parts, ROLLER, ROLLER), true, 'instances keep the definition alive');
  assert.equal(definitionStillReferenced(parts, FRAME, FRAME), false, 'the only row of a definition');
  const twoLeft = parts.filter((row) => row.id !== ROLLER);
  assert.equal(definitionStillReferenced(twoLeft, ROLLER, ROLLER_2), true);
  assert.equal(definitionStillReferenced([twoLeft[0], twoLeft[1]], ROLLER, ROLLER_2), false);
  assert.equal(definitionStillReferenced(parts, ''), false);
});

test('scriptForRow loads the definition script for an instance row', () => {
  const doc = serializeAssembly(trainer());
  const scripts = { [FRAME]: 'frame', [ROLLER]: 'roller' };
  const hit = scriptForRow(doc, scripts, ROLLER_2);
  assert.equal(hit.ok, true);
  assert.equal(hit.script, 'roller');
  assert.equal(hit.part.id, ROLLER_2);
  const miss = scriptForRow(doc, { [FRAME]: 'frame' }, ROLLER_3);
  assert.equal(miss.ok, false);
  assert.equal(miss.reason, 'missing');
});

test('feedRows: one row per placement, script and mesh from the definition', () => {
  const doc = serializeAssembly(trainer());
  const scripts = { [FRAME]: 'frame', [ROLLER]: 'roller' };
  const runs = { [ROLLER]: { ok: true, mesh: MESH, error: null } };
  const rows = feedRows(doc, runs, scripts);
  assert.equal(rows.length, 4);
  const byId = new Map(rows.map((row) => [row.id, row]));
  assert.equal(byId.get(ROLLER_2).missing, false);
  assert.equal(byId.get(ROLLER_2).mesh, MESH);
  assert.equal(byId.get(ROLLER_2).instanceOf, ROLLER);
  assert.equal(byId.get(ROLLER_2).definitionId, ROLLER);
  assert.equal(byId.get(ROLLER).instanceOf, null);
  assert.equal(byId.get(ROLLER).definitionId, ROLLER);
  assert.equal(byId.get(FRAME).mesh, null, 'no run for the frame yet');
});

test('composeViewportParts draws every visible instance from one run, each at its own pose', () => {
  const doc = serializeAssembly(trainer());
  const runs = { [ROLLER]: { ok: true, mesh: MESH, error: null } };
  const solids = composeViewportParts(doc, runs);
  assert.deepEqual(solids.map((s) => s.id), [ROLLER, ROLLER_2], 'hidden Roller (3) is skipped; no frame run');
  assert.equal(solids[0].mesh, solids[1].mesh, 'instances share the definition mesh object');
  assert.deepEqual(solids[0].position, [-60, 0, 120]);
  assert.deepEqual(solids[1].position, [0, 0, 120]);
  assert.equal(solids[1].definitionId, ROLLER);
  assert.equal(solids[1].surfId, ROLLER_2, 'joints and paint name the placement');
});

test('a definition with no primary row still composes and resolves', () => {
  const base = trainer();
  const doc = serializeAssembly({ ...base, parts: base.parts.filter((row) => row.id !== ROLLER) });
  const runs = { [ROLLER]: { ok: true, mesh: MESH, error: null } };
  assert.deepEqual(composeViewportParts(doc, runs).map((s) => s.id), [ROLLER_2]);
  assert.equal(scriptForRow(doc, { [ROLLER]: 'roller' }, ROLLER_3).script, 'roller');
  assert.equal(definitionStillReferenced(doc.parts, ROLLER, ROLLER_2), true);
});

test('preserveHiddenPartRuns keeps a hidden instance\'s definition mesh under the definition key', () => {
  const doc = serializeAssembly(trainer());
  const prev = { [ROLLER]: { ok: true, mesh: MESH, error: null, bodyCount: 1 } };
  const next = preserveHiddenPartRuns(doc, {}, prev);
  assert.equal(next[ROLLER].mesh, MESH);
  assert.equal(next[ROLLER_3], undefined, 'nothing is stored under the row id');
  const live = preserveHiddenPartRuns(doc, { [ROLLER]: { ok: true, mesh: { ...MESH }, error: null } }, prev);
  assert.notEqual(live[ROLLER].mesh, MESH, 'a current run wins');
});

test('isDefaultBlankAssembly reads the definition script of a lone instance row', () => {
  const doc = { version: 1, source: 'local', name: 'Assembly', activeId: ROLLER_2,
    parts: [{ id: ROLLER_2, instanceOf: ROLLER, name: 'Part (1)', visible: true, order: 0 }] };
  assert.equal(isDefaultBlankAssembly(doc, { [ROLLER]: 'return Manifold.cube([1,1,1]);' }), false);
  assert.equal(isDefaultBlankAssembly(doc, { [ROLLER]: '' }), true);
});

/**
 * Part instances (docs/vault-schema.md, Instances): a row with `instanceOf`
 * is one placement of another row's definition. Scripts and runs are keyed
 * by the definition; the row keeps its own id, pose, visibility and name.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  composeViewportParts,
  definitionRows,
  definitionStillReferenced,
  fanOutInstanceRuns,
  feedRows,
  isDefaultBlankAssembly,
  normalizeInstanceScripts,
  parseAssemblyDocument,
  partDefinitionId,
  partSheetMetal,
  preserveHiddenPartRuns,
  scriptForRow,
  serializeAssembly,
  setPartSheetMetal,
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

// ---- runtime slice: row-keyed maps kept consistent with the definition ----

const DEF = '2026-10-24-19-00-00-0004-r001';
const I2 = '2026-10-24-19-05-00-0011-r0b2';
const I3 = '2026-10-24-19-05-00-0012-r0c3';
const OTHER = '2026-10-24-19-00-00-0002-f001';

function runtimeDoc(overrides = {}) {
  return {
    version: 1,
    source: 'local',
    name: 'Trainer',
    activeId: I2,
    parts: [
      { id: OTHER, name: 'Frame', visible: true, order: 0 },
      { id: DEF, name: 'Roller', visible: true, order: 1 },
      { id: I2, instanceOf: DEF, name: 'Roller (2)', visible: true, order: 2, position: [40, 0, 0] },
      { id: I3, instanceOf: DEF, name: 'Roller (3)', visible: false, order: 3 },
    ],
    ...overrides,
  };
}

const tagMesh = (tag) => ({ numProp: 3, vertProperties: [tag, 0, 0, 1, 0, 0, 0, 1, 0], triVerts: [0, 1, 2] });
const run = (tag) => ({ ok: true, mesh: tagMesh(tag), error: null });


test('definitionRows and definitionStillReferenced follow every row of the definition', () => {
  const d = runtimeDoc();
  assert.deepEqual(definitionRows(d.parts, DEF).map((row) => row.id), [DEF, I2, I3]);
  assert.deepEqual(definitionRows(d.parts, OTHER).map((row) => row.id), [OTHER]);
  assert.equal(definitionStillReferenced(d.parts, DEF, I2), true);
  assert.equal(definitionStillReferenced(d.parts, OTHER, OTHER), false);
  // Primary gone, two instances left: the definition stays.
  const noPrimary = d.parts.filter((row) => row.id !== DEF);
  assert.equal(definitionStillReferenced(noPrimary, DEF, I2), true);
  assert.equal(definitionStillReferenced(noPrimary, DEF, null), true);
  assert.equal(definitionStillReferenced([noPrimary[0], noPrimary[1]], DEF, I2), false);
});


test('feedRows and composeViewportParts carry the definition next to the row', () => {
  const d = serializeAssembly(runtimeDoc());
  const scripts = { [OTHER]: 'f', [DEF]: 'r', [I2]: 'r', [I3]: 'r' };
  const rows = feedRows(d, {}, scripts);
  assert.deepEqual(rows.map((row) => row.instanceOf), [null, null, DEF, DEF]);
  const runs = { [OTHER]: run(1), [DEF]: run(2), [I2]: run(2), [I3]: run(2) };
  const solids = composeViewportParts(d, runs);
  // Hidden Roller (3) is not drawn; the two drawn rollers name the definition.
  assert.deepEqual(solids.map((solid) => [solid.id, solid.definitionId]), [
    [OTHER, OTHER], [DEF, DEF], [I2, DEF],
  ]);
  assert.deepEqual(solids[2].position, [40, 0, 0]);
});

test('normalizeInstanceScripts: the active row wins, else the primary, else the first with text', () => {
  const d = runtimeDoc();
  const base = { [OTHER]: 'frame', [DEF]: 'old', [I2]: 'edited', [I3]: 'stale' };
  const active = normalizeInstanceScripts(base, d);
  assert.deepEqual(active, { [OTHER]: 'frame', [DEF]: 'edited', [I2]: 'edited', [I3]: 'edited' });
  const primaryWins = normalizeInstanceScripts(base, { ...d, activeId: OTHER });
  assert.deepEqual(primaryWins, { [OTHER]: 'frame', [DEF]: 'old', [I2]: 'old', [I3]: 'old' });
  const noPrimary = normalizeInstanceScripts(
    { [OTHER]: 'frame', [I3]: 'third', [I2]: 'second' },
    { ...d, activeId: OTHER, parts: d.parts.filter((row) => row.id !== DEF) },
  );
  // The definition key is filled too, for the definition-keyed readers.
  assert.deepEqual(noPrimary, { [OTHER]: 'frame', [I2]: 'second', [I3]: 'second', [DEF]: 'second' });
  // Already consistent: the same object comes back.
  const same = { [OTHER]: 'frame', [DEF]: 'r', [I2]: 'r', [I3]: 'r' };
  assert.equal(normalizeInstanceScripts(same, d), same);
  assert.equal(normalizeInstanceScripts(same, null), same);
});

test('fanOutInstanceRuns: the row that just ran wins and every row shares its run object', () => {
  const d = runtimeDoc();
  const runs = { [OTHER]: run(1), [DEF]: run(2), [I2]: run(3) };
  const out = fanOutInstanceRuns(runs, d, I2);
  assert.equal(out[DEF], runs[I2]);
  assert.equal(out[I3], runs[I2]);
  assert.equal(out[OTHER], runs[OTHER]);
  assert.notEqual(out, runs);
  // Without a preferred row the active row's run wins.
  const byActive = fanOutInstanceRuns(runs, d);
  assert.equal(byActive[DEF], runs[I2]);
  // Active row absent from the group: the first run with a mesh is shared.
  const failed = { [OTHER]: run(1), [DEF]: { ok: false, mesh: null, error: 'x' }, [I3]: run(5) };
  const picked = fanOutInstanceRuns(failed, { ...d, activeId: OTHER });
  assert.equal(picked[DEF], failed[I3]);
  assert.equal(picked[I2], failed[I3]);
  // A failure on the active row flags every row.
  const broke = { [OTHER]: run(1), [DEF]: run(2), [I2]: { ok: false, mesh: null, error: 'boom' } };
  const flagged = fanOutInstanceRuns(broke, d, I2);
  assert.equal(flagged[DEF].ok, false);
  assert.equal(flagged[I3].ok, false);
  // Already shared: same object back.
  const shared = fanOutInstanceRuns(out, d, I2);
  assert.equal(shared, out);
  // A hidden active row that was skipped hands nothing on, and a kept copy
  // without volume loses to a fresh pool run on a visible sibling.
  const hiddenActive = { ...d, activeId: I3 };
  const skipped = { [OTHER]: run(1), [DEF]: { ...run(7), volume: 343 }, [I2]: { ...run(7), volume: 343 }, [I3]: { ok: false, mesh: null, skipped: true, error: null } };
  const kept = fanOutInstanceRuns(skipped, hiddenActive, I3);
  assert.equal(kept[I3], skipped[DEF]);
  assert.equal(kept[DEF].volume, 343);
  const copyOnly = { [OTHER]: run(1), [DEF]: { ...run(8), volume: 512 }, [I2]: { ...run(8), volume: 512 }, [I3]: { ok: true, mesh: tagMesh(9), error: null } };
  const chosen = fanOutInstanceRuns(copyOnly, hiddenActive);
  assert.equal(chosen[I3], copyOnly[DEF]);
});

test('sheet-metal binding is read from the definition and written to every row of it', () => {
  const bound = setPartSheetMetal(serializeAssembly(runtimeDoc()), I2, { sku: 'AL-5052-0.063', name: 'Aluminum' });
  for (const id of [DEF, I2, I3]) {
    assert.equal(partSheetMetal(bound, id)?.sku, 'AL-5052-0.063', id);
  }
  assert.equal(partSheetMetal(bound, OTHER), null);
  // A legacy document with the binding on the primary only still answers for an instance.
  const legacy = serializeAssembly(runtimeDoc({
    parts: runtimeDoc().parts.map((row) => (row.id === DEF ? { ...row, sheetMetal: { sku: 'ST-1008-0.060' } } : row)),
  }));
  assert.equal(partSheetMetal(legacy, I3)?.sku, 'ST-1008-0.060');
  const cleared = setPartSheetMetal(bound, DEF, null);
  assert.equal(partSheetMetal(cleared, I2), null);
});

test('fan-out also fills the definition key when the primary row is gone, for the definition-keyed readers', () => {
  const lone = { ...runtimeDoc(), activeId: I2, parts: runtimeDoc().parts.filter((row) => row.id !== DEF) };
  const scripts = normalizeInstanceScripts({ [OTHER]: 'frame', [I2]: 'roller', [I3]: 'roller' }, lone);
  assert.equal(scripts[DEF], 'roller');
  assert.equal(scriptForRow(serializeAssembly(lone), scripts, I3).script, 'roller');
  const runs = fanOutInstanceRuns({ [OTHER]: run(1), [I2]: run(4) }, lone, I2);
  assert.equal(runs[DEF], runs[I2]);
  assert.equal(runs[I3], runs[I2]);
  assert.deepEqual(composeViewportParts(serializeAssembly(lone), runs).map((s) => s.id), [OTHER, I2]);
});

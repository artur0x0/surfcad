/**
 * Reader side of part instances (docs/vault-schema.md, Instances): a v2
 * assembly whose rows carry `instanceOf` opens with one script per
 * definition, every row kept, and the browse list naming the part once.
 * Mock adapter only; no git write.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMockGithubAdapter } from '../src/utils/git/mockGithubAdapter.js';
import { assemblyIdPath, partIdPath, partMeshIdPath } from '../src/utils/git/idPaths.js';
import { listV2BrowseItems, openV2Assembly } from '../src/utils/git/v2VaultRead.js';
import { composeViewportParts, feedRows, partDefinitionId } from '../src/utils/assembly.js';

const TRAINER = '2026-10-24-19-00-00-0001-a001';
const FRAME = '2026-10-24-19-00-00-0002-f001';
const ROLLER = '2026-10-24-19-00-00-0004-0e01';
const ROLLER_2 = '2026-10-24-19-05-00-0011-00b2';
const ROLLER_3 = '2026-10-24-19-05-00-0012-00c3';
const MARKER = JSON.stringify({ kind: 'surfcad-vault', version: 2 });

function trainerJson({ withPrimary = true } = {}) {
  const parts = [
    { id: FRAME, name: 'Frame', visible: true, order: 0 },
    ...(withPrimary ? [{ id: ROLLER, name: 'Roller', visible: true, order: 1, position: [-60, 0, 120] }] : []),
    { id: ROLLER_2, instanceOf: ROLLER, name: 'Roller (2)', visible: true, order: 2, position: [0, 0, 120] },
    { id: ROLLER_3, instanceOf: ROLLER, name: 'Roller (3)', visible: false, order: 3, position: [60, 0, 120] },
  ];
  return `${JSON.stringify({
    format: 'surfcad.assembly', version: 2, id: TRAINER, name: 'Trainer', activeId: ROLLER_2, parts,
    colors: { [ROLLER_2]: { part: '#e11d48' } },
  }, null, 2)}\n`;
}

function seed(gh, files) {
  const repo = gh._seedRepo({ name: 'surfcad-vault', files: { 'surfcad.json': MARKER, ...files } });
  return { owner: repo.owner, name: repo.name };
}

const ROLLER_SCRIPT = `// @surf-id ${ROLLER}\n// @name Roller\nreturn Manifold.cylinder(40, 15, 15, 64);\n`;
const FRAME_SCRIPT = `// @surf-id ${FRAME}\n// @name Frame\nreturn Manifold.cube([10, 10, 10], true);\n`;

test('openV2Assembly loads one script per definition and keeps every instance row', async () => {
  const gh = createMockGithubAdapter();
  const reads = [];
  const repo = seed(gh, {
    [assemblyIdPath(TRAINER)]: trainerJson(),
    [partIdPath(FRAME)]: FRAME_SCRIPT,
    [partIdPath(ROLLER)]: ROLLER_SCRIPT,
    [partMeshIdPath(ROLLER)]: new Uint8Array([77, 69, 83, 72, 1, 0, 0, 0]),
  });
  const spy = new Proxy(gh, {
    get(target, key) {
      if (key !== 'readFile') return target[key];
      return (...args) => { reads.push(args[1]); return target.readFile(...args); };
    },
  });
  const opened = await openV2Assembly(spy, repo, TRAINER);
  assert.deepEqual(Object.keys(opened.scripts).sort(), [FRAME, ROLLER].sort(), 'scripts are keyed by definition');
  assert.equal(reads.filter((path) => path === partIdPath(ROLLER)).length, 1, 'the shared script is read once');
  assert.equal(opened.doc.parts.length, 4);
  const byId = new Map(opened.doc.parts.map((row) => [row.id, row]));
  assert.equal(byId.get(ROLLER_2).instanceOf, ROLLER);
  assert.equal(byId.get(ROLLER_2).missing, undefined);
  assert.equal(byId.get(ROLLER_3).visible, false);
  assert.equal(byId.get(ROLLER_2).surfId, ROLLER_2, 'paint stays on the placement');
  assert.deepEqual(Object.keys(opened.doc.colors), [ROLLER_2]);
  assert.equal(opened.doc.activeId, ROLLER_2);
  assert.equal(Object.keys(opened.assets).length, 1, 'one mesh sidecar for three roller rows');
  const rows = feedRows(opened.doc, {}, opened.scripts);
  assert.deepEqual(rows.map((row) => [row.id, row.missing, row.instanceOf ?? null]), [
    [FRAME, false, null], [ROLLER, false, null], [ROLLER_2, false, ROLLER], [ROLLER_3, false, ROLLER],
  ]);
  const mesh = { numProp: 3, vertProperties: [0, 0, 0, 1, 0, 0, 0, 1, 0], triVerts: [0, 1, 2] };
  const solids = composeViewportParts(opened.doc, { [ROLLER]: { ok: true, mesh, error: null } });
  assert.deepEqual(solids.map((s) => [s.id, s.position]), [[ROLLER, [-60, 0, 120]], [ROLLER_2, [0, 0, 120]]]);
});

test('openV2Assembly: a definition with no primary row still opens; a missing definition marks every instance missing', async () => {
  const gh = createMockGithubAdapter();
  const repo = seed(gh, {
    [assemblyIdPath(TRAINER)]: trainerJson({ withPrimary: false }),
    [partIdPath(FRAME)]: FRAME_SCRIPT,
    [partIdPath(ROLLER)]: ROLLER_SCRIPT,
  });
  const opened = await openV2Assembly(gh, repo, TRAINER);
  assert.deepEqual(Object.keys(opened.scripts).sort(), [FRAME, ROLLER].sort());
  assert.equal(opened.doc.parts.every((row) => row.missing !== true), true);
  assert.equal(partDefinitionId(opened.doc.parts.find((row) => row.id === ROLLER_3)), ROLLER);

  const gone = createMockGithubAdapter();
  const repo2 = seed(gone, {
    [assemblyIdPath(TRAINER)]: trainerJson(),
    [partIdPath(FRAME)]: FRAME_SCRIPT,
  });
  const missing = await openV2Assembly(gone, repo2, TRAINER);
  assert.deepEqual(
    missing.doc.parts.filter((row) => row.missing === true).map((row) => row.id).sort(),
    [ROLLER, ROLLER_2, ROLLER_3].sort(),
  );
  assert.deepEqual(Object.keys(missing.scripts), [FRAME]);
});

test('listV2BrowseItems names the part once, from its primary row, with instance labels ignored', async () => {
  const gh = createMockGithubAdapter();
  const repo = seed(gh, {
    [assemblyIdPath(TRAINER)]: trainerJson(),
    [partIdPath(FRAME)]: FRAME_SCRIPT,
    [partIdPath(ROLLER)]: ROLLER_SCRIPT,
  });
  const items = await listV2BrowseItems(gh, repo, 'main');
  const roller = items.parts.find((item) => item.id === ROLLER);
  assert.equal(roller.name, 'Roller', 'Roller (2) and Roller (3) are placement labels, not part names');
  assert.deepEqual(roller.assemblies, [{ id: TRAINER, name: 'Trainer' }]);
  const trainer = items.assemblies.find((item) => item.id === TRAINER);
  assert.deepEqual([...new Set(trainer.partIds)].sort(), [FRAME, ROLLER].sort());
  assert.equal(items.parts.some((item) => item.id === ROLLER_2), false, 'an instance row is not a part file');
});

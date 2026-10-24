/**
 * IndexedDB / working-copy identity collapse: UUID and path-as-id → surf-id.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mintSurfId, isSurfId, readSurfId, withSurfId } from '../src/utils/git/surfId.js';
import { assemblyRekeyKey, collapseWorkingCopyIds, dualWriteTargets, mergeLiveEdits, persistCollapsedWorkingCopy, PersistCrash, pickCollapsedPartId, remapFeaForPersist, replaceScriptKeys, reusePairsFromJournal } from '../src/utils/git/wcIdentity.js';
import { rewriteFeaStudyPartIds } from '../src/utils/git/feaStudyIds.js';
import { serializeAssembly, parseAssemblyDocument, composeViewportParts } from '../src/utils/assembly.js';
import { partSurfId, readSurfName, withSurfName } from '../src/utils/git/surfId.js';
import { normalizeAssemblyJoints } from '../src/utils/jointSchema.js';
import { seedAssemblyHistory } from '../src/joints/jointUi.js';
import { captureBaseline } from '../src/utils/git/gitBaseline.js';
import { isPartDirty, isWorkspaceDirty } from '../src/utils/git/gitWorkspace.js';
import { buildCommitFiles } from '../src/utils/git/gitCommit.js';
import { partListSubtitles } from '../src/utils/git/partListSubtitle.js';

const UUID = '5f0c3c1e-0000-4000-8000-000000000001';
const PATH = 'assemblies/Gearbox/Bracket.js';
const SURF = mintSurfId({ now: new Date('2026-10-18T00:00:00.000Z'), rand: 'a3f9' });
const NOW = new Date('2026-10-18T12:00:00.000Z');
const MINTED = mintSurfId({ now: NOW, rand: 'b10c' });
const ASM = mintSurfId({ now: NOW, rand: 'aa01' });

test('header wins over UUID row id and drops surfId', () => {
  const doc = {
    source: 'local',
    name: 'Assembly',
    activeId: UUID,
    parts: [{
      id: UUID,
      surfId: SURF,
      name: 'Bracket',
      visible: true,
      order: 0,
    }],
  };
  const scripts = { [UUID]: withSurfId('return 1;\n', SURF) };
  const out = collapseWorkingCopyIds(doc, scripts, { now: NOW, randFor: () => 'dead' });
  assert.equal(out.doc.parts[0].id, SURF);
  assert.equal(out.doc.parts[0].surfId, undefined);
  assert.equal(out.doc.activeId, SURF);
  assert.equal(out.scripts[SURF], scripts[UUID]);
  assert.equal(Object.hasOwn(out.scripts, UUID), false);
  assert.equal(readSurfId(out.scripts[SURF]), SURF);
  assert.equal(out.changed, true);
});

test('path-as-id collapses to the @surf-id header', () => {
  const picked = pickCollapsedPartId(
    { id: PATH, path: PATH, name: 'Bracket' },
    withSurfId('return 1;\n', SURF),
  );
  assert.equal(picked.id, SURF);
  assert.equal(picked.minted, false);

  const out = collapseWorkingCopyIds(
    {
      source: 'git',
      name: 'Gearbox',
      activeId: PATH,
      parts: [{ id: PATH, path: PATH, name: 'Bracket', visible: true, order: 0 }],
    },
    { [PATH]: withSurfId('return 1;\n', SURF) },
    { now: NOW, randFor: () => 'dead' },
  );
  assert.equal(out.doc.parts[0].id, SURF);
  assert.equal(out.doc.parts[0].path, PATH);
  assert.equal(out.doc.activeId, SURF);
  assert.equal(out.scripts[SURF].startsWith(`// @surf-id ${SURF}`), true);
  assert.equal(Object.hasOwn(out.scripts, PATH), false);
});

test('UUID-only row mints once and is stable with the same clock', () => {
  const doc = {
    source: 'local',
    name: 'Assembly',
    activeId: UUID,
    parts: [{ id: UUID, name: 'Part', visible: true, order: 0 }],
  };
  const scripts = { [UUID]: 'return Manifold.cube([1, 1, 1], true);\n' };
  const randFor = (part) => (part?.id === '$assembly' ? 'aa01' : 'b10c');
  const first = collapseWorkingCopyIds(doc, scripts, { now: NOW, randFor });
  const second = collapseWorkingCopyIds(doc, scripts, { now: NOW, randFor });
  assert.equal(first.doc.parts[0].id, MINTED);
  assert.deepEqual(second.doc.parts.map((part) => part.id), first.doc.parts.map((part) => part.id));
  assert.equal(first.doc.id, ASM);
  assert.equal(second.doc.id, ASM);
  assert.equal(readSurfId(first.scripts[MINTED]), null, 'must not stamp @surf-id on load');
  assert.equal(first.scripts[MINTED], scripts[UUID]);
});

test('already-collapsed docs are a no-op besides keeping the assembly id', () => {
  const doc = {
    id: ASM,
    source: 'local',
    name: 'Assembly',
    activeId: SURF,
    parts: [{ id: SURF, name: 'Bracket', visible: true, order: 0 }],
  };
  const scripts = { [SURF]: withSurfId('return 1;\n', SURF) };
  const out = collapseWorkingCopyIds(doc, scripts);
  assert.equal(out.changed, false);
  assert.equal(out.doc.parts[0], doc.parts[0]);
  assert.equal(out.doc.id, ASM);
});

test('serializeAssembly keeps assembly id, vaultLayout, and missing rows', () => {
  const doc = serializeAssembly({
    id: ASM,
    source: 'git',
    name: 'Gearbox',
    vaultLayout: 'legacy',
    activeId: SURF,
    parts: [{
      id: SURF,
      path: PATH,
      name: 'Bracket',
      visible: true,
      order: 0,
      missing: true,
    }],
  });
  assert.equal(doc.id, ASM);
  assert.equal(doc.vaultLayout, 'legacy');
  assert.equal(doc.parts[0].missing, true);
  const round = parseAssemblyDocument(JSON.stringify(doc));
  assert.equal(round.id, ASM);
  assert.equal(round.vaultLayout, 'legacy');
  assert.equal(round.parts[0].missing, true);
});

test('isSurfId rejects UUID and path so collapse never keeps them', () => {
  assert.equal(isSurfId(UUID), false);
  assert.equal(isSurfId(PATH), false);
  assert.equal(isSurfId(SURF), true);
  assert.equal(partSurfId({ id: UUID, surfId: SURF }), SURF);
  assert.equal(partSurfId({ id: SURF }), SURF);
  assert.equal(partSurfId({ id: UUID }), null);
});

test('composeViewportParts paints with the collapsed part id', () => {
  const out = collapseWorkingCopyIds(
    {
      source: 'git',
      name: 'agent-h13',
      activeId: 'local:part1',
      parts: [{
        id: 'local:part1',
        surfId: SURF,
        name: 'Part (1)',
        visible: true,
        order: 0,
      }],
    },
    { 'local:part1': withSurfId('return Manifold.cube([20, 20, 20], true);\n', SURF) },
  );
  assert.equal(out.doc.parts[0].id, SURF);
  assert.equal(out.doc.parts[0].surfId, undefined);
  const mesh = { vertProperties: new Float32Array(9), triVerts: new Uint32Array(3) };
  const solids = composeViewportParts(out.doc, { [SURF]: { ok: true, mesh } });
  assert.equal(solids.length, 1);
  assert.equal(solids[0].id, SURF);
  assert.equal(solids[0].surfId, SURF);
});

test('group partIds and colors follow the collapsed part id', () => {
  const groupId = mintSurfId({ now: NOW, rand: 'cc01' });
  const out = collapseWorkingCopyIds(
    {
      source: 'local',
      name: 'Assembly',
      activeId: UUID,
      parts: [{ id: UUID, name: 'Bracket', visible: true, order: 0 }],
      groups: [{ id: groupId, name: 'Hardware', source: null, partIds: [UUID] }],
      colors: { [UUID]: { part: '#ff0000' } },
    },
    { [UUID]: withSurfId('return 1;\n', SURF) },
    { now: NOW, randFor: () => 'dead' },
  );
  assert.equal(out.doc.parts[0].id, SURF);
  assert.deepEqual(out.doc.groups[0].partIds, [SURF]);
  assert.equal(out.doc.groups[0].id, groupId);
  assert.deepEqual(out.doc.colors[SURF], { part: '#ff0000' });
  assert.equal(Object.hasOwn(out.doc.colors, UUID), false);
});

test('duplicate @surf-id headers keep the first and mint the other with copiedFrom', () => {
  const uuid2 = '5f0c3c1e-0000-4000-8000-000000000002';
  const script = withSurfId('return 1;\n', SURF);
  const out = collapseWorkingCopyIds(
    {
      source: 'local',
      name: 'Assembly',
      activeId: UUID,
      parts: [
        { id: UUID, name: 'Bracket', visible: true, order: 0 },
        { id: uuid2, name: 'Bracket copy', visible: true, order: 1 },
      ],
    },
    { [UUID]: script, [uuid2]: script },
    { now: NOW, randFor: (part) => (part?.id === '$assembly' ? 'aa01' : 'b10c') },
  );
  assert.equal(out.doc.parts[0].id, SURF);
  assert.equal(out.doc.parts[0].copiedFrom, undefined);
  assert.equal(out.doc.parts[1].id, MINTED);
  assert.equal(out.doc.parts[1].copiedFrom, SURF);
  assert.equal(out.scripts[SURF], script);
  assert.equal(readSurfId(out.scripts[MINTED]), MINTED);
  assert.equal(out.scripts[MINTED].includes('return 1'), true);
  assert.equal(Object.hasOwn(out.scripts, UUID), false);
  assert.equal(Object.hasOwn(out.scripts, uuid2), false);
});

test('a header that points at another row\'s id mints and sets copiedFrom', () => {
  const uuid2 = '5f0c3c1e-0000-4000-8000-000000000002';
  const out = collapseWorkingCopyIds(
    {
      source: 'local',
      name: 'Assembly',
      parts: [
        { id: SURF, name: 'Original', visible: true, order: 0 },
        { id: uuid2, name: 'Pasted', visible: true, order: 1 },
      ],
    },
    {
      [SURF]: withSurfId('return 1;\n', SURF),
      [uuid2]: withSurfId('return 2;\n', SURF),
    },
    { now: NOW, randFor: (part) => (part?.id === '$assembly' ? 'aa01' : 'b10c') },
  );
  assert.equal(out.doc.parts[0].id, SURF);
  assert.equal(out.doc.parts[1].id, MINTED);
  assert.equal(out.doc.parts[1].copiedFrom, SURF);
  assert.equal(readSurfId(out.scripts[SURF]), SURF);
  assert.equal(out.scripts[MINTED].includes('return 2'), true);
});

test('paint and joints still resolve after collapse drops surfId', () => {
  const other = mintSurfId({ now: NOW, rand: 'c0de' });
  const jointId = mintSurfId({ now: NOW, rand: 'j01a' });
  const out = collapseWorkingCopyIds(
    {
      source: 'git',
      name: 'agent-h13',
      activeId: 'local:part1',
      parts: [
        {
          id: 'local:part1',
          surfId: SURF,
          name: 'Part (1)',
          visible: true,
          order: 0,
          placement: { t: [0, 0, 0], q: [0, 0, 0, 1] },
        },
        {
          id: 'local:part2',
          surfId: other,
          name: 'Part (2)',
          visible: true,
          order: 1,
          placement: { t: [0, 0, 5], q: [0, 0, 0, 1] },
        },
      ],
      joints: [{
        id: jointId,
        name: 'Fixed 1',
        type: 'fixed',
        a: { part: SURF },
      }],
      colors: { [SURF]: { part: '#ff0000' } },
    },
    {
      'local:part1': withSurfId('return Manifold.cube([20, 20, 20], true);\n', SURF),
      'local:part2': withSurfId('return Manifold.cube([10, 10, 10], true);\n', other),
    },
  );
  assert.equal(out.doc.parts[0].surfId, undefined);
  assert.equal(out.doc.parts[0].id, SURF);
  const joints = normalizeAssemblyJoints(out.doc.joints, out.doc.parts);
  assert.equal(joints?.[0]?.a?.part, SURF);
  const hist = seedAssemblyHistory(out.doc);
  assert.ok(hist.commits[0].placements[SURF]);
  const mesh = { vertProperties: new Float32Array(9), triVerts: new Uint32Array(3) };
  const solids = composeViewportParts(out.doc, { [SURF]: { ok: true, mesh } });
  assert.equal(solids[0].surfId, SURF);
  assert.equal(partSurfId(out.doc.parts[0]), SURF);
});

test('Cover vs Gearbox mint distinct assembly ids when rand collides', () => {
  const randFor = () => '0001';
  const gearbox = collapseWorkingCopyIds(
    { source: 'git', name: 'Gearbox', parts: [] },
    {},
    { now: NOW, randFor },
  );
  const cover = collapseWorkingCopyIds(
    { source: 'git', name: 'Cover', parts: [] },
    {},
    { now: NOW, randFor, usedAssemblyIds: [gearbox.doc.id] },
  );
  assert.equal(gearbox.doc.id, mintSurfId({ now: NOW, rand: '0001' }));
  assert.notEqual(cover.doc.id, gearbox.doc.id);
  assert.equal(isSurfId(cover.doc.id), true);
});

test('replaceScriptKeys writes new keys before deleting old ones', async () => {
  const store = new Map([[UUID, 'old']]);
  const order = [];
  await replaceScriptKeys({
    nextScripts: { [SURF]: 'new' },
    staleIds: [UUID, SURF],
    save: async (id, script) => {
      order.push(['save', id]);
      store.set(id, script);
    },
    remove: async (id) => {
      order.push(['delete', id]);
      store.delete(id);
    },
  });
  assert.deepEqual(order[0], ['save', SURF]);
  assert.ok(order.findIndex((step) => step[0] === 'delete') > 0);
  assert.equal(store.get(SURF), 'new');
  assert.equal(store.has(UUID), false);
});

function collapseTwice(doc, scripts, opts = {}) {
  const first = collapseWorkingCopyIds(doc, scripts, { now: NOW, randFor: () => 'b10c', ...opts });
  const later = new Date('2026-10-21T00:00:00.000Z');
  const pathIndex = Object.fromEntries((first.cached || []).map((hit) => [hit.path, hit.id]));
  const second = collapseWorkingCopyIds(first.doc, first.scripts, {
    ...opts,
    now: later,
    randFor: () => 'ffff',
    pathIndex,
  });
  assert.deepEqual(
    second.doc.parts.map((part) => part.id),
    first.doc.parts.map((part) => part.id),
    'ids must stay stable across a second collapse',
  );
  assert.equal(second.changed, false);
  return { first, second };
}

test('2a: colliding header keeps a free surf-id row id and is stable on reload', () => {
  const copyId = mintSurfId({ now: NOW, rand: 'c0c0' });
  const doc = {
    id: ASM,
    source: 'local',
    name: 'Assembly',
    activeId: SURF,
    parts: [
      { id: SURF, name: 'Original', visible: true, order: 0 },
      { id: copyId, name: 'Copy', visible: true, order: 1 },
    ],
  };
  const scripts = {
    [SURF]: withSurfId('return original;\n', SURF),
    [copyId]: withSurfId('return copy;\n', SURF),
  };
  const { first } = collapseTwice(doc, scripts);
  assert.equal(first.doc.parts[0].id, SURF);
  assert.equal(first.doc.parts[1].id, copyId);
  assert.equal(first.scripts[SURF].includes('return original'), true);
  assert.equal(first.scripts[copyId].includes('return copy'), true);
});

test('2a: UUID copy with colliding header mints once and is stable on reload', () => {
  const uuid2 = '5f0c3c1e-0000-4000-8000-000000000002';
  const doc = {
    id: ASM,
    source: 'local',
    name: 'Assembly',
    activeId: UUID,
    parts: [
      { id: UUID, name: 'Original', visible: true, order: 0 },
      { id: uuid2, name: 'Copy', visible: true, order: 1 },
    ],
  };
  const scripts = {
    [UUID]: withSurfId('return original;\n', SURF),
    [uuid2]: withSurfId('return copy;\n', SURF),
  };
  const { first, second } = collapseTwice(doc, scripts, {
    randFor: (part) => (part?.id === '$assembly' ? 'aa01' : 'b10c'),
  });
  assert.equal(first.doc.parts[0].id, SURF);
  assert.equal(first.doc.parts[1].id, MINTED);
  assert.equal(first.doc.parts[1].copiedFrom, SURF);
  assert.equal(second.changed, false);
  assert.deepEqual(second.doc.parts.map((part) => part.id), [SURF, MINTED]);
});

test('2b: header matching another row id never overwrites that row\'s script', () => {
  const uuidY = '5f0c3c1e-0000-4000-8000-00000000000a';
  const doc = {
    id: ASM,
    source: 'local',
    name: 'Assembly',
    activeId: SURF,
    parts: [
      { id: uuidY, name: 'Y', visible: true, order: 0 },
      { id: SURF, name: 'Original', visible: true, order: 1 },
    ],
    colors: { [SURF]: { part: '#ff0000' } },
  };
  const scripts = {
    [uuidY]: withSurfId('return Y;\n', SURF),
    [SURF]: withSurfId('return original;\n', SURF),
  };
  const { first } = collapseTwice(doc, scripts, {
    randFor: (part) => (part?.id === '$assembly' ? 'aa01' : 'b10c'),
  });
  assert.equal(first.doc.parts[1].id, SURF);
  assert.notEqual(first.doc.parts[0].id, SURF);
  assert.equal(first.scripts[SURF].includes('return original'), true);
  assert.equal(first.scripts[SURF].includes('return Y'), false);
  assert.equal(first.scripts[first.doc.parts[0].id].includes('return Y'), true);
  assert.deepEqual(first.doc.colors[SURF], { part: '#ff0000' });
});

test('2c: duplicate row id keeps the first script, colors, and groups', () => {
  const groupId = mintSurfId({ now: NOW, rand: 'cc02' });
  const doc = {
    id: ASM,
    source: 'local',
    name: 'Assembly',
    activeId: SURF,
    parts: [
      { id: SURF, name: 'First', visible: true, order: 0 },
      { id: SURF, name: 'Copy', visible: true, order: 1 },
    ],
    groups: [{ id: groupId, name: 'Hardware', source: null, partIds: [SURF] }],
    colors: { [SURF]: { part: '#00ff00' } },
  };
  const scripts = { [SURF]: withSurfId('return first;\n', SURF) };
  const { first } = collapseTwice(doc, scripts, {
    randFor: (part) => (part?.id === '$assembly' ? 'aa01' : 'b10c'),
  });
  assert.equal(first.doc.parts[0].id, SURF);
  assert.notEqual(first.doc.parts[1].id, SURF);
  assert.equal(first.doc.parts[1].copiedFrom, SURF);
  assert.equal(first.scripts[SURF].includes('return first'), true);
  assert.equal(typeof first.scripts[first.doc.parts[1].id], 'string');
  assert.deepEqual(first.doc.colors[SURF], { part: '#00ff00' });
  assert.equal(Object.hasOwn(first.doc.colors, first.doc.parts[1].id), false);
  assert.deepEqual(first.doc.groups[0].partIds, [SURF]);
});

test('2d: two UUID rows sharing surfId S keep S on the original', () => {
  const uuid2 = '5f0c3c1e-0000-4000-8000-00000000000d';
  const groupId = mintSurfId({ now: NOW, rand: 'cc03' });
  const doc = {
    id: ASM,
    source: 'local',
    name: 'Assembly',
    activeId: UUID,
    parts: [
      { id: UUID, surfId: SURF, name: 'Original', visible: true, order: 0 },
      { id: uuid2, surfId: SURF, name: 'Copy', visible: true, order: 1 },
    ],
    groups: [{ id: groupId, name: 'Hardware', source: null, partIds: [SURF] }],
    colors: { [SURF]: { part: '#0000ff' } },
  };
  const scripts = {
    [UUID]: withSurfId('return orig;\n', SURF),
    [uuid2]: withSurfId('return copy;\n', SURF),
  };
  const { first } = collapseTwice(doc, scripts, {
    randFor: (part) => (part?.id === '$assembly' ? 'aa01' : 'b10c'),
  });
  assert.equal(first.doc.parts[0].id, SURF);
  assert.notEqual(first.doc.parts[1].id, SURF);
  assert.equal(first.doc.parts[1].copiedFrom, SURF);
  assert.equal(first.scripts[SURF].includes('return orig'), true);
  assert.equal(first.scripts[first.doc.parts[1].id].includes('return copy'), true);
  assert.deepEqual(first.doc.colors[SURF], { part: '#0000ff' });
  assert.equal(Object.hasOwn(first.doc.colors, first.doc.parts[1].id), false);
  assert.deepEqual(first.doc.groups[0].partIds, [SURF]);
});

test('pathIndex reuses a minted id on the next collapse', () => {
  const path = 'parts/MissingGear.js';
  const first = collapseWorkingCopyIds(
    {
      source: 'git',
      name: 'Gearbox',
      parts: [{ id: path, path, name: 'Missing gear', visible: true, order: 0, missing: true }],
    },
    {},
    { now: NOW, randFor: () => 'b10c' },
  );
  assert.equal(first.doc.parts[0].id, MINTED);
  assert.equal(first.doc.parts[0].missing, true);
  const pathIndex = Object.fromEntries(first.cached.map((hit) => [hit.path, hit.id]));
  const second = collapseWorkingCopyIds(
    {
      source: 'git',
      name: 'Gearbox',
      parts: [{ id: path, path, name: 'Missing gear', visible: true, order: 0, missing: true }],
    },
    {},
    { now: new Date('2026-10-19T00:00:00.000Z'), randFor: () => 'zzzz', pathIndex },
  );
  assert.equal(second.doc.parts[0].id, MINTED);
  assert.equal(second.minted, 0);
});

function studyBlock(study) {
  return `// --- fea-study begin ---\n// @fea-study ${JSON.stringify(study)}\n// --- fea-study end ---\n`;
}

function readStudy(script) {
  const tag = '// @fea-study ';
  const line = String(script || '').split('\n').find((row) => row.startsWith(tag));
  assert.ok(line, 'missing @fea-study line');
  return JSON.parse(line.slice(tag.length));
}

function multiPartStudy(idA, idB) {
  const face = (part, faceID) => ({
    faceID,
    at: [0, 0, 0],
    n: [0, 0, 1],
    area: 10,
    part,
  });
  return {
    v: 1,
    id: 's1',
    name: 'Static 1',
    type: 'linear-static',
    material: { id: 'al-6061-t6' },
    fixtures: [{ kind: 'fixed', faces: [face(idA, 1)] }],
    loads: [{ kind: 'force', faces: [face(idB, 2)], vector: [0, 0, -1] }],
    scope: { kind: 'parts', ids: [idA, idB] },
    parts: [{ id: idA, material: { id: 'al-6061-t6' } }, { id: idB, material: { id: 'al-6061-t6' } }],
    contacts: [{
      kind: 'bonded',
      a: { part: idA, faceID: 1 },
      b: { part: idB, faceID: 2 },
    }],
    result: null,
  };
}

test('FEA study face.part, contacts, scope.ids, and body ids follow collapse', () => {
  const uuid2 = '5f0c3c1e-0000-4000-8000-0000000000fe';
  const study = multiPartStudy(UUID, uuid2);
  const source = `// keep ${UUID} in a comment\nreturn 1;\n${studyBlock(study)}`;
  const { first, second } = collapseTwice(
    {
      id: ASM,
      source: 'git',
      name: 'Study',
      activeId: UUID,
      parts: [
        { id: UUID, name: 'Left', visible: true, order: 0 },
        { id: uuid2, name: 'Right', visible: true, order: 1 },
      ],
    },
    {
      [UUID]: source,
      [uuid2]: 'return 2;\n',
    },
    { randFor: (part) => (part?.id === '$assembly' ? 'aa01' : (part?.id === uuid2 ? 'c0de' : 'b10c')) },
  );
  const left = first.doc.parts[0].id;
  const right = first.doc.parts[1].id;
  assert.ok(isSurfId(left));
  assert.ok(isSurfId(right));
  assert.notEqual(left, UUID);
  assert.notEqual(right, uuid2);
  const rewritten = readStudy(first.scripts[left]);
  assert.equal(rewritten.fixtures[0].faces[0].part, left);
  assert.equal(rewritten.loads[0].faces[0].part, right);
  assert.deepEqual(rewritten.scope.ids, [left, right]);
  assert.equal(rewritten.contacts[0].a.part, left);
  assert.equal(rewritten.contacts[0].b.part, right);
  assert.equal(rewritten.parts[0].id, left);
  assert.equal(rewritten.parts[1].id, right);
  assert.equal(rewritten.id, 's1');
  assert.match(first.scripts[left], new RegExp(`keep ${UUID}`));
  assert.equal(second.changed, false);
  assert.equal(second.scripts[left], first.scripts[left]);
});

test('rewriteFeaStudyPartIds only touches known study fields', () => {
  const next = mintSurfId({ now: NOW, rand: 'd00d' });
  const map = new Map([[UUID, next]]);
  const study = multiPartStudy(UUID, UUID);
  const script = `const old = '${UUID}';\n${studyBlock(study)}`;
  const out = rewriteFeaStudyPartIds(script, map);
  assert.match(out, new RegExp(`const old = '${UUID}'`));
  const rewritten = readStudy(out);
  assert.equal(rewritten.fixtures[0].faces[0].part, next);
  assert.equal(rewritten.contacts[0].a.part, next);
  assert.equal(rewritten.scope.ids[0], next);
  assert.equal(rewritten.parts[0].id, next);
  assert.equal(rewriteFeaStudyPartIds(out, map), out);
});

test('IDB get failure leaves the old key and does not collapse the row', async () => {
  const store = new Map([[UUID, 'return keep-me;\n']]);
  const doc = {
    source: 'local',
    name: 'Assembly',
    activeId: UUID,
    parts: [{ id: UUID, name: 'Part', visible: true, order: 0 }],
  };
  const scripts = {};
  const collapsed = collapseWorkingCopyIds(doc, scripts, { now: NOW, randFor: () => 'b10c' });
  assert.equal(collapsed.doc.parts[0].id, UUID);
  assert.equal(collapsed.pairs.length, 0);
  const persisted = await persistCollapsedWorkingCopy({
    collapsed,
    sourceDoc: doc,
    sourceScripts: Object.fromEntries(store),
    save: async (id, script) => { store.set(id, script); return true; },
    remove: async (id) => { store.delete(id); },
  });
  assert.equal(persisted.doc.parts[0].id, UUID);
  assert.equal(store.get(UUID), 'return keep-me;\n');
  assert.equal(store.size, 1);
});

test('persist does not rewrite an unchanged key so a later edit is kept', async () => {
  const store = new Map([[SURF, 'return keep-me;\n']]);
  const doc = {
    source: 'local',
    name: 'Assembly',
    activeId: SURF,
    parts: [{ id: SURF, name: 'Part', visible: true, order: 0 }],
  };
  const scripts = { [SURF]: 'return keep-me;\n' };
  const collapsed = collapseWorkingCopyIds(doc, scripts, { now: NOW, randFor: () => 'b10c' });
  store.set(SURF, 'return edited;\n');
  const persisted = await persistCollapsedWorkingCopy({
    collapsed,
    sourceDoc: doc,
    sourceScripts: scripts,
    heldScripts: scripts,
    save: async (id, script) => { store.set(id, script); return true; },
    load: async (id) => store.get(id),
    remove: async (id) => { store.delete(id); },
  });
  assert.equal(store.get(SURF), 'return edited;\n');
  assert.equal(persisted.doc.parts[0].id, SURF);
});

test('vault open does not copy a stale path-key record over the tip', async () => {
  const pathKey = 'assemblies/A/Pin.js';
  const store = new Map([[pathKey, 'OLD path-key record']]);
  const doc = {
    source: 'git',
    name: 'A',
    activeId: SURF,
    parts: [{ id: SURF, path: pathKey, name: 'Pin', visible: true, order: 0, isSynced: true }],
  };
  await persistCollapsedWorkingCopy({
    collapsed: {
      doc,
      scripts: { [SURF]: 'tip pin' },
      pairs: [{ from: pathKey, to: SURF }],
    },
    sourceDoc: doc,
    sourceScripts: { [SURF]: 'tip pin' },
    save: async (id, script) => { store.set(id, script); return true; },
    load: async (id) => store.get(id),
    remove: async (id) => { store.delete(id); },
  });
  assert.equal(store.get(SURF), 'tip pin');
  assert.equal(store.has(pathKey), false);
});

test('vault open writes every tip script over a stale IDB edit', async () => {
  const baseId = mintSurfId({ now: NOW, rand: 'ba5e' });
  const pinTip = withSurfId('return pin-tip;\n', SURF);
  const pinStale = withSurfId('return pin-stale;\n', SURF);
  const baseTip = withSurfId('return base-tip;\n', baseId);
  const store = new Map([[SURF, pinStale]]);
  const synced = {};
  const remembered = {};
  const pinAssets = { 'parts/Pin.mesh': 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' };
  const tipScripts = { [SURF]: pinTip, [baseId]: baseTip };
  const doc = {
    source: 'git',
    name: 'Assembly',
    activeId: SURF,
    parts: [
      { id: SURF, path: 'parts/Pin.js', name: 'Pin', visible: true, order: 0, isSynced: true },
      { id: baseId, path: 'parts/Base.js', name: 'Base', visible: true, order: 1, isSynced: true },
    ],
  };
  await persistCollapsedWorkingCopy({
    collapsed: { doc, scripts: tipScripts, pairs: [] },
    sourceDoc: doc,
    sourceScripts: tipScripts,
    save: async (id, script) => {
      store.set(id, script);
      synced[id] = true;
      if (id === SURF) remembered[id] = pinAssets;
      return true;
    },
    load: async (id) => store.get(id),
    remove: async (id) => { store.delete(id); },
  });
  assert.equal(store.get(SURF), pinTip);
  assert.equal(store.get(baseId), baseTip);
  assert.equal(synced[SURF], true);
  assert.equal(synced[baseId], true);
  assert.deepEqual(remembered[SURF], pinAssets);
});

test('put that reports success without storing keeps the old key', async () => {
  const store = new Map([[UUID, 'return keep-me;\n']]);
  const doc = {
    source: 'local',
    name: 'Assembly',
    activeId: UUID,
    parts: [{ id: UUID, name: 'Part', visible: true, order: 0 }],
  };
  const scripts = { [UUID]: store.get(UUID) };
  const collapsed = collapseWorkingCopyIds(doc, scripts, { now: NOW, randFor: () => 'b10c' });
  const persisted = await persistCollapsedWorkingCopy({
    collapsed,
    sourceDoc: doc,
    sourceScripts: scripts,
    heldScripts: scripts,
    save: async () => true,
    load: async (id) => store.get(id),
    remove: async (id) => { store.delete(id); },
  });
  assert.equal(persisted.doc.parts[0].id, UUID);
  assert.equal(store.get(UUID), 'return keep-me;\n');
  assert.equal(store.has(collapsed.doc.parts[0].id), false);
});

test('IDB doc stays on old ids if persist is killed before writes', async () => {
  const store = new Map([[UUID, 'return unsaved;\n']]);
  let idbDoc = {
    source: 'local',
    name: 'Assembly',
    activeId: UUID,
    parts: [{ id: UUID, name: 'Part', visible: true, order: 0 }],
  };
  const scripts = { [UUID]: 'return unsaved;\n' };
  const collapsed = collapseWorkingCopyIds(idbDoc, scripts, { now: NOW, randFor: () => 'b10c' });
  assert.notEqual(collapsed.doc.parts[0].id, UUID);
  const persisted = await persistCollapsedWorkingCopy({
    collapsed,
    sourceDoc: idbDoc,
    sourceScripts: scripts,
    heldScripts: scripts,
    save: async () => { throw new Error('killed'); },
    load: async (id) => store.get(id),
    remove: async (id) => { store.delete(id); },
    saveDoc: async (doc) => { idbDoc = doc; return doc; },
  });
  assert.equal(persisted.doc.parts[0].id, UUID);
  assert.equal(idbDoc.parts[0].id, UUID);
  assert.equal(store.get(UUID), 'return unsaved;\n');
});

test('failed from read-back keeps the old key', async () => {
  const store = new Map([[UUID, 'return keep-me;\n']]);
  const doc = {
    source: 'local',
    name: 'Assembly',
    activeId: UUID,
    parts: [{ id: UUID, name: 'Part', visible: true, order: 0 }],
  };
  const scripts = { [UUID]: store.get(UUID) };
  const collapsed = collapseWorkingCopyIds(doc, scripts, { now: NOW, randFor: () => 'b10c' });
  const nextId = collapsed.doc.parts[0].id;
  await persistCollapsedWorkingCopy({
    collapsed,
    sourceDoc: doc,
    sourceScripts: scripts,
    heldScripts: scripts,
    save: async (id, script) => { store.set(id, script); return true; },
    load: async (id) => {
      if (id === UUID) throw new Error('read failed');
      return store.get(id);
    },
    remove: async (id) => { store.delete(id); },
  });
  assert.equal(store.get(UUID), 'return keep-me;\n');
  assert.equal(store.get(nextId), 'return keep-me;\n');
});

test('merge after a failed write keeps U1 and its in-memory script', async () => {
  const store = new Map([[UUID, 'return u1;\n']]);
  const doc = {
    source: 'local',
    name: 'Assembly',
    activeId: UUID,
    parts: [{ id: UUID, name: 'Part', visible: true, order: 0 }],
  };
  const scripts = { [UUID]: 'return u1;\n' };
  const collapsed = collapseWorkingCopyIds(doc, scripts, { now: NOW, randFor: () => 'b10c' });
  const nextId = collapsed.doc.parts[0].id;
  const persisted = await persistCollapsedWorkingCopy({
    collapsed,
    sourceDoc: doc,
    sourceScripts: scripts,
    heldScripts: scripts,
    save: async () => false,
    load: async (id) => store.get(id),
    remove: async (id) => { store.delete(id); },
  });
  assert.equal(persisted.doc.parts[0].id, UUID);
  const live = { [nextId]: 'return u1;\n' };
  const merged = mergeLiveEdits(live, persisted.scripts, collapsed.pairs, scripts, persisted.failedFrom);
  assert.equal(merged[UUID], 'return u1;\n');
  assert.equal(merged[nextId], undefined);
});

test('edit injected mid-persist lands under the new id and stays dirty', async () => {
  const store = new Map([[UUID, 'return keep-me;\n']]);
  const live = { [UUID]: 'return keep-me;\n' };
  const doc = {
    source: 'git',
    name: 'Assembly',
    activeId: UUID,
    parts: [{ id: UUID, path: 'parts/Pin.js', name: 'Pin', visible: true, order: 0 }],
  };
  const scripts = { [UUID]: 'return keep-me;\n' };
  const collapsed = collapseWorkingCopyIds(doc, scripts, { now: NOW, randFor: () => 'b10c' });
  const nextId = collapsed.doc.parts[0].id;
  assert.notEqual(nextId, UUID);
  const baseline = captureBaseline({
    assemblyPath: 'assemblies/Assembly/.surf.json',
    assemblyName: 'Assembly',
    doc: collapsed.doc,
    scripts: collapsed.scripts,
  });
  const persisted = await persistCollapsedWorkingCopy({
    collapsed,
    sourceDoc: doc,
    sourceScripts: scripts,
    heldScripts: scripts,
    save: async (id, script) => {
      if (id === nextId) {
        const edited = 'return keep-me;\n// mid-persist\n';
        live[UUID] = edited;
        store.set(UUID, edited);
      }
      store.set(id, script);
      return true;
    },
    load: async (id) => store.get(id),
    remove: async (id) => { store.delete(id); },
  });
  const merged = mergeLiveEdits(live, persisted.scripts, collapsed.pairs, scripts);
  assert.equal(merged[nextId].includes('mid-persist'), true);
  assert.equal(merged[UUID], undefined);
  assert.equal(store.get(nextId).includes('mid-persist'), true);
  assert.equal(store.has(UUID), false);
  assert.equal(isPartDirty(nextId, merged[nextId], baseline), true);
});

test('failed write reverts C by id after the first row is dropped', async () => {
  const uuidB = '5f0c3c1e-0000-4000-8000-0000000000b2';
  const uuidC = '5f0c3c1e-0000-4000-8000-0000000000c3';
  const store = new Map([
    [UUID, 'return a;\n'],
    [uuidB, 'return b;\n'],
    [uuidC, 'return c;\n'],
  ]);
  const sourceDoc = {
    source: 'local',
    name: 'Assembly',
    activeId: UUID,
    parts: [
      { id: UUID, name: 'A', visible: true, order: 0 },
      { id: uuidB, name: 'B', visible: true, order: 1 },
      { id: uuidC, name: 'C', visible: true, order: 2 },
    ],
  };
  const sourceScripts = {
    [UUID]: 'return a;\n',
    [uuidB]: 'return b;\n',
    [uuidC]: 'return c;\n',
  };
  const collapsedAll = collapseWorkingCopyIds(sourceDoc, sourceScripts, {
    now: NOW,
    randFor: (part) => {
      if (part?.id === '$assembly') return 'aa01';
      if (part?.id === UUID) return 'a00a';
      if (part?.id === uuidB) return 'b00b';
      return 'c00c';
    },
  });
  const idC = collapsedAll.doc.parts[2].id;
  const dropped = {
    ...collapsedAll,
    doc: {
      ...collapsedAll.doc,
      parts: collapsedAll.doc.parts.slice(1),
      activeId: collapsedAll.doc.parts[1].id,
    },
  };
  const persisted = await persistCollapsedWorkingCopy({
    collapsed: dropped,
    sourceDoc,
    sourceScripts,
    heldScripts: sourceScripts,
    save: async (id, script) => {
      if (id === idC) return false;
      store.set(id, script);
      return true;
    },
    load: async (id) => store.get(id),
    remove: async (id) => { store.delete(id); },
  });
  const rowC = persisted.doc.parts.find((part) => part.name === 'C');
  assert.equal(rowC.id, uuidC);
  assert.equal(store.get(uuidC), 'return c;\n');
  assert.equal(store.has(idC), false);
});

test('IDB put failure keeps the old key and leaves the row un-collapsed', async () => {
  const store = new Map([[UUID, 'return keep-me;\n']]);
  const doc = {
    source: 'local',
    name: 'Assembly',
    activeId: UUID,
    parts: [{ id: UUID, name: 'Part', visible: true, order: 0 }],
  };
  const scripts = { [UUID]: store.get(UUID) };
  const collapsed = collapseWorkingCopyIds(doc, scripts, { now: NOW, randFor: () => 'b10c' });
  assert.notEqual(collapsed.doc.parts[0].id, UUID);
  const persisted = await persistCollapsedWorkingCopy({
    collapsed,
    sourceDoc: doc,
    sourceScripts: scripts,
    save: async () => false,
    remove: async (id) => { store.delete(id); },
  });
  assert.equal(persisted.doc.parts[0].id, UUID);
  assert.equal(store.get(UUID), 'return keep-me;\n');
  assert.equal(store.has(collapsed.doc.parts[0].id), false);
});

test('copy with a cached colliding header is stable and not dirty on reload', () => {
  const copyId = mintSurfId({ now: NOW, rand: 'c0c0' });
  const pinPath = 'parts/Pin.js';
  const copyPath = 'parts/PinCopy.js';
  const pinScript = withSurfId('return pin;\n', SURF);
  const copyScript = withSurfId('return copy;\n', SURF);
  const original = {
    id: ASM,
    source: 'git',
    name: 'Assembly',
    activeId: SURF,
    parts: [
      { id: SURF, path: pinPath, name: 'Pin', visible: true, order: 0 },
      { id: copyId, path: copyPath, name: 'PinCopy', visible: true, order: 1 },
    ],
  };
  const originalScripts = { [SURF]: pinScript, [copyId]: copyScript };
  const first = collapseWorkingCopyIds(original, originalScripts, { now: NOW, randFor: () => 'dead' });
  assert.equal(first.doc.parts[1].id, copyId);
  assert.equal(first.doc.parts[1].copiedFrom, SURF);
  assert.equal(readSurfId(first.scripts[copyId]), copyId);
  const baseline = captureBaseline({
    assemblyPath: 'assemblies/Assembly/.surf.json',
    assemblyName: 'Assembly',
    doc: first.doc,
    scripts: first.scripts,
  });
  const pathIndex = Object.fromEntries((first.cached || []).map((hit) => [hit.path, hit.id]));
  const reload = collapseWorkingCopyIds(first.doc, first.scripts, {
    now: new Date('2026-10-21T00:00:00.000Z'),
    randFor: () => 'ffff',
    pathIndex,
  });
  assert.equal(reload.doc.parts[1].id, copyId);
  assert.equal(readSurfId(reload.scripts[copyId]), copyId);
  assert.equal(isPartDirty(copyId, reload.scripts[copyId], baseline), false);
  assert.equal(isWorkspaceDirty(reload.doc, reload.scripts, baseline), false);
  const reload2 = collapseWorkingCopyIds(reload.doc, reload.scripts, {
    now: new Date('2026-10-22T00:00:00.000Z'),
    randFor: () => 'eeee',
    pathIndex,
  });
  assert.equal(reload2.doc.parts[1].id, copyId);
  assert.equal(isPartDirty(copyId, reload2.scripts[copyId], baseline), false);
  assert.equal(isWorkspaceDirty(reload2.doc, reload2.scripts, baseline), false);
});

test('Save writes a copied part file with its own @surf-id and @name', () => {
  const copyId = mintSurfId({ now: NOW, rand: 'c0c0' });
  const pinPath = 'parts/Pin.js';
  const copyPath = 'parts/PinCopy.js';
  const pinScript = withSurfName(withSurfId('return pin;\n', SURF), 'Pin');
  const doc = {
    source: 'git',
    name: 'Assembly',
    activeId: SURF,
    parts: [
      { id: SURF, path: pinPath, name: 'Pin', visible: true, order: 0 },
      { id: copyId, path: copyPath, name: 'PinCopy', visible: true, order: 1, copiedFrom: SURF },
    ],
  };
  const pinEdited = `${pinScript}// edited\n`;
  const baseline = captureBaseline({
    assemblyPath: 'assemblies/Assembly/.surf.json',
    assemblyName: 'Assembly',
    doc,
    scripts: { [SURF]: pinScript, [copyId]: pinScript },
  });
  // Pin is dirty; PinCopy.js bytes still match git (Pin's header). Save must
  // still rewrite PinCopy.js so GitHub does not keep Pin's @surf-id.
  const built = buildCommitFiles(doc, { [SURF]: pinEdited, [copyId]: pinScript }, baseline);
  const file = built.files.find((row) => row.path === copyPath);
  assert.ok(file, 'copy file must be in the Save');
  assert.equal(readSurfId(file.content), copyId);
  assert.equal(readSurfName(file.content), 'PinCopy');
  const json = built.files.find((row) => String(row.path).endsWith('.surf.json'));
  assert.ok(json?.content.includes(copyId));
});

test('Save restamps a non-surf @surf-id header and updates @name', () => {
  const copyId = mintSurfId({ now: NOW, rand: 'c0c0' });
  const pinPath = 'parts/Pin.js';
  const copyPath = 'parts/PinCopy.js';
  const pinScript = withSurfName(withSurfId('return pin;\n', SURF), 'Pin');
  const bogus = '// @surf-id bogus\n// @name Pin\nreturn copy;\n';
  const doc = {
    source: 'git',
    name: 'Assembly',
    activeId: SURF,
    parts: [
      { id: SURF, path: pinPath, name: 'Pin', visible: true, order: 0 },
      { id: copyId, path: copyPath, name: 'PinCopy', visible: true, order: 1, copiedFrom: SURF },
    ],
  };
  const pinEdited = `${pinScript}// edited\n`;
  const baseline = captureBaseline({
    assemblyPath: 'assemblies/Assembly/.surf.json',
    assemblyName: 'Assembly',
    doc,
    scripts: { [SURF]: pinScript, [copyId]: bogus },
  });
  const built = buildCommitFiles(doc, { [SURF]: pinEdited, [copyId]: bogus }, baseline);
  const file = built.files.find((row) => row.path === copyPath);
  assert.ok(file, 'copy file must be in the Save');
  assert.equal(readSurfId(file.content), copyId);
  assert.equal(String(file.content).includes('// @surf-id bogus'), false);
  assert.equal(readSurfName(file.content), 'PinCopy');
});

test('pasted header must not take another live part\'s surfId', () => {
  const uuid2 = '5f0c3c1e-0000-4000-8000-0000000000b2';
  const groupId = mintSurfId({ now: NOW, rand: 'cc04' });
  const jointId = mintSurfId({ now: NOW, rand: 'j02b' });
  const out = collapseWorkingCopyIds(
    {
      id: ASM,
      source: 'local',
      name: 'Assembly',
      activeId: UUID,
      parts: [
        { id: uuid2, name: 'Pasted', visible: true, order: 0 },
        { id: UUID, surfId: SURF, name: 'Original', visible: true, order: 1 },
      ],
      colors: { [SURF]: { part: '#ff00aa' } },
      groups: [{ id: groupId, name: 'Hardware', source: null, partIds: [SURF] }],
      joints: [{ id: jointId, name: 'Fixed 1', type: 'fixed', a: { part: SURF } }],
    },
    {
      [uuid2]: withSurfId('return pasted;\n', SURF),
      [UUID]: 'return original;\n',
    },
    { now: NOW, randFor: (part) => (part?.id === '$assembly' ? 'aa01' : 'b10c') },
  );
  assert.equal(out.doc.parts[1].id, SURF);
  assert.notEqual(out.doc.parts[0].id, SURF);
  assert.equal(out.doc.parts[0].copiedFrom, SURF);
  assert.equal(out.scripts[SURF].includes('return original'), true);
  assert.equal(out.scripts[out.doc.parts[0].id].includes('return pasted'), true);
  assert.deepEqual(out.doc.colors[SURF], { part: '#ff00aa' });
  assert.deepEqual(out.doc.groups[0].partIds, [SURF]);
  assert.equal(out.doc.joints[0].a.part, SURF);
});

test('nested legacy part list shows the name, not parts/Pin.js', () => {
  const nested = 'assemblies/Gearbox/parts/Pin.js';
  const titles = partListSubtitles([
    { id: SURF, path: nested, name: 'Pin', visible: true, order: 0 },
  ]);
  assert.equal(titles.get(SURF), 'Pin');
  assert.equal(String(titles.get(SURF)).includes('parts/Pin.js'), false);
});

test('read-only collapse does not mint and is stable across unsaved boots', () => {
  const doc = {
    source: 'local',
    name: 'Assembly',
    activeId: UUID,
    parts: [{ id: UUID, name: 'Part', visible: true, order: 0 }],
  };
  const scripts = { [UUID]: 'return 1;\n' };
  const first = collapseWorkingCopyIds(doc, scripts, {
    readOnly: true,
    now: NOW,
    randFor: () => 'b10c',
  });
  assert.equal(first.changed, false);
  assert.equal(first.doc.parts[0].id, UUID);
  const later = collapseWorkingCopyIds(doc, scripts, {
    readOnly: true,
    now: new Date('2026-10-21T00:00:00.000Z'),
    randFor: () => 'ffff',
  });
  assert.equal(later.changed, false);
  assert.equal(later.doc.parts[0].id, UUID);
  assert.equal(later.doc.parts[0].id, first.doc.parts[0].id);
});

const HEADERED_PATH = 'parts/Pin.js';
const HEADERED_SCRIPT = withSurfId('return pin;\n', SURF);
const HEADERED_EDIT = `${HEADERED_SCRIPT}// live edit\n`;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function makeIdb(doc, scripts) {
  return {
    doc: clone(doc),
    map: new Map(Object.entries(scripts)),
    memory: { doc: clone(doc), scripts: { ...scripts } },
    flight: [],
    flightToOnly: false,
    journal: null,
  };
}

function persistArgs(idb, collapsed, source, extra = {}) {
  return {
    collapsed,
    sourceDoc: source.doc,
    sourceScripts: source.scripts,
    heldScripts: { ...source.scripts },
    save: async (id, script) => { idb.map.set(id, script); return true; },
    load: async (id) => idb.map.get(id),
    remove: async (id) => { idb.map.delete(id); },
    saveDoc: async (doc) => { idb.doc = clone(doc); return doc; },
    live: () => idb.memory.scripts,
    assemblyKey: assemblyRekeyKey(source.doc),
    saveJournal: async (record) => { idb.journal = clone(record); },
    clearJournal: async () => { idb.journal = null; },
    onFlight: (pairs, opts) => {
      idb.flight = Array.isArray(pairs) ? pairs : [];
      idb.flightToOnly = !!(opts && opts.toOnly);
    },
    apply: ({ doc, scripts }) => {
      idb.memory.doc = clone(doc);
      idb.memory.scripts = { ...scripts };
    },
    ...extra,
  };
}

function scriptsForDoc(idb) {
  const scripts = {};
  for (const part of idb.doc.parts || []) {
    const text = idb.map.get(part.id);
    if (typeof text === 'string') scripts[part.id] = text;
  }
  return scripts;
}

function plantLiveEdit(idb, fromId, latest) {
  idb.map.set(fromId, latest);
  idb.memory.scripts[fromId] = latest;
}

async function bootFromIdb(idb) {
  const loadedDoc = clone(idb.doc);
  const loadedScripts = scriptsForDoc(idb);
  const collapsed = collapseWorkingCopyIds(loadedDoc, loadedScripts, {
    reusePairs: reusePairsFromJournal(idb.journal, loadedDoc),
  });
  await persistCollapsedWorkingCopy(persistArgs(
    idb,
    collapsed,
    { doc: loadedDoc, scripts: loadedScripts },
  ));
  return collapsed;
}

function headerlessFixture() {
  const original = 'return unsaved;\n';
  const latest = 'return unsaved;\n// live edit\n';
  const doc = {
    source: 'local',
    name: 'Assembly',
    activeId: UUID,
    parts: [{ id: UUID, name: 'Part', visible: true, order: 0 }],
  };
  const scripts = { [UUID]: original };
  const collapsed = collapseWorkingCopyIds(doc, scripts);
  return {
    kind: 'headerless UUID',
    beforeId: UUID,
    afterId: collapsed.doc.parts[0].id,
    original,
    latest,
    doc,
    scripts,
    collapsed,
  };
}

function headeredFixture() {
  const doc = {
    source: 'git',
    name: 'Assembly',
    activeId: HEADERED_PATH,
    parts: [{ id: HEADERED_PATH, path: HEADERED_PATH, name: 'Pin', visible: true, order: 0 }],
  };
  const scripts = { [HEADERED_PATH]: HEADERED_SCRIPT };
  const collapsed = collapseWorkingCopyIds(doc, scripts);
  return {
    kind: 'headered',
    beforeId: HEADERED_PATH,
    afterId: collapsed.doc.parts[0].id,
    original: HEADERED_SCRIPT,
    latest: HEADERED_EDIT,
    doc,
    scripts,
    collapsed,
  };
}

async function crashThenBoot(fixture, step) {
  const idb = makeIdb(fixture.doc, fixture.scripts);
  plantLiveEdit(idb, fixture.beforeId, fixture.latest);
  try {
    await persistCollapsedWorkingCopy(persistArgs(
      idb,
      fixture.collapsed,
      { doc: fixture.doc, scripts: fixture.scripts },
      { crashAfter: step },
    ));
    assert.fail(`expected PersistCrash after step ${step}`);
  } catch (err) {
    assert.equal(err instanceof PersistCrash, true);
    assert.equal(err.step, step);
  }
  await bootFromIdb(idb);
  const row = idb.doc.parts[0];
  assert.ok(
    row.id === fixture.beforeId || row.id === fixture.afterId,
    `${fixture.kind} step ${step}: id ${row.id} is a third mint`,
  );
  assert.equal(idb.map.get(row.id), fixture.latest);
  assert.notEqual(fixture.latest, fixture.original);
  for (const part of idb.doc.parts || []) {
    assert.equal(typeof idb.map.get(part.id), 'string', `missing script for ${part.id}`);
  }
  return idb;
}

const CRASH_STEPS = [
  [0, 'snapshot'],
  [1, 'put'],
  [2, 'saveDoc'],
  [3, 'apply'],
  [4, 'delete'],
];

for (const [step, name] of CRASH_STEPS) {
  test(`crash after ${name} (step ${step}) then boot keeps headerless UUID script`, async () => {
    await crashThenBoot(headerlessFixture(), step);
  });
  test(`crash after ${name} (step ${step}) then boot keeps headered row`, async () => {
    await crashThenBoot(headeredFixture(), step);
  });
}

test('K2: IDB doc is saved before from keys are deleted', async () => {
  const fixture = headerlessFixture();
  const order = [];
  const idb = makeIdb(fixture.doc, fixture.scripts);
  await persistCollapsedWorkingCopy(persistArgs(
    idb,
    fixture.collapsed,
    { doc: fixture.doc, scripts: fixture.scripts },
    {
      saveDoc: async (doc) => {
        order.push('saveDoc');
        idb.doc = clone(doc);
        return doc;
      },
      remove: async (id) => {
        order.push(['delete', id]);
        idb.map.delete(id);
      },
    },
  ));
  assert.equal(order[0], 'saveDoc');
  assert.ok(order.some((step) => Array.isArray(step) && step[0] === 'delete' && step[1] === UUID));
  assert.equal(idb.doc.parts[0].id, fixture.afterId);
  assert.equal(idb.map.has(UUID), false);
});

test('K2: crash after put leaves the old IDB doc and old keys', async () => {
  const fixture = headerlessFixture();
  const idb = makeIdb(fixture.doc, fixture.scripts);
  try {
    await persistCollapsedWorkingCopy(persistArgs(
      idb,
      fixture.collapsed,
      { doc: fixture.doc, scripts: fixture.scripts },
      { crashAfter: 1 },
    ));
  } catch (err) {
    assert.equal(err.step, 1);
  }
  assert.equal(idb.doc.parts[0].id, UUID);
  assert.equal(idb.map.get(UUID), fixture.original);
  assert.equal(idb.map.get(fixture.afterId), fixture.original);
  assert.equal(idb.memory.doc.parts[0].id, UUID);
});

test('K1: live from-edit during puts maps to to after saveDoc', async () => {
  const fixture = headerlessFixture();
  const order = [];
  const idb = makeIdb(fixture.doc, fixture.scripts);
  const edited = 'return unsaved;\n// typed during put\n';
  await persistCollapsedWorkingCopy(persistArgs(
    idb,
    fixture.collapsed,
    { doc: fixture.doc, scripts: fixture.scripts },
    {
      save: async (id, script) => {
        if (id === fixture.afterId) {
          idb.memory.scripts[UUID] = edited;
          idb.map.set(UUID, edited);
        }
        order.push('put');
        idb.map.set(id, script);
        return true;
      },
      saveDoc: async (doc) => {
        order.push('saveDoc');
        assert.equal(idb.memory.doc.parts[0].id, UUID);
        idb.doc = clone(doc);
        return doc;
      },
      apply: ({ doc, scripts }) => {
        order.push('apply');
        assert.equal(idb.doc.parts[0].id, fixture.afterId);
        idb.memory.doc = clone(doc);
        idb.memory.scripts = { ...scripts };
      },
    },
  ));
  assert.deepEqual(order.filter((step) => step !== 'put').slice(0, 2), ['saveDoc', 'apply']);
  assert.equal(idb.memory.scripts[fixture.afterId].includes('typed during put'), true);
  assert.equal(idb.map.get(fixture.afterId).includes('typed during put'), true);
  assert.equal(idb.map.has(UUID), false);
  const baseline = captureBaseline({
    assemblyPath: 'assemblies/Assembly/.surf.json',
    assemblyName: 'Assembly',
    doc: fixture.collapsed.doc,
    scripts: fixture.collapsed.scripts,
  });
  assert.equal(isPartDirty(fixture.afterId, idb.memory.scripts[fixture.afterId], baseline), true);
});

test('K1: live from-edit after saveDoc maps to to before memory switch', async () => {
  const fixture = headerlessFixture();
  const idb = makeIdb(fixture.doc, fixture.scripts);
  const edited = 'return unsaved;\n// typed after saveDoc\n';
  await persistCollapsedWorkingCopy(persistArgs(
    idb,
    fixture.collapsed,
    { doc: fixture.doc, scripts: fixture.scripts },
    {
      saveDoc: async (doc) => {
        idb.doc = clone(doc);
        assert.equal(idb.memory.doc.parts[0].id, UUID);
        idb.memory.scripts[UUID] = edited;
        idb.map.set(UUID, edited);
        return doc;
      },
      apply: ({ doc, scripts }) => {
        assert.equal(idb.doc.parts[0].id, fixture.afterId);
        assert.equal(scripts[fixture.afterId].includes('typed after saveDoc'), true);
        idb.memory.doc = clone(doc);
        idb.memory.scripts = { ...scripts };
      },
    },
  ));
  assert.equal(idb.memory.doc.parts[0].id, fixture.afterId);
  assert.equal(idb.map.get(fixture.afterId).includes('typed after saveDoc'), true);
  assert.equal(idb.map.has(UUID), false);
});

test('V: vault-open edit vs snapshot moves; stale snapshot bytes drop', async () => {
  const pathKey = 'assemblies/A/Pin.js';
  const store = new Map([[pathKey, 'OLD path-key record']]);
  const live = {};
  const doc = {
    source: 'git',
    name: 'A',
    activeId: SURF,
    parts: [{ id: SURF, path: pathKey, name: 'Pin', visible: true, order: 0, isSynced: true }],
  };
  await persistCollapsedWorkingCopy({
    collapsed: {
      doc,
      scripts: { [SURF]: 'tip pin' },
      pairs: [{ from: pathKey, to: SURF }],
    },
    sourceDoc: doc,
    sourceScripts: { [SURF]: 'tip pin' },
    save: async (id, script) => { store.set(id, script); return true; },
    load: async (id) => store.get(id),
    remove: async (id) => { store.delete(id); },
  });
  assert.equal(store.get(SURF), 'tip pin');
  assert.equal(store.has(pathKey), false);

  store.set(pathKey, 'OLD path-key record');
  store.set(SURF, 'stale tip');
  await persistCollapsedWorkingCopy({
    collapsed: {
      doc,
      scripts: { [SURF]: 'tip pin' },
      pairs: [{ from: pathKey, to: SURF }],
    },
    sourceDoc: doc,
    sourceScripts: { [SURF]: 'tip pin' },
    live,
    save: async (id, script) => {
      if (id === SURF && script === 'tip pin') {
        live[pathKey] = 'typed during vault open';
        store.set(pathKey, 'typed during vault open');
      }
      store.set(id, script);
      return true;
    },
    load: async (id) => store.get(id),
    remove: async (id) => { store.delete(id); },
  });
  assert.equal(store.get(SURF), 'typed during vault open');
  assert.equal(store.has(pathKey), false);
});

test('journal reusePairs keep the first mint; a free collapse mints another', () => {
  const doc = {
    source: 'local',
    name: 'Assembly',
    activeId: UUID,
    parts: [{ id: UUID, name: 'Part', visible: true, order: 0 }],
  };
  const scripts = { [UUID]: 'return unsaved;\n' };
  const first = collapseWorkingCopyIds(doc, scripts);
  const to = first.doc.parts[0].id;
  assert.ok(isSurfId(to));
  const journal = { assemblyKey: assemblyRekeyKey(doc), pairs: [{ from: UUID, to }] };
  const reused = collapseWorkingCopyIds(doc, scripts, {
    reusePairs: reusePairsFromJournal(journal, doc),
  });
  assert.equal(reused.doc.parts[0].id, to);
  const other = collapseWorkingCopyIds(doc, scripts);
  assert.notEqual(other.doc.parts[0].id, to);
});

test('dualWriteTargets includes both pair ids', () => {
  assert.deepEqual(dualWriteTargets(UUID, [{ from: UUID, to: SURF }]).sort(), [UUID, SURF].sort());
  assert.deepEqual(dualWriteTargets(SURF, [{ from: UUID, to: SURF }]).sort(), [UUID, SURF].sort());
  assert.deepEqual(dualWriteTargets(SURF, []), [SURF]);
  assert.deepEqual(dualWriteTargets(UUID, [{ from: UUID, to: SURF }], true), [SURF]);
  assert.deepEqual(dualWriteTargets(SURF, [{ from: UUID, to: SURF }], true), [SURF]);
});

async function rebootKeepsEdit(idb, expected) {
  await bootFromIdb(idb);
  const row = idb.doc.parts[0];
  assert.equal(typeof idb.map.get(row.id), 'string');
  assert.equal(idb.map.get(row.id), expected);
  for (const part of idb.doc.parts || []) {
    assert.equal(typeof idb.map.get(part.id), 'string', `missing script for ${part.id}`);
  }
}

test('saveDoc returning null keeps from keys and latest bytes after reboot', async () => {
  const fixture = headerlessFixture();
  const idb = makeIdb(fixture.doc, fixture.scripts);
  plantLiveEdit(idb, fixture.beforeId, fixture.latest);
  const persisted = await persistCollapsedWorkingCopy(persistArgs(
    idb,
    fixture.collapsed,
    { doc: fixture.doc, scripts: fixture.scripts },
    { saveDoc: async () => null },
  ));
  assert.equal(persisted.docSaved, false);
  assert.equal(persisted.doc.parts[0].id, UUID);
  assert.equal(idb.doc.parts[0].id, UUID);
  assert.equal(idb.map.get(UUID), fixture.latest);
  assert.equal(idb.memory.doc.parts[0].id, UUID);
  await rebootKeepsEdit(idb, fixture.latest);
});

test('saveDoc throw keeps from keys and latest bytes after reboot', async () => {
  const fixture = headerlessFixture();
  const idb = makeIdb(fixture.doc, fixture.scripts);
  plantLiveEdit(idb, fixture.beforeId, fixture.latest);
  const persisted = await persistCollapsedWorkingCopy(persistArgs(
    idb,
    fixture.collapsed,
    { doc: fixture.doc, scripts: fixture.scripts },
    { saveDoc: async () => { throw new Error('idb doc put failed'); } },
  ));
  assert.equal(persisted.docSaved, false);
  assert.equal(persisted.doc.parts[0].id, UUID);
  assert.equal(idb.doc.parts[0].id, UUID);
  assert.equal(idb.map.get(UUID), fixture.latest);
  assert.equal(idb.memory.doc.parts[0].id, UUID);
  await rebootKeepsEdit(idb, fixture.latest);
});

async function crashAfterSaveDocKeepsAutosaveEdit(fixture) {
  const idb = makeIdb(fixture.doc, fixture.scripts);
  plantLiveEdit(idb, fixture.beforeId, fixture.latest);
  const during = `${fixture.latest}// during saveDoc\n`;
  try {
    await persistCollapsedWorkingCopy(persistArgs(
      idb,
      fixture.collapsed,
      { doc: fixture.doc, scripts: fixture.scripts },
      {
        saveDoc: async (doc) => {
          idb.doc = clone(doc);
          for (const id of dualWriteTargets(fixture.beforeId, idb.flight)) {
            idb.map.set(id, during);
            idb.memory.scripts[id] = during;
          }
          return doc;
        },
        crashAfter: 2,
      },
    ));
    assert.fail('expected PersistCrash after step 2');
  } catch (err) {
    assert.equal(err instanceof PersistCrash, true);
    assert.equal(err.step, 2);
  }
  await bootFromIdb(idb);
  const row = idb.doc.parts[0];
  assert.ok(row.id === fixture.beforeId || row.id === fixture.afterId);
  assert.equal(idb.map.get(row.id), during);
}

test('edit at saveDoc then crash after step 2 keeps the edit on headerless UUID', async () => {
  await crashAfterSaveDocKeepsAutosaveEdit(headerlessFixture());
});

test('edit at saveDoc then crash after step 2 keeps the edit on headered row', async () => {
  await crashAfterSaveDocKeepsAutosaveEdit(headeredFixture());
});

test('vault open step-4 move lands in returned scripts for memory', async () => {
  const pathKey = 'assemblies/A/Pin.js';
  const store = new Map([[pathKey, 'OLD path-key record']]);
  const doc = {
    source: 'git',
    name: 'A',
    activeId: SURF,
    parts: [{ id: SURF, path: pathKey, name: 'Pin', visible: true, order: 0, isSynced: true }],
  };
  const persisted = await persistCollapsedWorkingCopy({
    collapsed: {
      doc,
      scripts: { [SURF]: 'tip pin' },
      pairs: [{ from: pathKey, to: SURF }],
    },
    sourceDoc: doc,
    sourceScripts: { [SURF]: 'tip pin' },
    save: async (id, script) => {
      if (id === SURF && script === 'tip pin') {
        store.set(pathKey, 'typed during vault open');
      }
      store.set(id, script);
      return true;
    },
    load: async (id) => store.get(id),
    remove: async (id) => { store.delete(id); },
    saveDoc: async (next) => next,
  });
  assert.equal(store.get(SURF), 'typed during vault open');
  assert.equal(persisted.scripts[SURF], 'typed during vault open');
});

function assertNoOrphanKeys(idb, allowed) {
  for (const key of idb.map.keys()) {
    assert.ok(allowed.has(key), `orphan key ${key}`);
  }
}

async function crashThenBootReusesJournal(step) {
  const original = 'return unsaved;\n';
  const latest = 'return unsaved;\n// live edit\n';
  const doc = {
    source: 'local',
    name: 'Assembly',
    activeId: UUID,
    parts: [{ id: UUID, name: 'Part', visible: true, order: 0 }],
  };
  const scripts = { [UUID]: original };
  const collapsed = collapseWorkingCopyIds(doc, scripts);
  const to = collapsed.doc.parts[0].id;
  assert.ok(isSurfId(to));
  assert.notEqual(to, UUID);
  const idb = makeIdb(doc, scripts);
  plantLiveEdit(idb, UUID, latest);
  try {
    await persistCollapsedWorkingCopy(persistArgs(
      idb,
      collapsed,
      { doc, scripts },
      { crashAfter: step },
    ));
    assert.fail(`expected PersistCrash after step ${step}`);
  } catch (err) {
    assert.equal(err instanceof PersistCrash, true);
    assert.equal(err.step, step);
  }
  assert.equal(idb.flight.length, 0, 'finally must endFlight');
  assert.ok(idb.journal);
  assert.equal(idb.journal.assemblyKey, assemblyRekeyKey(doc));
  assert.equal(idb.journal.pairs[0].from, UUID);
  assert.equal(idb.journal.pairs[0].to, to);
  const mintedBeforeBoot = [...idb.map.keys()].filter((id) => isSurfId(id) && id !== to);
  assert.equal(mintedBeforeBoot.length, 0);

  await bootFromIdb(idb);
  const row = idb.doc.parts[0];
  assert.equal(row.id, to, 'reboot minted a third id');
  assert.equal(idb.map.get(to), latest);
  assert.equal(idb.journal, null, 'journal must clear after step 4');
  assert.equal(idb.map.has(UUID), false);
  assertNoOrphanKeys(idb, new Set([to]));
}

test('crash after snapshot then boot reuses journal to without a third mint', async () => {
  await crashThenBootReusesJournal(0);
});

test('crash after put then boot reuses journal to without a third mint', async () => {
  await crashThenBootReusesJournal(1);
});

test('endFlight runs after a persist crash', async () => {
  const fixture = headerlessFixture();
  const idb = makeIdb(fixture.doc, fixture.scripts);
  try {
    await persistCollapsedWorkingCopy(persistArgs(
      idb,
      fixture.collapsed,
      { doc: fixture.doc, scripts: fixture.scripts },
      { crashAfter: 1 },
    ));
  } catch (err) {
    assert.equal(err.step, 1);
  }
  assert.deepEqual(idb.flight, []);
  assert.equal(idb.flightToOnly, false);
  assert.ok(idb.journal);
});

test('step 4 dual-write does not resurrect from', async () => {
  const fixture = headerlessFixture();
  const idb = makeIdb(fixture.doc, fixture.scripts);
  const late = `${fixture.latest}// after delete\n`;
  await persistCollapsedWorkingCopy(persistArgs(
    idb,
    fixture.collapsed,
    { doc: fixture.doc, scripts: fixture.scripts },
    {
      remove: async (id) => {
        idb.map.delete(id);
        for (const dest of dualWriteTargets(fixture.beforeId, idb.flight, idb.flightToOnly)) {
          idb.map.set(dest, late);
        }
      },
    },
  ));
  assert.equal(idb.map.has(UUID), false);
  assert.equal(idb.map.get(fixture.afterId), late);
  assert.equal(idb.journal, null);
});

test('failed saveDoc keeps the journal for a retry remint', async () => {
  const fixture = headerlessFixture();
  const idb = makeIdb(fixture.doc, fixture.scripts);
  const persisted = await persistCollapsedWorkingCopy(persistArgs(
    idb,
    fixture.collapsed,
    { doc: fixture.doc, scripts: fixture.scripts },
    { saveDoc: async () => null },
  ));
  assert.equal(persisted.docSaved, false);
  assert.ok(idb.journal);
  assert.equal(idb.journal.pairs[0].to, fixture.afterId);
  const retried = collapseWorkingCopyIds(fixture.doc, fixture.scripts, {
    reusePairs: reusePairsFromJournal(idb.journal, fixture.doc),
  });
  assert.equal(retried.doc.parts[0].id, fixture.afterId);
});

test('folded live FEA study remaps from to to', async () => {
  const study = multiPartStudy(UUID, UUID);
  const original = `return 1;\n${studyBlock(study)}`;
  const typed = `return 1;\n${studyBlock(study)}// typed during put\n`;
  const doc = {
    source: 'local',
    name: 'Study',
    activeId: UUID,
    parts: [{ id: UUID, name: 'Left', visible: true, order: 0 }],
  };
  const scripts = { [UUID]: original };
  const collapsed = collapseWorkingCopyIds(doc, scripts);
  const to = collapsed.doc.parts[0].id;
  const idb = makeIdb(doc, scripts);
  await persistCollapsedWorkingCopy(persistArgs(
    idb,
    collapsed,
    { doc, scripts },
    {
      save: async (id, script) => {
        if (id === to) {
          const live = idb.memory.scripts[UUID];
          if (typeof live === 'string' && !live.includes('typed during put')) {
            idb.memory.scripts[UUID] = typed;
            idb.map.set(UUID, typed);
          }
        }
        idb.map.set(id, script);
        return true;
      },
    },
  ));
  const rewritten = readStudy(idb.map.get(to));
  assert.equal(rewritten.fixtures[0].faces[0].part, to);
  assert.equal(rewritten.scope.ids[0], to);
  assert.match(idb.map.get(to), /typed during put/);
  assert.equal(idb.map.has(UUID), false);
});

test('dual-write FEA remaps the to copy only', () => {
  const study = multiPartStudy(UUID, UUID);
  const live = `return 1;\n${studyBlock(study)}`;
  const pairs = [{ from: UUID, to: SURF }];
  const fromBytes = remapFeaForPersist(live, pairs, UUID);
  const toBytes = remapFeaForPersist(live, pairs, SURF);
  assert.equal(readStudy(fromBytes).fixtures[0].faces[0].part, UUID);
  assert.equal(readStudy(toBytes).fixtures[0].faces[0].part, SURF);
  assert.match(fromBytes, new RegExp(`keep ${UUID}|return 1`));
});

test('step-3 from-move remaps FEA study ids onto to', async () => {
  const study = multiPartStudy(UUID, UUID);
  const original = 'return 1;\n';
  const moved = `return 1;\n${studyBlock(study)}`;
  const doc = {
    source: 'local',
    name: 'Study',
    activeId: UUID,
    parts: [{ id: UUID, name: 'Left', visible: true, order: 0 }],
  };
  const scripts = { [UUID]: original };
  const collapsed = collapseWorkingCopyIds(doc, scripts);
  const to = collapsed.doc.parts[0].id;
  const idb = makeIdb(doc, scripts);
  await persistCollapsedWorkingCopy(persistArgs(
    idb,
    collapsed,
    { doc, scripts },
    {
      saveDoc: async (next) => {
        idb.doc = clone(next);
        idb.map.set(UUID, moved);
        return next;
      },
    },
  ));
  const rewritten = readStudy(idb.map.get(to));
  assert.equal(rewritten.fixtures[0].faces[0].part, to);
  assert.equal(rewritten.parts[0].id, to);
  assert.equal(idb.map.has(UUID), false);
  assert.equal(idb.memory.scripts[to], idb.map.get(to));
});

test('instance rows keep their row id through collapse and follow a remapped definition', () => {
  const INSTANCE = mintSurfId({ now: new Date('2026-10-24T19:05:00.011Z'), rand: 'r0b2' });
  const doc = {
    source: 'local',
    name: 'Trainer',
    activeId: INSTANCE,
    parts: [
      { id: UUID, surfId: SURF, name: 'Roller', visible: true, order: 0 },
      { id: INSTANCE, instanceOf: SURF, name: 'Roller (2)', visible: true, order: 1, position: [0, 0, 120] },
    ],
  };
  const scripts = { [UUID]: withSurfId('return 1;\n', SURF) };
  const out = collapseWorkingCopyIds(doc, scripts, { now: NOW, randFor: () => 'dead' });
  assert.equal(out.doc.parts[0].id, SURF, 'the UUID primary collapses onto its header');
  assert.equal(out.doc.parts[1].id, INSTANCE, 'the instance row is never reminted');
  assert.equal(out.doc.parts[1].instanceOf, SURF);
  assert.equal(out.doc.parts[1].copiedFrom, undefined, 'an instance is not a copy of its definition');
  assert.equal(out.minted, 0);
  assert.deepEqual(Object.keys(out.scripts), [SURF], 'one script, under the definition');
  assert.equal(out.doc.activeId, INSTANCE);

  // The definition row itself remapped (UUID primary, header-less): the instance follows.
  const MINT = mintSurfId({ now: NOW, rand: 'dead' });
  const noHeader = collapseWorkingCopyIds({
    ...doc,
    parts: [
      { id: UUID, name: 'Roller', visible: true, order: 0 },
      { id: INSTANCE, instanceOf: UUID, name: 'Roller (2)', visible: true, order: 1 },
    ],
  }, { [UUID]: 'return 1;\n' }, { now: NOW, randFor: () => 'dead' });
  assert.equal(noHeader.doc.parts[0].id, MINT);
  assert.equal(noHeader.doc.parts[1].id, INSTANCE);
  assert.equal(noHeader.doc.parts[1].instanceOf, MINT, 'instanceOf follows the minted definition id');
});

/**
 * IndexedDB / working-copy identity collapse: UUID and path-as-id → surf-id.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mintSurfId, isSurfId, readSurfId, withSurfId } from '../src/utils/git/surfId.js';
import { collapseWorkingCopyIds, pickCollapsedPartId, replaceScriptKeys } from '../src/utils/git/wcIdentity.js';
import { rewriteFeaStudyPartIds } from '../src/utils/git/feaStudyIds.js';
import { serializeAssembly, parseAssemblyDocument, composeViewportParts } from '../src/utils/assembly.js';
import { partSurfId } from '../src/utils/git/surfId.js';
import { normalizeAssemblyJoints } from '../src/utils/jointSchema.js';
import { seedAssemblyHistory } from '../src/joints/jointUi.js';

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

/**
 * IndexedDB / working-copy identity collapse: UUID and path-as-id → surf-id.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mintSurfId, isSurfId, readSurfId, withSurfId } from '../src/utils/git/surfId.js';
import { collapseWorkingCopyIds, pickCollapsedPartId, replaceScriptKeys } from '../src/utils/git/wcIdentity.js';
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
  assert.equal(out.scripts[MINTED], script);
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

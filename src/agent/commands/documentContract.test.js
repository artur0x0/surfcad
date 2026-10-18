/**
 * PR 8 agent contract: ids only, confirm:true, no git from these commands.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createAssemblyCommand,
  deleteAssemblyCommand,
  deletePartCommand,
  insertPartCommand,
  listAssembliesCommand,
  openAssemblyCommand,
  openPartCommand,
  renameAssemblyCommand,
  renamePartCommand,
} from './document.js';
import { setScriptCommand } from './setScript.js';
import { partGetTransformCommand, partSetTransformCommand } from './partTransform.js';
import { setActivePartCommand } from './setActivePart.js';
import { selectPartsCommand } from './selectParts.js';
import { findPartById } from '../state/identity.js';

const PART = '2026-10-18-02-50-00-0001-bb02';
const ASM = '2026-10-18-02-50-00-0001-aa01';
const PATH = 'parts/Bracket.js';
const ASM_PATH = 'assemblies/Gearbox.surf.json';

test('id-only payloads: paths are unknown_part / unknown_assembly', () => {
  assert.equal(openAssemblyCommand.checkArgs({ name: 'Gearbox' })?.code, 'bad_args');
  assert.equal(openAssemblyCommand.checkArgs({ assembly_id: ASM_PATH })?.code, 'unknown_assembly');
  assert.equal(openAssemblyCommand.checkArgs({ assembly_id: ASM }), null);

  assert.equal(openPartCommand.checkArgs({})?.code, 'bad_args');
  assert.equal(openPartCommand.checkArgs({ part_id: PATH })?.code, 'unknown_part');
  assert.equal(openPartCommand.checkArgs({ assembly_id: ASM_PATH })?.code, 'unknown_assembly');
  assert.equal(openPartCommand.checkArgs({ part_id: PART }), null);

  assert.equal(insertPartCommand.checkArgs({ part_id: PATH })?.code, 'unknown_part');
  assert.equal(setScriptCommand.checkArgs({ source: 'return 1;\n' })?.code, 'bad_args');
  assert.equal(setScriptCommand.checkArgs({ part_id: PATH, source: 'return 1;\n' })?.code, 'unknown_part');
  assert.equal(setScriptCommand.checkArgs({ part_id: PART, source: 'return 1;\n' }), null);

  assert.equal(setActivePartCommand.checkArgs({ part_id: PATH })?.code, 'unknown_part');
  assert.equal(partGetTransformCommand.checkArgs({ part: 'b' })?.code, 'bad_args');
  assert.equal(partGetTransformCommand.checkArgs({ part_id: PATH })?.code, 'unknown_part');
  assert.equal(partSetTransformCommand.checkArgs({ part_id: PART, position: [1, 0, 0] }), null);

  assert.equal(renamePartCommand.checkArgs({ part_id: PATH, name: 'Mount' })?.code, 'unknown_part');
  assert.equal(renameAssemblyCommand.checkArgs({ assembly_id: ASM_PATH, name: 'Box' })?.code, 'unknown_assembly');
  assert.equal(selectPartsCommand.checkArgs({ part_id: PATH })?.code, 'unknown_part');
  assert.equal(selectPartsCommand.checkArgs({ part_ids: [PART, PATH] })?.code, 'unknown_part');
});

test('delete_part scope repo and delete_assembly require confirm:true', async () => {
  let called = null;
  const ctx = {
    agentDeletePart: async (args) => {
      called = ['part', args];
      return { result: { status: 'removed' } };
    },
    agentDeleteAssembly: async (args) => {
      called = ['assembly', args];
      return { result: { status: 'deleted' } };
    },
  };

  assert.equal(deletePartCommand.checkArgs({ part_id: PART, scope: 'assembly' }), null);
  assert.equal(deletePartCommand.checkArgs({ part_id: PART, scope: 'repo' })?.code, 'confirm_required');
  assert.equal(deletePartCommand.checkArgs({ part_id: PART, scope: 'repo', confirm: true }), null);
  assert.equal(deleteAssemblyCommand.checkArgs({ assembly_id: ASM })?.code, 'confirm_required');
  assert.equal(deleteAssemblyCommand.checkArgs({ assembly_id: ASM, confirm: false })?.code, 'confirm_required');
  assert.equal(deleteAssemblyCommand.checkArgs({ assembly_id: ASM, confirm: true }), null);

  const skippedPart = await deletePartCommand.run(ctx, { part_id: PART, scope: 'repo' });
  assert.equal(skippedPart.error?.code, 'confirm_required');
  assert.equal(called, null);

  const skippedAsm = await deleteAssemblyCommand.run(ctx, { assembly_id: ASM });
  assert.equal(skippedAsm.error?.code, 'confirm_required');
  assert.equal(called, null);

  const dropped = await deletePartCommand.run(ctx, { part_id: PART, scope: 'assembly' });
  assert.equal(dropped.result?.status, 'removed');
  assert.deepEqual(called, ['part', { partId: PART, scope: 'assembly', confirm: false }]);

  const deleted = await deleteAssemblyCommand.run(ctx, { assembly_id: ASM, confirm: true });
  assert.equal(deleted.result?.status, 'deleted');
  assert.equal(called[0], 'assembly');
  assert.equal(called[1].confirm, true);
});

test('open / list / rename / create_assembly pass ids and never invent a path', async () => {
  const seen = [];
  const ctx = {
    agentOpenAssembly: async (args) => {
      seen.push(['open', args]);
      return { result: { assemblyId: args.assemblyId, assemblyName: 'Gearbox', activeId: PART, partCount: 1 } };
    },
    agentListAssemblies: async () => ({
      result: { assemblies: [{ id: ASM, name: 'Gearbox' }] },
    }),
    agentRenameAssembly: async (args) => {
      seen.push(['rename', args]);
      return { result: { assemblyId: args.assemblyId, name: args.name } };
    },
    agentCreateAssembly: async (args) => {
      seen.push(['create', args]);
      return { result: { assemblyId: ASM, assemblyName: args.name || 'Assembly', activeId: PART, partCount: 1 } };
    },
    agentRenamePart: async (args) => {
      seen.push(['renamePart', args]);
      return { result: { partId: args.partId, name: args.name, moved: false } };
    },
  };

  const opened = await openAssemblyCommand.run(ctx, { assembly_id: ASM });
  assert.equal(opened.result.assemblyId, ASM);
  assert.equal('path' in opened.result, false);

  const listed = await listAssembliesCommand.run(ctx, {});
  assert.deepEqual(listed.result.assemblies, [{ id: ASM, name: 'Gearbox' }]);
  assert.equal(JSON.stringify(listed).includes('assemblies/'), false);

  const renamed = await renameAssemblyCommand.run(ctx, { assembly_id: ASM, name: ' Mount ' });
  assert.deepEqual(renamed.result, { assemblyId: ASM, name: 'Mount' });

  const created = await createAssemblyCommand.run(ctx, { name: 'Gearbox' });
  assert.equal(created.result.assemblyId, ASM);
  assert.equal(created.result.partCount, 1);

  const part = await renamePartCommand.run(ctx, { part_id: PART, name: 'Bracket' });
  assert.equal(part.result.moved, false);
  assert.equal(part.result.partId, PART);

  assert.deepEqual(seen[0], ['open', { assemblyId: ASM }]);
  assert.deepEqual(seen[1], ['rename', { assemblyId: ASM, name: 'Mount' }]);
  assert.deepEqual(seen[2], ['create', { name: 'Gearbox' }]);
});

test('path-shaped part_id is unknown_part even when a row.path matches', async () => {
  const doc = {
    parts: [{ id: PART, name: 'Bracket', path: PATH, visible: true }],
    activeId: PART,
  };
  assert.equal(findPartById(doc, PATH), null);
  assert.equal(findPartById(doc, PART)?.name, 'Bracket');
  assert.equal(setScriptCommand.checkArgs({ part_id: PATH, source: 'return 1;\n' })?.code, 'unknown_part');
  assert.equal(setActivePartCommand.checkArgs({ part_id: PATH })?.code, 'unknown_part');
  assert.equal(renamePartCommand.checkArgs({ part_id: PATH, name: 'Mount' })?.code, 'unknown_part');
  assert.equal(selectPartsCommand.checkArgs({ part_id: PATH })?.code, 'unknown_part');

  let mutated = false;
  let activated = null;
  const wrote = await setScriptCommand.run({
    readParts: () => ({
      activeId: PART,
      parts: [{ id: PART, name: 'Bracket', path: PATH, visible: true }],
    }),
    mutate: async () => {
      mutated = true;
      return { ok: true };
    },
  }, { part_id: PATH, source: 'return 1;\n' });
  assert.equal(wrote.error?.code, 'unknown_part');
  assert.equal(mutated, false);

  const activatedOut = setActivePartCommand.run({
    setActivePart(partId) {
      const part = findPartById(doc, partId);
      if (!part) return { error: { code: 'unknown_part', message: `Unknown part id: ${partId}` } };
      activated = part.id;
      return { ok: true };
    },
  }, { part_id: PATH });
  assert.equal(activatedOut.error?.code, 'unknown_part');
  assert.equal(activated, null);
});

test('set_script refuses a part_mismatch instead of writing the active part', async () => {
  let mutated = false;
  const out = await setScriptCommand.run({
    readParts: () => ({ activeId: PART, parts: [{ id: PART, name: 'A', visible: true }] }),
    mutate: async () => {
      mutated = true;
      return { ok: true };
    },
  }, { part_id: '2026-10-18-02-50-00-0001-cc03', source: 'return 1;\n' });
  assert.equal(out.error?.code, 'part_mismatch');
  assert.equal(mutated, false);
});

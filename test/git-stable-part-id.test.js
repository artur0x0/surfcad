/**
 * Part ids stay stable across git_save, reload, and rename_part.
 * Mock adapter only.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMockGithubAdapter } from '../src/utils/git/mockGithubAdapter.js';
import { findOrCreateVault } from '../src/utils/git/vault.js';
import { assemblyFilePath, assemblyPartPath, sharedPartPath } from '../src/utils/git/vaultLayout.js';
import { validateSurfJson } from '../src/utils/git/surfJson.js';
import {
  assembleCommitFiles,
  commitWorkspace,
  firstCommitBaseline,
  prepareVaultPartRename,
} from '../src/utils/git/gitCommit.js';
import { ensureAssemblyVaultPaths, allocateVaultPartPath } from '../src/utils/git/partVaultPath.js';
import { findAssemblyPart } from '../src/utils/git/partIdentity.js';
import { isSurfId } from '../src/utils/git/surfId.js';
import { openVaultAssembly } from '../src/utils/git/gitWorkspace.js';
import { renamePartCommand } from '../src/agent/commands/document.js';
import { buildPartsState } from '../src/agent/state/parts.js';

const ASM = 'Kettle-MCP';
const IDS = [
  '5f0c3c1e-0000-4000-8000-000000000001',
  '5f0c3c1e-0000-4000-8000-000000000002',
];
const NAMES = ['Kettle Body', 'Kettle Lid'];

function kettle() {
  const doc = {
    source: 'git',
    name: ASM,
    activeId: IDS[0],
    parts: IDS.map((id, order) => ({
      id,
      name: NAMES[order],
      visible: true,
      order,
      isSynced: false,
    })),
  };
  const scripts = Object.fromEntries(
    IDS.map((id, i) => [id, `// ${NAMES[i]}\nreturn Manifold.cube([${i + 1}, 1, 1], true);\n`]),
  );
  return { doc, scripts };
}

test('new parts promote to assemblies/<Assembly>/<name>.js, never parts/', () => {
  const path = allocateVaultPartPath(ASM, 'Kettle Body', []);
  assert.equal(path, assemblyPartPath(ASM, 'Kettle Body'));
  assert.notEqual(path, sharedPartPath('Kettle Body'));
  const { doc, scripts } = kettle();
  const { doc: fixed, moved } = ensureAssemblyVaultPaths(doc, scripts);
  assert.equal(moved.length, 2);
  assert.deepEqual(fixed.parts.map((part) => part.id), IDS);
  assert.deepEqual(fixed.parts.map((part) => part.path), [
    assemblyPartPath(ASM, 'Kettle Body'),
    assemblyPartPath(ASM, 'Kettle Lid'),
  ]);
  assert.equal(fixed.parts.some((part) => String(part.path).startsWith('parts/')), false);
});

test('create -> git_save -> reload keeps the same id', async () => {
  const gh = createMockGithubAdapter({ login: 'agent' });
  const vault = await findOrCreateVault(gh);
  const { doc, scripts } = kettle();
  const first = await commitWorkspace(gh, vault.repo, {
    doc,
    scripts,
    baseline: firstCommitBaseline({ headSha: vault.headSha }),
    message: 'Save Kettle',
  });
  assert.equal(first.status, 'committed');
  assert.deepEqual(first.doc.parts.map((part) => part.id), IDS);
  const raw = JSON.parse((await gh.readFile(vault.repo, assemblyFilePath(ASM), 'main')).content);
  assert.equal(validateSurfJson(raw).ok, true, validateSurfJson(raw).errors?.join('; '));
  assert.deepEqual(raw.parts.map((part) => part.id), IDS);
  assert.deepEqual(raw.parts.map((part) => part.path), [
    assemblyPartPath(ASM, 'Kettle Body'),
    assemblyPartPath(ASM, 'Kettle Lid'),
  ]);
  assert.equal(raw.parts.some((part) => String(part.path).startsWith('parts/')), false);

  const opened = await openVaultAssembly(gh, vault.repo, ASM, {
    branch: 'main',
    headSha: first.sha,
  });
  const openedIds = opened.doc.parts.map((part) => part.id);
  assert.equal(openedIds.every((id) => isSurfId(id)), true);
  assert.equal(opened.doc.parts[0].name, 'Kettle Body');
  assert.equal(findAssemblyPart(opened.doc, opened.doc.parts[0].path)?.id, openedIds[0]);
  const pathIndex = Object.fromEntries((opened.identities?.cached || []).map((hit) => [hit.path, hit.id]));
  const reloaded = await openVaultAssembly(gh, vault.repo, ASM, {
    branch: 'main',
    headSha: first.sha,
    pathIndex,
    knownAssemblyId: opened.doc.id,
  });
  assert.deepEqual(reloaded.doc.parts.map((part) => part.id), openedIds);
  const listed = buildPartsState({
    activeId: opened.doc.activeId,
    assemblyName: opened.doc.name,
    parts: opened.doc.parts.map((row) => ({
      id: row.id,
      name: row.name,
      visible: row.visible,
      path: row.path,
    })),
  });
  assert.deepEqual(listed.parts.map((row) => row.id), openedIds);
  assert.equal('path' in listed.parts[0], false);
});

test('second save after adopt does not mint -2 copies', async () => {
  const gh = createMockGithubAdapter({ login: 'agent' });
  const vault = await findOrCreateVault(gh);
  const { doc, scripts } = kettle();
  const first = await commitWorkspace(gh, vault.repo, {
    doc,
    scripts,
    baseline: firstCommitBaseline({ headSha: vault.headSha }),
    message: 'Save Kettle',
  });
  const second = await assembleCommitFiles(gh, vault.repo, {
    doc: first.doc,
    scripts: first.scripts,
    baseline: first.baseline,
    message: 'Save again',
  });
  assert.equal(second.status, 'clean', JSON.stringify(second));
});

test('rename_part keeps the id and only moves the path', async () => {
  const gh = createMockGithubAdapter({ login: 'agent' });
  const vault = await findOrCreateVault(gh);
  const { doc, scripts } = kettle();
  const saved = await commitWorkspace(gh, vault.repo, {
    doc,
    scripts,
    baseline: firstCommitBaseline({ headSha: vault.headSha }),
    message: 'Save Kettle',
  });
  const prepared = await prepareVaultPartRename(gh, vault.repo, {
    doc: saved.doc,
    scripts: saved.scripts,
    from: IDS[0],
    nextName: 'Body',
  });
  assert.equal(prepared.status, 'ready', prepared.error);
  assert.equal(prepared.fromId, IDS[0]);
  assert.equal(prepared.to, assemblyPartPath(ASM, 'Body'));
  const renamed = prepared.doc.parts.find((part) => part.id === IDS[0]);
  assert.ok(renamed);
  assert.equal(renamed.path, assemblyPartPath(ASM, 'Body'));
  assert.equal(renamed.name, 'Body');
  assert.equal(prepared.doc.parts[1].id, IDS[1]);
});

test('list_parts and rename_part resolve the stable id', async () => {
  let seen = null;
  const out = await renamePartCommand.run({
    agentRenamePart: async (args) => {
      seen = args.partId;
      return { result: { partId: args.partId, name: args.name, moved: false } };
    },
  }, { part_id: IDS[0], name: 'Body' });
  assert.equal(seen, IDS[0]);
  assert.equal(out.result?.partId, IDS[0]);
  assert.equal(out.result?.moved, false);
});

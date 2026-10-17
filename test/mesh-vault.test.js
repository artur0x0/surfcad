/**
 * Vault mesh sync: placement, shared-mesh refusal, size caps, and who may save.
 * The full upload → save → reopen → rename → delete story is the golden.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { meshVaultSyncScenario } from '../scripts/golden/smoke_mesh_vault_sync.mjs';
import { encodeMesh } from '../src/utils/meshFormat.js';
import { importMeshScript } from '../src/utils/meshAssets.js';
import {
  VAULT_FILE_MAX_BYTES,
  VAULT_FILE_WARN_BYTES,
  VaultFileTooLargeError,
  gitBlobSha,
} from '../src/utils/git/binaryContent.js';
import {
  assemblyPartPath,
  assetPathForScript,
  sharedPartPath,
} from '../src/utils/git/vaultLayout.js';
import {
  collectMeshCommitAssets,
  meshVaultSaveAllowed,
  placeLocalMeshParts,
} from '../src/utils/git/meshSync.js';

const TRI = {
  numProp: 3,
  vertProperties: [0, 0, 0, 1, 0, 0, 0, 1, 0],
  triVerts: [0, 1, 2],
};

function partDoc(id, name = 'Bracket') {
  return {
    name: 'Gearbox',
    source: 'git',
    activeId: id,
    parts: [{ id, name, visible: true, order: 0 }],
  };
}

describe('mesh vault save policy', () => {
  test('only a writable git vault may commit meshes', () => {
    assert.equal(meshVaultSaveAllowed({
      source: 'git', readOnly: false, githubConnected: true,
    }), true);
    assert.equal(meshVaultSaveAllowed({
      source: 'git', readOnly: true, githubConnected: true,
    }), false);
    assert.equal(meshVaultSaveAllowed({
      source: 'git', readOnly: true, githubConnected: false, adapterKind: 'mock',
    }), true);
    assert.equal(meshVaultSaveAllowed({
      source: 'git', readOnly: false, githubConnected: false,
    }), false);
    assert.equal(meshVaultSaveAllowed({
      source: 'git', readOnly: false, githubConnected: false, adapterKind: 'mock',
    }), true);
    assert.equal(meshVaultSaveAllowed({
      source: 'local', readOnly: false, githubConnected: true,
    }), false);
  });

  test('a local upload is placed beside the assembly script, numbering when taken', () => {
    const local = 'bracket-local';
    const taken = assemblyPartPath('Gearbox', 'Bracket');
    const placed = placeLocalMeshParts(
      partDoc(local),
      { [local]: importMeshScript('Bracket.mesh') },
      { occupied: [taken, assetPathForScript(taken)] },
    );
    assert.equal(placed.moved.length, 1);
    assert.equal(placed.doc.parts[0].id, local);
    assert.equal(placed.doc.parts[0].path, assemblyPartPath('Gearbox', 'Bracket (2)'));
    assert.equal(placed.doc.parts[0].name, 'Bracket (2)');
    assert.equal(
      assetPathForScript(placed.doc.parts[0].path),
      'assemblies/Gearbox/Bracket (2).mesh',
    );
    assert.equal(placed.scripts[taken], undefined);
  });

  test('a remote .mesh occupies the sibling script stem', () => {
    const local = 'bracket-local';
    const mesh = assetPathForScript(assemblyPartPath('Gearbox', 'Bracket'));
    const placed = placeLocalMeshParts(
      partDoc(local),
      { [local]: importMeshScript('Bracket.mesh') },
      { occupied: [mesh] },
    );
    assert.equal(placed.moved.length, 1);
    assert.equal(placed.doc.parts[0].id, local);
    assert.notEqual(placed.doc.parts[0].path, assemblyPartPath('Gearbox', 'Bracket'));
    assert.notEqual(assetPathForScript(placed.doc.parts[0].path), mesh);
  });

  test('an existing shared part path is left where it is', () => {
    const id = sharedPartPath('Bracket');
    const placed = placeLocalMeshParts(
      partDoc(id),
      { [id]: importMeshScript('Bracket.mesh') },
      { occupied: [] },
    );
    assert.equal(placed.moved.length, 0);
    assert.equal(placed.doc.parts[0].id, id);
  });
});

describe('collectMeshCommitAssets', () => {
  test('a shared mesh already in the vault is not replaced', async () => {
    const id = sharedPartPath('Bracket');
    const meshPath = assetPathForScript(id);
    const remote = encodeMesh(TRI);
    const local = encodeMesh({ ...TRI, vertProperties: [0, 0, 0, 2, 0, 0, 0, 1, 0] });
    const collected = await collectMeshCommitAssets({
      doc: partDoc(id),
      scripts: { [id]: importMeshScript('Bracket.mesh') },
      records: { [id]: { assets: { 'Bracket.mesh': 'a'.repeat(40) }, meshSynced: false } },
      tree: [{ path: meshPath, sha: gitBlobSha(remote) }],
      readBytes: async () => local,
    });
    assert.equal(Object.keys(collected.assets).length, 0);
    assert.equal(collected.marks.length, 0);
    assert.equal(collected.skipped.length, 1);
    assert.match(collected.skipped[0].message, /left unchanged/);
  });

  test('the same shared blob is adopted and not written again', async () => {
    const id = sharedPartPath('Bracket');
    const meshPath = assetPathForScript(id);
    const bytes = encodeMesh(TRI);
    const collected = await collectMeshCommitAssets({
      doc: partDoc(id),
      scripts: { [id]: importMeshScript('Bracket.mesh') },
      records: { [id]: { assets: { 'Bracket.mesh': gitBlobSha(bytes) }, meshSynced: false } },
      tree: [{ path: meshPath, sha: gitBlobSha(bytes) }],
      readBytes: async () => bytes,
    });
    assert.equal(Object.keys(collected.assets).length, 0);
    assert.equal(collected.marks.length, 1);
    assert.equal(collected.marks[0].adopted, true);
    assert.equal(collected.marks[0].sha, gitBlobSha(bytes));
  });

  test('an assembly-local mesh with a new sha is included', async () => {
    const id = assemblyPartPath('Gearbox', 'Bracket');
    const meshPath = assetPathForScript(id);
    const remote = encodeMesh(TRI);
    const local = encodeMesh({ ...TRI, vertProperties: [0, 0, 0, 2, 0, 0, 0, 1, 0] });
    const collected = await collectMeshCommitAssets({
      doc: partDoc(id),
      scripts: { [id]: importMeshScript('Bracket.mesh') },
      records: { [id]: { assets: { 'Bracket.mesh': 'b'.repeat(40) }, meshSynced: false } },
      tree: [{ path: meshPath, sha: gitBlobSha(remote) }],
      readBytes: async () => local,
    });
    assert.equal(collected.assets[meshPath], local);
    assert.equal(collected.marks[0].adopted, false);
    assert.equal(collected.marks[0].sha, gitBlobSha(local));
  });

  test('over 40 MiB throws VaultFileTooLargeError with a toast', async () => {
    const id = assemblyPartPath('Gearbox', 'Huge');
    const huge = new Uint8Array(VAULT_FILE_MAX_BYTES + 1);
    await assert.rejects(
      () => collectMeshCommitAssets({
        doc: partDoc(id, 'Huge'),
        scripts: { [id]: importMeshScript('Huge.mesh') },
        records: { [id]: { assets: { 'Huge.mesh': 'c'.repeat(40) }, meshSynced: false } },
        readBytes: async () => huge,
      }),
      (err) => err instanceof VaultFileTooLargeError
        && err.code === 'file_too_large'
        && /40 MiB/.test(err.toast),
    );
  });

  test('over 20 MiB warns and is still committed', async () => {
    const id = assemblyPartPath('Gearbox', 'Big');
    const meshPath = assetPathForScript(id);
    const big = new Uint8Array(VAULT_FILE_WARN_BYTES + 1);
    const collected = await collectMeshCommitAssets({
      doc: partDoc(id, 'Big'),
      scripts: { [id]: importMeshScript('Big.mesh') },
      records: { [id]: { assets: { 'Big.mesh': 'd'.repeat(40) }, meshSynced: false } },
      readBytes: async () => big,
    });
    assert.equal(collected.warnings.length, 1);
    assert.match(collected.warnings[0].message, /20/);
    assert.equal(collected.assets[meshPath], big);
  });

  test('a mesh already marked synced is not written again', async () => {
    const id = assemblyPartPath('Gearbox', 'Bracket');
    const collected = await collectMeshCommitAssets({
      doc: partDoc(id),
      scripts: { [id]: importMeshScript('Bracket.mesh') },
      records: { [id]: { assets: { 'Bracket.mesh': 'e'.repeat(40) }, meshSynced: true } },
      readBytes: async () => encodeMesh(TRI),
    });
    assert.equal(Object.keys(collected.assets).length, 0);
    assert.equal(collected.marks.length, 0);
  });
});

describe('mesh vault sync golden', () => {
  test('upload, save, reopen, rename, and delete carry the mesh', async () => {
    await meshVaultSyncScenario();
  });
});

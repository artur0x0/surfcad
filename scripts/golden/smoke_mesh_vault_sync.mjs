#!/usr/bin/env node
/**
 * Mock-adapter golden for vault mesh sync.
 *
 * Upload a triangle, Save once (the commit has the `.js` and the `.mesh`,
 * then the local-only badge clears), clear the asset cache, reopen (the
 * mesh renders from `readBlob`), then rename and delete (the mesh follows).
 */
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { clearAssetCache, getAssetBytes, putAsset } from '../../src/utils/git/assetCache.js';
import { gitBlobSha } from '../../src/utils/git/binaryContent.js';
import { fileDelete, fileWrite } from '../../src/utils/git/githubAdapterInterface.js';
import { assembleCommitFiles } from '../../src/utils/git/gitCommit.js';
import { planPartPath } from '../../src/utils/git/gitRename.js';
import { openVaultAssembly } from '../../src/utils/git/gitWorkspace.js';
import { partRepoPath } from '../../src/utils/git/partIdentity.js';
import { createMockGithubAdapter } from '../../src/utils/git/mockGithubAdapter.js';
import { createSyncStore } from '../../src/utils/git/syncStore.js';
import { flushSyncQueue } from '../../src/utils/git/syncWorker.js';
import { stringifySurfJson } from '../../src/utils/git/surfJson.js';
import { vaultMarkerContent } from '../../src/utils/git/vault.js';
import {
  assemblyFilePath,
  assetPathForScript,
  parseVaultPath,
} from '../../src/utils/git/vaultLayout.js';
import { encodeMesh } from '../../src/utils/meshFormat.js';
import {
  importMeshScript,
  resolvePartMeshes,
  showLocalMeshBadge,
} from '../../src/utils/meshAssets.js';
import {
  collectMeshCommitAssets,
  partMeshRecordsFromBaseline,
  placeLocalMeshParts,
  readMeshBytes,
  remapMeshRecords,
} from '../../src/utils/git/meshSync.js';

const MARKER = vaultMarkerContent();
const TRI = {
  numProp: 3,
  vertProperties: [0, 0, 0, 1, 0, 0, 0, 1, 0],
  triVerts: [0, 1, 2],
};

function sameBytes(a, b) {
  assert.ok(a instanceof Uint8Array);
  assert.ok(b instanceof Uint8Array);
  assert.equal(a.byteLength, b.byteLength);
  for (let i = 0; i < a.byteLength; i += 1) assert.equal(a[i], b[i]);
}

export async function meshVaultSyncScenario() {
  await clearAssetCache();
  const gh = createMockGithubAdapter({ login: 'artur' });
  const repo = { owner: 'artur', name: 'vault' };
  await gh.createRepo({ name: 'vault' });
  const empty = {
    name: 'Gearbox',
    source: 'git',
    activeId: null,
    parts: [],
  };
  await gh.commitFiles(repo, {
    branch: 'main',
    message: 'seed',
    files: [
      fileWrite('surfcad.json', MARKER),
      fileWrite(assemblyFilePath('Gearbox'), stringifySurfJson(empty)),
    ],
  });

  const opened = await openVaultAssembly(gh, repo, 'Gearbox');
  const store = createSyncStore({ persist: false });
  await store.setLastSyncedSha(repo, opened.baseline.headSha, 'main');

  const bytes = encodeMesh(TRI);
  const sha = await putAsset(bytes);
  assert.equal(sha, gitBlobSha(bytes));
  const localId = 'bracket-local';
  const script = importMeshScript('Bracket.mesh');
  const doc = {
    ...empty,
    activeId: localId,
    parts: [{ id: localId, name: 'Bracket', visible: true, order: 0 }],
  };
  const scripts = { [localId]: script };
  const records = {
    [localId]: { assets: { 'Bracket.mesh': sha }, meshSynced: false },
  };
  assert.equal(showLocalMeshBadge({
    signedIn: true, meshLocal: true, meshSynced: false,
  }), true);
  assert.equal(showLocalMeshBadge({
    signedIn: false, meshLocal: true, meshSynced: false,
  }), false);

  const tree = await gh.listTree(repo, 'main');
  const placed = placeLocalMeshParts(doc, scripts, {
    occupied: tree.map((entry) => entry.path),
  });
  const partId = placed.doc.parts[0].id;
  const partPath = partRepoPath(placed.doc.parts[0]);
  const meshPath = assetPathForScript(partPath);
  assert.equal(parseVaultPath(partPath).kind, 'assembly-part');
  assert.equal(meshPath, 'assemblies/Gearbox/Bracket.mesh');
  const movedRecords = remapMeshRecords(records, placed.moved);
  const collected = await collectMeshCommitAssets({
    doc: placed.doc,
    scripts: placed.scripts,
    records: movedRecords,
    baseline: opened.baseline,
    tree,
  });
  assert.equal(collected.skipped.length, 0);
  sameBytes(collected.assets[meshPath], bytes);
  const assembled = await assembleCommitFiles(gh, repo, {
    doc: placed.doc,
    scripts: placed.scripts,
    baseline: opened.baseline,
    message: 'Add Bracket',
    assets: collected.assets,
  });
  assert.equal(assembled.status, 'ready');
  const savePaths = assembled.files.filter((file) => !file.delete).map((file) => file.path);
  assert.ok(savePaths.includes(partPath));
  assert.ok(savePaths.includes(meshPath));
  const commitsBefore = gh._log.filter((entry) => entry.op === 'commitFiles').length;
  await store.enqueue(repo, {
    op: 'save',
    branch: 'main',
    message: assembled.message,
    partIds: [partId],
    files: assembled.files,
    payload: { meshes: collected.marks.filter((mark) => !mark.adopted) },
  });
  const offline = await flushSyncQueue({
    store, adapter: gh, repo, branch: 'main', online: false,
  });
  assert.equal(offline.status, 'offline');
  const queuedMesh = store.pending(repo, 'main')[0].files.find((file) => file.path === meshPath);
  sameBytes(queuedMesh.content, bytes);
  const flushed = await flushSyncQueue({
    store, adapter: gh, repo, branch: 'main', online: true,
  });
  assert.equal(flushed.status, 'synced');
  const saveCommits = gh._log.filter((entry) => entry.op === 'commitFiles').slice(commitsBefore);
  assert.equal(saveCommits.length, 1);
  assert.ok(saveCommits[0].paths.includes(partPath));
  assert.ok(saveCommits[0].paths.includes(meshPath));
  assert.equal(flushed.meshes.length, 1);
  assert.equal(flushed.meshes[0].meshSynced, undefined);
  assert.equal(showLocalMeshBadge({
    signedIn: true,
    meshLocal: true,
    meshSynced: true,
  }), false);
  const treeSha = (await gh.listTree(repo, 'main')).find((entry) => entry.path === meshPath).sha;
  assert.equal(treeSha, gitBlobSha(bytes));

  await clearAssetCache();
  assert.equal(await getAssetBytes(treeSha), null);
  let blobReads = 0;
  const readBlob = gh.readBlob.bind(gh);
  gh.readBlob = async (readRepo, blobSha) => {
    blobReads += 1;
    return readBlob(readRepo, blobSha);
  };
  const again = await openVaultAssembly(gh, repo, 'Gearbox');
  assert.ok(blobReads >= 1, 'reopen reads the mesh with readBlob');
  const readsAfterOpen = blobReads;
  const againPath = partRepoPath(again.doc.parts[0]);
  const againMesh = assetPathForScript(againPath);
  const cached = await readMeshBytes(
    gh, repo, 'main', againMesh, again.baseline.assets[againMesh],
  );
  assert.equal(cached.source, 'cache');
  assert.equal(blobReads, readsAfterOpen);
  const meshRecords = partMeshRecordsFromBaseline(
    again.doc,
    again.scripts,
    again.baseline.assets,
  );
  const bound = meshRecords[again.doc.parts[0].id];
  assert.equal(bound.meshSynced, true);
  assert.equal(bound.assets['Bracket.mesh'], treeSha);
  const rendered = await resolvePartMeshes(again.doc.parts[0].id, again.scripts[again.doc.parts[0].id], {
    assets: bound.assets,
  });
  assert.deepEqual(rendered.missing, []);
  const mesh = rendered.importedModels['Bracket.mesh'];
  assert.equal(mesh.vertProperties.length, 9);
  assert.equal(mesh.vertProperties[3], 1);
  assert.deepEqual(Array.from(mesh.triVerts), [0, 1, 2]);

  const fromId = again.doc.parts[0].id;
  const from = againPath;
  const to = planPartPath(from, 'Plate');
  const plateMesh = assetPathForScript(to);
  await store.enqueue(repo, {
    op: 'rename',
    branch: 'main',
    message: 'Rename Bracket to Plate',
    partIds: [fromId],
    payload: {
      kind: 'part',
      from,
      to,
      content: again.scripts[fromId] || again.scripts[from],
      label: 'Plate',
    },
  });
  const renamed = await flushSyncQueue({
    store, adapter: gh, repo, branch: 'main', online: true,
  });
  assert.equal(renamed.status, 'synced');
  const afterRename = await gh.listTree(repo, 'main');
  assert.equal(afterRename.some((entry) => entry.path === meshPath), false);
  assert.equal(afterRename.some((entry) => entry.path === from), false);
  const plateEntry = afterRename.find((entry) => entry.path === plateMesh);
  assert.ok(plateEntry);
  sameBytes(await gh.readBlob(repo, plateEntry.sha), bytes);
  assert.equal(parseVaultPath(plateMesh).kind, 'asset');

  const cleared = { ...empty };
  await store.enqueue(repo, {
    op: 'delete',
    branch: 'main',
    message: 'Delete Plate.js',
    partIds: [to],
    files: [
      fileDelete(plateMesh),
      fileDelete(to),
      fileWrite(assemblyFilePath('Gearbox'), stringifySurfJson(cleared)),
    ],
  });
  const removed = await flushSyncQueue({
    store, adapter: gh, repo, branch: 'main', online: true,
  });
  assert.equal(removed.status, 'synced');
  const afterDelete = await gh.listTree(repo, 'main');
  assert.equal(afterDelete.some((entry) => entry.path === plateMesh), false);
  assert.equal(afterDelete.some((entry) => entry.path === to), false);
  assert.equal(afterDelete.some((entry) => entry.path.endsWith('.mesh')), false);
}

async function main() {
  try {
    await meshVaultSyncScenario();
    console.log('mesh vault sync golden passed');
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}

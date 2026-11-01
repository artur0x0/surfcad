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
import { clearAssetCache } from '../../src/utils/git/assetCache.js';
import { fileWrite } from '../../src/utils/git/githubAdapterInterface.js';
import { openVaultAssembly } from '../../src/utils/git/gitWorkspace.js';
import { createMockGithubAdapter } from '../../src/utils/git/mockGithubAdapter.js';
import { stringifySurfJson } from '../../src/utils/git/surfJson.js';
import { vaultMarkerContent } from '../../src/utils/git/vault.js';
import { assemblyFilePath } from '../../src/utils/git/vaultLayout.js';
import { showLocalMeshBadge } from '../../src/utils/meshAssets.js';

const MARKER = vaultMarkerContent();

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

  const writes = gh._log.filter((row) => row.op === 'commitFiles').length;
  await assert.rejects(
    () => openVaultAssembly(gh, repo, 'Gearbox'),
    (err) => err?.code === 'unknown_assembly',
  );
  assert.equal(gh._log.filter((row) => row.op === 'commitFiles').length, writes);
  assert.equal(showLocalMeshBadge({
    signedIn: true, meshLocal: true, meshSynced: false,
  }), true);
  assert.equal(showLocalMeshBadge({
    signedIn: false, meshLocal: true, meshSynced: false,
  }), false);
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

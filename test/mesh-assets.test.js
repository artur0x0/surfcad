import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { runAssemblyParts } from '../src/utils/assemblyRun.js';
import { putAsset, getAssetBytes } from '../src/utils/git/assetCache.js';
import { gitBlobSha, VAULT_FILE_MAX_BYTES, VAULT_FILE_WARN_BYTES } from '../src/utils/git/binaryContent.js';
import {
  RAW_UPLOAD_MAX_BYTES,
  checkRawUpload,
  checkStoredMesh,
  dedupedImportName,
  importMeshScript,
  localMeshBadgeTitle,
  meshAssetName,
  meshResolveError,
  rememberPartAssets,
  resolvePartMeshes,
  selectedPartDownload,
  showLocalMeshBadge,
} from '../src/utils/meshAssets.js';
import { decodeMesh, encodeMesh } from '../src/utils/meshFormat.js';

const triangle = {
  numProp: 3,
  vertProperties: Float32Array.of(0, 0, 0, 1, 0, 0, 0, 1, 0),
  triVerts: Uint32Array.of(0, 1, 2),
};

test('mesh encode and decode round-trip a triangle', () => {
  const bytes = encodeMesh(triangle);
  assert.equal(String.fromCharCode(...bytes.subarray(0, 4)), 'MESH');
  const back = decodeMesh(bytes);
  assert.equal(back.numProp, 3);
  assert.deepEqual(Array.from(back.vertProperties), Array.from(triangle.vertProperties));
  assert.deepEqual(Array.from(back.triVerts), Array.from(triangle.triVerts));
  assert.throws(() => decodeMesh(new Uint8Array([1, 2, 3, 4])), /too small|Not a SurfCAD mesh/);
});

test('git blob sha matches sha1 of the git header and the empty blob', () => {
  const bytes = encodeMesh(triangle);
  const header = Buffer.from(`blob ${bytes.byteLength}\0`, 'utf8');
  const expect = createHash('sha1').update(header).update(Buffer.from(bytes)).digest('hex');
  assert.equal(gitBlobSha(bytes), expect);
  assert.equal(gitBlobSha(new Uint8Array()), 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391');
});

test('putAsset stores bytes that getAssetBytes returns', async () => {
  const bytes = encodeMesh(triangle);
  const sha = await putAsset(bytes);
  assert.equal(sha, gitBlobSha(bytes));
  const back = await getAssetBytes(sha);
  assert.ok(back instanceof Uint8Array);
  assert.equal(back.byteLength, bytes.byteLength);
  assert.equal(back[0], bytes[0]);
  assert.equal(await getAssetBytes('0'.repeat(40)), null);
});

test('upload caps reject a raw file over 32 MiB and a mesh over 40, and warn over 20', () => {
  assert.equal(checkRawUpload(RAW_UPLOAD_MAX_BYTES).ok, true);
  const raw = checkRawUpload(RAW_UPLOAD_MAX_BYTES + 1);
  assert.equal(raw.ok, false);
  assert.match(raw.message, /32 MiB/);

  assert.equal(checkStoredMesh(VAULT_FILE_WARN_BYTES).warn, false);
  const warn = checkStoredMesh(VAULT_FILE_WARN_BYTES + 1);
  assert.equal(warn.ok, true);
  assert.equal(warn.warn, true);
  assert.match(warn.message, /saved on this device/);

  const over = checkStoredMesh(VAULT_FILE_MAX_BYTES + 1);
  assert.equal(over.ok, false);
  assert.match(over.message, /40 MiB/);
});

test('import names drop the extension and number a collision', () => {
  assert.equal(dedupedImportName('bracket.stl', []), 'bracket');
  assert.equal(dedupedImportName('bracket.stl', ['bracket']), 'bracket (2)');
  assert.equal(dedupedImportName('Bracket.STEP', ['Bracket', 'Bracket (2)']), 'Bracket (3)');
  assert.equal(meshAssetName('bracket (2)'), 'bracket (2).mesh');
  assert.equal(importMeshScript('bracket (2).mesh'), "return importMesh('bracket (2).mesh');\n");
});

test('a non-active part is preloaded, and a missing asset fails only that part', async () => {
  const bytes = encodeMesh(triangle);
  const sha = await putAsset(bytes);
  rememberPartAssets('b', { 'Wedge.mesh': sha });
  const doc = {
    source: 'local',
    name: 'BracketBox',
    activeId: 'a',
    parts: [
      { id: 'a', name: 'Block', visible: true, order: 0 },
      { id: 'b', name: 'Wedge', visible: true, order: 1 },
      { id: 'c', name: 'Gone', visible: true, order: 2 },
    ],
  };
  const scripts = {
    a: 'let part = Manifold.cube([10, 10, 10], true);\nreturn part;\n',
    b: "return importMesh('Wedge.mesh');\n",
    c: "return importMesh('gone.mesh');\n",
  };
  const seen = [];
  const result = await runAssemblyParts({
    doc,
    scripts,
    execute: async (script, opts) => {
      seen.push({ script, importedModels: opts?.importedModels });
      return { mesh: { vertProperties: triangle.vertProperties, triVerts: triangle.triVerts } };
    },
  });
  const wedge = seen.find((row) => row.script.includes("importMesh('Wedge.mesh')"));
  assert.ok(wedge, 'non-active upload ran');
  assert.equal(wedge.importedModels['Wedge.mesh'].vertProperties.length, 9);
  assert.equal(seen.some((row) => row.script.includes("importMesh('gone.mesh')")), false);
  assert.match(result.runs.c.error, /Missing mesh asset/);
  assert.equal(result.runs.b.ok, true);
  assert.equal(result.runs.a.ok, true);
});

test('a rolled-back empty part is empty, not a missing manifold', async () => {
  const doc = {
    source: 'local',
    name: 'BracketBox',
    activeId: 'a',
    parts: [{ id: 'a', name: 'Block', visible: true, order: 0 }],
  };
  const result = await runAssemblyParts({
    doc,
    scripts: { a: 'let part = Manifold.cube([10, 10, 10], true);\nreturn part;\n' },
    execute: async () => ({ ok: true, cleared: true }),
  });
  assert.equal(result.runs.a.ok, false);
  assert.equal(result.runs.a.empty, true);
  assert.equal(result.runs.a.mesh, null);
  assert.notEqual(result.runs.a.error, 'Script must return a Manifold object');
  assert.equal(result.solids.some((solid) => solid.id === 'a'), false);
});

test('selected-part download refuses hidden and failed parts', () => {
  const mesh = { vertProperties: triangle.vertProperties, triVerts: triangle.triVerts };
  const hidden = selectedPartDownload({
    part: { name: 'Wedge', visible: false },
    leftover: mesh,
  });
  assert.equal(hidden.ok, false);
  assert.match(hidden.message, /hidden/);

  const failed = selectedPartDownload({
    part: { name: 'Wedge', visible: true },
    run: { ok: false, error: 'Missing mesh asset: Wedge.mesh' },
    leftover: mesh,
  });
  assert.equal(failed.ok, false);
  assert.equal(failed.mesh, undefined);
  assert.match(failed.message, /Missing mesh asset/);

  const kept = selectedPartDownload({
    part: { name: 'Wedge', visible: true },
    leftover: mesh,
  });
  assert.equal(kept.ok, true);
  assert.equal(kept.mesh, mesh);
  assert.equal(kept.filename, 'Wedge');

  const cold = selectedPartDownload({ part: { name: 'Wedge', visible: true } });
  assert.equal(cold.ok, false);
  assert.equal(cold.needsRun, true);
});

test('an unresolved importMesh keeps the line error instead of a throw', async () => {
  const prepared = await resolvePartMeshes('part', "return importMesh('Bracket.mesh');\n", {
    assets: {},
    getAssetBytes: async () => { throw new Error('cache down'); },
  });
  assert.deepEqual(prepared.missing, ['Bracket.mesh']);
  assert.equal(prepared.importedModels['Bracket.mesh'], undefined);
  assert.equal(
    meshResolveError(prepared.missing, 'Missing mesh asset: Bracket.mesh'),
    'Missing mesh asset: Bracket.mesh',
  );
  assert.match(meshResolveError(prepared.missing, ''), /Bracket\.mesh/);
});

test('the local-only badge follows signed-in state, not the GitHub token', () => {
  assert.equal(showLocalMeshBadge({ signedIn: false, meshLocal: true, meshSynced: false }), false);
  assert.equal(showLocalMeshBadge({ signedIn: true, meshLocal: true, meshSynced: false }), true);
  assert.equal(showLocalMeshBadge({ signedIn: true, meshLocal: true, meshSynced: true }), false);
  assert.equal(showLocalMeshBadge({ signedIn: true, meshLocal: false, meshSynced: false }), false);
  assert.match(localMeshBadgeTitle(true), /vault/);
  assert.match(localMeshBadgeTitle(false), /GitHub is connected/);
});

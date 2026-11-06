/**
 * STEP import stays on the device.
 *
 * The app converts STEP with the Open CASCADE wasm module in a worker. It
 * must not upload the file, must not fall back to the server converter, and
 * must not ask for a sign-in first. The server route still exists
 * (backend/routes/convert.js) for callers outside the app; nothing under
 * src/ may reach it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

async function sourceFiles(dir, out = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await sourceFiles(path, out);
    else if (/\.(?:js|jsx|mjs|ts|tsx)$/.test(entry.name)) out.push(path);
  }
  return out;
}

test('no client source names the server convert route', async () => {
  const hits = [];
  for (const path of await sourceFiles(join(root, 'src'))) {
    const text = await readFile(path, 'utf8');
    if (/api\/convert|convert\/step/.test(text)) hits.push(path.slice(root.length));
  }
  assert.deepEqual(hits, []);
});

test('the STEP import path makes no network request for the file', async () => {
  const importModel = await readFile(join(root, 'src/utils/importModel.js'), 'utf8');
  assert.doesNotMatch(importModel, /\bfetch\s*\(/);
  assert.doesNotMatch(importModel, /FormData|VITE_API_URL|credentials:/);
  assert.match(importModel, /stepClient\.js/);
  assert.match(importModel, /importMeshData/);

  const client = await readFile(join(root, 'src/step/stepClient.js'), 'utf8');
  assert.doesNotMatch(client, /\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon/);

  const worker = await readFile(join(root, 'src/workers/stepWorker.js'), 'utf8');
  assert.doesNotMatch(worker, /\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|importScripts/);

  // The only fetch in the module loader is for the wasm file itself.
  const mesh = await readFile(join(root, 'src/step/stepMesh.js'), 'utf8');
  const fetches = mesh.match(/\bfetch\s*\([^)]*\)/g) || [];
  assert.deepEqual(fetches, ['fetch(url)']);
  assert.match(mesh, /new URL\('\.\.\/\.\.\/packages\/surfcad-step\/pkg\/surfcad_step\.wasm', import\.meta\.url\)/);
});

test('STEP upload does not require a session', async () => {
  const app = await readFile(join(root, 'src/App.jsx'), 'utf8');
  assert.doesNotMatch(app, /Sign in to import STEP/);
  assert.doesNotMatch(app, /isBackendFormat/);
  const importModel = await readFile(join(root, 'src/utils/importModel.js'), 'utf8');
  assert.doesNotMatch(importModel, /Sign in to import STEP/);
});

test('the server converter is still in the tree, behind auth', async () => {
  const route = await readFile(join(root, 'backend/routes/convert.js'), 'utf8');
  assert.match(route, /requireAuth/);
  const app = await readFile(join(root, 'backend/serverApp.js'), 'utf8');
  assert.match(app, /convertRoutes/);
});

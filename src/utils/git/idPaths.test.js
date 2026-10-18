import assert from 'node:assert/strict';
import test from 'node:test';
import { mintSurfId } from './surfId.js';
import {
  assemblyFilePath,
  parseIdPath,
  partFilePath,
  partMeshPath,
} from './idPaths.js';

const ID = mintSurfId({ now: new Date('2026-10-18T02:50:00.001Z'), rand: 'aa01' });

test('f(id) helpers round-trip part, mesh, and assembly paths', () => {
  assert.equal(partFilePath(ID), `parts/${ID}.js`);
  assert.equal(partMeshPath(ID), `parts/${ID}.mesh`);
  assert.equal(assemblyFilePath(ID), `assemblies/${ID}.surf.json`);
  assert.deepEqual(parseIdPath(partFilePath(ID)), { kind: 'part', id: ID });
  assert.deepEqual(parseIdPath(partMeshPath(ID)), { kind: 'mesh', id: ID });
  assert.deepEqual(parseIdPath(assemblyFilePath(ID)), { kind: 'assembly', id: ID });
});

test('parseIdPath rejects name-based v1 paths and a non-id stem', () => {
  assert.equal(parseIdPath('assemblies/Gearbox/.surf.json'), null);
  assert.equal(parseIdPath('assemblies/Gearbox/Gearbox.surf.json'), null);
  assert.equal(parseIdPath('parts/Bracket.js'), null);
  assert.equal(parseIdPath('parts/Bracket.mesh'), null);
  assert.equal(parseIdPath(`assemblies/${ID}/.surf.json`), null);
});

test('f(id) helpers refuse a display name', () => {
  assert.throws(() => partFilePath('Bracket'), /Bad surf id/);
  assert.throws(() => partMeshPath('Bracket'), /Bad surf id/);
  assert.throws(() => assemblyFilePath('Gearbox'), /Bad surf id/);
});

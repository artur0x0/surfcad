import assert from 'node:assert/strict';
import test from 'node:test';
import { mintSurfId } from './surfId.js';
import {
  assemblyIdPath,
  parseIdPath,
  partIdPath,
  partMeshIdPath,
} from './idPaths.js';

const ID = mintSurfId({ now: new Date('2026-10-18T02:50:00.001Z'), rand: 'aa01' });
const LOCAL = `local-${ID}`;

test('f(id) helpers round-trip part, mesh, and assembly paths', () => {
  assert.equal(partIdPath(ID), `parts/${ID}.js`);
  assert.equal(partMeshIdPath(ID), `parts/${ID}.mesh`);
  assert.equal(assemblyIdPath(ID), `assemblies/${ID}.surf.json`);
  assert.deepEqual(parseIdPath(partIdPath(ID)), { kind: 'part', id: ID });
  assert.deepEqual(parseIdPath(partMeshIdPath(ID)), { kind: 'mesh', id: ID });
  assert.deepEqual(parseIdPath(assemblyIdPath(ID)), { kind: 'assembly', id: ID });
});

test('parseIdPath rejects name-based v1 paths and a non-id stem', () => {
  assert.equal(parseIdPath('assemblies/Gearbox/.surf.json'), null);
  assert.equal(parseIdPath('assemblies/Gearbox/Gearbox.surf.json'), null);
  assert.equal(parseIdPath('parts/Bracket.js'), null);
  assert.equal(parseIdPath('parts/Bracket.mesh'), null);
  assert.equal(parseIdPath(`assemblies/${ID}/.surf.json`), null);
});

test('f(id) helpers refuse a display name and a local- id', () => {
  assert.throws(() => partIdPath('Bracket'), /Bad surf id/);
  assert.throws(() => partMeshIdPath('Bracket'), /Bad surf id/);
  assert.throws(() => assemblyIdPath('Gearbox'), /Bad surf id/);
  assert.throws(() => partIdPath(LOCAL), /Bad surf id/);
  assert.throws(() => assemblyIdPath(LOCAL), /Bad surf id/);
  assert.equal(parseIdPath(`parts/${LOCAL}.js`), null);
  assert.equal(parseIdPath(`assemblies/${LOCAL}.surf.json`), null);
});

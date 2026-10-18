import assert from 'node:assert/strict';
import test from 'node:test';
import {
  findPartById,
  rejectAssemblyId,
  rejectPartId,
  unknownAssemblyError,
} from './identity.js';

const PART = '2026-10-18-02-50-00-0001-bb02';
const ASM = '2026-10-18-02-50-00-0001-aa01';

test('rejectPartId refuses empty values and vault paths', () => {
  assert.equal(rejectPartId(undefined)?.code, 'bad_args');
  assert.equal(rejectPartId('')?.code, 'bad_args');
  assert.equal(rejectPartId('parts/Bracket.js')?.code, 'unknown_part');
  assert.equal(rejectPartId('assemblies/Box/Bracket.js')?.code, 'unknown_part');
  assert.equal(rejectPartId(PART), null);
});

test('rejectAssemblyId refuses empty values, names-as-paths, and vault paths', () => {
  assert.equal(rejectAssemblyId('')?.code, 'bad_args');
  assert.equal(rejectAssemblyId('assemblies/Gearbox.surf.json')?.code, 'unknown_assembly');
  assert.equal(rejectAssemblyId(ASM), null);
  assert.match(unknownAssemblyError('x').message, /list_assemblies/);
});

test('findPartById matches row.id only', () => {
  const doc = {
    parts: [
      { id: PART, name: 'Bracket', path: 'parts/old.js' },
      { id: 'other', name: 'Cover' },
    ],
  };
  assert.equal(findPartById(doc, PART)?.name, 'Bracket');
  assert.equal(findPartById(doc, 'Bracket'), null);
  assert.equal(findPartById(doc, 'parts/old.js'), null);
  assert.equal(findPartById(doc, 'missing'), null);
});

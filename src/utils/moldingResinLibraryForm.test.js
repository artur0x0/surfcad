import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { libraryPayload } from './moldingResinLibraryForm.js';

const complete = {
  grade: 'ABS',
  tensileModulusMpa: '2300',
  shrinkLowPct: '0.4',
  shrinkHighPct: '0.7',
  wallMinMm: '1.2',
  wallMaxMm: '3.5',
  meltTempLowC: '220',
  meltTempHighC: '260',
  moldTempLowC: '40',
  moldTempHighC: '80',
  notes: 'lab',
  active: true,
};

describe('molding resin library form', () => {
  test('a complete form has properties and no price', () => {
    const parsed = libraryPayload(complete);
    assert.equal(parsed.value.grade, 'ABS');
    assert.equal(parsed.value.tensileModulusMpa, 2300);
    assert.equal(parsed.value.shrinkLowPct, 0.4);
    assert.equal(parsed.value.usdPerKg, undefined);
    assert.equal(parsed.value.partnerId, undefined);
  });

  test('a blank modulus and an inverted wall are rejected', () => {
    assert.match(libraryPayload({ ...complete, tensileModulusMpa: '' }).error, /required/);
    assert.match(libraryPayload({ ...complete, tensileModulusMpa: null }).error, /required/);
    assert.match(libraryPayload({ ...complete, wallMinMm: '4', wallMaxMm: '1' }).error, /Wall min/);
  });
});

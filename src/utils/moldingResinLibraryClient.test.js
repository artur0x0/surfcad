import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchMoldingResinLibrary } from './moldingResinLibraryClient.js';

test('the library client keeps properties and drops a price payload', async () => {
  const ok = await fetchMoldingResinLibrary(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      source: 'seed',
      resins: [{ grade: 'ABS', tensileModulusMpa: 2300 }],
    }),
  }));
  assert.equal(ok.resins[0].grade, 'ABS');
  const priced = await fetchMoldingResinLibrary(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ resins: [{ grade: 'ABS', usdPerKg: 2 }] }),
  }));
  assert.equal(priced.error.code, 'library_unavailable');
});

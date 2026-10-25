import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { assemblyPartPath, sharedPartPath } from '../src/utils/git/vaultLayout.js';
import {
  allocateVaultPartPath,
  ensureAssemblyVaultPaths,
  partRowVaultPathOk,
} from '../src/utils/git/partVaultPath.js';
import { stringifySurfJson, toSurfJson, validateSurfJson } from '../src/utils/git/surfJson.js';
import { mintSurfId } from '../src/utils/git/surfId.js';

describe('allocateVaultPartPath', () => {
  test('bare name lands in the assembly folder with .js', () => {
    const path = allocateVaultPartPath('Kettle', 'Kettle Body', []);
    assert.equal(path, assemblyPartPath('Kettle', 'Kettle Body'));
    assert.ok(path.endsWith('.js'));
  });

  test('path without .js is normalized', () => {
    const path = allocateVaultPartPath('Kettle', 'parts/Bracket', []);
    assert.equal(path, sharedPartPath('Bracket'));
  });

  test('duplicate names get -2 suffix in assembly folder', () => {
    const first = assemblyPartPath('Kettle', 'Handle');
    const second = allocateVaultPartPath('Kettle', 'Handle', [first], { layout: 'assembly-folder' });
    assert.equal(second, assemblyPartPath('Kettle', 'Handle-2'));
  });
});

describe('ensureAssemblyVaultPaths + stringifySurfJson', () => {
  test('repairs path-less agent-style parts for kettle save', () => {
    const when = new Date('2026-10-25T03:07:13.016Z');
    const surfId = mintSurfId({ now: when, rand: 'dcd1' });
    const doc = {
      source: 'git',
      name: 'Kettle',
      activeId: 'local-body',
      parts: [
        { id: 'local-body', name: 'Kettle Body', visible: true, order: 0, surfId },
        {
          id: 'local-lid',
          name: 'Kettle Lid',
          visible: true,
          order: 1,
          surfId: mintSurfId({ now: when, rand: 'dcd2' }),
        },
        {
          id: 'local-handle',
          name: 'Kettle Handle',
          visible: true,
          order: 2,
          surfId: mintSurfId({ now: when, rand: 'dcd3' }),
        },
      ],
    };
    const scripts = {
      'local-body': '// body\n',
      'local-lid': '// lid\n',
      'local-handle': '// handle\n',
    };
    const { doc: fixed, scripts: fixedScripts, moved } = ensureAssemblyVaultPaths(doc, scripts);
    assert.equal(moved.length, 3);
    assert.equal(fixed.parts[0].id, 'local-body');
    assert.ok(partRowVaultPathOk(fixed.parts[0].path));
    const text = stringifySurfJson(fixed);
    const parsed = JSON.parse(text);
    const check = validateSurfJson(parsed);
    assert.equal(check.ok, true, check.errors?.join('; '));
    assert.equal(fixedScripts[fixed.parts[0].id], '// body\n');
  });

  test('invalid path without .js is repaired', () => {
    const bad = assemblyPartPath('Kettle', 'Lid').replace(/\.js$/, '');
    const doc = {
      source: 'git',
      name: 'Kettle',
      activeId: bad,
      parts: [{
        id: bad,
        name: 'Kettle Lid',
        visible: true,
        order: 0,
        surfId: mintSurfId({ now: new Date('2026-10-25T03:07:13.016Z'), rand: 'ee01' }),
      }],
    };
    const { doc: fixed } = ensureAssemblyVaultPaths(doc, { [bad]: '// x\n' });
    assert.ok((fixed.parts[0].path || fixed.parts[0].id).endsWith('.js'));
    assert.equal(validateSurfJson(JSON.parse(stringifySurfJson(fixed))).ok, true);
  });

  test('toSurfJson stays pure: path-less ids still throw', () => {
    assert.throws(
      () => toSurfJson({
        name: 'A',
        source: 'git',
        parts: [{ id: 'local:123', name: 'p', visible: true, order: 0 }],
      }),
      /Invalid \.surf\.json/,
    );
  });

  test('promoting a new part does not mark committed siblings unsynced', () => {
    const alpha = '5f0c3c1e-0000-4000-8000-0000000000aa';
    const beta = '5f0c3c1e-0000-4000-8000-0000000000bb';
    const gamma = '5f0c3c1e-0000-4000-8000-0000000000cc';
    const delta = '5f0c3c1e-0000-4000-8000-0000000000dd';
    const alphaPath = assemblyPartPath('Trio', 'Alpha');
    const betaPath = assemblyPartPath('Trio', 'Beta');
    const gammaPath = assemblyPartPath('Trio', 'Gamma');
    const doc = {
      source: 'git',
      name: 'Trio',
      activeId: alpha,
      parts: [
        { id: alpha, name: 'Alpha', visible: true, order: 0, path: alphaPath, isSynced: true },
        { id: beta, name: 'Beta', visible: true, order: 1, path: betaPath, isSynced: true },
        { id: gamma, name: 'Gamma', visible: true, order: 2, path: gammaPath },
        { id: delta, name: 'Delta', visible: true, order: 3, isSynced: false },
      ],
    };
    const scripts = {
      [alpha]: '// alpha\n',
      [beta]: '// beta\n',
      [gamma]: '// gamma\n',
      [delta]: '// delta\n',
    };
    const { doc: fixed, moved } = ensureAssemblyVaultPaths(doc, scripts);
    assert.equal(moved.length, 1);
    assert.equal(moved[0].id, delta);
    assert.equal(fixed.parts.find((part) => part.id === alpha).isSynced, true);
    assert.equal(fixed.parts.find((part) => part.id === beta).isSynced, true);
    assert.equal(fixed.parts.find((part) => part.id === gamma).isSynced, undefined);
    assert.equal(fixed.parts.find((part) => part.id === delta).isSynced, false);
    assert.equal(fixed.parts.find((part) => part.id === gamma).path, gammaPath);
    assert.ok(fixed.parts.find((part) => part.id === delta).path.endsWith('Delta.js'));
  });
});

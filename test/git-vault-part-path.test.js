import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { assemblyPartPath, sharedPartPath } from '../src/utils/git/vaultLayout.js';
import {
  allocateVaultPartPath,
  ensureAssemblyVaultPaths,
  partRowVaultPathOk,
} from '../src/utils/git/partVaultPath.js';
import { stringifySurfJson, validateSurfJson } from '../src/utils/git/surfJson.js';
import { mintSurfId } from '../src/utils/git/surfId.js';

describe('allocateVaultPartPath', () => {
  test('bare name lands in parts/ with .js', () => {
    const path = allocateVaultPartPath('Kettle', 'Kettle Body', []);
    assert.equal(path, sharedPartPath('Kettle Body'));
    assert.ok(path.endsWith('.js'));
  });

  test('path without .js is normalized', () => {
    const path = allocateVaultPartPath('Kettle', 'parts/Bracket', []);
    assert.equal(path, sharedPartPath('Bracket'));
  });

  test('duplicate names get (2) suffix in assembly folder', () => {
    const first = assemblyPartPath('Kettle', 'Handle');
    const second = allocateVaultPartPath('Kettle', 'Handle', [first], { layout: 'assembly-folder' });
    assert.equal(second, assemblyPartPath('Kettle', 'Handle (2)'));
  });
});

describe('ensureAssemblyVaultPaths + stringifySurfJson', () => {
  test('repairs path-less agent-style parts for kettle save', () => {
    const surfId = mintSurfId();
    const doc = {
      source: 'git',
      name: 'Kettle',
      activeId: 'local-body',
      parts: [
        { id: 'local-body', name: 'Kettle Body', visible: true, order: 0, surfId },
        { id: 'local-lid', name: 'Kettle Lid', visible: true, order: 1, surfId: mintSurfId() },
        { id: 'local-handle', name: 'Kettle Handle', visible: true, order: 2, surfId: mintSurfId() },
      ],
    };
    const scripts = {
      'local-body': '// body\n',
      'local-lid': '// lid\n',
      'local-handle': '// handle\n',
    };
    const { doc: fixed, scripts: fixedScripts, moved } = ensureAssemblyVaultPaths(doc, scripts);
    assert.equal(moved.length, 3);
    assert.ok(partRowVaultPathOk(fixed.parts[0].id));
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
      parts: [{ id: bad, name: 'Kettle Lid', visible: true, order: 0, surfId: mintSurfId() }],
    };
    const { doc: fixed } = ensureAssemblyVaultPaths(doc, { [bad]: '// x\n' });
    assert.ok(fixed.parts[0].id.endsWith('.js'));
    assert.equal(validateSurfJson(JSON.parse(stringifySurfJson(fixed))).ok, true);
  });
});

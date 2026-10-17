import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { assemblyPartPath } from '../src/utils/git/vaultLayout.js';
import {
  partRowNeedsVaultPath,
  promoteStrayPartsToAssemblyFolder,
} from '../src/utils/git/partVaultPath.js';

describe('promoteStrayPartsToAssemblyFolder', () => {
  test('assigns assembly-folder paths from part names', () => {
    const doc = {
      source: 'git',
      name: 'Kettle',
      activeId: 'local-a',
      parts: [
        { id: 'local-a', name: 'Kettle Body', visible: true, order: 0 },
        { id: 'local-b', name: 'Kettle Lid', visible: true, order: 1 },
      ],
    };
    const scripts = { 'local-a': '// body\n', 'local-b': '// lid\n' };
    const { doc: next, scripts: nextScripts, moved } = promoteStrayPartsToAssemblyFolder(doc, scripts);
    const body = assemblyPartPath('Kettle', 'Kettle Body');
    const lid = assemblyPartPath('Kettle', 'Kettle Lid');
    assert.equal(moved.length, 2);
    assert.equal(next.parts[0].id, body);
    assert.equal(next.parts[1].id, lid);
    assert.equal(nextScripts[body], '// body\n');
    assert.equal(nextScripts[lid], '// lid\n');
    assert.equal(next.activeId, body);
  });

  test('suffixes on collision with document and remote paths', () => {
    const existing = assemblyPartPath('Kettle', 'Kettle Handle');
    const doc = {
      source: 'git',
      name: 'Kettle',
      activeId: 'local-h',
      parts: [{ id: 'local-h', name: 'Kettle Handle', visible: true, order: 0 }],
    };
    const { doc: next, moved } = promoteStrayPartsToAssemblyFolder(doc, { 'local-h': '// h\n' }, {
      remotePaths: [existing],
    });
    const alt = assemblyPartPath('Kettle', 'Kettle Handle (2)');
    assert.equal(moved[0].to, alt);
    assert.equal(next.parts[0].id, alt);
  });

  test('repo paths are not stray', () => {
    const id = assemblyPartPath('Gear', 'Bracket');
    assert.equal(partRowNeedsVaultPath({ id }), false);
    assert.equal(partRowNeedsVaultPath({ id: 'local-xyz' }), true);
  });
});

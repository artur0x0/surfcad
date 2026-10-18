/**
 * Part delete: assembly drops on the first tap. Repo delete waits for a
 * second confirm that names the vault file.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  partCanDeleteFromRepo,
  partDeleteChoice,
  partListDeleteAction,
  partRepoDeleteConfirmCopy,
  partRepoFileName,
} from '../src/utils/assembly.js';

const FILE = 'assemblies/Widget/FilletKilla.js';
const COPY = "Delete FilletKilla.js from the repo? This can't be undone from SurfCAD.";

describe('part delete dialog', () => {
  test('assembly delete drops with no second step', () => {
    const next = partDeleteChoice('choose', 'assembly');
    assert.deepEqual(next, { step: null, action: 'drop' });
    assert.equal(partListDeleteAction('confirm'), 'drop');
    assert.equal(partListDeleteAction('assembly'), 'drop');
  });

  test('the first repo tap only opens the second confirm', () => {
    const asked = partDeleteChoice('choose', 'repo');
    assert.deepEqual(asked, { step: 'confirm-repo', action: 'keep' });
    const again = partDeleteChoice('choose', 'repo');
    assert.equal(again.action, 'keep');
    const dropped = partDeleteChoice('confirm-repo', 'repo');
    assert.deepEqual(dropped, { step: null, action: 'drop-repo' });
    assert.equal(partListDeleteAction('repo'), 'drop-repo');
  });

  test('cancel on either step keeps the part', () => {
    assert.equal(partDeleteChoice('choose', 'cancel').action, 'keep');
    assert.equal(partDeleteChoice('confirm-repo', 'cancel').action, 'keep');
    assert.equal(partDeleteChoice('confirm-repo', 'dismiss').action, 'keep');
    assert.equal(partListDeleteAction('dismiss'), 'keep');
    assert.equal(partListDeleteAction(undefined), 'keep');
  });

  test('the second confirm names the vault file, not the row label', () => {
    assert.equal(partRepoFileName(FILE), 'FilletKilla.js');
    assert.equal(partRepoFileName('parts/FilletKilla.js'), 'FilletKilla.js');
    assert.equal(partRepoFileName('assemblies\\Widget\\FilletKilla.js'), 'FilletKilla.js');
    assert.equal(partRepoFileName('parts/My Part.js'), 'My Part.js');
    assert.equal(partRepoDeleteConfirmCopy(FILE), COPY);
    assert.equal(
      partRepoDeleteConfirmCopy(''),
      "Delete this file from the repo? This can't be undone from SurfCAD.",
    );
    assert.equal(COPY.includes('FilletKilla.js'), true);
    assert.equal(COPY.includes('FilletKilla from'), false);
  });

  test('a local id cannot offer repo delete', () => {
    assert.equal(partCanDeleteFromRepo('git', FILE), true);
    assert.equal(partCanDeleteFromRepo('git', 'parts/FilletKilla.js'), true);
    assert.equal(partCanDeleteFromRepo('git', 'local:abc'), false);
    assert.equal(partCanDeleteFromRepo('local', FILE), false);
    assert.equal(partCanDeleteFromRepo('git', 'assemblies/Widget/../FilletKilla.js'), false);
    assert.equal(partCanDeleteFromRepo('git', '2026-10-18-00-00-00-0000-aaaa', FILE), true);
    assert.equal(partCanDeleteFromRepo('git', '2026-10-18-00-00-00-0000-aaaa'), false);
  });
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { blankPartStarter, DEFAULT_SCRIPT } from './defaultScript.js';
import { isBufferEmpty, shouldClearViewportScript } from './helperPaletteSnippets.js';
import { DEFAULT_ASSEMBLY_NAME, DEFAULT_PART_NAME, isDefaultBlankAssembly } from './assembly.js';
import { readSurfId } from './git/surfId.js';

/** Pi 5 acceptance B3: a new blank assembly's part has no demo script. */

import { mintSurfId } from './git/surfId.js';

const SEED = mintSurfId();

test('a local blank part is an empty script', () => {
  assert.equal(blankPartStarter(), '');
  assert.equal(blankPartStarter(null), '');
  assert.equal(isBufferEmpty(''), true);
});

test('a git blank part is only its surf-id header and still counts as empty', () => {
  const starter = blankPartStarter(SEED);
  assert.equal(starter, `// @surf-id ${SEED}\n`);
  assert.equal(readSurfId(starter), SEED);
  assert.equal(isBufferEmpty(starter), true, 'comment-only script is empty');
  assert.equal(shouldClearViewportScript(starter), true, 'running it clears the viewport');
  assert.doesNotMatch(starter, /fillet|loft|hole|cube/);
});

test('the demo script is not the blank starter', () => {
  assert.match(DEFAULT_SCRIPT, /fillet-mode begin/);
  assert.notEqual(blankPartStarter(), DEFAULT_SCRIPT);
});

test('a seeded blank assembly skips the Save | Discard guard in both modes', () => {
  const part = { id: SEED, name: DEFAULT_PART_NAME, visible: true, order: 0 };
  const local = { name: DEFAULT_ASSEMBLY_NAME, parts: [part], activeId: SEED, source: 'local' };
  const git = { ...local, source: 'git' };
  assert.equal(isDefaultBlankAssembly(local, { [SEED]: blankPartStarter() }), true);
  assert.equal(isDefaultBlankAssembly(git, { [SEED]: blankPartStarter(SEED) }), true);
  assert.equal(isDefaultBlankAssembly(git, { [SEED]: `${blankPartStarter(SEED)}let part = Manifold.cube([1, 1, 1]);\n` }), false);
});

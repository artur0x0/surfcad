import assert from 'node:assert/strict';
import test from 'node:test';
import { runScript } from './index.js';

/**
 * A closed shell is one solid with a void. decompose() also returns the
 * negative-volume inner shell. Treating that as its own body unions the
 * filled outer hull and the cavity disappears.
 */
const BOX = 'Manifold.cube([80, 50, 20], true)';
const LIP = 'Manifold.cube([12, 20, 8], true).translate([45, 0, 0])';

function negativeVolume(manifold) {
  const parts = manifold.decompose();
  let neg = 0;
  try {
    for (const part of parts) {
      const v = part.volume();
      if (v < neg) neg = v;
    }
  } finally {
    for (const part of parts) {
      try { part.delete(); } catch { /* freed */ }
    }
  }
  return neg;
}

test('a closed shell is one body and still has an inner shell', async () => {
  const shell = await runScript(`return hollow(${BOX}, 2, 'none');`);
  assert.equal(shell.status, 'NoError');
  assert.equal(shell.bodyCount, 1);
  assert.ok(negativeVolume(shell.manifold) < -1000, 'inner shell missing');
});

test('booleanBodies union of a closed shell keeps the cavity', async () => {
  const shell = await runScript(`return hollow(${BOX}, 2, 'none');`);
  const lip = await runScript(`return ${LIP};`);
  const merged = await runScript([
    `const voided = hollow(${BOX}, 2, 'none');`,
    `const boss = ${LIP};`,
    `return booleanBodies(voided, { op: 'union', tools: [boss] });`,
  ].join('\n'));
  assert.equal(merged.status, 'NoError');
  assert.equal(merged.bodyCount, 1);
  assert.ok(merged.volume > shell.volume, `volume ${merged.volume} did not gain the lip`);
  assert.ok(
    merged.volume < shell.volume + lip.volume + 1,
    `volume ${merged.volume} filled the cavity (shell ${shell.volume}, lip ${lip.volume})`,
  );
  assert.ok(negativeVolume(merged.manifold) < -1000, 'inner shell missing');
});

test('an overlapping merge-on add stays one body and keeps the cavity', async () => {
  const shell = await runScript(`return hollow(${BOX}, 2, 'none');`);
  const lip = await runScript(`return ${LIP};`);
  const merged = await runScript([
    `let part = hollow(${BOX}, 2, 'none');`,
    `part = part.add(${LIP}, { merge: true });`,
    'return part;',
  ].join('\n'));
  assert.equal(merged.status, 'NoError');
  assert.equal(merged.bodyCount, 1);
  assert.ok(merged.volume > shell.volume, `volume ${merged.volume} did not gain the flange`);
  assert.ok(
    merged.volume < shell.volume + lip.volume + 1,
    `volume ${merged.volume} filled the cavity (shell ${shell.volume}, lip ${lip.volume})`,
  );
  assert.ok(negativeVolume(merged.manifold) < -1000, 'inner shell missing');
});

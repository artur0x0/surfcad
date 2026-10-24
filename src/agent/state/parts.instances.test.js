import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPartsState } from './parts.js';

test('parts rows carry instanceOf for part instances and omit it otherwise', () => {
  const out = buildPartsState({
    activeId: 'i2',
    assemblyName: 'Trainer',
    parts: [
      { id: 'r001', name: 'Roller', visible: true, runState: 'ok' },
      { id: 'i2', name: 'Roller (2)', visible: true, instanceOf: 'r001', runState: 'ok' },
      { id: 'x', name: 'X', visible: true, instanceOf: '' },
    ],
  });
  assert.equal('instanceOf' in out.parts[0], false);
  assert.equal(out.parts[1].instanceOf, 'r001');
  assert.equal('instanceOf' in out.parts[2], false);
});

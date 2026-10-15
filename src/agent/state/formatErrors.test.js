import assert from 'node:assert/strict';
import test from 'node:test';
import { formatAgentErrors } from './formatErrors.js';

const SCRIPT = `// --- cube begin id=cube1 ---
let part = Manifold.cube([10, 10, 10], true);
// --- cube end ---
// --- hole begin id=hole1 ---
part = part.subtract(Manifold.cylinder(12, 2, 2, 12, true));
// --- hole end ---
return part;
`;

test('formatAgentErrors returns an empty list when there are no messages', () => {
  assert.deepEqual(formatAgentErrors({}), []);
});

test('formatAgentErrors maps plain messages to build_failed rows', () => {
  assert.deepEqual(formatAgentErrors({ messages: ['bad solid'] }), [
    { code: 'build_failed', message: 'bad solid' },
  ]);
});

test('formatAgentErrors attaches featureIndex when runFailure has an id', () => {
  const rows = formatAgentErrors({
    messages: ['subtract failed'],
    script: SCRIPT,
    runFailure: { id: 'hole1' },
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].code, 'feature_failed');
  assert.equal(rows[0].message, 'subtract failed');
  assert.equal(rows[0].featureIndex, 1);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { formatAgentErrors, kernelExceptionDetail } from './formatErrors.js';

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
  assert.equal(rows[0].featureId, 'hole1');
  assert.equal(rows[0].featureType, 'hole');
  assert.equal(rows[0].featureLabel, 'Hole');
});

test('formatAgentErrors names the feature instead of a generic Feature failed', () => {
  const rows = formatAgentErrors({
    messages: ['Feature failed'],
    script: SCRIPT,
    runFailure: { id: 'hole1' },
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].code, 'feature_failed');
  assert.equal(rows[0].message, 'Hole failed');
  assert.equal(rows[0].featureType, 'hole');
  assert.equal(rows[0].featureLabel, 'Hole');
  assert.equal(rows[0].detail, undefined);
  const unnamed = formatAgentErrors({
    script: SCRIPT,
    runFailure: { id: 'hole1' },
  });
  assert.equal(unnamed[0].message, 'Hole failed');
});

test('formatAgentErrors prefers the viewport message and keeps kernel detail', () => {
  const rows = formatAgentErrors({
    messages: ['Error: not a solid'],
    script: SCRIPT,
    runFailure: {
      id: 'hole1',
      kind: 'hole',
      message: 'Hole failed: not a solid',
      detail: 'at hole (runtime.js:12)',
    },
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].code, 'feature_failed');
  assert.equal(rows[0].message, 'Hole failed: not a solid');
  assert.equal(rows[0].featureType, 'hole');
  assert.equal(rows[0].featureLabel, 'Hole');
  assert.equal(rows[0].detail, 'at hole (runtime.js:12)');
  assert.equal(rows[0].message.includes('Feature failed'), false);
});

test('kernelExceptionDetail drops the popup line and keeps the stack frame', () => {
  const error = new Error('Hole failed: not a solid');
  error.stack = 'Error: Hole failed: not a solid\n    at hole (runtime.js:12:3)';
  assert.equal(
    kernelExceptionDetail(error, 'Hole failed: not a solid'),
    'at hole (runtime.js:12:3)',
  );
  error.detail = 'manifold status NotManifold';
  assert.equal(kernelExceptionDetail(error, 'Hole failed: not a solid'), 'manifold status NotManifold');
});

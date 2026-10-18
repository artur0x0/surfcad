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
      detail: 'RuntimeError',
    },
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].code, 'feature_failed');
  assert.equal(rows[0].message, 'Hole failed: not a solid');
  assert.equal(rows[0].featureType, 'hole');
  assert.equal(rows[0].featureLabel, 'Hole');
  assert.equal(rows[0].detail, 'RuntimeError');
  assert.equal(rows[0].message.includes('Feature failed'), false);
});

const STACK = [
  'at eval (eval at executeScript (http://127.0.0.1:4178/src/lib/surfcad/runtime.js:9241:16), <anonymous>:5:7)',
  'at executeScript (http://127.0.0.1:4178/src/lib/surfcad/runtime.js:9248:12)',
  'at executeSkippingFailedFeatures (http://127.0.0.1:4178/src/lib/surfcad/runtime.js:9301:47)',
].join('\n');

test('formatAgentErrors omits detail when the only extra text is a stack', () => {
  const rows = formatAgentErrors({
    messages: ['Cube failed: result is not a valid solid (NotManifold)', STACK],
    script: SCRIPT,
    runFailure: {
      id: 'cube1',
      message: 'Cube failed: result is not a valid solid (NotManifold)',
      detail: STACK,
    },
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].message, 'Cube failed: result is not a valid solid (NotManifold)');
  assert.equal(rows[0].detail, undefined);
  assert.equal(/https?:\/\//.test(JSON.stringify(rows)), false);
  assert.equal(/\bat\s+/.test(JSON.stringify(rows)), false);
  assert.equal(/\.js:\d+/.test(JSON.stringify(rows)), false);
});

test('kernelExceptionDetail keeps a class, status, or kernel message and drops stacks', () => {
  const error = new Error('Hole failed: not a solid');
  error.stack = `Error: Hole failed: not a solid\n${STACK}`;
  assert.equal(kernelExceptionDetail(error, 'Hole failed: not a solid'), null);

  error.name = 'RuntimeError';
  assert.equal(kernelExceptionDetail(error, 'Hole failed: not a solid'), 'RuntimeError');

  const status = new Error('Hole failed: not a solid');
  status.status = 'NotManifold';
  assert.equal(kernelExceptionDetail(status, 'Hole failed: not a solid'), 'NotManifold');

  const wasm = new Error('Fillet failed');
  wasm.cause = new Error('memory access out of bounds');
  assert.equal(kernelExceptionDetail(wasm, 'Fillet failed'), 'memory access out of bounds');

  const shown = new Error('Cube failed: result is not a valid solid (NotManifold)');
  shown.stack = STACK;
  shown.detail = STACK;
  shown.status = 'NotManifold';
  assert.equal(
    kernelExceptionDetail(shown, 'Cube failed: result is not a valid solid (NotManifold)'),
    null,
  );
});

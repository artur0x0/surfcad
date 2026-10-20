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

test('formatAgentErrors explains a reserved helper redeclaration', () => {
  const rows = formatAgentErrors({
    messages: ["SyntaxError: Identifier 'cut' has already been declared"],
  });
  assert.deepEqual(rows, [{
    code: 'build_failed',
    message: '`cut` is a reserved SurfCAD helper name; rename your variable',
  }]);
  const feature = formatAgentErrors({
    messages: ["Identifier 'hole' has already been declared"],
    script: SCRIPT,
    runFailure: { id: 'hole1', message: "Identifier 'hole' has already been declared" },
  });
  assert.equal(feature[0].code, 'feature_failed');
  assert.equal(feature[0].message, '`hole` is a reserved SurfCAD helper name; rename your variable');
  assert.equal(feature[0].featureIndex, 1);
  const userName = "Identifier 'width' has already been declared";
  assert.equal(formatAgentErrors({ messages: [userName] })[0].message, userName);
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
  // detail is always present on feature_failed; with nothing further it names the feature.
  assert.equal(rows[0].detail, 'hole threw an Error');
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

test('formatAgentErrors drops a stack from detail and falls back to the feature name', () => {
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
  assert.equal(rows[0].detail, 'cube threw an Error');
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

test('feature_failed rows always carry detail; a move failure says how to name the body', () => {
  const script = `// --- move begin id=move1 ---
part = move(part, [0, 15, 0], { bodies: [{ at: [0, 0, 0] }] });
// --- move end ---
return part;
`;
  const msg = 'move: that point is not a body centroid — re-pick the body';
  const [row] = formatAgentErrors({ messages: [msg], script, runFailure: { id: 'move1', message: msg } });
  assert.equal(row.code, 'feature_failed');
  assert.equal(row.message, msg);
  assert.equal(row.featureType, 'move');
  assert.match(row.detail, /list_bodies/);
  assert.match(row.detail, /body_index/);
  const [other] = formatAgentErrors({ messages: ['hollow: wall too thick'], script: '', runFailure: { message: 'hollow: wall too thick' } });
  assert.equal(other.detail, 'hollow threw an Error');
  const [plain] = formatAgentErrors({ messages: ['boom'], script: '', runFailure: { message: 'boom' } });
  assert.equal(plain.detail, 'Error');
});

test('a kernel crash is one geometry_worker_crashed row with reason, workerRestarted, and the fixed detail', () => {
  const crash = { code: 'geometry_worker_crashed', reason: 'out_of_memory', workerRestarted: true, message: 'The geometry engine ran out of memory building this part (heap 4096 MB). It was restarted; other parts are unaffected.' };
  const [row] = formatAgentErrors({ messages: [crash.message], script: '', crash });
  assert.equal(row.code, 'geometry_worker_crashed');
  assert.equal(row.reason, 'out_of_memory');
  assert.equal(row.workerRestarted, true);
  assert.match(row.message, /ran out of memory/);
  assert.match(row.detail, /restarted.*Simplify/);
  // The same record on the run failure (the viewport path) wins over a feature row.
  const script = '// --- code begin id=c1 ---\nreturn part;\n// --- code end ---\n';
  const [viaFailure] = formatAgentErrors({ messages: [], script, runFailure: { id: 'c1', message: crash.message, crash: { ...crash, reason: 'timeout' } } });
  assert.equal(viaFailure.code, 'geometry_worker_crashed');
  assert.equal(viaFailure.reason, 'timeout');
  assert.equal(viaFailure.featureId, 'c1');
  assert.equal(viaFailure.featureIndex, 0);
});

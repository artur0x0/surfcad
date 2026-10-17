import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SCRIPT_SANDBOX_SHADOWS,
  acceptWorkerResult,
  createResultAuth,
  evaluateSandboxedScript,
  freezeWorkerHandlers,
  rewriteDynamicImport,
} from './scriptSandbox.js';
import { bindManifoldModule, executeScript } from '../lib/surfcad/runtime.js';

bindManifoldModule({ setup() {}, Manifold: {} }, { setup: false });

test('rewriteDynamicImport blocks import() and leaves importMesh and strings', () => {
  assert.equal(
    rewriteDynamicImport('const x = import("https://cdn.jsdelivr.net/npm/x")'),
    'const x = __blockedImport("https://cdn.jsdelivr.net/npm/x")',
  );
  assert.equal(rewriteDynamicImport('return importMesh("part.mesh")'), 'return importMesh("part.mesh")');
  assert.equal(rewriteDynamicImport('const s = "import(foo)"'), 'const s = "import(foo)"');
  assert.equal(rewriteDynamicImport('// import("x")\nreturn 1'), '// import("x")\nreturn 1');
  assert.equal(
    rewriteDynamicImport('const t = `n=${import("https://cdn.jsdelivr.net/npm/x")}`'),
    'const t = `n=${__blockedImport("https://cdn.jsdelivr.net/npm/x")}`',
  );
});

test('scripts cannot fetch, dynamically import, or postMessage', () => {
  assert.throws(
    () => executeScript('fetch("https://cdn.jsdelivr.net/npm/x")', {}),
    /not allowed/,
  );
  assert.throws(
    () => executeScript('import("https://cdn.jsdelivr.net/npm/lodash-es/+esm")', {}),
    /not allowed/,
  );
  assert.throws(
    () => executeScript('postMessage({ type: "result", payload: { volume: 1 } })', {}),
    /not allowed/,
  );
  assert.throws(
    () => evaluateSandboxedScript('importScripts("https://cdn.jsdelivr.net/npm/x")'),
    /not allowed/,
  );
});

test('a script cannot keep a writable onmessage across runs', () => {
  const posted = [];
  const rawPost = (msg) => { posted.push(msg); };
  const self = { postMessage: rawPost, onmessage: null };
  const dispatch = (event) => event;
  freezeWorkerHandlers(self, { dispatch, rawPostMessage: rawPost });
  assert.equal(self.onmessage, dispatch);
  assert.throws(() => { self.onmessage = () => { posted.push('forged'); }; }, /not allowed|read only|Cannot assign/i);
  evaluateSandboxedScript('try { onmessage = function () {} } catch (e) {}');
  assert.equal(self.onmessage, dispatch);
  freezeWorkerHandlers(self, { dispatch, rawPostMessage: rawPost });
  assert.equal(self.onmessage, dispatch);
  assert.throws(() => self.postMessage({ type: 'result' }), /not allowed/);
  rawPost({ type: 'result', payload: { ok: true } });
  assert.equal(posted.at(-1).payload.ok, true);
});

test('results without the per-run nonce are rejected', () => {
  const auth = createResultAuth();
  assert.equal(typeof auth, 'string');
  assert.equal(auth.length > 0, true);
  assert.equal(acceptWorkerResult(auth, { resultAuth: auth, volume: 1 }), true);
  assert.equal(acceptWorkerResult(auth, { volume: 1 }), false);
  assert.equal(acceptWorkerResult(auth, { resultAuth: 'forged', volume: 1 }), false);
  assert.equal(acceptWorkerResult(auth, null), false);
});

test('sandbox shadows stay frozen', () => {
  assert.equal(Object.isFrozen(SCRIPT_SANDBOX_SHADOWS), true);
  assert.equal(Object.isFrozen(SCRIPT_SANDBOX_SHADOWS.fetch), true);
});

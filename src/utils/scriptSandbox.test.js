import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  SCRIPT_SANDBOX_SHADOWS,
  acceptWorkerResult,
  attachHostPort,
  createResultAuth,
  evaluateSandboxedScript,
  freezeWorkerHandlers,
  generateWorkerRequestId,
  isWorkerHostMessage,
  lockScriptIntrinsics,
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
  assert.equal(
    rewriteDynamicImport('const x = import/*x*/("https://cdn.jsdelivr.net/npm/x")'),
    'const x = __blockedImport("https://cdn.jsdelivr.net/npm/x")',
  );
  assert.equal(
    rewriteDynamicImport('im\\u0070ort("https://cdn.jsdelivr.net/npm/x")'),
    '__blockedImport("https://cdn.jsdelivr.net/npm/x")',
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
  self.onmessage = () => { posted.push('forged'); };
  freezeWorkerHandlers(self, { dispatch, rawPostMessage: rawPost });
  assert.equal(self.onmessage, dispatch);
  evaluateSandboxedScript('try { onmessage = function () {} } catch (e) {}');
  freezeWorkerHandlers(self, { dispatch, rawPostMessage: rawPost });
  assert.equal(self.onmessage, dispatch);
  assert.throws(() => evaluateSandboxedScript('postMessage({ type: "result" })'), /not allowed/);
  assert.throws(() => evaluateSandboxedScript('close()'), /not allowed/);
  assert.throws(() => evaluateSandboxedScript('addEventListener("message", function () {})'), /not allowed/);
  rawPost({ type: 'result', payload: { ok: true } });
  assert.equal(posted.at(-1).payload.ok, true);
});

test('freezeWorkerHandlers does not defineProperty worker host slots', () => {
  const src = readFileSync(new URL('./scriptSandbox.js', import.meta.url), 'utf8');
  assert.equal(/defineProperty\(\s*self\s*,/.test(src), false);
});

test('host messages still reach dispatch after freeze', () => {
  const seen = [];
  const self = { postMessage() {}, onmessage: null };
  const dispatch = (event) => { seen.push(event); };
  freezeWorkerHandlers(self, { dispatch, rawPostMessage: () => {} });
  assert.equal(self.onmessage, dispatch);
  self.onmessage({ data: { type: 'init', id: 'req_x' } });
  assert.equal(seen.length, 1);
  self.onmessage = () => {};
  freezeWorkerHandlers(self, { dispatch, rawPostMessage: () => {} });
  assert.equal(self.onmessage, dispatch);
});

test('scripts cannot reach host globals through self or globalThis', () => {
  assert.throws(
    () => evaluateSandboxedScript('self.fetch("https://cdn.jsdelivr.net/npm/x")'),
    /not (a function|allowed)|Cannot read|undefined/,
  );
  assert.throws(
    () => evaluateSandboxedScript('close()'),
    /not allowed/,
  );
  assert.throws(
    () => evaluateSandboxedScript('addEventListener("message", function () {})'),
    /not allowed/,
  );
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
  assert.equal(Object.isFrozen(SCRIPT_SANDBOX_SHADOWS.self), true);
});

test('request ids are UUIDs, not counter plus Date.now', () => {
  const id = generateWorkerRequestId(() => '11111111-1111-1111-1111-111111111111');
  assert.equal(id, 'req_11111111-1111-1111-1111-111111111111');
  const src = readFileSync(new URL('./ManifoldWorker.js', import.meta.url), 'utf8');
  assert.equal(/req_\$\{\+\+this\.requestIdCounter\}_\$\{Date\.now\(\)\}/.test(src), false);
  assert.match(src, /generateWorkerRequestId/);
});

test('forged worker messages without a typed payload are dropped', () => {
  assert.equal(isWorkerHostMessage({ type: 'result', id: 'req_x', payload: { resultAuth: 'a' } }), true);
  assert.equal(isWorkerHostMessage({ type: 'ready', id: 'req_x' }), true);
  assert.equal(isWorkerHostMessage({ type: 'loaded' }), true);
  assert.equal(isWorkerHostMessage({ type: 'pwn', id: 'req_x', payload: {} }), false);
  assert.equal(isWorkerHostMessage({ type: 'result', id: 1, payload: {} }), false);
  assert.equal(isWorkerHostMessage({ type: 'result', id: 'req_x', payload: 'nope' }), false);
  assert.equal(isWorkerHostMessage('ready'), false);
});

test('helperList is an object so App init is not dropped', () => {
  // App awaits getHelperFunctions() after ready. A top-level array payload
  // is rejected by isWorkerHostMessage and the loading gate never clears.
  assert.equal(
    isWorkerHostMessage({ type: 'helperList', id: 'req_x', payload: { helpers: ['cube'] } }),
    true,
  );
  assert.equal(
    isWorkerHostMessage({ type: 'helperList', id: 'req_x', payload: ['cube'] }),
    false,
  );
  const runtime = readFileSync(new URL('../lib/surfcad/runtime.js', import.meta.url), 'utf8');
  assert.match(runtime, /payload:\s*\{\s*helpers:\s*Object\.keys\(HELPER_FUNCTIONS\)\s*\}/);
  assert.equal(/payload:\s*Object\.keys\(HELPER_FUNCTIONS\)/.test(runtime), false);
});

test('page CSP keeps jsdelivr for Monaco; worker CSP has connect-src none', () => {
  const page = readFileSync(new URL('../../docs/nginx-snippets/surfcad-security.conf', import.meta.url), 'utf8');
  assert.match(page, /cdn\.jsdelivr\.net/);
  assert.match(page, /monaco-editor\/loader/);
  const worker = readFileSync(new URL('../../docs/nginx-snippets/surfcad-worker-csp.conf', import.meta.url), 'utf8');
  assert.match(worker, /connect-src 'none'/);
});

test('PoC A: Function constructor cannot reach import()', () => {
  const u = 'https:' + '/' + '/cdn.jsdelivr.net/npm/lodash-es/+esm';
  const script = [
    'const u = ' + JSON.stringify(u) + ';',
    "const F = []['constructor']['constructor'];",
    'F(\'return import("\' + u + \'")\')()',
  ].join('\n');
  assert.throws(() => evaluateSandboxedScript(script), /not allowed/);
  assert.throws(() => executeScript(script, {}), /not allowed/);
  assert.throws(
    () => evaluateSandboxedScript('import/*x*/("https://cdn.jsdelivr.net/npm/x")'),
    /not allowed/,
  );
});

test('PoC B: Function constructor cannot reach postMessage', () => {
  const script = [
    "const F = []['constructor']['constructor'];",
    'F(\'postMessage({type:"result",id:"x",payload:{ok:1}})\')()',
  ].join('\n');
  assert.throws(() => evaluateSandboxedScript(script), /not allowed/);
  assert.throws(() => executeScript(script, {}), /not allowed/);
});

test('PoC C: microtask Function cannot steal onmessage', async () => {
  lockScriptIntrinsics();
  const prevOnMessage = globalThis.onmessage;
  const dispatch = function hostDispatch() {};
  const self = { onmessage: dispatch, postMessage() {} };
  freezeWorkerHandlers(self, { dispatch, rawPostMessage: () => {} });
  const script = [
    "const F = []['constructor']['constructor'];",
    'return Promise.resolve().then(function () {',
    "  F('onmessage = function (e) { }')()",
    '})',
  ].join('\n');
  await assert.rejects(() => evaluateSandboxedScript(script), /not allowed/);
  assert.equal(self.onmessage, dispatch);
  assert.equal(globalThis.onmessage, prevOnMessage);
  assert.throws(() => []['constructor']['constructor']('return 1'), /not allowed/);
  assert.throws(
    () => Object.getPrototypeOf(async function () {}).constructor('return 1'),
    /not allowed/,
  );
});

test('benign scripts still evaluate after intrinsic lockdown', () => {
  assert.equal(evaluateSandboxedScript('return 40 + 2'), 42);
  assert.equal(executeScript('return { ok: true }', {}).ok, true);
});

test('attachHostPort moves the protocol off self.postMessage', () => {
  const port = {
    sent: null,
    onmessage: null,
    started: false,
    postMessage(msg) { this.sent = msg; },
    start() { this.started = true; },
  };
  const dispatch = function hostDispatch() {};
  const send = attachHostPort({ ports: [port] }, dispatch);
  assert.equal(typeof send, 'function');
  assert.equal(port.onmessage, dispatch);
  assert.equal(port.started, true);
  send({ type: 'ready', id: 'req_x' });
  assert.equal(port.sent.type, 'ready');
  const src = readFileSync(new URL('./ManifoldWorker.js', import.meta.url), 'utf8');
  assert.match(src, /new MessageChannel/);
  assert.match(src, /_hostPort/);
  assert.match(src, /Dropped worker-global message/);
});

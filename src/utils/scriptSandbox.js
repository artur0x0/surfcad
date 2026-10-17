/**
 * Shared CAD-script sandbox.
 *
 * User scripts run as `new Function` in the reused Manifold worker (wasm
 * stays warm — no per-run init). Containment is SES-style lockdown of
 * Function / eval / import plus a MessageChannel host port captured
 * before any user code. Scripts cannot reach the real `import()`,
 * `postMessage`, or `onmessage` through `[]['constructor']['constructor']`.
 */

function blocked(name) {
  const fn = function blockedApi() {
    throw new Error(`Access to '${name}' is not allowed in scripts`);
  };
  try { Object.defineProperty(fn, 'name', { value: name }); } catch { /* ignore */ }
  return Object.freeze(fn);
}

function guardedTimer(name) {
  const fn = function blockedTimer(handler) {
    if (typeof handler === 'string') {
      throw new Error(`Access to '${name}' string eval is not allowed in scripts`);
    }
    throw new Error(`Access to '${name}' is not allowed in scripts`);
  };
  try { Object.defineProperty(fn, 'name', { value: name }); } catch { /* ignore */ }
  return Object.freeze(fn);
}

/** Empty `self` / `globalThis` for the script Function scope (allowlist). */
const LIMITED_SCRIPT_GLOBAL = Object.freeze(Object.create(null));

export const SCRIPT_SANDBOX_SHADOWS = Object.freeze({
  fetch: blocked('fetch'),
  importScripts: blocked('importScripts'),
  XMLHttpRequest: blocked('XMLHttpRequest'),
  WebSocket: blocked('WebSocket'),
  postMessage: blocked('postMessage'),
  onmessage: null,
  close: blocked('close'),
  addEventListener: blocked('addEventListener'),
  removeEventListener: blocked('removeEventListener'),
  Function: blocked('Function'),
  setTimeout: guardedTimer('setTimeout'),
  setInterval: guardedTimer('setInterval'),
  __blockedImport: blocked('import'),
  self: LIMITED_SCRIPT_GLOBAL,
  globalThis: LIMITED_SCRIPT_GLOBAL,
});

export const WORKER_HOST_TYPES = Object.freeze([
  'loaded',
  'ready',
  'result',
  'error',
  'helperList',
]);

function skipWsAndComments(s, k) {
  while (k < s.length) {
    if (/\s/.test(s[k])) { k += 1; continue; }
    if (s.startsWith('//', k)) {
      const nl = s.indexOf('\n', k);
      k = nl < 0 ? s.length : nl + 1;
      continue;
    }
    if (s.startsWith('/*', k)) {
      const end = s.indexOf('*/', k + 2);
      k = end < 0 ? s.length : end + 2;
      continue;
    }
    break;
  }
  return k;
}

function readUnicodeEscape(s, i) {
  if (s[i] !== '\\' || s[i + 1] !== 'u') return null;
  if (s[i + 2] === '{') {
    let k = i + 3;
    let hex = '';
    while (k < s.length && s[k] !== '}') {
      if (!/[0-9a-fA-F]/.test(s[k])) return null;
      hex += s[k];
      k += 1;
    }
    if (s[k] !== '}' || !hex) return null;
    return { char: String.fromCodePoint(parseInt(hex, 16)), end: k + 1 };
  }
  const hex = s.slice(i + 2, i + 6);
  if (!/^[0-9a-fA-F]{4}$/.test(hex)) return null;
  return { char: String.fromCharCode(parseInt(hex, 16)), end: i + 6 };
}

function isIdentStart(ch) {
  return /[A-Za-z_$_]/.test(ch);
}

function isIdentPart(ch) {
  return /[A-Za-z0-9_$_]/.test(ch);
}

/**
 * `import(` including comment-split and unicode-escaped forms.
 * `importMesh(` is left alone.
 */
function matchImportCall(s, i) {
  if (i > 0) {
    const prev = s[i - 1];
    if (isIdentPart(prev) && prev !== '\\') return -1;
  }
  let name = '';
  let k = i;
  while (k < s.length) {
    const esc = readUnicodeEscape(s, k);
    if (esc) {
      name += esc.char;
      k = esc.end;
      continue;
    }
    const ch = s[k];
    if (name.length === 0 ? isIdentStart(ch) : isIdentPart(ch)) {
      name += ch;
      k += 1;
      continue;
    }
    break;
  }
  if (name !== 'import') return -1;
  k = skipWsAndComments(s, k);
  return s[k] === '(' ? k : -1;
}

/**
 * Replace dynamic `import(` outside strings and comments.
 * `importMesh(` is left alone.
 */
export function rewriteDynamicImport(source) {
  const s = String(source ?? '');
  let out = '';
  let i = 0;
  const stack = ['code'];
  let interpDepth = 0;

  while (i < s.length) {
    const mode = stack[stack.length - 1];
    if (mode === 'code' || mode === 'interp') {
      if (s.startsWith('//', i)) { stack.push('line'); out += '//'; i += 2; continue; }
      if (s.startsWith('/*', i)) { stack.push('block'); out += '/*'; i += 2; continue; }
      if (s[i] === "'") { stack.push('sq'); out += s[i]; i += 1; continue; }
      if (s[i] === '"') { stack.push('dq'); out += s[i]; i += 1; continue; }
      if (s[i] === '`') { stack.push('tq'); out += s[i]; i += 1; continue; }
      if (mode === 'interp') {
        if (s[i] === '{') interpDepth += 1;
        else if (s[i] === '}') {
          interpDepth -= 1;
          if (interpDepth <= 0) {
            out += '}';
            i += 1;
            stack.pop();
            continue;
          }
        }
      }
      const paren = matchImportCall(s, i);
      if (paren >= 0) {
        out += '__blockedImport(';
        i = paren + 1;
        continue;
      }
      out += s[i];
      i += 1;
      continue;
    }
    if (mode === 'line') {
      out += s[i];
      if (s[i] === '\n') stack.pop();
      i += 1;
      continue;
    }
    if (mode === 'block') {
      if (s.startsWith('*/', i)) { out += '*/'; i += 2; stack.pop(); continue; }
      out += s[i];
      i += 1;
      continue;
    }
    if (mode === 'sq' || mode === 'dq') {
      const q = mode === 'sq' ? "'" : '"';
      if (s[i] === '\\') { out += s.slice(i, i + 2); i += 2; continue; }
      out += s[i];
      if (s[i] === q) stack.pop();
      i += 1;
      continue;
    }
    if (mode === 'tq') {
      if (s[i] === '\\') { out += s.slice(i, i + 2); i += 2; continue; }
      if (s.startsWith('${', i)) {
        out += '${';
        i += 2;
        stack.push('interp');
        interpDepth = 1;
        continue;
      }
      out += s[i];
      if (s[i] === '`') stack.pop();
      i += 1;
    }
  }
  return out;
}

function exoticFunctionConstructors() {
  const found = [Function];
  try { found.push((async function () {}).constructor); } catch { /* ignore */ }
  try { found.push((function* () {}).constructor); } catch { /* ignore */ }
  try { found.push((async function* () {}).constructor); } catch { /* ignore */ }
  return [...new Set(found)];
}

let scriptIntrinsicsLocked = false;

/**
 * SES-style lockdown of Function / AsyncFunction / GeneratorFunction.
 * Host `new Function` (the evaluator) still works. User code that walks
 * `[]['constructor']['constructor']` gets a thrower.
 */
export function lockScriptIntrinsics() {
  if (scriptIntrinsicsLocked) return;
  scriptIntrinsicsLocked = true;
  const deny = blocked('Function');
  for (const Ctor of exoticFunctionConstructors()) {
    try {
      Object.defineProperty(Ctor.prototype, 'constructor', {
        get() { return deny; },
        set() { throw new Error("Access to 'Function' is not allowed in scripts"); },
        configurable: false,
        enumerable: false,
      });
    } catch { /* already locked */ }
    try {
      Object.defineProperty(Ctor, 'constructor', {
        get() { return deny; },
        set() { throw new Error("Access to 'Function' is not allowed in scripts"); },
        configurable: false,
        enumerable: false,
      });
    } catch { /* already locked */ }
  }
  try {
    Object.defineProperty(globalThis, 'eval', {
      value: blocked('eval'),
      writable: false,
      configurable: false,
    });
  } catch { /* already locked */ }
}

/** Strict-mode `new Function` with network / messaging shadows. */
export function evaluateSandboxedScript(script, extraScope = {}) {
  lockScriptIntrinsics();
  const scope = { ...extraScope, ...SCRIPT_SANDBOX_SHADOWS };
  const keys = Object.keys(scope);
  const values = Object.values(scope);
  const body = `"use strict";\n${rewriteDynamicImport(String(script ?? ''))}`;
  return new Function(...keys, body)(...values);
}

export function createResultAuth() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `auth-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

/** Host-side check: a result must carry the nonce from this run. */
export function acceptWorkerResult(expectedAuth, payload) {
  return expectedAuth != null
    && payload != null
    && typeof payload === 'object'
    && !Array.isArray(payload)
    && payload.resultAuth === expectedAuth;
}

/** crypto.randomUUID request ids — not `req_${counter}_${Date.now()}`. */
export function generateWorkerRequestId(randomUUID) {
  const uuid = typeof randomUUID === 'function'
    ? randomUUID()
    : (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : createResultAuth());
  return `req_${uuid}`;
}

/** Drop forged / untyped worker messages before they resolve a pending request. */
export function isWorkerHostMessage(data) {
  if (data == null || typeof data !== 'object' || Array.isArray(data)) return false;
  if (typeof data.type !== 'string' || !WORKER_HOST_TYPES.includes(data.type)) return false;
  if (data.id != null && typeof data.id !== 'string') return false;
  // Arrays are rejected: getHelperList must send { helpers: string[] }.
  // A raw Object.keys() payload was dropped and App init never left the
  // loading gate (golden app-loads / Agent bridge FEA).
  if (data.payload != null && (typeof data.payload !== 'object' || Array.isArray(data.payload))) {
    return false;
  }
  return true;
}

/**
 * Bind a transferred MessagePort as the host protocol. User `self.postMessage`
 * / `self.onmessage` cannot forge or steal host traffic once this port is live.
 */
export function attachHostPort(event, dispatch) {
  const port = event && event.ports && event.ports[0];
  if (!port || typeof port.postMessage !== 'function') return null;
  if (typeof dispatch === 'function') {
    port.onmessage = dispatch;
    try { if (typeof port.start === 'function') port.start(); } catch { /* ignore */ }
  }
  return port.postMessage.bind(port);
}

/**
 * Reinstall the host dispatch on the IDL `onmessage` slot after every run
 * (Node goldens / tests that drive `self.onmessage`). Browser host traffic
 * uses the MessagePort from attachHostPort. Do not defineProperty the
 * WorkerGlobalScope IDL slots — that blocks Chrome init delivery.
 */
export function freezeWorkerHandlers(self, { dispatch, rawPostMessage } = {}) {
  if (!self || typeof self !== 'object') return rawPostMessage || null;
  if (typeof dispatch === 'function') {
    try { self.onmessage = dispatch; } catch { /* already frozen */ }
  }
  return rawPostMessage || null;
}

/**
 * Shared CAD-script sandbox.
 *
 * User scripts run as `new Function` in the reused Manifold worker. This
 * module is the one evaluator: it shadows network / messaging APIs, rewrites
 * `import()` so jsdelivr is not reachable, and freezes the worker handlers
 * so a script cannot keep `onmessage` or forge `postMessage` results.
 */

function blocked(name) {
  const fn = function blockedApi() {
    throw new Error(`Access to '${name}' is not allowed in scripts`);
  };
  try { Object.defineProperty(fn, 'name', { value: name }); } catch { /* ignore */ }
  return Object.freeze(fn);
}

export const SCRIPT_SANDBOX_SHADOWS = Object.freeze({
  fetch: blocked('fetch'),
  importScripts: blocked('importScripts'),
  postMessage: blocked('postMessage'),
  onmessage: null,
  __blockedImport: blocked('import'),
});

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

  const atImportCall = () => {
    if (!s.startsWith('import', i)) return -1;
    if (i > 0 && /[\w$]/.test(s[i - 1])) return -1;
    let k = i + 6;
    while (k < s.length && /\s/.test(s[k])) k += 1;
    return s[k] === '(' ? k : -1;
  };

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
      const paren = atImportCall();
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

/** Strict-mode `new Function` with network / messaging shadows. */
export function evaluateSandboxedScript(script, extraScope = {}) {
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
    && payload.resultAuth === expectedAuth;
}

/**
 * Install the real dispatch on `onmessage` (goldens call it directly) and
 * replace `postMessage` with a thrower. The handler must keep a bound copy
 * of the original `postMessage`.
 */
export function freezeWorkerHandlers(self, { dispatch, rawPostMessage } = {}) {
  if (!self || typeof self !== 'object') return rawPostMessage || null;
  if (typeof dispatch === 'function') {
    try {
      Object.defineProperty(self, 'onmessage', {
        get() { return dispatch; },
        set() { throw new Error("Access to 'onmessage' is not allowed in scripts"); },
        configurable: false,
        enumerable: true,
      });
    } catch {
      try { self.onmessage = dispatch; } catch { /* already frozen */ }
    }
  }
  try {
    Object.defineProperty(self, 'postMessage', {
      value: blocked('postMessage'),
      writable: false,
      configurable: false,
    });
  } catch {
    /* already frozen */
  }
  return rawPostMessage || null;
}

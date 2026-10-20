/**
 * Kernel arena: free every Manifold / CrossSection handle a run created.
 *
 * Embind handles are not garbage collected. A user script makes one handle
 * per kernel call (`Manifold.cylinder(...)`, `.translate(...)`, `.add(...)`)
 * and keeps none of them but the one it returns, so before this each
 * execute leaked every intermediate into the wasm heap. The fastened bike
 * grew the heap by about 200 MB per full rebuild and the heap never shrinks.
 *
 * `installKernelArena(module)` wraps the public statics and prototype
 * methods of `Manifold` and `CrossSection`, and the two constructors, so
 * every handle they hand out is recorded while an arena is open.
 * `beginKernelArena()` opens one; `endKernelArena(arena, { keep })` deletes
 * every recorded handle that is not in `keep` and not already deleted, and
 * returns how many it freed. Handles made while no arena is open are not
 * recorded, so a clone the runtime retains between runs is untouched.
 *
 * The wrappers only observe return values. They do not change arguments,
 * results, or the methods `installSeparateBodies` patched (those are
 * wrapped on top, so the solid they return is recorded too).
 */

let active = null;

function isHandle(value) {
  return !!value && typeof value === 'object'
    && typeof value.delete === 'function'
    && typeof value.isDeleted === 'function';
}

function record(value) {
  if (!active) return value;
  if (Array.isArray(value)) {
    for (const item of value) if (isHandle(item)) active.add(item);
  } else if (isHandle(value)) {
    active.add(value);
  }
  return value;
}

const SKIP_METHODS = new Set(['constructor', 'delete', 'deleteLater', 'isDeleted', 'isAliasOf']);

function wrapOwnFunctions(target, { skipPrototype = false } = {}) {
  for (const key of Object.getOwnPropertyNames(target)) {
    if (SKIP_METHODS.has(key) || key.startsWith('_')) continue;
    if (skipPrototype && key === 'prototype') continue;
    const desc = Object.getOwnPropertyDescriptor(target, key);
    if (!desc || typeof desc.value !== 'function' || !desc.writable) continue;
    const fn = desc.value;
    target[key] = function arenaTracked(...args) {
      return record(fn.apply(this, args));
    };
  }
}

/**
 * Install the recorders on `module.Manifold` and `module.CrossSection`.
 * Idempotent. Call after `setup()` and `installSeparateBodies`.
 */
const PROBES = {
  Manifold: (Cls) => Cls.cube([1, 1, 1]),
  CrossSection: (Cls) => Cls.square([1, 1]),
};

/**
 * The prototype instances really use. `Cls.prototype` on these embind
 * classes is a wrapper, so a probe instance is made and deleted.
 */
function instancePrototype(name, Cls) {
  const make = PROBES[name];
  if (!make) return Cls.prototype || null;
  let probe = null;
  try {
    probe = make(Cls);
    return Object.getPrototypeOf(probe);
  } catch (_) {
    return Cls.prototype || null;
  } finally {
    try { probe?.delete?.(); } catch (_) { /* freed */ }
  }
}

export function installKernelArena(module) {
  if (!module || module.__kernelArena) return;
  for (const name of ['Manifold', 'CrossSection']) {
    const Cls = module[name];
    if (typeof Cls !== 'function') continue;
    const proto = instancePrototype(name, Cls);
    wrapOwnFunctions(Cls, { skipPrototype: true });
    if (proto) wrapOwnFunctions(proto);
    if (Cls.prototype && Cls.prototype !== proto) wrapOwnFunctions(Cls.prototype);
    module[name] = new Proxy(Cls, {
      construct(target, args) {
        return record(Reflect.construct(target, args, target));
      },
    });
  }
  Object.defineProperty(module, '__kernelArena', { value: true });
}

/** Open an arena. Nested calls share the outermost set. */
export function beginKernelArena() {
  if (active) return { set: active, outer: true };
  active = new Set();
  return { set: active, outer: false };
}

/**
 * Close `arena`: delete every recorded handle not in `keep`. Returns the
 * number of handles freed. A nested arena returns 0 and leaves the set to
 * the outermost caller.
 */
export function endKernelArena(arena, { keep = [] } = {}) {
  if (!arena || arena.outer || arena.set !== active) return 0;
  const set = active;
  active = null;
  const retained = new Set();
  for (const k of keep) if (k) retained.add(k);
  let freed = 0;
  for (const handle of set) {
    if (retained.has(handle)) continue;
    try {
      if (handle.isDeleted()) continue;
      handle.delete();
      freed += 1;
    } catch (_) { /* already freed */ }
  }
  set.clear();
  return freed;
}

/** Keep `handle` out of the current arena's sweep (it is retained elsewhere). */
export function retainFromKernelArena(handle) {
  if (active && handle) active.delete(handle);
  return handle;
}

/** For tests: handles recorded so far in the open arena, or -1 when none is open. */
export function kernelArenaSize() {
  return active ? active.size : -1;
}

/** Bytes of the wasm heap right now, in MB (one decimal), or null. */
export function wasmHeapMB(module) {
  try {
    const buf = module?.HEAP8?.buffer || module?.wasmMemory?.buffer;
    if (!buf) return null;
    return Math.round(buf.byteLength / 1048576 * 10) / 10;
  } catch (_) {
    return null;
  }
}

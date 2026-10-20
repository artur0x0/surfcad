import assert from 'node:assert/strict';
import test from 'node:test';
import {
  KERNEL_CRASH_CODE,
  classifyKernelFailure,
  kernelCrashError,
  kernelCrashMessage,
  kernelCrashRecord,
  isKernelCrashError,
  splitPendingOnCrash,
} from './kernelCrash.js';

test('classifyKernelFailure: script and helper errors are not fatal', () => {
  assert.deepEqual(classifyKernelFailure({ error: new Error('cut: plane needs a normal') }), { fatal: false, reason: null });
  assert.deepEqual(classifyKernelFailure({ error: new TypeError('x is not a function') }), { fatal: false, reason: null });
  assert.deepEqual(classifyKernelFailure({ error: new RangeError('Maximum call stack size exceeded') }), { fatal: false, reason: null });
  assert.deepEqual(classifyKernelFailure({ message: 'Script must return a Manifold object' }), { fatal: false, reason: null });
});

test('classifyKernelFailure: an Emscripten abort is fatal; a full heap makes it out of memory', () => {
  const aborted = new Error('Aborted(). Build with -sASSERTIONS for more info.');
  assert.deepEqual(classifyKernelFailure({ error: aborted, heapMB: 48 }), { fatal: true, reason: 'wasm_abort' });
  assert.deepEqual(classifyKernelFailure({ error: aborted, heapMB: 4096 }), { fatal: true, reason: 'out_of_memory' });
  assert.deepEqual(classifyKernelFailure({ error: aborted, heapMB: 3600 }), { fatal: true, reason: 'out_of_memory' });
  assert.deepEqual(classifyKernelFailure({ error: aborted, heapMB: 3500 }), { fatal: true, reason: 'wasm_abort' });
});

test('classifyKernelFailure: a wasm trap and an allocator message are fatal', () => {
  const trap = new WebAssembly.RuntimeError('memory access out of bounds');
  assert.deepEqual(classifyKernelFailure({ error: trap }), { fatal: true, reason: 'wasm_abort' });
  assert.deepEqual(classifyKernelFailure({ name: 'RuntimeError', message: 'unreachable' }), { fatal: true, reason: 'wasm_abort' });
  assert.deepEqual(classifyKernelFailure({ message: 'Cannot enlarge memory arrays to size 4294967296 bytes' }), { fatal: true, reason: 'out_of_memory' });
  assert.deepEqual(classifyKernelFailure({ message: 'abort(OOM). Build with -sASSERTIONS' }), { fatal: true, reason: 'out_of_memory' });
});

test('kernelCrashMessage names the reason and what to do', () => {
  assert.match(kernelCrashMessage({ reason: 'out_of_memory', wasmHeapMB: 4096 }), /ran out of memory.*heap 4096 MB.*restarted.*Simplify/);
  assert.match(kernelCrashMessage({ reason: 'timeout', budgetMs: 30000 }), /did not finish within 30 s.*restarted/);
  assert.match(kernelCrashMessage({ reason: 'wasm_abort', kernelMessage: 'Aborted()' }), /crashed building this part \(Aborted\(\)\)/);
  assert.match(kernelCrashMessage({ reason: 'worker_lost' }), /stopped while building/);
});

test('kernelCrashError carries the contract fields and round-trips to a record', () => {
  const err = kernelCrashError({ reason: 'out_of_memory', kernelMessage: 'Aborted()', wasmHeapMB: 4096, partId: 'p12' });
  assert.equal(isKernelCrashError(err), true);
  assert.equal(isKernelCrashError(new Error('Aborted()')), false);
  assert.equal(err.code, KERNEL_CRASH_CODE);
  assert.equal(err.reason, 'out_of_memory');
  assert.equal(err.workerRestarted, true);
  assert.equal(err.partId, 'p12');
  assert.deepEqual(kernelCrashRecord(err), {
    code: 'geometry_worker_crashed',
    reason: 'out_of_memory',
    workerRestarted: true,
    message: err.message,
    kernelMessage: 'Aborted()',
    wasmHeapMB: 4096,
    partId: 'p12',
  });
  assert.equal(kernelCrashRecord(new Error('nope')), null);
  assert.equal(JSON.parse(JSON.stringify(kernelCrashRecord(err))).reason, 'out_of_memory');
});

test('splitPendingOnCrash: the crashed job and older ones fail, newer ones are requeued', () => {
  assert.deepEqual(splitPendingOnCrash(['a', 'b', 'c', 'd'], 'b'), { failed: ['a', 'b'], requeue: ['c', 'd'] });
  assert.deepEqual(splitPendingOnCrash(['a', 'b', 'c'], null), { failed: ['a'], requeue: ['b', 'c'] });
  assert.deepEqual(splitPendingOnCrash(['a', 'b'], 'zzz'), { failed: ['a'], requeue: ['b'] });
  assert.deepEqual(splitPendingOnCrash([], 'a'), { failed: [], requeue: [] });
  assert.deepEqual(splitPendingOnCrash(['a'], 'a'), { failed: ['a'], requeue: [] });
});

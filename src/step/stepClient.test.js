import test from 'node:test';
import assert from 'node:assert/strict';

import { convertStep } from './stepClient.js';
import { STEP_ERROR_MESSAGES, StepImportError } from './stepMesh.js';

/** A stand-in for the module worker. `reply` decides what it posts back. */
function fakeWorker(reply) {
  const worker = {
    terminated: 0,
    posted: [],
    onmessage: null,
    onerror: null,
    onmessageerror: null,
    postMessage(data, transfer) {
      worker.posted.push({ data, transfer });
      reply?.(worker, data);
    },
    terminate() {
      worker.terminated += 1;
    },
  };
  return worker;
}

const bytes = () => new TextEncoder().encode('ISO-10303-21;');

test('a result resolves with the arrays and the worker is terminated', async () => {
  const worker = fakeWorker((self, data) => {
    queueMicrotask(() => self.onmessage({
      data: {
        id: data.id,
        ok: true,
        vertProperties: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        triVerts: new Uint32Array([0, 1, 2]),
        solids: 1,
        faces: 1,
        facesWithoutMesh: 0,
        heapBytes: 1024,
      },
    }));
  });
  const input = bytes();
  const result = await convertStep(input, { deflection: 0.2, createWorker: () => worker });
  assert.equal(result.triVerts.length, 3);
  assert.equal(result.solids, 1);
  assert.equal(worker.terminated, 1);
  assert.equal(worker.posted.length, 1);
  assert.equal(worker.posted[0].data.options.deflection, 0.2);
  // The file's buffer is handed to the worker, not copied.
  assert.equal(worker.posted[0].transfer.length, 1);
});

test('a worker failure rejects with the message for its code', async () => {
  const worker = fakeWorker((self, data) => {
    queueMicrotask(() => self.onmessage({ data: { id: data.id, ok: false, code: 'too_detailed', detail: 'cap' } }));
  });
  await assert.rejects(convertStep(bytes(), { createWorker: () => worker }), (error) => {
    assert.ok(error instanceof StepImportError);
    assert.equal(error.code, 'too_detailed');
    assert.equal(error.message, STEP_ERROR_MESSAGES.too_detailed);
    return true;
  });
  assert.equal(worker.terminated, 1);
});

test('a worker that never answers times out and is terminated', async () => {
  const worker = fakeWorker();
  await assert.rejects(convertStep(bytes(), { timeoutMs: 20, createWorker: () => worker }), (error) => {
    assert.equal(error.code, 'timeout');
    assert.equal(error.message, STEP_ERROR_MESSAGES.timeout);
    return true;
  });
  assert.equal(worker.terminated, 1);
});

test('a worker that dies reports the generic failure', async () => {
  const worker = fakeWorker((self) => {
    queueMicrotask(() => self.onerror({ message: 'out of memory', preventDefault() {} }));
  });
  await assert.rejects(convertStep(bytes(), { createWorker: () => worker }), (error) => {
    assert.equal(error.code, 'failed');
    assert.equal(error.message, STEP_ERROR_MESSAGES.failed);
    return true;
  });
  assert.equal(worker.terminated, 1);
});

test('a worker that cannot start and an empty file fail without hanging', async () => {
  await assert.rejects(
    convertStep(bytes(), { createWorker: () => { throw new Error('no workers'); } }),
    (error) => error instanceof StepImportError && error.code === 'failed',
  );
  await assert.rejects(
    convertStep(new Uint8Array(0), { createWorker: () => fakeWorker() }),
    (error) => error instanceof StepImportError && error.code === 'unreadable',
  );
});

// Main-thread client for the STEP worker.
//
// convertStep(bytes) starts a module worker, converts one STEP file to a
// triangle soup, and terminates the worker when the call settles. The file's
// bytes are transferred to the worker and never sent over the network.

import { StepImportError } from './stepMesh.js';

/** Single-threaded wasm is slower than the old server converter's 40 s limit allowed for. */
export const STEP_CONVERT_TIMEOUT_MS = 180_000;

async function createStepWorker() {
  const mod = await import('../workers/stepWorker.js?worker');
  return new mod.default();
}

/**
 * @param {Uint8Array} bytes STEP file contents. The buffer is transferred.
 * @param {{ deflection?: number, timeoutMs?: number, createWorker?: () => (Worker | Promise<Worker>) }} [options]
 * @returns {Promise<{ vertProperties: Float32Array, triVerts: Uint32Array,
 *   solids: number, faces: number, facesWithoutMesh: number, heapBytes: number }>}
 * @throws {StepImportError}
 */
export async function convertStep(bytes, options = {}) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) {
    throw new StepImportError('unreadable', 'empty input');
  }
  const timeoutMs = options.timeoutMs > 0 ? options.timeoutMs : STEP_CONVERT_TIMEOUT_MS;
  let worker;
  try {
    worker = await (options.createWorker || createStepWorker)();
  } catch (error) {
    throw new StepImportError('failed', `worker start: ${error?.message || error}`);
  }
  let timer = null;
  try {
    return await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new StepImportError('timeout', `no result after ${timeoutMs} ms`)), timeoutMs);
      worker.onmessage = (event) => {
        const data = event.data || {};
        if (data.ok) {
          const { vertProperties, triVerts, solids, faces, facesWithoutMesh, heapBytes } = data;
          resolve({ vertProperties, triVerts, solids, faces, facesWithoutMesh, heapBytes });
        } else {
          reject(new StepImportError(data.code, data.detail || ''));
        }
      };
      // A worker that dies without posting (the browser killed it for memory,
      // or the script failed to load) reports here.
      worker.onerror = (event) => {
        event?.preventDefault?.();
        reject(new StepImportError('failed', `worker error: ${event?.message || 'unknown'}`));
      };
      worker.onmessageerror = () => reject(new StepImportError('failed', 'worker message could not be read'));
      const buffer = bytes.buffer;
      const whole = bytes.byteOffset === 0 && bytes.byteLength === buffer.byteLength;
      worker.postMessage(
        { id: 1, bytes, options: { deflection: options.deflection } },
        whole ? [buffer] : [],
      );
    });
  } finally {
    if (timer) clearTimeout(timer);
    try { worker.terminate(); } catch { /* already gone */ }
  }
}

// Module worker for STEP import. One worker converts one file and is then
// terminated by src/step/stepClient.js, which returns the wasm heap (it can
// reach gigabytes on a large assembly and cannot shrink) to the browser.
//
// in:  { id, bytes: Uint8Array, options: { deflection } }
// out: { id, ok: true, vertProperties, triVerts, solids, faces, facesWithoutMesh, heapBytes }
//      { id, ok: false, code, message, detail }

import { meshStep, StepImportError } from '../step/stepMesh.js';

self.onmessage = async (event) => {
  const { id, bytes, options } = event.data || {};
  try {
    const result = await meshStep(bytes, options || {});
    self.postMessage({ id, ok: true, ...result }, [result.vertProperties.buffer, result.triVerts.buffer]);
  } catch (error) {
    const known = error instanceof StepImportError ? error : new StepImportError('failed', String(error?.message || error));
    self.postMessage({ id, ok: false, code: known.code, message: known.message, detail: known.detail || '' });
  }
};

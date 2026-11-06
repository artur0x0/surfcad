// STEP import in the browser.
//
// `meshStep` reads STEP bytes with Open CASCADE Technology compiled to wasm
// (packages/surfcad-step) and returns one triangle soup: every face's
// triangles, in millimetres, with no vertices shared between faces. The
// caller welds the soup and builds the solid in the Manifold worker.
//
// The file never leaves the device. There is no server fallback: a file the
// module cannot read fails here with a message for the user.
//
// The module is single-threaded and does not use shared memory, so the page
// needs no COOP/COEP headers. It is LGPL-2.1 (OCCT) and is loaded as its own
// wasm file; see packages/surfcad-step/LICENSES.md. This file runs in the
// STEP worker (src/workers/stepWorker.js) and in Node tests.

/** Same cap the server converter had. */
export const STEP_MAX_TRIANGLES = 800_000;
export const STEP_DEFAULT_DEFLECTION_MM = 0.1;
export const STEP_ANGULAR_DEFLECTION_RAD = 0.5;
/** The interface version this file was written against (surfcad_step_abi). */
export const STEP_MODULE_ABI = 1;

const STATUS = {
  ok: 0,
  badInput: 1,
  readFailed: 2,
  noShape: 3,
  noTriangles: 4,
  tooManyTriangles: 5,
  outOfMemory: 6,
  internal: 7,
};

export const STEP_ERROR_MESSAGES = Object.freeze({
  unreadable: "We couldn't read this file as STEP. Check that it is a valid STEP file and try again.",
  empty: 'This STEP file has no geometry to import.',
  too_detailed: `This STEP file meshes to more than ${STEP_MAX_TRIANGLES.toLocaleString('en-US')} triangles. Export a simpler model and try again.`,
  out_of_memory: 'This STEP file needs more memory than the browser allows. Export a smaller model and try again.',
  timeout: 'This STEP file took too long to convert. Export a smaller model and try again.',
  failed: "We couldn't convert this STEP file. Check that it is a valid STEP file and try again.",
});

/** `message` is written for the user. `code` is one of the STEP_ERROR_MESSAGES keys. */
export class StepImportError extends Error {
  constructor(code, detail = '') {
    super(STEP_ERROR_MESSAGES[code] || STEP_ERROR_MESSAGES.failed);
    this.name = 'StepImportError';
    this.code = STEP_ERROR_MESSAGES[code] ? code : 'failed';
    this.detail = detail;
  }
}

function codeForStatus(status) {
  if (status === STATUS.badInput || status === STATUS.readFailed) return 'unreadable';
  if (status === STATUS.noShape || status === STATUS.noTriangles) return 'empty';
  if (status === STATUS.tooManyTriangles) return 'too_detailed';
  if (status === STATUS.outOfMemory) return 'out_of_memory';
  return 'failed';
}

function clamp(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

/**
 * Packed little-endian blob from surfcad_step_mesh (packages/surfcad-step/src/api.cpp):
 * int32 status, uint32 nVertices, nTriangles, messageLen, nSolids, nFaces,
 * nFacesWithoutMesh, reserved; message padded to 8 bytes; float32 positions;
 * uint32 indices. The arrays are copied out of the wasm heap.
 */
export function decodeStepBlob(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 32) {
    throw new StepImportError('failed', 'short blob');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const status = view.getInt32(0, true);
  const nVertices = view.getUint32(4, true);
  const nTriangles = view.getUint32(8, true);
  const messageLen = view.getUint32(12, true);
  const solids = view.getUint32(16, true);
  const faces = view.getUint32(20, true);
  const facesWithoutMesh = view.getUint32(24, true);
  let offset = 32;
  if (offset + messageLen > bytes.byteLength) throw new StepImportError('failed', 'blob message overruns');
  const message = new TextDecoder().decode(bytes.subarray(offset, offset + messageLen));
  offset = (offset + messageLen + 7) & ~7;
  const positionBytes = nVertices * 3 * 4;
  const indexBytes = nTriangles * 3 * 4;
  if (offset + positionBytes + indexBytes > bytes.byteLength) {
    throw new StepImportError('failed', 'blob arrays overrun');
  }
  const vertProperties = new Float32Array(nVertices * 3);
  new Uint8Array(vertProperties.buffer).set(bytes.subarray(offset, offset + positionBytes));
  offset += positionBytes;
  const triVerts = new Uint32Array(nTriangles * 3);
  new Uint8Array(triVerts.buffer).set(bytes.subarray(offset, offset + indexBytes));
  return { status, message, solids, faces, facesWithoutMesh, vertProperties, triVerts };
}

async function readWasm(url) {
  if (globalThis.process && globalThis.process.versions && globalThis.process.versions.node) {
    const { readFile } = await import('node:fs/promises');
    return new Uint8Array(await readFile(url));
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error(`step wasm fetch failed (${response.status})`);
  return new Uint8Array(await response.arrayBuffer());
}

function factoryWithBinary(factory, bytes) {
  let rejectLoad = null;
  const failed = new Promise((_, reject) => {
    rejectLoad = reject;
  });
  const loaded = factory({
    print() {},
    printErr() {},
    instantiateWasm(imports, receive) {
      WebAssembly.instantiate(bytes, imports).then(
        (result) => {
          try {
            receive(result.instance);
          } catch (error) {
            rejectLoad(error);
          }
        },
        (error) => rejectLoad(error),
      );
      return {};
    },
  });
  return Promise.race([loaded, failed]);
}

let modulePromise = null;

async function loadStepModule() {
  if (modulePromise) return modulePromise;
  modulePromise = (async () => {
    const glue = await import('../../packages/surfcad-step/pkg/surfcad_step.js');
    const wasmUrl = new URL('../../packages/surfcad-step/pkg/surfcad_step.wasm', import.meta.url);
    const module = await factoryWithBinary(glue.default, await readWasm(wasmUrl));
    const abi = module._surfcad_step_abi();
    if (abi !== STEP_MODULE_ABI) {
      throw new Error(`step wasm interface is version ${abi}, expected ${STEP_MODULE_ABI}`);
    }
    return module;
  })().catch((error) => {
    modulePromise = null;
    throw error;
  });
  return modulePromise;
}

/**
 * @param {Uint8Array} bytes STEP file contents
 * @param {{ deflection?: number, angle?: number, maxTriangles?: number }} [options]
 *   deflection is the chord tolerance in millimetres (0.01 to 5, default 0.1).
 *   angle is the angular deflection in radians (default 0.5).
 * @returns {Promise<{ vertProperties: Float32Array, triVerts: Uint32Array,
 *   solids: number, faces: number, facesWithoutMesh: number, heapBytes: number }>}
 * @throws {StepImportError}
 */
export async function meshStep(bytes, options = {}) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) {
    throw new StepImportError('unreadable', 'empty input');
  }
  const deflection = clamp(options.deflection, STEP_DEFAULT_DEFLECTION_MM, 0.01, 5);
  const angle = clamp(options.angle, STEP_ANGULAR_DEFLECTION_RAD, 0.05, 1.5);
  const maxTriangles = Number.isInteger(options.maxTriangles) && options.maxTriangles >= 0
    ? options.maxTriangles
    : STEP_MAX_TRIANGLES;

  let module;
  try {
    module = await loadStepModule();
  } catch (error) {
    throw new StepImportError('failed', `module load: ${error?.message || error}`);
  }

  let input = 0;
  let sizeSlot = 0;
  let blob = 0;
  try {
    input = module._malloc(bytes.byteLength);
    sizeSlot = module._malloc(4);
    if (!input || !sizeSlot) throw new StepImportError('out_of_memory', 'input allocation');
    module.HEAPU8.set(bytes, input);
    blob = module._surfcad_step_mesh(input, bytes.byteLength, deflection, angle, maxTriangles, sizeSlot);
    if (!blob) throw new StepImportError('out_of_memory', 'result allocation');
    // Memory may have grown during the call. Read the heap view again.
    const heap = module.HEAPU8;
    const size = new DataView(heap.buffer, heap.byteOffset + sizeSlot, 4).getUint32(0, true);
    const decoded = decodeStepBlob(heap.subarray(blob, blob + size));
    if (decoded.status !== STATUS.ok) {
      throw new StepImportError(codeForStatus(decoded.status), decoded.message);
    }
    return {
      vertProperties: decoded.vertProperties,
      triVerts: decoded.triVerts,
      solids: decoded.solids,
      faces: decoded.faces,
      facesWithoutMesh: decoded.facesWithoutMesh,
      heapBytes: heap.byteLength,
    };
  } catch (error) {
    if (error instanceof StepImportError) throw error;
    // A wasm trap (out-of-bounds, stack overflow, a failed memory.grow) leaves
    // the instance unusable. Drop it so the next call starts clean.
    modulePromise = null;
    const text = String(error?.message || error);
    const memory = /out of memory|memory access out of bounds|Cannot enlarge memory|grow/i.test(text);
    throw new StepImportError(memory ? 'out_of_memory' : 'failed', text);
  } finally {
    if (modulePromise) {
      try {
        if (blob) module._surfcad_step_free(blob);
        if (sizeSlot) module._free(sizeSlot);
        if (input) module._free(input);
      } catch {
        modulePromise = null;
      }
    }
  }
}

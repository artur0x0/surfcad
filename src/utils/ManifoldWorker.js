// utils/ManifoldWorker.js
// Wrapper class that manages the sandbox worker and exposes a clean API

/**
 * ManifoldWorker provides a Promise-based API for executing Manifold scripts
 * in an isolated Web Worker environment.
 * 
 * Usage:
 *   const manifold = new ManifoldWorker();
 *   await manifold.init();
 *   const meshData = await manifold.execute(script);
 */
import { softRestartDecision } from './manifoldWorkerLiveness.js'
import {
  classifyKernelFailure,
  kernelCrashError,
  splitPendingOnCrash,
  DEFAULT_JOB_BUDGET_MS,
} from '../workers/kernelCrash.js'

/**
 * The sandbox worker, loaded on first use. A dynamic import keeps this
 * module loadable under Node (tests pass their own `createWorker`), and
 * Vite still bundles the `?worker` entry.
 */
const defaultCreateWorker = async () => {
  const mod = await import('../workers/sandboxWorker.js?worker');
  return new mod.default();
};

class ManifoldWorker {
  /**
   * @param {{ createWorker?: () => Worker | Promise<Worker>, onCrash?: (info: object) => void }} [opts]
   */
  constructor(opts = {}) {
    this.worker = null;
    this.isReady = false;
    this.pendingRequests = new Map();
    this.requestIdCounter = 0;
    
    this.config = {
      timeoutMs: DEFAULT_JOB_BUDGET_MS,
      memoryLimitMB: 512,
    };
    
    this.onError = null;
    this._createWorker = typeof opts.createWorker === 'function' ? opts.createWorker : defaultCreateWorker;
    /** Called once per kernel crash with { at, reason, message, failed, requeued }. */
    this.onCrash = typeof opts.onCrash === 'function' ? opts.onCrash : null;
    this.crashCount = 0;
    this.lastCrash = null;
    this._crashInFlight = null;
  }
  
  async init() {
    if (this.isReady) {
      console.log('[ManifoldWorker] Already initialized');
      return;
    }
    // Dedupe concurrent init (StrictMode remount / overlapping callers).
    if (this._initPromise) return this._initPromise;

    const run = (async () => {
      const worker = await this._createWorker();
      await this._boot(worker);
    })();
    // A restart that supersedes this gate must not let the old finally
    // clear the replacement init.
    const tracked = run.finally(() => {
      if (this._initPromise === tracked) this._initPromise = null;
    });
    this._initPromise = tracked;

    return tracked;
  }

  /** Wire `worker` and run the loaded → init → ready handshake. */
  _boot(worker) {
    const INIT_TIMEOUT_MS = 60000;
    return new Promise((resolve, reject) => {
      let settled = false;
      const settle = (fn) => (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        this._initCancel = null;
        fn(value);
      };
      const resolveInit = settle(resolve);
      const rejectInit = settle(reject);
      this._initCancel = (reason) => rejectInit(reason instanceof Error ? reason : new Error(String(reason || 'Worker init cancelled')));

      const timeoutId = setTimeout(() => {
        rejectInit(new Error(`Manifold worker init timed out after ${INIT_TIMEOUT_MS / 1000}s`));
        try {
          if (this.worker) {
            this.worker.terminate();
            this.worker = null;
          }
        } catch { /* ignore */ }
        this.isReady = false;
      }, INIT_TIMEOUT_MS);

      try {
        this.worker = worker;

        this.worker.onmessage = (event) => this._handleMessage(event);

        this.worker.onerror = (error) => {
          console.error('[ManifoldWorker] Worker error:', error);
          if (!settled) {
            rejectInit(new Error(`Worker error: ${error?.message || 'unknown'}`));
            return;
          }
          // The thread died without a report (the browser killed it, an
          // uncaught throw outside a message): the oldest job was running.
          if (this.worker !== worker) return;
          const verdict = classifyKernelFailure({ message: String(error?.message || '') });
          this._onKernelCrash({
            reason: verdict.fatal ? verdict.reason : 'worker_lost',
            kernelMessage: error?.message || '',
            crashedId: null,
          });
        };

        // Wait for 'loaded' signal, then send init
        const initHandler = (event) => {
          if (event.data.type !== 'loaded') return;
          this.worker.removeEventListener('message', initHandler);
          console.log('[ManifoldWorker] Worker loaded, sending init...');

          const initId = this._generateRequestId();
          this.pendingRequests.set(initId, { resolve: resolveInit, reject: rejectInit });

          // No payload needed - worker imports WASM directly
          this.worker.postMessage({
            type: 'init',
            id: initId,
            payload: {}
          });
        };

        this.worker.addEventListener('message', initHandler);
      } catch (error) {
        rejectInit(error);
      }
    });
  }
  
  /**
   * Execute a Manifold script
   * @param {string} script - The script to execute
   * @param {Object} options - Execution options
   * @param {Object} options.importedModels - Pre-serialized imported models
   * @param {number} options.timeoutMs - Timeout in milliseconds
   * @param {number} options.memoryLimitMB - Memory limit in MB
   * @returns {Promise<Object>} - The mesh data result
   */
  async execute(script, options = {}) {
    await this._waitUntilReady();
    if (!this.isReady) {
      throw new Error('ManifoldWorker not initialized. Call init() first.');
    }
    
    // The job budget: the caller's timeoutMs, else the default. A
    // configured jobBudgetMs (dev panel, goldens) wins over both.
    const timeoutMs = Number(this.config.jobBudgetMs) > 0
      ? Number(this.config.jobBudgetMs)
      : (options.timeoutMs || this.config.timeoutMs);
    const memoryLimitMB = options.memoryLimitMB || this.config.memoryLimitMB;
    const importedModels = options.importedModels || {};
    
    return new Promise((resolve, reject) => {
      const requestId = this._generateRequestId();

      // Watchdog: a job past its budget is treated like a crash. The thread
      // is killed and replaced, this job fails with reason timeout, and the
      // jobs queued behind it move to the fresh worker. A promise-only
      // timeout used to leave the hung run holding the thread, and every
      // later call queued behind it until the tab was reloaded.
      const timeoutId = setTimeout(() => {
        if (!this.pendingRequests.has(requestId)) return;
        this._onKernelCrash({ reason: 'timeout', crashedId: requestId, budgetMs: timeoutMs });
      }, timeoutMs);

      const message = {
        type: 'execute',
        id: requestId,
        payload: {
          script,
          importedModels,
          memoryLimitMB,
          nonce: options.nonce ?? null,
          ...(options.rollbackAnchor === null || typeof options.rollbackAnchor === 'string'
            ? { rollbackAnchor: options.rollbackAnchor }
            : {}),
        }
      };
      // Store request (the message stays so a crash elsewhere can re-post it)
      this.pendingRequests.set(requestId, {
        kind: 'execute',
        sentAt: performance.now(),
        message,
        partId: typeof options.partId === 'string' ? options.partId : null,
        resolve: (result) => {
          clearTimeout(timeoutId);
          resolve(result);
        },
        reject: (error) => {
          clearTimeout(timeoutId);
          reject(error);
        }
      });

      this.worker.postMessage(message);
    });
  }

  /**
   * Get model information (volume, surface area, bounding box) from cached manifold
   * 
   * @param {Object} [options] - Options
   * @param {number} [options.timeoutMs] - Timeout in milliseconds
   * @returns {Promise<Object>} Model info containing:
   *   - volume: Volume in mm³
   *   - surfaceArea: Surface area in mm²
   *   - boundingBox: { min: [x,y,z], max: [x,y,z] }
   * @throws {Error} If no manifold is cached
   */
  async getModelInfo(options = {}) {
    if (!this.isReady) {
      throw new Error('ManifoldWorker not initialized');
    }
    
    const timeoutMs = options.timeoutMs || this.config.timeoutMs;
    
    return new Promise((resolve, reject) => {
      const requestId = this._generateRequestId();
      
      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`getModelInfo timed out after ${timeoutMs / 1000}s`));
      }, timeoutMs);
      
      this.pendingRequests.set(requestId, {
        resolve: (result) => {
          clearTimeout(timeoutId);
          resolve(result);
        },
        reject: (error) => {
          clearTimeout(timeoutId);
          reject(error);
        }
      });
      
      this.worker.postMessage({
        type: 'getModelInfo',
        id: requestId,
        payload: {}
      });
    });
  }


  /**
   * Keep the last execute() solid as the game-mode ghost target.
   * Must be called immediately after executing the puzzle target script,
   * before the player's attempt overwrites cachedManifold.
   */
  async storeGameTarget(options = {}) {
    if (!this.isReady) throw new Error('ManifoldWorker not initialized');
    const timeoutMs = options.timeoutMs || this.config.timeoutMs;
    return new Promise((resolve, reject) => {
      const requestId = this._generateRequestId();
      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`storeGameTarget timed out after ${timeoutMs / 1000}s`));
      }, timeoutMs);
      this.pendingRequests.set(requestId, {
        resolve: (r) => { clearTimeout(timeoutId); resolve(r); },
        reject: (e) => { clearTimeout(timeoutId); reject(e); },
      });
      this.worker.postMessage({ type: 'storeGameTarget', id: requestId, payload: {} });
    });
  }

  /**
   * Compare the last execute() solid (attempt) against the stored ghost.
   * @param {Object} [opts]
   * @param {number} [opts.relEps]
   * @param {number} [opts.volFloor]
   * @param {*} [opts.nonce] - Must match the execute nonce that produced the on-screen solid
   */
  async compareGameMatch(opts = {}, options = {}) {
    if (!this.isReady) throw new Error('ManifoldWorker not initialized');
    const timeoutMs = options.timeoutMs || this.config.timeoutMs;
    return new Promise((resolve, reject) => {
      const requestId = this._generateRequestId();
      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`compareGameMatch timed out after ${timeoutMs / 1000}s`));
      }, timeoutMs);
      this.pendingRequests.set(requestId, {
        resolve: (r) => { clearTimeout(timeoutId); resolve(r); },
        reject: (e) => { clearTimeout(timeoutId); reject(e); },
      });
      this.worker.postMessage({
        type: 'compareGameMatch',
        id: requestId,
        payload: { relEps: opts.relEps, volFloor: opts.volFloor, nonce: opts.nonce },
      });
    });
  }

  /** Drop the worker's cached solid from the last run (viewport-clearing run). */
  async clearResult(options = {}) {
    if (!this.isReady) throw new Error('ManifoldWorker not initialized');
    const timeoutMs = options.timeoutMs || this.config.timeoutMs;
    return new Promise((resolve, reject) => {
      const requestId = this._generateRequestId();
      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`clearResult timed out after ${timeoutMs / 1000}s`));
      }, timeoutMs);
      this.pendingRequests.set(requestId, {
        resolve: (r) => { clearTimeout(timeoutId); resolve(r); },
        reject: (e) => { clearTimeout(timeoutId); reject(e); },
      });
      this.worker.postMessage({ type: 'clearResult', id: requestId, payload: {} });
    });
  }

  async clearGameTarget(options = {}) {
    if (!this.isReady) throw new Error('ManifoldWorker not initialized');
    const timeoutMs = options.timeoutMs || this.config.timeoutMs;
    return new Promise((resolve, reject) => {
      const requestId = this._generateRequestId();
      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`clearGameTarget timed out after ${timeoutMs / 1000}s`));
      }, timeoutMs);
      this.pendingRequests.set(requestId, {
        resolve: (r) => { clearTimeout(timeoutId); resolve(r); },
        reject: (e) => { clearTimeout(timeoutId); reject(e); },
      });
      this.worker.postMessage({ type: 'clearGameTarget', id: requestId, payload: {} });
    });
  }

  /**
   * Import OBJ string and create Manifold
   * This is the preferred import method - STL and 3MF should convert to OBJ first
   * 
   * @param {string} objString - OBJ format string
   * @param {string} filename - Filename for caching
   * @param {Object} [options] - Options
   * @returns {Promise<{mesh: Object, volume: number, boundingBox: Object}>}
   */
  async importOBJ(objString, filename, options = {}) {
    if (!this.isReady) {
      throw new Error('ManifoldWorker not initialized');
    }
    
    const timeoutMs = options.timeoutMs || this.config.timeoutMs;
    
    return new Promise((resolve, reject) => {
      const requestId = this._generateRequestId();
      
      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`importOBJ timed out after ${timeoutMs / 1000}s`));
      }, timeoutMs);
      
      this.pendingRequests.set(requestId, {
        resolve: (result) => {
          clearTimeout(timeoutId);
          resolve(result);
        },
        reject: (error) => {
          clearTimeout(timeoutId);
          reject(error);
        }
      });
      
      this.worker.postMessage({
        type: 'importOBJ',
        id: requestId,
        payload: { objString, filename }
      });
    });
  }
  
  /**
   * ── Stage verification protocol (dev tooling; pairs with the worker's
   * stageReference... / stageVerify cases). The staging environment (bundled
   * built/manifold.wasm) is the single kernel-truth source for the pilot:
   * push reference solids, fetch/verify against them here, never in a
   * divergent out-of-process copy.
   */
  async stageReferenceLoad(filename, { objString, meshData, tolerance } = {}, options = {}) {
    if (!this.isReady) throw new Error('ManifoldWorker not initialized');
    const timeoutMs = options.timeoutMs || this.config.timeoutMs;
    return new Promise((resolve, reject) => {
      const requestId = this._generateRequestId();
      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`stageReferenceLoad timed out after ${timeoutMs / 1000}s`));
      }, timeoutMs);
      this.pendingRequests.set(requestId, {
        resolve: (r) => { clearTimeout(timeoutId); resolve(r); },
        reject: (e) => { clearTimeout(timeoutId); reject(e); },
      });
      this.worker.postMessage({
        type: 'stageReferenceLoad', id: requestId,
        payload: { filename, objString, meshData, tolerance },
      });
    });
  }

  async stageReferenceList() {
    if (!this.isReady) throw new Error('ManifoldWorker not initialized');
    return new Promise((resolve, reject) => {
      const requestId = this._generateRequestId();
      this.pendingRequests.set(requestId, { resolve, reject });
      this.worker.postMessage({ type: 'stageReferenceList', id: requestId, payload: {} });
    });
  }

  async stageReferenceClear() {
    if (!this.isReady) throw new Error('ManifoldWorker not initialized');
    return new Promise((resolve, reject) => {
      const requestId = this._generateRequestId();
      this.pendingRequests.set(requestId, { resolve, reject });
      this.worker.postMessage({ type: 'stageReferenceClear', id: requestId, payload: {} });
    });
  }

  async stageVerify(reference, opts = {}, options = {}) {
    if (!this.isReady) throw new Error('ManifoldWorker not initialized');
    const timeoutMs = options.timeoutMs || Math.max(this.config.timeoutMs, 120000);
    return new Promise((resolve, reject) => {
      const requestId = this._generateRequestId();
      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`stageVerify timed out after ${timeoutMs / 1000}s`));
      }, timeoutMs);
      this.pendingRequests.set(requestId, {
        resolve: (r) => { clearTimeout(timeoutId); resolve(r); },
        reject: (e) => { clearTimeout(timeoutId); reject(e); },
      });
      this.worker.postMessage({
        type: 'stageVerify', id: requestId,
        payload: { reference, passRel: opts.passRel, volGate: opts.volGate,
                   candidateMesh: opts.candidateMesh, tolerance: opts.tolerance },
      });
    });
  }

  async stageGetLastMesh() {
    if (!this.isReady) throw new Error('ManifoldWorker not initialized');
    const timeoutMs = this.config.timeoutMs;
    return new Promise((resolve, reject) => {
      const requestId = this._generateRequestId();
      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`stageGetLastMesh timed out after ${timeoutMs / 1000}s`));
      }, timeoutMs);
      this.pendingRequests.set(requestId, {
        resolve: (r) => { clearTimeout(timeoutId); resolve(r); },
        reject: (e) => { clearTimeout(timeoutId); reject(e); },
      });
      this.worker.postMessage({ type: 'stageGetLastMesh', id: requestId, payload: {} });
    });
  }

  /**
   * Get list of available helper functions
   * @returns {Promise<string[]>}
   */
  async getHelperList() {
    if (!this.isReady) {
      throw new Error('ManifoldWorker not initialized');
    }

    const timeoutMs = 15000;
    return new Promise((resolve, reject) => {
      const requestId = this._generateRequestId();
      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`getHelperList timed out after ${timeoutMs / 1000}s`));
      }, timeoutMs);

      this.pendingRequests.set(requestId, {
        resolve: (result) => { clearTimeout(timeoutId); resolve(result); },
        reject: (error) => { clearTimeout(timeoutId); reject(error); },
      });

      this.worker.postMessage({
        type: 'getHelperList',
        id: requestId
      });
    });
  }

  /**
   * Cross section a cached manifold
   * 
   * This operation uses the manifold cached from the last execute() call
   * and trims it by the specified plane, returning the portion on the 
   * negative side of the plane (opposite to the normal direction).
   * 
   * @param {number[]} normal - Unit normal vector of the cutting plane [x, y, z]
   * @param {number} originOffset - Distance from origin along the normal direction.
   *                                Positive values move the plane in the normal direction.
   * @param {Object} [options] - Optional execution options
   * @param {number} [options.timeoutMs] - Timeout in milliseconds (default: from config)
   * @returns {Promise<Object>} Result object containing:
   *   - mesh: Serialized mesh data of the trimmed manifold
   */
  async trimByPlane(normal, originOffset, options = {}) {
    if (!this.isReady) {
      throw new Error('ManifoldWorker not initialized');
    }
    
    const timeoutMs = options.timeoutMs || this.config.timeoutMs;
    
    return new Promise((resolve, reject) => {
      const requestId = this._generateRequestId();
      
      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`trimByPlane timed out after ${timeoutMs / 1000}s`));
      }, timeoutMs);
      
      this.pendingRequests.set(requestId, {
        resolve: (result) => {
          clearTimeout(timeoutId);
          resolve(result);
        },
        reject: (error) => {
          clearTimeout(timeoutId);
          reject(error);
        }
      });
      
      this.worker.postMessage({
        type: 'trimByPlane',
        id: requestId,
        payload: { normal, originOffset }
      });
    });
  }

  /**
   * Trim mesh data by a plane without using the cached Run solid.
   */
  async trimMeshByPlane(mesh, normal, originOffset, options = {}) {
    if (!this.isReady) {
      throw new Error('ManifoldWorker not initialized');
    }
    const timeoutMs = options.timeoutMs || this.config.timeoutMs;
    return new Promise((resolve, reject) => {
      const requestId = this._generateRequestId();
      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`trimMeshByPlane timed out after ${timeoutMs / 1000}s`));
      }, timeoutMs);
      this.pendingRequests.set(requestId, {
        resolve: (result) => {
          clearTimeout(timeoutId);
          resolve(result);
        },
        reject: (error) => {
          clearTimeout(timeoutId);
          reject(error);
        },
      });
      this.worker.postMessage({
        type: 'trimMeshByPlane',
        id: requestId,
        payload: { mesh, normal, originOffset },
      });
    });
  }

  /**
   * Split a clone of the cached solid for the Pieces preview.
   * Does not replace the cached manifold and does not write the script.
   *
   * @param {object} plane - Face `{ center, normal, offset? }` or `{ normal, originOffset }`
   * @param {{ at: number[] }[]} bodies - Bodies to cut. Omit to cut every body.
   * @returns {Promise<{ pieces: object[] }>}
   */
  /** One request/response round trip. */
  _request(type, payload, options = {}) {
    if (!this.isReady) {
      return Promise.reject(new Error('ManifoldWorker not initialized'));
    }
    const timeoutMs = options.timeoutMs || this.config.timeoutMs;
    return new Promise((resolve, reject) => {
      const requestId = this._generateRequestId();
      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`${type} timed out after ${timeoutMs / 1000}s`));
      }, timeoutMs);
      const message = { type, id: requestId, payload };
      this.pendingRequests.set(requestId, {
        kind: options.kind || type,
        message,
        resolve: (result) => {
          clearTimeout(timeoutId);
          resolve(result);
        },
        reject: (error) => {
          clearTimeout(timeoutId);
          reject(error);
        },
      });
      this.worker.postMessage(message);
    });
  }

  /**
   * Which parts a subtract cutter overlaps. The cutter script runs on the
   * worker without replacing the cached solid.
   */
  async probeOverlap(cutterScript, parts, options = {}) {
    return this._request('probeOverlap', { cutterScript, parts }, options);
  }

  async previewBoolean(op, bodies, options = {}) {
    if (!this.isReady) {
      throw new Error('ManifoldWorker not initialized');
    }
    const timeoutMs = options.timeoutMs || this.config.timeoutMs;
    return new Promise((resolve, reject) => {
      const requestId = this._generateRequestId();
      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`previewBoolean timed out after ${timeoutMs / 1000}s`));
      }, timeoutMs);
      this.pendingRequests.set(requestId, {
        resolve: (result) => {
          clearTimeout(timeoutId);
          resolve(result);
        },
        reject: (error) => {
          clearTimeout(timeoutId);
          reject(error);
        }
      });
      this.worker.postMessage({
        type: 'previewBoolean',
        id: requestId,
        payload: {
          op,
          bodies,
          tools: Array.isArray(options.tools) ? options.tools : undefined,
          targetScript: typeof options.targetScript === 'string' ? options.targetScript : undefined,
        }
      });
    });
  }

  async previewCut(plane, bodies, options = {}) {
    if (!this.isReady) {
      throw new Error('ManifoldWorker not initialized');
    }
    const timeoutMs = options.timeoutMs || this.config.timeoutMs;
    return new Promise((resolve, reject) => {
      const requestId = this._generateRequestId();
      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`previewCut timed out after ${timeoutMs / 1000}s`));
      }, timeoutMs);
      this.pendingRequests.set(requestId, {
        resolve: (result) => {
          clearTimeout(timeoutId);
          resolve(result);
        },
        reject: (error) => {
          clearTimeout(timeoutId);
          reject(error);
        }
      });
      this.worker.postMessage({
        type: 'previewCut',
        id: requestId,
        payload: { plane, bodies }
      });
    });
  }

  /**
   * Offset a clone of the cached solid for the Move Face preview.
   * Does not replace the cached manifold and does not write the script.
   *
   * @param {{ center: number[], normal: number[] }[]} faces
   * @param {number} distance
   * @param {boolean} [flip]
   * @returns {Promise<{ mesh: object }>}
   */
  async previewMoveFace(faces, distance, flip = false, options = {}) {
    if (!this.isReady) {
      throw new Error('ManifoldWorker not initialized');
    }
    const timeoutMs = options.timeoutMs || this.config.timeoutMs;
    return new Promise((resolve, reject) => {
      const requestId = this._generateRequestId();
      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`previewMoveFace timed out after ${timeoutMs / 1000}s`));
      }, timeoutMs);
      this.pendingRequests.set(requestId, {
        resolve: (result) => {
          clearTimeout(timeoutId);
          resolve(result);
        },
        reject: (error) => {
          clearTimeout(timeoutId);
          reject(error);
        }
      });
      this.worker.postMessage({
        type: 'previewMoveFace',
        id: requestId,
        payload: { faces, distance, flip }
      });
    });
  }

  /**
   * Block pop preview. Builds the new solid (size + pose) without reading
   * or replacing the cached part, and without writing the script.
   *
   * @param {string} id palette id: cube, roundedBox, cylinder, sphere, tube, hexPrism
   * @param {object} params sheet values
   * @returns {Promise<{ mesh: object, volume: number, boundingBox: object, combine: string }>}
   */
  async previewBlock(id, params, options = {}) {
    if (!this.isReady) {
      throw new Error('ManifoldWorker not initialized');
    }
    const timeoutMs = options.timeoutMs || this.config.timeoutMs;
    return new Promise((resolve, reject) => {
      const requestId = this._generateRequestId();
      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`previewBlock timed out after ${timeoutMs / 1000}s`));
      }, timeoutMs);
      this.pendingRequests.set(requestId, {
        resolve: (result) => {
          clearTimeout(timeoutId);
          resolve(result);
        },
        reject: (error) => {
          clearTimeout(timeoutId);
          reject(error);
        }
      });
      this.worker.postMessage({
        type: 'previewBlock',
        id: requestId,
        payload: { id, params }
      });
    });
  }

  /**
   * Heal a clone of the cached solid for the Delete Face preview.
   * Does not replace the cached manifold and does not write the script.
   *
   * @param {{ center: number[], normal: number[] }[]} faces
   * @returns {Promise<{ mesh: object }>}
   */
  async previewDeleteFace(faces, options = {}) {
    if (!this.isReady) {
      throw new Error('ManifoldWorker not initialized');
    }
    const timeoutMs = options.timeoutMs || this.config.timeoutMs;
    return new Promise((resolve, reject) => {
      const requestId = this._generateRequestId();
      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`previewDeleteFace timed out after ${timeoutMs / 1000}s`));
      }, timeoutMs);
      this.pendingRequests.set(requestId, {
        resolve: (result) => {
          clearTimeout(timeoutId);
          resolve(result);
        },
        reject: (error) => {
          clearTimeout(timeoutId);
          reject(error);
        }
      });
      this.worker.postMessage({
        type: 'previewDeleteFace',
        id: requestId,
        payload: { faces }
      });
    });
  }
  
  /**
   * Cheap alive check (Safari may kill the Worker on minimize while the
   * JS world survives). Returns false when the worker is gone or unresponsive.
   */
  async ping(timeoutMs = 2000) {
    if (!this.worker || !this.isReady) return false;
    try {
      // kind:'ping' so a timeout is not counted as script work.
      await this._request('ping', {}, { timeoutMs, kind: 'ping' });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Requests other than the liveness ping. A synchronous script keeps the
   * worker thread busy; ping cannot be answered until that script returns.
   */
  _pendingWorkCount() {
    let n = 0;
    for (const req of this.pendingRequests.values()) {
      if (req?.kind === 'ping') continue;
      n += 1;
    }
    return n;
  }

  _livenessState(pingOk) {
    return {
      initInFlight: !!this._initPromise,
      restartInFlight: !!this._restartPromise,
      pendingWork: this._pendingWorkCount(),
      ...(pingOk === undefined ? {} : { pingOk }),
    };
  }

  /**
   * Block until an in-flight restart or init finishes. Does not start one.
   */
  async _waitUntilReady() {
    if (this.isReady) return;
    const restart = this._restartPromise;
    if (restart) {
      try { await restart; } catch { /* caller checks isReady */ }
    }
    if (this.isReady) return;
    const init = this._initPromise;
    if (init) {
      try { await init; } catch { /* caller checks isReady */ }
    }
  }

  /**
   * Soft-recover after page freeze / bfcache: ping, else restart in place.
   * Never calls location.reload — full remount is only if Safari discarded
   * the tab (that is a real navigation; we cannot fake surviving it).
   *
   * A ping timeout while a script is in flight is not death. Headless Chrome
   * fires a late visibility/pageshow after the first layout (viewport
   * ResizeObserver, privacy footer). Restarting there used to terminate the
   * running fillet and leave the next call with "not initialized".
   */
  async ensureAlive(reason = 'lifecycle') {
    let decision = softRestartDecision(this._livenessState());
    if (decision === 'wait') {
      await this._restartPromise;
      return { status: 'restarted', reason };
    }
    if (decision === 'starting' || decision === 'busy') {
      return { status: decision, reason };
    }

    const pingOk = await this.ping();
    decision = softRestartDecision(this._livenessState(pingOk));
    if (decision === 'wait') {
      await this._restartPromise;
      return { status: 'restarted', reason };
    }
    if (decision !== 'restart') {
      return { status: decision === 'ping' ? 'alive' : decision, reason };
    }

    console.warn(`[ManifoldWorker] Worker dead (${reason}); soft restart`);
    await this.restart();
    return { status: 'restarted', reason };
  }

  /**
   * The kernel died (the worker reported a fatal throw, the thread raised
   * an error, or a job ran past its budget). Fail the job that was running
   * with one structured error, drop the thread, start a fresh one, and
   * re-post the jobs that were queued behind the crash so they run there.
   * Nothing waits for the MCP timeout and nobody has to reload the tab.
   *
   * @param {{ reason?: string, kernelMessage?: string, wasmHeapMB?: number | null, crashedId?: string | null, budgetMs?: number }} info
   * @returns {Promise<void>} settles when the replacement worker is ready
   */
  _onKernelCrash(info = {}) {
    if (this._crashInFlight) return this._crashInFlight;
    const dead = this.worker;
    const ids = [...this.pendingRequests.keys()];
    const split = splitPendingOnCrash(ids, info.crashedId ?? null);
    const reason = info.reason || 'wasm_abort';
    const requeued = [];
    const failed = [...split.failed];
    for (const id of split.requeue) {
      const request = this.pendingRequests.get(id);
      if (request?.message) requeued.push([id, request]);
      else failed.push(id);
    }
    this.crashCount += 1;
    const makeError = (id) => {
      const request = id != null ? this.pendingRequests.get(id) : null;
      return kernelCrashError({
        reason,
        kernelMessage: info.kernelMessage,
        wasmHeapMB: info.wasmHeapMB,
        budgetMs: info.budgetMs,
        partId: request?.partId || null,
        workerRestarted: true,
      });
    };
    const first = makeError(failed[0] ?? null);
    this.lastCrash = {
      at: Date.now(),
      reason,
      message: first.message,
      kernelMessage: typeof info.kernelMessage === 'string' ? info.kernelMessage : null,
      wasmHeapMB: Number.isFinite(Number(info.wasmHeapMB)) ? Number(info.wasmHeapMB) : null,
      failed: failed.length,
      requeued: requeued.length,
    };
    for (const id of failed) {
      const request = this.pendingRequests.get(id);
      const error = id === failed[0] ? first : makeError(id);
      this.pendingRequests.delete(id);
      try { request?.reject?.(error); } catch { /* listener threw */ }
    }
    for (const [id] of requeued) this.pendingRequests.delete(id);
    // Drop the thread without rejecting the requeued jobs.
    if (this._initCancel) {
      try { this._initCancel(new Error('Worker crashed')); } catch { /* ignore */ }
      this._initCancel = null;
    }
    this._initPromise = null;
    this.isReady = false;
    if (dead) {
      try { dead.onmessage = null; dead.onerror = null; } catch { /* detached */ }
      try { dead.terminate(); } catch { /* gone */ }
    }
    if (this.worker === dead) this.worker = null;
    console.warn(`[ManifoldWorker] Kernel crashed (${reason}); ${failed.length} job(s) failed, ${requeued.length} requeued; restarting worker`);

    const run = (async () => {
      try {
        await this.init();
      } catch (err) {
        const lost = kernelCrashError({
          reason: 'worker_lost',
          kernelMessage: err?.message || String(err),
          workerRestarted: false,
        });
        for (const [, request] of requeued) {
          try { request.reject?.(lost); } catch { /* listener threw */ }
        }
        throw err;
      }
      for (const [id, request] of requeued) {
        this.pendingRequests.set(id, request);
        this.worker.postMessage(request.message);
      }
    })();
    const settle = run.finally(() => {
      if (this._restartPromise === settle) this._restartPromise = null;
      if (this._crashInFlight === settle) this._crashInFlight = null;
    });
    settle.catch(() => {});
    this._restartPromise = settle;
    this._crashInFlight = settle;
    if (this.onCrash) {
      try { this.onCrash({ ...this.lastCrash }); } catch { /* listener threw */ }
    }
    return settle;
  }

  /**
   * Terminate the worker
   */
  terminate() {
    if (this._initCancel) {
      try { this._initCancel(new Error('Worker terminated')); } catch { /* ignore */ }
      this._initCancel = null;
    }
    for (const [, request] of this.pendingRequests) {
      try { request.reject?.(new Error('Worker terminated')); } catch { /* ignore */ }
    }
    this.pendingRequests.clear();
    this._initPromise = null;
    if (this.worker) {
      try { this.worker.terminate(); } catch { /* ignore */ }
      this.worker = null;
    }
    this.isReady = false;
    console.log('[ManifoldWorker] Terminated');
  }
  
  /**
   * Restart the worker (terminate and reinitialize)
   * @returns {Promise<void>}
   */
  async restart() {
    if (this._restartPromise) return this._restartPromise;
    const run = (async () => {
      this.terminate();
      await this.init();
    })();
    this._restartPromise = run;
    try {
      await run;
    } finally {
      if (this._restartPromise === run) this._restartPromise = null;
    }
  }

  /**
   * A superseded execute keeps the worker thread until it finishes, and every
   * later script queues behind it. Opening an assembly restarts the thread
   * when one of those runs is still in flight so the open is not stuck there.
   * No-op when nothing is pending. Pending promises reject as terminated.
   * @returns {Promise<boolean>} true when a run was dropped
   */
  async preemptInflight() {
    if (!this.pendingRequests || this.pendingRequests.size === 0) return false;
    console.log('[ManifoldWorker] Preempting in-flight run');
    await this.restart();
    return true;
  }
  
  /**
   * Configure the worker
   * @param {Object} config - Configuration options
   */
  configure(config) {
    this.config = { ...this.config, ...config };
  }
  
  // ========== Private Methods ==========
  
  _generateRequestId() {
    return `req_${++this.requestIdCounter}_${Date.now()}`;
  }
  
  _handleMessage(event) {
    const { type, id, payload } = event.data;
    
    switch (type) {
      case 'ready': {
        // Handled in init()
        const request = this.pendingRequests.get(id);
        if (request) {
          this.pendingRequests.delete(id);
          this.isReady = true;
          request.resolve();
        }
        break;
      }
      
      case 'result': {
        const request = this.pendingRequests.get(id);
        if (request) {
          this.pendingRequests.delete(id);
          if (payload && payload.timing && request.sentAt != null) {
            const roundTripMs = performance.now() - request.sentAt;
            const execMs = Number(payload.timing.execMs) || 0;
            const serializeMs = Number(payload.timing.serializeMs) || 0;
            payload.timing.roundTripMs = roundTripMs;
            payload.timing.transferMs = Math.max(0, roundTripMs - execMs - serializeMs);
          }
          request.resolve(payload);
        }
        break;
      }
      
      case 'helperList': {
        const request = this.pendingRequests.get(id);
        if (request) {
          this.pendingRequests.delete(id);
          request.resolve(payload);
        }
        break;
      }
      
      case 'error': {
        if (payload && payload.fatal) {
          // The worker says its kernel is dead. One crash handles every
          // pending job; a later report from the same dead thread is moot.
          this._onKernelCrash({
            reason: payload.reason || 'wasm_abort',
            kernelMessage: payload.message,
            wasmHeapMB: payload.wasmHeapMB,
            crashedId: id ?? null,
          });
          if (this.onError) this.onError(payload);
          break;
        }
        const request = this.pendingRequests.get(id);
        if (request) {
          this.pendingRequests.delete(id);
          const error = new Error(payload.message);
          error.stack = payload.stack;
          if (typeof payload.name === 'string' && payload.name) error.name = payload.name;
          // Script line of the failing call (feature strip red border).
          if (Number.isFinite(payload.scriptLine)) error.scriptLine = payload.scriptLine;
          // Marked feature block that was running (engine-independent).
          if (typeof payload.featureId === 'string') error.featureId = payload.featureId;
          if (typeof payload.featureBlock === 'string') error.featureBlock = payload.featureBlock;
          if (payload.featureSkip && typeof payload.featureSkip === 'object') error.featureSkip = payload.featureSkip;
          request.reject(error);
        }
        
        // Also call global error handler if set
        if (this.onError) {
          this.onError(payload);
        }
        break;
      }
      
      case 'loaded': {
        // Worker script loaded (handled in init())
        break;
      }
      
      default:
        console.warn('[ManifoldWorker] Unknown message type:', type);
    }
  }
}

/**
 * ManifoldContext - A React-friendly wrapper that also handles mesh rendering
 * This can be used as a global singleton or per-viewport instance
 */
class ManifoldContext {
  constructor() {
    this.worker = null;
    this.cachedManifolds = new Map();  // For cross-section operations
    this.meshCache = new Map();        // For imported models
  }
  
  /**
   * Initialize the context
   */
  async init() {
    if (this.worker?.isReady) {
      window.ManifoldContext = this;
      return;
    }
    if (this._initPromise) return this._initPromise;

    const run = (async () => {
      this.worker = new ManifoldWorker();
      await this.worker.init();
      // Expose on window for backward compatibility
      window.ManifoldContext = this;
      console.log('[ManifoldContext] Initialized');
    })();
    this._initPromise = run;

    try {
      await run;
    } finally {
      if (this._initPromise === run) this._initPromise = null;
    }
  }

  /**
   * Resolve once the sandbox can take a call. A terminate/restart in progress
   * (soft-recover or an assembly preempt) is awaited instead of failing the
   * next script with "Manifold Sandbox not initialized".
   */
  async whenReady() {
    const restart = this.worker?._restartPromise;
    if (restart) {
      try { await restart; } catch { /* fall through to init */ }
    }
    if (this.worker?.isReady) return;
    const workerInit = this.worker?._initPromise;
    if (workerInit) {
      try { await workerInit; } catch { /* fall through to init */ }
      if (this.worker?.isReady) return;
    }
    if (this._initPromise) {
      await this._initPromise;
      if (this.worker?.isReady) return;
    }
    await this.init();
  }

  async executeScript(script, options = {}) {
    await this.whenReady();
    if (!this.worker || !this.worker.isReady) {
      throw new Error('ManifoldContext not initialized');
    }
    
    // The caller resolved this script's meshes on the main thread.
    // An omitted map still means the legacy filename cache.
    let importedModels;
    if (options.importedModels && typeof options.importedModels === 'object') {
      importedModels = options.importedModels;
    } else {
      importedModels = {};
      for (const [filename, meshData] of this.meshCache) {
        importedModels[filename] = meshData;
      }
    }
    
    const result = await this.worker.execute(script, {
      ...options,
      importedModels
    });
    
    // Cache the full result for quoting/downloads
    this.lastResult = result;
    
    return result;
  }

  /**
   * Get model information from the cached manifold
   * 
   * @returns {Promise<Object>} Model info { volume, surfaceArea, boundingBox }
   */
  async getModelInfo() {
    if (!this.worker || !this.worker.isReady) {
      throw new Error('ManifoldContext not initialized');
    }
    
    return await this.worker.getModelInfo();
  }


  /**
   * Retain the last executeScript() solid as the game ghost target.
   */
  async storeGameTarget() {
    if (!this.worker || !this.worker.isReady) {
      throw new Error('ManifoldContext not initialized');
    }
    return await this.worker.storeGameTarget();
  }

  /**
   * Boolean-difference the last executeScript() attempt vs the stored ghost.
   */
  async compareGameMatch(opts = {}) {
    if (!this.worker || !this.worker.isReady) {
      throw new Error('ManifoldContext not initialized');
    }
    return await this.worker.compareGameMatch(opts);
  }

  /**
   * Forget the last execution everywhere: context cache + worker-side manifold.
   * A run that clears the viewport (empty / comment-only / plane-only script) must
   * leave nothing behind for cross-section, model info, quoting, game compare or
   * the stage hooks to serve as "the current part".
   */
  async clearResult() {
    this.lastResult = null;
    if (!this.worker || !this.worker.isReady) return { ok: true };
    return await this.worker.clearResult();
  }

  async clearGameTarget() {
    if (!this.worker || !this.worker.isReady) {
      throw new Error('ManifoldContext not initialized');
    }
    return await this.worker.clearGameTarget();
  }

  /**
   * Import OBJ string and create Manifold
   * @param {string} objString - OBJ format string
   * @param {string} filename - Filename for caching
   * @returns {Promise<{mesh: Object, volume: number, boundingBox: Object}>}
   */
  async importOBJ(objString, filename) {
    if (!this.worker || !this.worker.isReady) {
      throw new Error('ManifoldContext not initialized');
    }
    
    return await this.worker.importOBJ(objString, filename);
  }

  /**
   * Get the last execution result (includes mesh, volume, boundingBox)
   * @returns {Object|null}
   */
  getLastResult() {
    return this.lastResult || null;
  }

  /**
   * Trim the cached manifold by a plane
   * 
   * Convenience wrapper for cross-section preview operations. Uses the 
   * manifold cached from the most recent executeScript() call.
   * 
   * @param {number[]} normal - Unit normal vector of the cutting plane [x, y, z].
   *                            The portion of the manifold on the negative side
   *                            (opposite to normal direction) is kept.
   * @param {number} originOffset - Signed distance from the origin to the plane
   *                                along the normal vector. Positive moves the
   *                                plane in the normal direction.
   * @returns {Promise<Object>} Result object containing:
   *   - mesh: Serialized mesh data with vertProperties, triVerts, etc.
   */
  async trimByPlane(normal, originOffset) {
    if (!this.worker || !this.worker.isReady) {
      throw new Error('ManifoldContext not initialized');
    }
    
    return await this.worker.trimByPlane(normal, originOffset);
  }

  /**
   * Trim arbitrary mesh data by a plane (assembly extras, or active part without
   * touching the cached manifold from the last Run).
   */
  async trimMeshByPlane(mesh, normal, originOffset, options = {}) {
    if (!this.worker || !this.worker.isReady) {
      throw new Error('ManifoldContext not initialized');
    }
    return await this.worker.trimMeshByPlane(mesh, normal, originOffset, options);
  }

  /**
   * Pieces preview. Runs the real cut on a clone of the last solid and
   * returns each piece mesh. The cached solid is left as it was.
   */
  async previewBoolean({ op, bodies, tools, targetScript } = {}) {
    if (!this.worker || !this.worker.isReady) {
      throw new Error('ManifoldContext not initialized');
    }
    return await this.worker.previewBoolean(op, bodies, { tools, targetScript });
  }

  /**
   * Cross-part subtract: which part meshes the frozen cutter overlaps.
   * @param {{ cutterScript: string, parts: { id: string, mesh: object, offset: number[] }[] }} args
   */
  async probeOverlap({ cutterScript, parts } = {}) {
    if (!this.worker || !this.worker.isReady) {
      throw new Error('ManifoldContext not initialized');
    }
    return await this.worker.probeOverlap(cutterScript, parts);
  }

  async previewCut({ plane, bodies } = {}) {
    if (!this.worker || !this.worker.isReady) {
      throw new Error('ManifoldContext not initialized');
    }
    return await this.worker.previewCut(plane, bodies);
  }

  /**
   * Move Face preview. Runs moveFace on a clone of the last solid.
   * The cached solid is left as it was.
   */
  async previewMoveFace({ faces, distance, flip } = {}) {
    if (!this.worker || !this.worker.isReady) {
      throw new Error('ManifoldContext not initialized');
    }
    return await this.worker.previewMoveFace(faces, distance, !!flip);
  }

  /**
   * Delete Face preview. Runs deleteFace on a clone of the last solid.
   * The cached solid is left as it was.
   */
  async previewDeleteFace({ faces } = {}) {
    if (!this.worker || !this.worker.isReady) {
      throw new Error('ManifoldContext not initialized');
    }
    return await this.worker.previewDeleteFace(faces);
  }

  /**
   * Block pop preview. The cached solid is left as it was.
   */
  async previewBlock({ id, params } = {}) {
    if (!this.worker || !this.worker.isReady) {
      throw new Error('ManifoldContext not initialized');
    }
    return await this.worker.previewBlock(id, params);
  }
  
  /**
   * Cache an imported model for use in scripts
   * @param {string} filename - The filename key
   * @param {Object} meshData - The serialized mesh data
   */
  cacheImportedModel(filename, meshData) {
    this.meshCache.set(filename, meshData);
    console.log(`[ManifoldContext] Cached model: ${filename}`);
  }
  
  /**
   * Get a cached imported model
   * @param {string} filename - The filename key
   * @returns {Object|null} - The mesh data or null
   */
  getImportedModel(filename) {
    return this.meshCache.get(filename) || null;
  }

  /**
   * Clear all cached models
   */
  clearCache() {
    this.meshCache.clear();
    this.cachedManifolds.clear();
  }
  
  /**
   * Get list of helper functions available in scripts
   * @returns {Promise<string[]>}
   */
  async getHelperFunctions() {
    if (!this.worker) return [];
    return await this.worker.getHelperList();
  }
  
  /**
   * Cheap alive check — delegates to the underlying ManifoldWorker.
   * App soft-recover must call this on the context singleton, not the class.
   */
  async ping(timeoutMs = 2000) {
    if (!this.worker) return false;
    return await this.worker.ping(timeoutMs);
  }

  /**
   * Soft-recover after Safari freeze / bfcache: ping the worker, else
   * restart in place (or re-init if the worker handle is gone). Never
   * location.reload — tab discard is a real navigation we cannot fake.
   */
  async ensureAlive(reason = 'lifecycle') {
    if (this.worker) {
      const result = await this.worker.ensureAlive(reason);
      if (result.status === 'restarted') {
        window.ManifoldContext = this;
      }
      return result;
    }
    console.warn(`[ManifoldContext] No worker (${reason}); soft restart via init`);
    await this.init();
    return { status: 'restarted', reason };
  }

  /**
   * Check if initialized
   * @returns {boolean}
   */
  get isReady() {
    return this.worker?.isReady || false;
  }
  
  /**
   * Terminate the context
   */
  terminate() {
    this._initPromise = null;
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.clearCache();
  }
}

// Create and export singleton instance
const manifoldContext = new ManifoldContext();

// Dev/automation hook: lets headless review tooling (harness/stage_shot.mjs) drive the
// REAL worker path without a human clicking Run. Gated so production bundles are unaffected.
if (typeof window !== 'undefined' && import.meta.env?.DEV) {
  window.__MANIFOLD_CONTEXT__ = manifoldContext;
}

export { ManifoldWorker, ManifoldContext, manifoldContext };
export default manifoldContext;

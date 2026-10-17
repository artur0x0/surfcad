// utils/scriptExecutor.js
import { validateScript, formatValidationErrors } from './scriptValidator';
import { parseImportedModels, getCachedManifoldData } from './stepImport';

/**
 * Default execution limits
 */
const DEFAULT_LIMITS = {
  timeoutMs: 30000,      // 30 seconds
  memoryLimitMB: 512,    // 512 MB
};

/**
 * Script executor that runs user code in a sandboxed Web Worker
 * with validation, timeout, and memory limits.
 */
class ScriptExecutor {
  constructor(options = {}) {
    this.worker = null;
    this.isReady = false;
    this.pendingExecution = null;
    this.limits = { ...DEFAULT_LIMITS, ...options.limits };
    this.wasmUrl = options.wasmUrl || '/manifold.js'; // Path to Manifold WASM
    this.workerUrl = options.workerUrl || '/workers/sandboxWorker.js';
    this.onMemoryWarning = options.onMemoryWarning || null;
  }
  
  /**
   * Initialize the worker
   */
  async initialize() {
    if (this.isReady) return;
    
    return new Promise((resolve, reject) => {
      try {
        this.worker = new Worker(this.workerUrl, { type: 'module' });
        
        const initTimeout = setTimeout(() => {
          reject(new Error('Worker initialization timed out'));
        }, 10000);
        
        this.worker.onmessage = (event) => {
          const { type } = event.data;
          
          if (type === 'loaded') {
            // Worker loaded, now initialize Manifold
            this.worker.postMessage({
              type: 'init',
              payload: { wasmUrl: this.wasmUrl }
            });
          } else if (type === 'ready') {
            clearTimeout(initTimeout);
            this.isReady = true;
            console.log('[ScriptExecutor] Worker ready');
            resolve();
          } else if (type === 'error') {
            clearTimeout(initTimeout);
            reject(new Error(event.data.payload.message));
          }
        };
        
        this.worker.onerror = (error) => {
          clearTimeout(initTimeout);
          reject(new Error(`Worker error: ${error.message}`));
        };
        
      } catch (error) {
        reject(error);
      }
    });
  }
  
  /**
   * Terminate the worker (for cleanup or to stop runaway execution)
   */
  terminate() {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
      this.isReady = false;
    }
    
    if (this.pendingExecution) {
      this.pendingExecution.reject(new Error('Execution cancelled'));
      this.pendingExecution = null;
    }
  }
  
  /**
   * Preload imported models and serialize them for the worker
   */
  async prepareImportedModels(script) {
    const filenames = parseImportedModels(script);
    const serializedModels = {};
    
    if (filenames.length === 0) {
      return serializedModels;
    }
    
    console.log(`[ScriptExecutor] Preloading ${filenames.length} imported model(s)`);
    
    for (const filename of filenames) {
      const data = await getCachedManifoldData(filename);
      if (data) {
        // Store the raw mesh data (already serialized in IndexedDB)
        serializedModels[filename] = data;
        console.log(`[ScriptExecutor] Prepared: ${filename}`);
      } else {
        console.warn(`[ScriptExecutor] Model not found: ${filename}`);
      }
    }
    
    return serializedModels;
  }
  
  /**
   * Execute a script with full validation and sandboxing
   * 
   * @param {string} script - The user script to execute
   * @param {object} options - Execution options
   * @returns {Promise<{mesh: object, memoryUsedMB: number}>}
   */
  async execute(script, options = {}) {
    const limits = { ...this.limits, ...options.limits };
    
    // Step 1: Validate the script
    const validation = validateScript(script);
    if (!validation.valid) {
      const errorMsg = formatValidationErrors(validation.errors);
      throw new Error(errorMsg);
    }
    
    // Step 2: Ensure worker is ready
    if (!this.isReady) {
      await this.initialize();
    }
    
    // Step 3: Preload any imported models
    const importedModels = await this.prepareImportedModels(script);
    
    // Step 4: Execute in worker with timeout
    return new Promise((resolve, reject) => {
      // Set up timeout
      const timeoutId = setTimeout(() => {
        console.error('[ScriptExecutor] Execution timed out, terminating worker');
        this.terminate();
        reject(new Error(`Script execution timed out after ${limits.timeoutMs / 1000}s`));
      }, limits.timeoutMs);
      
      // Store pending execution for cancellation
      this.pendingExecution = { resolve, reject, timeoutId };
      
      // Handle messages from worker
      const messageHandler = (event) => {
        const { type, payload } = event.data;
        
        if (type === 'result') {
          clearTimeout(timeoutId);
          this.worker.removeEventListener('message', messageHandler);
          this.pendingExecution = null;
          
          // Check for memory warning
          if (payload.memoryUsedMB && payload.memoryUsedMB > limits.memoryLimitMB * 0.8) {
            this.onMemoryWarning?.({
              used: payload.memoryUsedMB,
              limit: limits.memoryLimitMB
            });
          }
          
          resolve(payload);
          
        } else if (type === 'error') {
          clearTimeout(timeoutId);
          this.worker.removeEventListener('message', messageHandler);
          this.pendingExecution = null;
          reject(new Error(payload.message));
        }
      };
      
      this.worker.addEventListener('message', messageHandler);
      
      // Send execution request
      this.worker.postMessage({
        type: 'execute',
        payload: {
          script,
          importedModels,
          memoryLimitMB: limits.memoryLimitMB
        }
      });
    });
  }
}

/**
 * Validate a script without executing it
 */
export { validateScript, formatValidationErrors } from './scriptValidator';

export default ScriptExecutor;
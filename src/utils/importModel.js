// utils/modelImport.js
// Consolidated model import - handles STL, OBJ, 3MF and STEP, all in the browser.
// Mesh files use OBJ as the intermediate format. STEP is meshed by the Open CASCADE
// wasm module and handed to the Manifold worker as arrays.

import manifoldContext from './ManifoldWorker';
import { importSTL, importOBJ, import3MF, meshToOBJ } from './model-io';

// ============================================================================
// IndexedDB CACHE
// ============================================================================

const DB_NAME = 'SurfDB';
const DB_VERSION = 1;
const STORE_NAME = 'models';

const initDB = () => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'filename' });
      }
    };
  });
};

/**
 * Cache manifold mesh data in IndexedDB
 */
export const cacheManifoldData = async (filename, meshData) => {
  try {
    const db = await initDB();
    const tx = db.transaction([STORE_NAME], 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    
    await new Promise((resolve, reject) => {
      const request = store.put({ filename, meshData, timestamp: Date.now() });
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
    
    console.log(`[Cache] Stored ${filename}`);
  } catch (error) {
    console.error('[Cache] Store error:', error);
  }
};

/**
 * Retrieve cached manifold mesh data
 */
export const getCachedManifoldData = async (filename) => {
  try {
    const db = await initDB();
    const tx = db.transaction([STORE_NAME], 'readonly');
    const store = tx.objectStore(STORE_NAME);
    
    return new Promise((resolve) => {
      const request = store.get(filename);
      request.onsuccess = () => {
        resolve(request.result?.meshData || null);
      };
      request.onerror = () => resolve(null);
    });
  } catch (error) {
    console.error('[Cache] Retrieve error:', error);
    return null;
  }
};

/**
 * Load a cached model and register with ManifoldContext
 */
export const loadCachedModel = async (filename) => {
  // Check ManifoldContext first
  const existing = manifoldContext.getImportedModel(filename);
  if (existing) return existing;
  
  // Try IndexedDB
  const meshData = await getCachedManifoldData(filename);
  if (meshData) {
    manifoldContext.cacheImportedModel(filename, meshData);
    return meshData;
  }
  
  return null;
};

/**
 * Check if a model is available
 */
export const hasImportedModel = async (filename) => {
  if (manifoldContext.getImportedModel(filename)) return true;
  return (await getCachedManifoldData(filename)) !== null;
};

/**
 * Clear all cached models
 */
export const clearModelCache = async () => {
  try {
    const db = await initDB();
    const tx = db.transaction([STORE_NAME], 'readwrite');
    await new Promise((resolve, reject) => {
      const request = tx.objectStore(STORE_NAME).clear();
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
    manifoldContext.clearCache?.();
    console.log('[Cache] Cleared');
  } catch (error) {
    console.error('[Cache] Clear error:', error);
  }
};

/**
 * List all cached model filenames
 */
export const listCachedModels = async () => {
  try {
    const db = await initDB();
    const tx = db.transaction([STORE_NAME], 'readonly');
    return new Promise((resolve) => {
      const request = tx.objectStore(STORE_NAME).getAllKeys();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve([]);
    });
  } catch (error) {
    return [];
  }
};

// ============================================================================
// FORMAT DETECTION
// ============================================================================

const MESH_FORMATS = ['.stl', '.obj', '.3mf'];
const STEP_FORMATS = ['.step', '.stp'];

const getExtension = (filename) => 
  filename.toLowerCase().slice(filename.lastIndexOf('.'));

export const isMeshFormat = (filename) => 
  MESH_FORMATS.includes(getExtension(filename));

export const isStepFormat = (filename) => 
  STEP_FORMATS.includes(getExtension(filename));

// ============================================================================
// SCRIPT GENERATION
// ============================================================================

/**
 * Parse a script to find imported model filenames
 */
export const parseImportedModels = (script) => {
  const pattern = /window\.__importedManifolds\s*\[\s*['"]([^'"]+)['"]\s*\]/g;
  const filenames = [];
  let match;
  while ((match = pattern.exec(script)) !== null) {
    filenames.push(match[1]);
  }
  return [...new Set(filenames)];
};

/**
 * Generate script for accessing imported model
 */
export const generateImportScript = (filename, volume) => {
  return `// Imported model: ${filename}
// Volume: ${volume.toFixed(2)} mm³
//
// This model was imported and converted to a Manifold object.
// You can use all Manifold operations on it.

const importedModel = window.__importedManifolds['${filename}'];

return importedModel;`;
};

// ============================================================================
// STEP IMPORT (in the browser)
// ============================================================================

/** Weld grid for the STEP reader's per-face triangle soup, in millimetres. */
const STEP_WELD_TOLERANCE_MM = 0.001;

const STEP_NOT_SOLID_MESSAGE =
  'This STEP file did not convert to a closed solid. Check that the model is a solid body and try again.';

/**
 * Import a STEP file. The file is read and meshed on this device by the
 * Open CASCADE wasm module (src/step/stepClient.js) and the Manifold worker
 * welds the result into a solid. Nothing is uploaded, and there is no server
 * fallback: a file the module cannot convert fails with a message.
 */
export const importStepFile = async (file, deflection = 0.1, options = {}) => {
  const startTime = Date.now();
  const filename = file.name;
  
  console.log(`[Import] Starting STEP import: ${filename}`);
  
  try {
    const convert = options.convertStep || (await import('../step/stepClient.js')).convertStep;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const soup = await convert(bytes, { deflection });
    console.log(`[Import] STEP meshed: ${soup.triVerts.length / 3} triangles, ${soup.solids} solids, ${soup.faces} faces`);

    let result;
    try {
      result = await manifoldContext.importMeshData(
        { vertProperties: soup.vertProperties, triVerts: soup.triVerts },
        filename,
        { tolerance: STEP_WELD_TOLERANCE_MM },
      );
    } catch (error) {
      console.error('[Import] STEP mesh is not a solid:', error);
      throw new Error(STEP_NOT_SOLID_MESSAGE);
    }
    if (!result || !result.mesh) {
      throw new Error(STEP_NOT_SOLID_MESSAGE);
    }
    
    if (!options.skipCache) {
      await cacheManifoldData(filename, result.mesh);
      manifoldContext.cacheImportedModel(filename, result.mesh);
    }
    
    const script = generateImportScript(filename, result.volume);
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[Import] ✓ STEP import complete in ${duration}s (volume: ${result.volume.toFixed(2)} mm³)`);
    
    return {
      script,
      filename,
      meshData: result.mesh,
      volume: result.volume,
      boundingBox: result.boundingBox,
    };
  } catch (error) {
    console.error('[Import] STEP import failed:', error);
    throw error;
  }
};

// ============================================================================
// MESH IMPORT (Frontend via OBJ conversion)
// ============================================================================

/**
 * Import STL, OBJ, or 3MF file
 * Converts to OBJ internally for reliable Manifold construction
 */
export const importMeshFile = async (file, options = {}) => {
  const startTime = Date.now();
  const filename = file.name;
  const ext = getExtension(filename);
  
  console.log(`[Import] Starting mesh import: ${filename}`);
  
  try {
    // Step 1: Parse file to vertices/triangles
    let meshData;
    
    switch (ext) {
      case '.stl':
        console.log('[Import] Parsing STL...');
        meshData = await importSTL(file);
        break;
      case '.obj':
        console.log('[Import] Parsing OBJ...');
        meshData = await importOBJ(file);
        break;
      case '.3mf':
        console.log('[Import] Parsing 3MF...');
        meshData = await import3MF(file);
        break;
      default:
        throw new Error(`Unsupported format: ${ext}`);
    }
    
    console.log(`[Import] Parsed ${meshData.vertices.length} vertices, ${meshData.triangles.length} triangles`);
    
    // Step 2: Convert to OBJ string (the reliable intermediate format)
    console.log('[Import] Converting to OBJ format...');
    const objString = meshToOBJ(meshData, filename.replace(/\.[^.]+$/, ''));
    
    // Step 3: Import via OBJ pipeline in worker
    console.log('[Import] Sending to Manifold worker...');
    const result = await manifoldContext.importOBJ(objString, filename);
    
    if (!result || !result.mesh) {
      throw new Error('Failed to create Manifold from mesh');
    }
    
    if (!options.skipCache) {
      await cacheManifoldData(filename, result.mesh);
      manifoldContext.cacheImportedModel(filename, result.mesh);
    }
    
    // Step 5: Generate script
    const script = generateImportScript(filename, result.volume);
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[Import] ✓ Mesh import complete in ${duration}s (volume: ${result.volume.toFixed(2)} mm³)`);
    
    return {
      script,
      filename,
      meshData: result.mesh,
      volume: result.volume,
      boundingBox: result.boundingBox
    };
  } catch (error) {
    console.error('[Import] Mesh import failed:', error);
    throw error;
  }
};

// ============================================================================
// UNIFIED IMPORT
// ============================================================================

/**
 * Import any supported 3D file
 * Routes to appropriate handler based on format
 */
export const importFile = async (file, options = {}) => {
  const filename = file.name;
  
  if (isMeshFormat(filename)) {
    return importMeshFile(file, options);
  } else if (isStepFormat(filename)) {
    return importStepFile(file, options.deflection || 0.1, options);
  } else {
    const ext = getExtension(filename);
    throw new Error(`Unsupported format: ${ext}. Supported: STL, OBJ, 3MF, STEP, STP`);
  }
};

export default {
  // Main import function
  importFile,
  
  // Format-specific imports
  importMeshFile,
  importStepFile,
  
  // Format detection
  isMeshFormat,
  isStepFormat,
  
  // Script utilities
  parseImportedModels,
  generateImportScript,
  
  // Cache utilities
  cacheManifoldData,
  getCachedManifoldData,
  loadCachedModel,
  hasImportedModel,
  clearModelCache,
  listCachedModels
};

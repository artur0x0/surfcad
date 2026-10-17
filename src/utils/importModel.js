// utils/modelImport.js
// Consolidated model import - handles STL, OBJ, 3MF (frontend) and STEP (backend)
// Uses OBJ as intermediate format for reliable Manifold construction

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

const FRONTEND_FORMATS = ['.stl', '.obj', '.3mf'];
const BACKEND_FORMATS = ['.step', '.stp'];

const getExtension = (filename) => 
  filename.toLowerCase().slice(filename.lastIndexOf('.'));

export const isFrontendFormat = (filename) => 
  FRONTEND_FORMATS.includes(getExtension(filename));

export const isBackendFormat = (filename) => 
  BACKEND_FORMATS.includes(getExtension(filename));

/** Client-safe STEP import errors. 401 is "sign in"; never show converter stdout. */
export function stepImportErrorMessage(status, payload) {
  if (status === 401) return 'Sign in to import STEP';
  if (status === 429) {
    return payload?.details || payload?.error || 'Too many STEP imports. Try again shortly.';
  }
  return payload?.details || payload?.error || 'STEP conversion failed';
}

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
// STEP IMPORT (Backend)
// ============================================================================

/**
 * Convert STEP file to Manifold via backend
 */
const convertStepToManifold = async (file, deflection = 0.1) => {
  const API_URL = import.meta.env.VITE_API_URL;
  
  const formData = new FormData();
  formData.append('file', file);
  formData.append('deflection', deflection.toString());
  
  const response = await fetch(`${API_URL}/api/convert/step`, {
    method: 'POST',
    credentials: 'include',
    body: formData
  });
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({ details: 'Conversion failed' }));
    throw new Error(stepImportErrorMessage(response.status, error));
  }
  
  return response.json();
};

/**
 * Import STEP file via backend
 */
export const importStepFile = async (file, deflection = 0.1, options = {}) => {
  const startTime = Date.now();
  const filename = file.name;
  
  console.log(`[Import] Starting STEP import: ${filename}`);
  
  try {
    const response = await convertStepToManifold(file, deflection);
    
    if (!response.success) {
      throw new Error(response.details || 'STEP conversion failed');
    }
    
    const meshData = response.data;
    
    if (!options.skipCache) {
      await cacheManifoldData(filename, meshData);
      manifoldContext.cacheImportedModel(filename, meshData);
    }
    
    const script = generateImportScript(filename, meshData.volume);
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[Import] ✓ STEP import complete in ${duration}s`);
    
    return { script, filename, meshData };
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
  
  if (isFrontendFormat(filename)) {
    return importMeshFile(file, options);
  } else if (isBackendFormat(filename)) {
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
  isFrontendFormat,
  isBackendFormat,
  
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

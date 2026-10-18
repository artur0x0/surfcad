// utils/exportModel.js
// 3MF export functionality (only format supported)

import { saveAs } from 'file-saver';
import manifoldContext from './ManifoldWorker';
import { export3MF, blobToBase64 } from './model-io';
import { meshResolveError, resolvePartMeshes } from './meshAssets.js';
import { meshToStl, meshTo3mfBytes, meshToStepBytes } from '../lib/surfcad/export.js';
import { track } from './analytics.js';

/**
 * Generate a 3MF blob from the current script
 * @param {string} currentScript - The Manifold script to execute
 * @returns {Promise<Blob>} The 3MF file as a Blob
 */
export async function generate3MFBlob(currentScript, options = {}) {
  if (!currentScript) {
    throw new Error('No script provided');
  }

  if (!manifoldContext.isReady) {
    try {
      await manifoldContext.init();
    } catch (err) {
      throw new Error(err?.message || 'Manifold worker not initialized');
    }
  }
  if (!manifoldContext.isReady) {
    throw new Error('Manifold worker not initialized');
  }

  const lineError = options.lineError || '';
  let importedModels = options.importedModels;
  if (!importedModels) {
    let prepared;
    try {
      prepared = await resolvePartMeshes(options.partId, currentScript);
    } catch (err) {
      throw new Error(lineError || err?.message || 'Missing mesh asset');
    }
    if (prepared.missing.length) {
      throw new Error(meshResolveError(prepared.missing, lineError));
    }
    importedModels = prepared.importedModels;
  }

  // Execute script via worker to get mesh data
  let result;
  try {
    result = await manifoldContext.executeScript(currentScript, { importedModels });
  } catch (err) {
    const message = err?.message || 'Could not export this part.';
    if (/mesh asset|importMesh/i.test(message)) {
      throw new Error(lineError || message);
    }
    throw err instanceof Error ? err : new Error(message);
  }
  
  if (!result || !result.mesh) {
    throw new Error('Invalid manifold result for export');
  }

  return export3MF(result.mesh, 'model', {
    unit: 'millimeter',
    title: 'Manifold Model',
    designer: 'Manifold Web CAD'
  });
}

/**
 * Generate a 3MF blob from existing mesh data (avoids re-execution)
 * @param {Object} meshData - Mesh data from previous execution
 * @param {Object} options - Export options
 * @returns {Promise<Blob>} The 3MF file as a Blob
 */
export async function generate3MFBlobFromMesh(meshData, options = {}) {
  if (!meshData || !meshData.vertProperties) {
    throw new Error('Invalid mesh data for export');
  }

  return export3MF(meshData, options.name || 'model', {
    unit: options.unit || 'millimeter',
    title: options.title || 'Manifold Model',
    designer: options.designer || 'Manifold Web CAD'
  });
}

/**
 * Export 3MF as base64 string (for API/database storage)
 * @param {string} currentScript - The Manifold script to execute
 * @returns {Promise<string>} Base64 encoded 3MF file
 */
export async function get3MFBase64(currentScript) {
  const blob = await generate3MFBlob(currentScript);
  return blobToBase64(blob);
}

/**
 * Export 3MF as base64 from existing mesh data
 * @param {Object} meshData - Mesh data from previous execution
 * @returns {Promise<string>} Base64 encoded 3MF file
 */
export async function get3MFBase64FromMesh(meshData) {
  const blob = await generate3MFBlobFromMesh(meshData);
  return blobToBase64(blob);
}

/**
 * Download model as 3MF file
 * @param {string} currentScript - The Manifold script to execute
 * @param {string} filename - Filename without extension (default: 'model')
 */
export async function downloadModel(currentScript, filename = 'model') {
  try {
    const blob = await generate3MFBlob(currentScript);
    saveAs(blob, `${filename}.3mf`);
    track('export_done', { format: '3mf' });
    console.log('[Export] 3MF exported successfully');
  } catch (error) {
    console.error('[Export] Error exporting 3MF:', error);
    throw error;
  }
}

/**
 * Download model from existing mesh data (avoids re-execution)
 * @param {Object} meshData - Mesh data from previous execution
 * @param {string} filename - Filename without extension (default: 'model')
 */
export async function downloadModelFromMesh(meshData, filename = 'model') {
  return downloadMeshExport(meshData, '3mf', filename);
}

const EXPORT_FORMATS = new Set(['stl', '3mf', 'step']);

function normalizeExportFormat(format) {
  const kind = String(format || '').toLowerCase();
  if (!EXPORT_FORMATS.has(kind)) {
    throw new Error(`export format must be stl, 3mf, or step (got ${format})`);
  }
  return kind;
}

/**
 * Mesh bytes for STL / 3MF / STEP (faceted STEP from mesh).
 * @returns {{ bytes: Uint8Array, filename: string, byteLength: number, format: string, stepSource?: string }}
 */
export async function meshExportBytes(meshData, format, filename = 'part') {
  const kind = normalizeExportFormat(format);
  const stem = String(filename || 'part').replace(/\.(stl|3mf|step|stp)$/i, '') || 'part';
  if (kind === 'stl') {
    const bytes = meshToStl(meshData);
    return {
      bytes,
      format: kind,
      filename: `${stem}.stl`,
      byteLength: bytes.length,
    };
  }
  if (kind === '3mf') {
    const bytes = await meshTo3mfBytes(meshData, { name: stem });
    return {
      bytes,
      format: kind,
      filename: `${stem}.3mf`,
      byteLength: bytes.length,
    };
  }
  const step = meshToStepBytes(meshData, { name: stem });
  return {
    bytes: step.bytes,
    format: kind,
    filename: `${stem}.step`,
    byteLength: step.bytes.length,
    stepSource: step.stepSource,
  };
}

export async function meshExportBase64(meshData, format, filename = 'part') {
  const pack = await meshExportBytes(meshData, format, filename);
  const data = await blobToBase64(new Blob([pack.bytes]));
  return {
    format: pack.format,
    filename: pack.filename,
    bytesBase64: data,
    byteLength: pack.byteLength,
    ...(pack.stepSource ? { stepSource: pack.stepSource } : {}),
  };
}

/** Browser download for any supported mesh export format. */
export async function downloadMeshExport(meshData, format, filename = 'part') {
  const pack = await meshExportBytes(meshData, format, filename);
  saveAs(new Blob([pack.bytes]), pack.filename);
  track('export_done', { format: pack.format });
  return {
    format: pack.format,
    filename: pack.filename,
    byteLength: pack.byteLength,
    downloaded: true,
    ...(pack.stepSource ? { stepSource: pack.stepSource } : {}),
  };
}

export default {
  generate3MFBlob,
  generate3MFBlobFromMesh,
  get3MFBase64,
  get3MFBase64FromMesh,
  downloadModel,
  downloadModelFromMesh,
  meshExportBytes,
  meshExportBase64,
  downloadMeshExport,
};

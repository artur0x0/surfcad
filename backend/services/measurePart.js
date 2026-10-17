/**
 * Measure the exported 3MF and return its volume and one-part bounding box.
 * Client volume, bounding box, and prices are never read. If the mesh cannot
 * be measured, the order is rejected — a client-supplied volume must not
 * become the price. A mesh over the vertex cap is its own error.
 */
import {
  MeshMeasureError,
  geometryFromMesh,
  meshFrom3mfXml,
} from '../../src/utils/meshMeasure.js';
import { ZIP_LIMITS, ZipLimitError, inflateZipEntry, readZipDirectory } from './safeZip.js';

export const UNMEASURABLE_PART_ERROR =
  "We couldn't measure this part. Please re-export and try again";
export const MODEL_TOO_LARGE_ERROR = 'This model file is too large to process.';

export async function measureExportedPart(modelData) {
  const raw = modelData?.modelFile?.data ?? modelData?.modelFile?.['data'];
  if (!raw) {
    return rejectMeasure('No exported model file was attached.');
  }

  try {
    const xml = await modelXmlFromPayload(raw);
    const geometry = geometryFromMesh(meshFrom3mfXml(xml));
    if (!(geometry.volume > 0)) {
      return rejectMeasure('Exported mesh volume was not positive.');
    }
    return { ok: true, source: 'mesh', geometry };
  } catch (err) {
    const reason = err?.message || 'Could not read the exported mesh.';
    if (err instanceof ZipLimitError && err.status === 413) {
      console.error('[Orders] Rejected oversized 3MF:', reason);
      return { ok: false, status: 413, error: MODEL_TOO_LARGE_ERROR, detail: reason };
    }
    if (err instanceof MeshMeasureError && err.fatal) {
      console.error('[Orders] Could not measure exported 3MF:', reason);
      return { ok: false, error: reason };
    }
    return rejectMeasure(reason);
  }
}

function rejectMeasure(reason) {
  console.error('[Orders] Could not measure exported 3MF:', reason);
  return { ok: false, error: UNMEASURABLE_PART_ERROR, detail: reason };
}

export async function modelXmlFromPayload(raw, limits = ZIP_LIMITS) {
  const cleaned = String(raw).replace(/^data:[^,]*,/, '').replace(/\s/g, '');
  const buffer = Buffer.from(cleaned, 'base64');
  if (buffer.length === 0) {
    throw new MeshMeasureError('Empty model file');
  }
  let entries;
  try {
    entries = readZipDirectory(buffer, limits);
  } catch (err) {
    if (err instanceof ZipLimitError && err.status === 413) throw err;
    throw new MeshMeasureError('Model file is not a 3MF zip');
  }
  const model = entries.find((entry) => !entry.name.endsWith('/') && entry.name.toLowerCase().endsWith('.model'));
  if (!model) throw new MeshMeasureError('No model file found in 3MF');
  const bytes = await inflateZipEntry(buffer, model, limits);
  return bytes.toString('utf8');
}

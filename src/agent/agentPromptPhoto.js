/**
 * A photo from the device (camera or library) attached to the agent prompt.
 *
 * The picked file is decoded on the page, scaled to at most
 * AGENT_PROMPT_PHOTO_MAX_EDGE on its long side, and encoded as PNG through
 * the same 2 MB cap as a viewer screenshot (capAgentPromptScreenshot). The
 * payload is then exactly a screenshot payload ({ mime: 'image/png', data,
 * width, height }), so the transport, the relay and every published
 * surfcad-mcp (which accepts image/png only) carry it unchanged.
 *
 * `decode` and `createCanvas` are injectable for unit tests; the page uses
 * createImageBitmap (EXIF orientation applied) with an <img> fallback.
 */
import { AGENT_PROMPT_SHOT_MAX_BYTES, capAgentPromptScreenshot } from './agentPromptCapture.js';

/** Long side of the attached photo, in pixels. Enough to read a sketch or a part; small enough to fit the PNG cap. */
export const AGENT_PROMPT_PHOTO_MAX_EDGE = 1600;
/** A file over this is refused before decoding (a RAW or a huge scan). */
export const AGENT_PROMPT_PHOTO_MAX_FILE_BYTES = 40 * 1024 * 1024;

/** The file input: any image the browser can decode. No `capture`, so iOS offers the camera and the library. */
export const AGENT_PROMPT_PHOTO_ACCEPT = 'image/*';

/**
 * Is this a file the photo path takes? Image mime, or a known image
 * extension when the browser reports no type (some Android pickers).
 * @param {{ type?: string, name?: string, size?: number } | null | undefined} file
 */
export function photoFileAccepted(file) {
  if (!file || typeof file !== 'object') return { ok: false, reason: 'photo_unsupported' };
  const type = typeof file.type === 'string' ? file.type.toLowerCase() : '';
  const name = typeof file.name === 'string' ? file.name.toLowerCase() : '';
  const byType = type.startsWith('image/');
  const byName = /\.(png|jpe?g|gif|webp|heic|heif|bmp|avif)$/.test(name);
  if (!byType && !byName) return { ok: false, reason: 'photo_unsupported' };
  const size = Number(file.size);
  if (Number.isFinite(size) && size > AGENT_PROMPT_PHOTO_MAX_FILE_BYTES) return { ok: false, reason: 'photo_too_large' };
  return { ok: true, reason: null };
}

/**
 * Pixel size after the long-side cap. Never upscales.
 * @param {number} width
 * @param {number} height
 * @param {number} [maxEdge]
 */
export function photoTargetSize(width, height, maxEdge = AGENT_PROMPT_PHOTO_MAX_EDGE) {
  const w = Math.max(1, Math.round(Number(width) || 1));
  const h = Math.max(1, Math.round(Number(height) || 1));
  const edge = Math.max(w, h);
  if (!(maxEdge > 0) || edge <= maxEdge) return { width: w, height: h };
  const ratio = maxEdge / edge;
  return { width: Math.max(1, Math.round(w * ratio)), height: Math.max(1, Math.round(h * ratio)) };
}

function defaultCreateCanvas(width, height) {
  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  throw new Error('canvas unavailable');
}

/**
 * Decode a File to something drawImage accepts, with EXIF orientation
 * applied where the browser can. Resolves { source, width, height, close }.
 * @param {Blob} file
 */
export async function defaultDecodePhoto(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        close: () => { try { bitmap.close?.(); } catch { /* already closed */ } },
      };
    } catch {
      // HEIC on a browser without the codec, or an old createImageBitmap. Try <img>.
    }
  }
  if (typeof Image !== 'function' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
    throw new Error('photo decode unavailable');
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('photo decode failed'));
      el.src = url;
    });
    return {
      source: img,
      width: img.naturalWidth || img.width,
      height: img.naturalHeight || img.height,
      close: () => { try { URL.revokeObjectURL(url); } catch { /* gone */ } },
    };
  } catch (err) {
    try { URL.revokeObjectURL(url); } catch { /* gone */ }
    throw err;
  }
}

/**
 * Turn a picked image file into a prompt screenshot payload.
 * Resolves { ok, reason, attached, shot } in the shape of attachViewerShot.
 *
 * @param {Blob & { name?: string }} file
 * @param {{ decode?: Function, createCanvas?: Function, encode?: Function, maxEdge?: number, maxBytes?: number }} [opts]
 */
export async function photoFileToShot(file, opts = {}) {
  const accepted = photoFileAccepted(file);
  if (!accepted.ok) return { ok: false, reason: accepted.reason, attached: false, shot: null };
  const decode = typeof opts.decode === 'function' ? opts.decode : defaultDecodePhoto;
  const createCanvas = typeof opts.createCanvas === 'function' ? opts.createCanvas : defaultCreateCanvas;
  const maxEdge = Number.isFinite(opts.maxEdge) ? opts.maxEdge : AGENT_PROMPT_PHOTO_MAX_EDGE;
  const maxBytes = Number.isFinite(opts.maxBytes) ? opts.maxBytes : AGENT_PROMPT_SHOT_MAX_BYTES;

  let decoded;
  try {
    decoded = await decode(file);
  } catch {
    return { ok: false, reason: 'photo_failed', attached: false, shot: null };
  }
  try {
    if (!decoded || !(decoded.width > 0) || !(decoded.height > 0)) {
      return { ok: false, reason: 'photo_failed', attached: false, shot: null };
    }
    const { width, height } = photoTargetSize(decoded.width, decoded.height, maxEdge);
    const canvas = createCanvas(width, height);
    const ctx = canvas?.getContext?.('2d');
    if (!ctx || typeof ctx.drawImage !== 'function') {
      return { ok: false, reason: 'photo_failed', attached: false, shot: null };
    }
    ctx.drawImage(decoded.source, 0, 0, width, height);
    const shot = capAgentPromptScreenshot({ canvas, width, height }, {
      maxBytes,
      ...(typeof opts.encode === 'function' ? { encode: opts.encode } : {}),
      createCanvas,
    });
    if (!shot || !shot.data) return { ok: false, reason: 'photo_failed', attached: false, shot: null };
    return { ok: true, reason: null, attached: true, shot };
  } catch {
    return { ok: false, reason: 'photo_failed', attached: false, shot: null };
  } finally {
    try { decoded?.close?.(); } catch { /* nothing to release */ }
  }
}

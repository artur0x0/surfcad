/**
 * Viewer-only PNG capture for the floating agent prompt.
 * Transport payload: { mime: 'image/png', data (raw base64), width, height }.
 * Cap is 2 MB of decoded bytes. Larger frames are downscaled on the page.
 */
import { encodeCanvasImage } from './screenshotImage.js';

export const AGENT_PROMPT_SHOT_MAX_BYTES = 2 * 1024 * 1024;
export const AGENT_PROMPT_SHOT_MIME = 'image/png';

export function stripDataUrlPrefix(dataUrl) {
  if (typeof dataUrl !== 'string') return '';
  const comma = dataUrl.indexOf(',');
  if (dataUrl.startsWith('data:') && comma !== -1) return dataUrl.slice(comma + 1);
  return dataUrl;
}

export function base64DecodedBytes(b64) {
  if (typeof b64 !== 'string' || !b64) return 0;
  const len = b64.length;
  let pad = 0;
  if (b64.endsWith('==')) pad = 2;
  else if (b64.endsWith('=')) pad = 1;
  return Math.max(0, Math.floor((len * 3) / 4) - pad);
}

export function screenshotFromDataUrl(dataUrl, width, height) {
  const data = stripDataUrlPrefix(dataUrl);
  return {
    mime: AGENT_PROMPT_SHOT_MIME,
    data,
    width: Number.isInteger(width) ? width : 0,
    height: Number.isInteger(height) ? height : 0,
  };
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
 * Downscale a PNG data-URL shot until decoded bytes fit `maxBytes`.
 * `encode` / `createCanvas` are injectable for unit tests.
 *
 * @param {{ dataUrl?: string, width?: number, height?: number, canvas?: object }} shot
 * @param {{ maxBytes?: number, encode?: Function, createCanvas?: Function }} [opts]
 */
export function capAgentPromptScreenshot(shot, opts = {}) {
  const maxBytes = Number.isFinite(opts.maxBytes) ? opts.maxBytes : AGENT_PROMPT_SHOT_MAX_BYTES;
  const encode = typeof opts.encode === 'function' ? opts.encode : encodeCanvasImage;
  const createCanvas = typeof opts.createCanvas === 'function' ? opts.createCanvas : defaultCreateCanvas;

  let width = Math.max(1, Math.round(Number(shot?.width) || 1));
  let height = Math.max(1, Math.round(Number(shot?.height) || 1));
  let dataUrl = typeof shot?.dataUrl === 'string' ? shot.dataUrl : '';
  let canvas = shot?.canvas || null;

  if (!dataUrl && canvas) {
    const encoded = encode(canvas, { format: 'png' }, { createCanvas });
    dataUrl = encoded.dataUrl;
    width = encoded.width;
    height = encoded.height;
  }

  let payload = screenshotFromDataUrl(dataUrl, width, height);
  let bytes = base64DecodedBytes(payload.data);
  let guard = 0;

  // A raw data-URL string may omit width/height. Invent a large source so
  // the downscale loop can still shrink an oversized payload.
  if (bytes > maxBytes && (width <= 16 || height <= 16)) {
    width = 1920;
    height = 1080;
  }

  while (bytes > maxBytes && width > 16 && height > 16 && guard < 12) {
    const ratio = Math.sqrt(maxBytes / bytes) * 0.92;
    const nextW = Math.max(16, Math.floor(width * Math.min(0.85, Math.max(0.35, ratio))));
    const nextH = Math.max(16, Math.round(height * (nextW / width)));
    const source = canvas || makeSourceFromDataUrl(dataUrl, width, height, createCanvas);
    const scaled = createCanvas(nextW, nextH);
    const ctx = scaled.getContext('2d');
    if (ctx && typeof ctx.drawImage === 'function' && source) {
      ctx.drawImage(source, 0, 0, nextW, nextH);
    }
    const encoded = encode(scaled, { format: 'png' }, { createCanvas });
    dataUrl = encoded.dataUrl;
    width = encoded.width || nextW;
    height = encoded.height || nextH;
    canvas = scaled;
    payload = screenshotFromDataUrl(dataUrl, width, height);
    bytes = base64DecodedBytes(payload.data);
    guard += 1;
  }

  return payload;
}

function makeSourceFromDataUrl(dataUrl, width, height, createCanvas) {
  const canvas = createCanvas(width, height);
  if (canvas && typeof canvas._hydrate === 'function') {
    canvas._hydrate(dataUrl);
  }
  return canvas;
}

/**
 * Pressing the camera on with no viewer capture must not invent an empty
 * placeholder. The toggle stays off until a real PNG exists.
 */
export function attachViewerShot(captureViewer, opts = {}) {
  if (typeof captureViewer !== 'function') {
    return { ok: false, reason: 'capture_unavailable', attached: false, shot: null };
  }
  let raw;
  try {
    raw = captureViewer();
  } catch {
    return { ok: false, reason: 'capture_failed', attached: false, shot: null };
  }
  if (raw && typeof raw.then === 'function') {
    return Promise.resolve(raw).then((value) => payloadFromViewerShot(value, opts), () => ({
      ok: false,
      reason: 'capture_failed',
      attached: false,
      shot: null,
    }));
  }
  return payloadFromViewerShot(raw, opts);
}

function payloadFromViewerShot(raw, opts) {
  const shot = viewerShotToPayload(raw, opts);
  if (!shot || !shot.data) {
    return { ok: false, reason: 'capture_failed', attached: false, shot: null };
  }
  return { ok: true, attached: true, shot };
}

/**
 * Turn a Viewport `capturePng` result into a transport screenshot.
 * Accepts a data URL string or `{ dataUrl, width, height }`.
 */
export function viewerShotToPayload(shot, opts = {}) {
  if (!shot) return null;
  if (typeof shot === 'string') {
    return capAgentPromptScreenshot({ dataUrl: shot }, opts);
  }
  if (typeof shot.dataUrl === 'string') {
    return capAgentPromptScreenshot(shot, opts);
  }
  return null;
}

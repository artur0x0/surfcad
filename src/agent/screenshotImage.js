/** jpeg quality passed to canvas.toDataURL when the caller omits `quality`. */
export const JPEG_QUALITY = 0.8;

/**
 * Output pixel size. `scale` (when below 1) is applied first, then `max_width`
 * caps the width. Never upscales.
 * @param {number} srcW
 * @param {number} srcH
 * @param {{ scale?: number, max_width?: number }} [options]
 */
export function targetImageSize(srcW, srcH, options = {}) {
  const w0 = Math.max(1, Math.round(Number(srcW) || 1));
  const h0 = Math.max(1, Math.round(Number(srcH) || 1));
  let width = w0;
  let height = h0;
  const scale = options.scale;
  if (typeof scale === 'number' && scale > 0 && scale < 1) {
    width = Math.max(1, Math.round(w0 * scale));
    height = Math.max(1, Math.round(h0 * scale));
  }
  const maxWidth = options.max_width;
  if (typeof maxWidth === 'number' && maxWidth > 0 && width > maxWidth) {
    const ratio = maxWidth / width;
    width = Math.max(1, Math.round(maxWidth));
    height = Math.max(1, Math.round(height * ratio));
  }
  return { width, height };
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
 * Encode a viewport canvas. Downscale happens here, in the browser, before
 * the data URL is built. With no scale/max_width and png, this is
 * `canvas.toDataURL('image/png')` on the source canvas.
 *
 * @param {{ width: number, height: number, getContext?: Function, toDataURL: Function }} canvas
 * @param {{ format?: string, quality?: number, max_width?: number, scale?: number }} [options]
 * @param {{ createCanvas?: (w: number, h: number) => { getContext: Function, toDataURL: Function } }} [deps]
 */
export function encodeCanvasImage(canvas, options = {}, deps = {}) {
  const format = options.format === 'jpeg' ? 'jpeg' : 'png';
  const mime = format === 'jpeg' ? 'image/jpeg' : 'image/png';
  const { width, height } = targetImageSize(canvas?.width, canvas?.height, options);
  const sameSize = width === canvas.width && height === canvas.height;
  let source = canvas;
  if (!sameSize) {
    const createCanvas = deps.createCanvas || defaultCreateCanvas;
    const out = createCanvas(width, height);
    const ctx = out.getContext('2d');
    if (!ctx || typeof ctx.drawImage !== 'function') throw new Error('canvas 2d unavailable');
    ctx.drawImage(canvas, 0, 0, width, height);
    source = out;
  }
  const dataUrl = format === 'jpeg'
    ? source.toDataURL(mime, options.quality == null ? JPEG_QUALITY : options.quality)
    : source.toDataURL(mime);
  return { dataUrl, width, height, format };
}

import React from 'react';
import { WebGLRenderer } from 'three';
import { captureSentryException } from './sentryClient.js';

/** One warning per page load. A missing GPU and a lost context are separate. */
let reportedWebglUnavailable = false;
let reportedWebglContextLost = false;

const WEBGL_UNAVAILABLE_REPORT = {
  level: 'warning',
  tags: { webgl: 'unavailable', gpu: 'none' },
  fingerprint: ['webgl-unavailable'],
};

const WEBGL_CONTEXT_LOST_REPORT = {
  level: 'warning',
  tags: { webgl: 'context-lost' },
  fingerprint: ['webgl-context-lost'],
};

/** Tests reset the page-load dedupe. Production never calls this. */
export function resetViewportWebglReports() {
  reportedWebglUnavailable = false;
  reportedWebglContextLost = false;
}

function reportWebglOnce(kind, error, hint, report) {
  if (kind === 'unavailable') {
    if (reportedWebglUnavailable) return;
    reportedWebglUnavailable = true;
  } else {
    if (reportedWebglContextLost) return;
    reportedWebglContextLost = true;
  }
  const reporter = typeof report === 'function' ? report : captureSentryException;
  void reporter(error, hint);
}

/**
 * Build the viewport renderer. three.js throws "Error creating WebGL context."
 * when getContext returns null (no GPU, hardware acceleration off, blocklisted
 * driver). This never throws — the caller shows a fallback and skips the loop.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {typeof WebGLRenderer} [Renderer]
 * @param {(error: unknown, hint: object) => void} [report] injectable; defaults to Sentry
 * @returns {WebGLRenderer | null}
 */
export function createViewportWebGLRenderer(canvas, Renderer = WebGLRenderer, report) {
  if (!canvas || typeof Renderer !== 'function') return null;
  try {
    const renderer = new Renderer({ canvas, antialias: true });
    return renderer || null;
  } catch (error) {
    const message = error && error.message ? error.message : error;
    console.warn('[Viewport] WebGL is unavailable:', message);
    reportWebglOnce('unavailable', error, WEBGL_UNAVAILABLE_REPORT, report);
    return null;
  }
}

/**
 * Listen for a context that dies after it was created. preventDefault on
 * webglcontextlost lets the browser fire webglcontextrestored.
 * Returns a function that removes both listeners.
 *
 * @param {EventTarget} canvas
 * @param {{ onLost?: Function, onRestored?: Function, report?: Function }} [handlers]
 */
export function installWebglContextLossHandlers(canvas, { onLost, onRestored, report } = {}) {
  if (!canvas || typeof canvas.addEventListener !== 'function') return () => {};
  const handleLost = (event) => {
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
    reportWebglOnce(
      'lost',
      new Error('WebGL context lost'),
      WEBGL_CONTEXT_LOST_REPORT,
      report,
    );
    if (typeof onLost === 'function') onLost(event);
  };
  const handleRestored = (event) => {
    if (typeof onRestored === 'function') onRestored(event);
  };
  canvas.addEventListener('webglcontextlost', handleLost);
  canvas.addEventListener('webglcontextrestored', handleRestored);
  return () => {
    canvas.removeEventListener('webglcontextlost', handleLost);
    canvas.removeEventListener('webglcontextrestored', handleRestored);
  };
}

/** Dispose a renderer. Missing renderer and a throwing dispose are both safe. */
export function disposeViewportRenderer(renderer) {
  if (!renderer || typeof renderer.dispose !== 'function') return;
  try {
    renderer.dispose();
  } catch (error) {
    const message = error && error.message ? error.message : error;
    console.warn('[Viewport] WebGL cleanup failed:', message);
  }
}

export function WebGLUnavailableNotice() {
  return React.createElement(
    'div',
    {
      className: 'pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-6',
      'data-webgl-unavailable': 'true',
      role: 'status',
    },
    React.createElement(
      'div',
      {
        className: 'max-w-sm rounded-lg surface-glass surface-glass-chip px-4 py-3 text-center font-ui shadow-lg',
      },
      React.createElement(
        'p',
        { className: 'text-ui font-medium text-on-dark' },
        'WebGL is unavailable',
      ),
      React.createElement(
        'p',
        { className: 'mt-1 text-ui-sm text-muted-on-dark' },
        'This browser could not create a 3D view. Enable hardware acceleration, or try another browser such as Chrome.',
      ),
    ),
  );
}

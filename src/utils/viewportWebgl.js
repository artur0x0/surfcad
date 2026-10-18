import React from 'react';
import { WebGLRenderer } from 'three';

/**
 * Build the viewport renderer. three.js throws "Error creating WebGL context."
 * when getContext returns null (no GPU, hardware acceleration off, blocklisted
 * driver). This never throws — the caller shows a fallback and skips the loop.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {typeof WebGLRenderer} [Renderer]
 * @returns {WebGLRenderer | null}
 */
export function createViewportWebGLRenderer(canvas, Renderer = WebGLRenderer) {
  if (!canvas || typeof Renderer !== 'function') return null;
  try {
    const renderer = new Renderer({ canvas, antialias: true });
    return renderer || null;
  } catch (error) {
    const message = error && error.message ? error.message : error;
    console.warn('[Viewport] WebGL is unavailable:', message);
    return null;
  }
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
      className: 'absolute inset-0 z-10 flex items-center justify-center p-6',
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

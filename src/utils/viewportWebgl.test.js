import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { WebGLRenderer } from 'three';
import {
  createViewportWebGLRenderer,
  disposeViewportRenderer,
  WebGLUnavailableNotice,
} from './viewportWebgl.js';

function nullContextCanvas() {
  return {
    width: 300,
    height: 150,
    style: {},
    setAttribute() {},
    addEventListener() {},
    removeEventListener() {},
    getContext() {
      return null;
    },
  };
}

class ThrowingRenderer {
  constructor() {
    throw new Error('Error creating WebGL context.');
  }
}

test('createViewportWebGLRenderer returns null when the constructor throws', () => {
  const canvas = nullContextCanvas();
  assert.equal(createViewportWebGLRenderer(canvas, ThrowingRenderer), null);
  assert.equal(createViewportWebGLRenderer(null, ThrowingRenderer), null);
});

test('createViewportWebGLRenderer survives three.js when getContext returns null', () => {
  const canvas = nullContextCanvas();
  let thrown = null;
  try {
    new WebGLRenderer({ canvas, antialias: true });
  } catch (error) {
    thrown = error;
  }
  assert.equal(thrown && thrown.message, 'Error creating WebGL context.');
  assert.equal(createViewportWebGLRenderer(canvas, WebGLRenderer), null);
});

test('disposeViewportRenderer ignores a missing renderer and a throwing dispose', () => {
  assert.doesNotThrow(() => disposeViewportRenderer(null));
  assert.doesNotThrow(() => disposeViewportRenderer(undefined));
  assert.doesNotThrow(() => disposeViewportRenderer({}));
  assert.doesNotThrow(() => disposeViewportRenderer({
    dispose() {
      throw new Error('dispose failed');
    },
  }));
});

test('WebGLUnavailableNotice renders the fallback copy', () => {
  const html = renderToStaticMarkup(React.createElement(WebGLUnavailableNotice));
  assert.match(html, /data-webgl-unavailable="true"/);
  assert.match(html, /role="status"/);
  assert.match(html, /WebGL is unavailable/);
  assert.match(html, /Enable hardware acceleration/);
  assert.match(html, /another browser such as Chrome/);
  assert.equal(html.includes('Edge'), false);
});

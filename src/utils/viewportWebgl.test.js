import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { useEffect, useRef, useState } from 'react';
import { WebGLRenderer } from 'three';
import {
  createViewportWebGLRenderer,
  disposeViewportRenderer,
  WebGLUnavailableNotice,
} from './viewportWebgl.js';

const VIEWPORT_SRC = readFileSync(new URL('../components/Viewport.jsx', import.meta.url), 'utf8');

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

test('Viewport init bails before the draw loop when the renderer is missing', () => {
  const initStart = VIEWPORT_SRC.indexOf('const initScene = () =>');
  const controlsAt = VIEWPORT_SRC.indexOf('new TrackballControls', initStart);
  const init = VIEWPORT_SRC.slice(initStart, controlsAt);
  const createAt = init.indexOf('createViewportWebGLRenderer(canvasRef.current)');
  const guardAt = init.indexOf('if (!renderer)');
  assert.ok(createAt !== -1);
  assert.ok(guardAt > createAt);
  assert.equal(init.includes('new WebGLRenderer'), false);
  assert.match(init, /setWebglUnavailable\(true\)/);
  assert.match(init, /return;/);
  assert.match(VIEWPORT_SRC, /<WebGLUnavailableNotice \/>/);
  assert.match(VIEWPORT_SRC, /disposeViewportRenderer\(rendererRef\.current\)/);
  const animateAt = VIEWPORT_SRC.indexOf('const animate = () =>', initStart);
  const animate = VIEWPORT_SRC.slice(animateAt, animateAt + 280);
  assert.match(animate, /if \(!rendererRef\.current\) return;/);
});

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;
const DOCUMENT_NODE = 9;

class TextNode {
  constructor(value, ownerDocument) {
    this.nodeType = TEXT_NODE;
    this.nodeName = '#text';
    this.nodeValue = String(value);
    this.parentNode = null;
    this.ownerDocument = ownerDocument;
    this.childNodes = [];
  }

  get textContent() {
    return this.nodeValue;
  }

  set textContent(value) {
    this.nodeValue = String(value);
  }
}

class ElementNode {
  constructor(tag, ownerDocument) {
    this.nodeType = ELEMENT_NODE;
    this.nodeName = String(tag).toUpperCase();
    this.tagName = this.nodeName;
    this.childNodes = [];
    this.parentNode = null;
    this.ownerDocument = ownerDocument;
    this.namespaceURI = 'http://www.w3.org/1999/xhtml';
    this.style = {};
    this.attributes = Object.create(null);
    this.className = '';
    this.onclick = null;
    this.width = 300;
    this.height = 150;
    this.clientWidth = 640;
    this.clientHeight = 480;
  }

  get firstChild() {
    return this.childNodes[0] || null;
  }

  get lastChild() {
    return this.childNodes[this.childNodes.length - 1] || null;
  }

  get nextSibling() {
    if (!this.parentNode) return null;
    const index = this.parentNode.childNodes.indexOf(this);
    return this.parentNode.childNodes[index + 1] || null;
  }

  get textContent() {
    return this.childNodes.map((child) => child.textContent ?? child.nodeValue ?? '').join('');
  }

  set textContent(value) {
    this.childNodes = [];
    const text = value == null ? '' : String(value);
    if (text) this.appendChild(this.ownerDocument.createTextNode(text));
  }

  appendChild(child) {
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }

  removeChild(child) {
    const index = this.childNodes.indexOf(child);
    if (index >= 0) this.childNodes.splice(index, 1);
    child.parentNode = null;
    return child;
  }

  insertBefore(child, before) {
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = this;
    const index = before ? this.childNodes.indexOf(before) : -1;
    if (index < 0) this.childNodes.push(child);
    else this.childNodes.splice(index, 0, child);
    return child;
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null;
  }

  removeAttribute(name) {
    delete this.attributes[name];
  }

  hasAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attributes, name);
  }

    addEventListener() {}

    removeEventListener() {}

    contains(node) {
      let current = node;
      while (current) {
        if (current === this) return true;
        current = current.parentNode;
      }
      return false;
    }

    getContext() {
    return null;
  }

  getBoundingClientRect() {
    return {
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: this.clientWidth,
      bottom: this.clientHeight,
      width: this.clientWidth,
      height: this.clientHeight,
    };
  }
}

class DocumentNode {
  constructor() {
    this.nodeType = DOCUMENT_NODE;
    this.nodeName = '#document';
    this.ownerDocument = this;
    this.defaultView = null;
    this.documentElement = null;
    this.body = null;
    this.childNodes = [];
  }

  createElement(tag) {
    return new ElementNode(tag, this);
  }

  createElementNS(_, tag) {
    return this.createElement(tag);
  }

  createTextNode(text) {
    return new TextNode(text, this);
  }

  addEventListener() {}

  removeEventListener() {}
}

function installDom() {
  const document = new DocumentNode();
  const listeners = new Map();
  const window = {
    document,
    devicePixelRatio: 1,
    navigator: { userAgent: 'viewport-webgl-test' },
    HTMLElement: ElementNode,
    HTMLIFrameElement: function HTMLIFrameElement() {},
    Element: ElementNode,
    Node: ElementNode,
    addEventListener(type, fn) {
      const list = listeners.get(type) || [];
      list.push(fn);
      listeners.set(type, list);
    },
    removeEventListener(type, fn) {
      const list = listeners.get(type) || [];
      listeners.set(type, list.filter((item) => item !== fn));
    },
    dispatchEvent(event) {
      for (const fn of listeners.get(event.type) || []) fn(event);
    },
    requestAnimationFrame(callback) {
      return setTimeout(() => callback(Date.now()), 0);
    },
    cancelAnimationFrame(id) {
      clearTimeout(id);
    },
    getComputedStyle() {
      return { getPropertyValue() { return ''; } };
    },
  };
  document.defaultView = window;
  document.documentElement = document.createElement('html');
  document.body = document.createElement('body');
  document.documentElement.appendChild(document.body);
  document.activeElement = document.body;
  globalThis.window = window;
  globalThis.document = document;
  globalThis.HTMLElement = ElementNode;
  globalThis.Element = ElementNode;
  globalThis.Node = ElementNode;
  globalThis.requestAnimationFrame = window.requestAnimationFrame;
  globalThis.cancelAnimationFrame = window.cancelAnimationFrame;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  return { document, window };
}

/**
 * Same guard the viewport effect uses: create the renderer, and if the
 * browser cannot, leave the canvas up with the inline notice. Resize and
 * unmount must not touch a renderer that was never created.
 */
function ViewportProbe() {
  const canvasRef = useRef(null);
  const rendererRef = useRef(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let alive = true;
    let raf = 0;
    const renderer = createViewportWebGLRenderer(canvasRef.current);
    if (!renderer) {
      setUnavailable(true);
    } else {
      rendererRef.current = renderer;
      const loop = () => {
        if (!alive || !rendererRef.current) return;
        raf = requestAnimationFrame(loop);
        rendererRef.current.render();
      };
      loop();
    }
    const onResize = () => {
      const current = rendererRef.current;
      if (!current) return;
      current.setSize(640, 480);
    };
    window.addEventListener('resize', onResize);
    onResize();
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      disposeViewportRenderer(rendererRef.current);
      rendererRef.current = null;
    };
  }, []);

  return React.createElement(
    'div',
    {
      className: 'viewport-shell relative w-full h-full',
      'data-agent-viewport': '',
    },
    React.createElement('canvas', { ref: canvasRef }),
    unavailable ? React.createElement(WebGLUnavailableNotice) : null,
  );
}

function textOf(node) {
  if (!node) return '';
  if (node.nodeType === TEXT_NODE) return node.nodeValue || '';
  return (node.childNodes || []).map(textOf).join('');
}

test('viewport shows the WebGL fallback and unmounts when no context can be created', async () => {
  const { document, window } = installDom();
  const errors = [];
  const { createRoot } = await import('react-dom/client');
  const { act } = await import('react');
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host, {
    onRecoverableError(error) {
      errors.push(error);
    },
  });
  await act(async () => {
    root.render(React.createElement(ViewportProbe));
  });
  const text = textOf(host);
  assert.match(text, /WebGL is unavailable/);
  assert.match(text, /Enable hardware acceleration/);
  assert.match(text, /Chrome/);
  assert.equal(text.includes('Something went wrong'), false);
  assert.equal(text.includes('Edge'), false);
  assert.equal(errors.length, 0, errors.map((error) => error && error.message).join('\n'));
  assert.doesNotThrow(() => window.dispatchEvent({ type: 'resize' }));
  await act(async () => {
    root.unmount();
  });
  assert.equal(errors.length, 0);
});

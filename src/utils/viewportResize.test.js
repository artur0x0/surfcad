import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OrthographicCamera, PerspectiveCamera } from 'three';
import { readViewportContainerSize, resizeViewportRenderer, updateCameraProjection } from './viewportResize.js';

test('readViewportContainerSize floors client dimensions', () => {
  const el = { clientWidth: 400.9, clientHeight: 200.1 };
  assert.deepEqual(readViewportContainerSize(el), { width: 400, height: 200 });
  assert.deepEqual(readViewportContainerSize(null), { width: 0, height: 0 });
});

test('updateCameraProjection updates perspective aspect', () => {
  const camera = new PerspectiveCamera(45, 1, 0.1, 100);
  updateCameraProjection(camera, 800, 400);
  assert.equal(camera.aspect, 2);
});

test('updateCameraProjection preserves ortho height and scales width', () => {
  const camera = new OrthographicCamera(-50, 50, 100, -100, 0.1, 500);
  updateCameraProjection(camera, 400, 200);
  assert.equal(camera.top, 100);
  assert.equal(camera.bottom, -100);
  assert.equal(camera.left, -200);
  assert.equal(camera.right, 200);
});

test('resizeViewportRenderer calls setSize with updateStyle false by default', () => {
  const calls = [];
  const renderer = {
    setPixelRatio(dpr) { calls.push(['dpr', dpr]); },
    setSize(w, h, updateStyle) { calls.push(['size', w, h, updateStyle]); },
  };
  const camera = new PerspectiveCamera(45, 1, 0.1, 100);
  const ok = resizeViewportRenderer({
    renderer,
    camera,
    width: 320,
    height: 240,
    pixelRatio: 1.5,
  });
  assert.equal(ok, true);
  assert.deepEqual(calls[0], ['dpr', 1.5]);
  assert.deepEqual(calls[1], ['size', 320, 240, false]);
  assert.equal(camera.aspect, 320 / 240);
});

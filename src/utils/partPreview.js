/**
 * Mini snapshot of one part solid for the parts feed.
 *
 * Same look as the CAD viewer: off-white for ordinary parts,
 * the sheet-metal gray for a sheet mesh, and the #1e1e1e background.
 * One shared renderer draws a part once.
 * The bitmap is cached by the mesh, so an idle row and a scroll do not
 * draw again. A new solid (new vertex data) is a new key and draws again.
 */
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Mesh,
  PerspectiveCamera,
  PointLight,
  Scene,
  WebGLRenderer,
} from 'three';
import { dropPlanarFins } from './planarSeam.js';
import { makeDefaultPartMaterial } from './partMaterial.js';
import { ensureBodyMaterial } from './sheetMetal/sheetMaterial.js';
import { VIEW_PRESETS, fitView } from './viewCamera.js';

export const PART_PREVIEW_SIZE = 128;

const cache = new Map();
const keyByMesh = new WeakMap();
const MAX_CACHE = 48;

let renderer = null;
let scene = null;
let camera = null;
let body = null;
let normalMaterial = null;
let rendererFailed = false;

function hashMesh(mesh) {
  const src = mesh?.vertProperties;
  const tris = mesh?.triVerts;
  const np = mesh?.numProp || 3;
  if (!src || !tris || src.length < np * 3 || tris.length < 3) return null;
  let h = 2166136261;
  const n = src.length;
  for (let i = 0; i < n; i++) {
    h ^= Math.round(Number(src[i]) * 10000);
    h = Math.imul(h, 16777619);
  }
  const tn = tris.length;
  h ^= tn;
  h = Math.imul(h, 16777619);
  const step = Math.max(1, Math.floor(tn / 24));
  for (let i = 0; i < tn; i += step) {
    h ^= (Number(tris[i]) + i) | 0;
    h = Math.imul(h, 16777619);
  }
  if (!Number.isFinite(h)) return null;
  const key = (h >>> 0).toString(16);
  return mesh.sheetMetal ? `sheet:${key}` : key;
}

/** Stable id for this solid. Null when there is nothing to draw. */
export function meshPreviewKey(mesh) {
  if (!mesh || typeof mesh !== 'object') return null;
  if (keyByMesh.has(mesh)) return keyByMesh.get(mesh);
  const key = hashMesh(mesh);
  keyByMesh.set(mesh, key);
  return key;
}

/** `manifold` when the row has a solid, otherwise `empty`. */
export function partPreviewKind(mesh) {
  return meshPreviewKey(mesh) ? 'manifold' : 'empty';
}

function remember(key, canvas) {
  cache.delete(key);
  cache.set(key, canvas);
  while (cache.size > MAX_CACHE) {
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }
}

/** Cached bitmap for this key, or null. Does not draw. */
export function peekPartPreview(key) {
  if (!key || !cache.has(key)) return null;
  const hit = cache.get(key);
  cache.delete(key);
  cache.set(key, hit);
  return hit;
}

function geometryFromMesh(meshData) {
  const src = meshData?.vertProperties;
  const tris = meshData?.triVerts;
  const np = meshData?.numProp || 3;
  if (!src || !tris || src.length < np * 3 || tris.length < 3) return null;
  const nVert = Math.floor(src.length / np);
  const positions = new Float32Array(nVert * 3);
  for (let i = 0; i < nVert; i++) {
    positions[i * 3] = src[i * np];
    positions[i * 3 + 1] = src[i * np + 1];
    positions[i * 3 + 2] = src[i * np + 2];
  }
  const fin = dropPlanarFins(positions, new Uint32Array(tris));
  if (!fin?.indices || fin.indices.length < 3) return null;
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setIndex(new BufferAttribute(fin.indices, 1));
  geometry.computeVertexNormals();
  return geometry;
}

function ensureRenderer() {
  if (renderer) return true;
  if (rendererFailed || typeof document === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    renderer = new WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: true,
    });
    renderer.setPixelRatio(1);
    renderer.setSize(PART_PREVIEW_SIZE, PART_PREVIEW_SIZE, false);
    renderer.setClearColor(0x1e1e1e, 1);
    scene = new Scene();
    scene.background = new Color(0x1e1e1e);
    camera = new PerspectiveCamera(45, 1, 0.1, 2000);
    const light = new PointLight(0xffffff, 1);
    camera.add(light);
    scene.add(camera);
    normalMaterial = makeDefaultPartMaterial();
    body = new Mesh(new BufferGeometry(), normalMaterial);
    scene.add(body);
    return true;
  } catch (err) {
    rendererFailed = true;
    renderer = null;
    console.error('[partPreview] renderer unavailable', err);
    return false;
  }
}

function emptyCanvas() {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = PART_PREVIEW_SIZE;
  canvas.height = PART_PREVIEW_SIZE;
  paintEmptyPreview(canvas);
  return canvas;
}

function renderSnapshot(mesh) {
  if (!ensureRenderer()) return null;
  const geometry = geometryFromMesh(mesh);
  if (!geometry) return null;
  const prev = body.geometry;
  body.geometry = geometry;
  ensureBodyMaterial(body, mesh, normalMaterial);
  if (prev && prev !== geometry) prev.dispose();
  const fitted = fitView({
    camera,
    geometry,
    dir: VIEW_PRESETS.iso.dir,
    up: VIEW_PRESETS.iso.up,
    margin: 1.35,
  });
  if (!fitted) {
    geometry.dispose();
    body.geometry = new BufferGeometry();
    return null;
  }
  renderer.render(scene, camera);
  const snap = document.createElement('canvas');
  snap.width = PART_PREVIEW_SIZE;
  snap.height = PART_PREVIEW_SIZE;
  const ctx = snap.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(renderer.domElement, 0, 0);
  return snap;
}

/**
 * Draw this solid once and cache the bitmap. A repeated key returns the
 * cached canvas and does not touch WebGL. Missing solids return empty.
 */
export function takePartPreview(mesh) {
  const key = meshPreviewKey(mesh);
  if (!key) return { kind: 'empty', key: null, canvas: null };
  const hit = peekPartPreview(key);
  if (hit) return { kind: 'manifold', key, canvas: hit };
  let snap = null;
  try {
    snap = renderSnapshot(mesh);
  } catch (err) {
    console.error('[partPreview] snapshot failed', err);
    snap = null;
  }
  if (!snap) {
    snap = emptyCanvas();
    if (snap) remember(key, snap);
    return { kind: 'empty', key, canvas: snap };
  }
  remember(key, snap);
  return { kind: 'manifold', key, canvas: snap };
}

/** Dark tile matching the viewer background. Used when a part has no solid. */
export function paintEmptyPreview(canvas) {
  const ctx = canvas?.getContext?.('2d');
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx.fillStyle = '#1e1e1e';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#3a3a3a';
  ctx.strokeRect(8, 8, Math.max(0, w - 16), Math.max(0, h - 16));
}

/** Copy a cached snapshot onto the row canvas. */
export function blitPartPreview(dest, src) {
  const ctx = dest?.getContext?.('2d');
  if (!ctx || !src) return;
  ctx.clearRect(0, 0, dest.width, dest.height);
  ctx.drawImage(src, 0, 0, dest.width, dest.height);
}

/** Paint a stored PNG data URL onto the row canvas. */
export function blitPartPreviewUrl(dest, url) {
  return new Promise((resolve) => {
    if (!dest || typeof url !== 'string' || !url.startsWith('data:image/') || typeof Image === 'undefined') {
      resolve(false);
      return;
    }
    const img = new Image();
    img.onload = () => {
      try {
        blitPartPreview(dest, img);
        resolve(true);
      } catch {
        resolve(false);
      }
    };
    img.onerror = () => resolve(false);
    img.src = url;
  });
}

/**
 * Lit core / cavity skin for the active part, plus the outer parting polyline.
 *
 * Same child mesh as the face-color skin. While it is visible the paint
 * skin is hidden. Detach puts that visibility back, unless a wall-thickness
 * skin, a side-action skin, or a stress skin is still holding the paint hidden.
 */

import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  FrontSide,
  Line,
  LineBasicMaterial,
  Mesh,
} from 'three';
import { makeFaceSkinMaterial } from '../utils/faceColorSkin.js';
import { PARTING_LINE_RGB, PARTING_ROLE_RGB } from './parting.js';

/** Above paint (2), under the wall skin (2.4) and the stress skin (2.5). */
export const PARTING_SKIN_RENDER_ORDER = 2.35;

const SKIN_NAME = 'mold-parting-skin';

function hostSide(host) {
  const material = host?.material;
  const side = Array.isArray(material) ? material[0]?.side : material?.side;
  return side === DoubleSide ? DoubleSide : FrontSide;
}

function hidePaintSkin(host) {
  const paint = host?.userData?.faceColorSkin;
  if (!paint) return;
  if (!host.userData.partingPaintHidden) {
    host.userData.partingPaintHidden = { visible: paint.visible !== false };
  }
  paint.visible = false;
}

function restorePaintSkin(host) {
  const saved = host?.userData?.partingPaintHidden;
  if (!saved) return;
  host.userData.partingPaintHidden = null;
  if (host.userData?.stressSkin || host.userData?.wallSkin || host.userData?.sideActionSkin || host.userData?.moldDraftSkin) return;
  const paint = host.userData?.faceColorSkin;
  if (paint) paint.visible = saved.visible;
}

function buildGeometry(geometry, parting) {
  const index = geometry?.index?.array;
  const src = geometry?.attributes?.position?.array;
  if (!index?.length || !src?.length) return null;
  const triangles = Math.floor(index.length / 3);
  if (!triangles) return null;
  const roleOf = new Array(triangles).fill('parting');
  const rows = Array.isArray(parting?.triangles) ? parting.triangles : [];
  for (let i = 0; i < rows.length; i++) {
    const sample = rows[i];
    if (sample?.index >= 0 && sample.index < triangles) roleOf[sample.index] = sample.role;
  }
  const positions = new Float32Array(triangles * 9);
  const colors = new Float32Array(triangles * 9);
  let w = 0;
  for (let t = 0; t < triangles; t++) {
    const rgb = PARTING_ROLE_RGB[roleOf[t]] || PARTING_ROLE_RGB.cavity;
    for (let k = 0; k < 3; k++) {
      const vi = index[t * 3 + k] * 3;
      positions[w] = src[vi] || 0;
      colors[w] = rgb[0];
      w += 1;
      positions[w] = src[vi + 1] || 0;
      colors[w] = rgb[1];
      w += 1;
      positions[w] = src[vi + 2] || 0;
      colors[w] = rgb[2];
      w += 1;
    }
  }
  const geom = new BufferGeometry();
  geom.setAttribute('position', new BufferAttribute(positions, 3));
  geom.setAttribute('color', new BufferAttribute(colors, 3));
  geom.computeVertexNormals();
  return geom;
}

function disposeDraw(obj) {
  if (!obj) return;
  for (const child of [...(obj.children || [])]) {
    obj.remove(child);
    disposeDraw(child);
  }
  obj.geometry?.dispose?.();
  const material = obj.material;
  if (Array.isArray(material)) material.forEach((entry) => entry?.dispose?.());
  else material?.dispose?.();
}

function buildLine(parting) {
  const loop = parting?.lines?.[0];
  const points = loop?.points;
  if (!Array.isArray(points) || points.length < 2) return null;
  const count = points.length + (loop.closed ? 1 : 0);
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < points.length; i++) {
    positions[i * 3] = points[i][0] || 0;
    positions[i * 3 + 1] = points[i][1] || 0;
    positions[i * 3 + 2] = points[i][2] || 0;
  }
  if (loop.closed) {
    positions[points.length * 3] = points[0][0] || 0;
    positions[points.length * 3 + 1] = points[0][1] || 0;
    positions[points.length * 3 + 2] = points[0][2] || 0;
  }
  const geom = new BufferGeometry();
  geom.setAttribute('position', new BufferAttribute(positions, 3));
  const material = new LineBasicMaterial({ color: new Color(PARTING_LINE_RGB[0], PARTING_LINE_RGB[1], PARTING_LINE_RGB[2]) });
  const line = new Line(geom, material);
  line.name = 'mold-parting-line';
  line.renderOrder = PARTING_SKIN_RENDER_ORDER + 0.05;
  line.frustumCulled = false;
  line.raycast = () => {};
  return line;
}

/** Drop the parting skin and give face paint its previous visibility back. */
export function detachPartingSkin(host) {
  if (!host) return;
  const skin = host.userData?.partingSkin;
  if (skin) {
    host.remove(skin);
    disposeDraw(skin);
  }
  host.userData.partingSkin = null;
  host.userData.partingStamp = null;
  restorePaintSkin(host);
}

/** Draw `parting.triangles` on this mesh. A missing classification removes the skin. */
export function syncPartingSkin(host, parting) {
  if (!host || !parting?.counts) {
    detachPartingSkin(host);
    return null;
  }
  const stamp = [
    host.geometry?.uuid || '',
    parting.counts.cavity,
    parting.counts.core,
    parting.counts.parting,
    parting.lines?.[0]?.length || 0,
    parting.lines?.[0]?.points?.length || 0,
    parting.neutralDeg,
  ].join('|');
  if (host.userData?.partingStamp === stamp && host.userData.partingSkin) {
    hidePaintSkin(host);
    return host.userData.partingSkin;
  }
  const painted = buildGeometry(host.geometry, parting);
  detachPartingSkin(host);
  if (!painted) return null;
  const material = makeFaceSkinMaterial(hostSide(host));
  material.polygonOffsetFactor = -2;
  material.polygonOffsetUnits = -4;
  const skin = new Mesh(painted, material);
  skin.name = SKIN_NAME;
  skin.renderOrder = PARTING_SKIN_RENDER_ORDER;
  skin.frustumCulled = false;
  skin.raycast = () => {};
  skin.userData.partingSkin = true;
  const loop = buildLine(parting);
  if (loop) skin.add(loop);
  host.add(skin);
  host.userData.partingSkin = skin;
  host.userData.partingStamp = stamp;
  hidePaintSkin(host);
  return skin;
}

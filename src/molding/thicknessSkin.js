/**
 * Lit wall-thickness skin for the active part.
 *
 * Same child mesh as the face-color skin (`src/utils/faceColorSkin.js`):
 * unwelded triangles, vertex colours, no raycast, the face-skin headlight.
 * Render order sits above paint (2) and under the stress skin (2.5). While
 * this skin is visible the paint skin is hidden. Detach puts that visibility
 * back, unless a parting skin, a side-action skin, or a stress skin is still
 * holding the paint hidden.
 * Turning the mode off removes this mesh, so the part colour and face paint
 * show again.
 */

import { BufferAttribute, BufferGeometry, DoubleSide, FrontSide, Mesh } from 'three';
import { makeFaceSkinMaterial } from '../utils/faceColorSkin.js';
import { thicknessRgb } from './thicknessColor.js';

/** Above the paint skin (2), under the stress skin (2.5) and pick highlights (6). */
export const WALL_SKIN_RENDER_ORDER = 2.4;

const SKIN_NAME = 'wall-thickness-skin';

function hostSide(host) {
  const material = host?.material;
  const side = Array.isArray(material) ? material[0]?.side : material?.side;
  return side === DoubleSide ? DoubleSide : FrontSide;
}

function hidePaintSkin(host) {
  const paint = host?.userData?.faceColorSkin;
  if (!paint) return;
  if (!host.userData.wallPaintHidden) {
    host.userData.wallPaintHidden = { visible: paint.visible !== false };
  }
  paint.visible = false;
}

function restorePaintSkin(host) {
  const saved = host?.userData?.wallPaintHidden;
  if (!saved) return;
  host.userData.wallPaintHidden = null;
  if (host.userData?.stressSkin || host.userData?.partingSkin || host.userData?.sideActionSkin) return;
  const paint = host.userData?.faceColorSkin;
  if (paint) paint.visible = saved.visible;
}

function scaleOf(wall) {
  return {
    nominal: wall?.nominal,
    thinRatio: wall?.thresholds?.thinRatio,
    thickRatio: wall?.thresholds?.thickRatio,
  };
}

function buildGeometry(geometry, wall) {
  const index = geometry?.index?.array;
  const src = geometry?.attributes?.position?.array;
  if (!index?.length || !src?.length) return null;
  const triangles = Math.floor(index.length / 3);
  if (!triangles) return null;
  const thicknessOf = new Array(triangles).fill(null);
  const field = Array.isArray(wall?.field) ? wall.field : [];
  for (let i = 0; i < field.length; i++) {
    const sample = field[i];
    const t = sample?.index;
    if (t >= 0 && t < triangles) thicknessOf[t] = sample.thickness;
  }
  const scale = scaleOf(wall);
  const positions = new Float32Array(triangles * 9);
  const colors = new Float32Array(triangles * 9);
  let w = 0;
  for (let t = 0; t < triangles; t++) {
    const rgb = thicknessRgb(thicknessOf[t], scale);
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

/** Drop the thickness skin and give face paint its previous visibility back. */
export function detachThicknessSkin(host) {
  if (!host) return;
  const skin = host.userData?.wallSkin;
  if (skin) {
    host.remove(skin);
    skin.geometry?.dispose?.();
    skin.material?.dispose?.();
  }
  host.userData.wallSkin = null;
  host.userData.wallStamp = null;
  restorePaintSkin(host);
}

/**
 * Draw `wall.field` on this mesh. A missing nominal removes the skin.
 * The same geometry and the same nominal keep the mesh already built.
 */
export function syncThicknessSkin(host, wall) {
  if (!host || wall?.nominal == null) {
    detachThicknessSkin(host);
    return null;
  }
  const stamp = [
    host.geometry?.uuid || '',
    wall.nominal,
    wall.sampleCount,
    wall.max,
    wall.thresholds?.thinRatio,
    wall.thresholds?.thickRatio,
  ].join('|');
  if (host.userData?.wallStamp === stamp && host.userData.wallSkin) {
    hidePaintSkin(host);
    return host.userData.wallSkin;
  }
  const painted = buildGeometry(host.geometry, wall);
  detachThicknessSkin(host);
  if (!painted) return null;
  const material = makeFaceSkinMaterial(hostSide(host));
  material.polygonOffsetFactor = -2;
  material.polygonOffsetUnits = -4;
  const skin = new Mesh(painted, material);
  skin.name = SKIN_NAME;
  skin.renderOrder = WALL_SKIN_RENDER_ORDER;
  skin.frustumCulled = false;
  skin.raycast = () => {};
  skin.userData.wallSkin = true;
  host.add(skin);
  host.userData.wallSkin = skin;
  host.userData.wallStamp = stamp;
  hidePaintSkin(host);
  return skin;
}

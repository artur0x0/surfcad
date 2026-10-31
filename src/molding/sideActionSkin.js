/**
 * Lit side-action skin for the active part.
 *
 * Same child mesh as the face-color skin, painted only on the undercut
 * triangles that belong to a group. While it is visible the paint skin is
 * hidden. Detach puts that visibility back, unless a wall, parting, or
 * stress skin is still holding the paint hidden.
 */

import { BufferAttribute, BufferGeometry, DoubleSide, FrontSide, Mesh } from 'three';
import { makeFaceSkinMaterial } from '../utils/faceColorSkin.js';
import { sideActionRgb } from './sideActions.js';

/** Above paint (2), the parting skin (2.35), and the wall skin (2.4). Under the stress skin (2.5). */
export const SIDE_ACTION_SKIN_RENDER_ORDER = 2.42;

const SKIN_NAME = 'mold-side-action-skin';

function hostSide(host) {
  const material = host?.material;
  const side = Array.isArray(material) ? material[0]?.side : material?.side;
  return side === DoubleSide ? DoubleSide : FrontSide;
}

function hidePaintSkin(host) {
  const paint = host?.userData?.faceColorSkin;
  if (!paint) return;
  if (!host.userData.sideActionPaintHidden) {
    host.userData.sideActionPaintHidden = { visible: paint.visible !== false };
  }
  paint.visible = false;
}

function restorePaintSkin(host) {
  const saved = host?.userData?.sideActionPaintHidden;
  if (!saved) return;
  host.userData.sideActionPaintHidden = null;
  if (host.userData?.stressSkin || host.userData?.wallSkin || host.userData?.partingSkin || host.userData?.moldDraftSkin) return;
  const paint = host.userData?.faceColorSkin;
  if (paint) paint.visible = saved.visible;
}

function buildGeometry(geometry, sideActions) {
  const index = geometry?.index?.array;
  const src = geometry?.attributes?.position?.array;
  if (!index?.length || !src?.length) return null;
  const triangles = Math.floor(index.length / 3);
  if (!triangles) return null;
  const colorOf = new Array(triangles).fill(null);
  const groups = Array.isArray(sideActions?.groups) ? sideActions.groups : [];
  groups.forEach((group, indexInKind) => {
    const rgb = sideActionRgb(group.kind, indexInKind);
    const members = Array.isArray(group.triangles) ? group.triangles : [];
    for (let i = 0; i < members.length; i++) {
      const t = members[i];
      if (t >= 0 && t < triangles) colorOf[t] = rgb;
    }
  });
  let painted = 0;
  for (let t = 0; t < triangles; t++) if (colorOf[t]) painted += 1;
  if (!painted) return null;
  const positions = new Float32Array(painted * 9);
  const colors = new Float32Array(painted * 9);
  let w = 0;
  for (let t = 0; t < triangles; t++) {
    const rgb = colorOf[t];
    if (!rgb) continue;
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

/** Drop the side-action skin and give face paint its previous visibility back. */
export function detachSideActionSkin(host) {
  if (!host) return;
  const skin = host.userData?.sideActionSkin;
  if (skin) {
    host.remove(skin);
    skin.geometry?.dispose?.();
    skin.material?.dispose?.();
  }
  host.userData.sideActionSkin = null;
  host.userData.sideActionStamp = null;
  restorePaintSkin(host);
}

/** Draw the grouped undercuts. An empty group list removes the skin. */
export function syncSideActionSkin(host, sideActions) {
  if (!host || !sideActions?.groups?.length) {
    detachSideActionSkin(host);
    return null;
  }
  const stamp = [
    host.geometry?.uuid || '',
    sideActions.count,
    sideActions.slideCount,
    sideActions.lifterCount,
    ...sideActions.groups.map((group) => `${group.kind}:${group.pull.join(',')}:${group.triangles?.length || 0}`),
  ].join('|');
  if (host.userData?.sideActionStamp === stamp && host.userData.sideActionSkin) {
    hidePaintSkin(host);
    return host.userData.sideActionSkin;
  }
  const painted = buildGeometry(host.geometry, sideActions);
  detachSideActionSkin(host);
  if (!painted) return null;
  const material = makeFaceSkinMaterial(hostSide(host));
  material.polygonOffsetFactor = -2;
  material.polygonOffsetUnits = -4;
  const skin = new Mesh(painted, material);
  skin.name = SKIN_NAME;
  skin.renderOrder = SIDE_ACTION_SKIN_RENDER_ORDER;
  skin.frustumCulled = false;
  skin.raycast = () => {};
  skin.userData.sideActionSkin = true;
  host.add(skin);
  host.userData.sideActionSkin = skin;
  host.userData.sideActionStamp = stamp;
  hidePaintSkin(host);
  return skin;
}

/**
 * Lit mold-draft skin for the active part.
 *
 * Paints only the side walls that fall below the draft threshold. While it
 * is visible the paint skin is hidden. Detach puts that visibility back,
 * unless another mold overlay or a stress skin is still holding it hidden.
 * This is not CAD draft mode.
 */

import { BufferAttribute, BufferGeometry, DoubleSide, FrontSide, Mesh } from 'three';
import { makeFaceSkinMaterial } from '../utils/faceColorSkin.js';
import { MOLD_DRAFT_RGB } from './moldDraft.js';

/** Above the side-action skin (2.42), under the stress skin (2.5). */
export const MOLD_DRAFT_SKIN_RENDER_ORDER = 2.43;

const SKIN_NAME = 'mold-draft-skin';

function hostSide(host) {
  const material = host?.material;
  const side = Array.isArray(material) ? material[0]?.side : material?.side;
  return side === DoubleSide ? DoubleSide : FrontSide;
}

function hidePaintSkin(host) {
  const paint = host?.userData?.faceColorSkin;
  if (!paint) return;
  if (!host.userData.moldDraftPaintHidden) {
    host.userData.moldDraftPaintHidden = { visible: paint.visible !== false };
  }
  paint.visible = false;
}

function restorePaintSkin(host) {
  const saved = host?.userData?.moldDraftPaintHidden;
  if (!saved) return;
  host.userData.moldDraftPaintHidden = null;
  if (host.userData?.stressSkin || host.userData?.wallSkin || host.userData?.partingSkin || host.userData?.sideActionSkin) return;
  const paint = host.userData?.faceColorSkin;
  if (paint) paint.visible = saved.visible;
}

function buildGeometry(geometry, moldDraft) {
  const index = geometry?.index?.array;
  const src = geometry?.attributes?.position?.array;
  if (!index?.length || !src?.length) return null;
  const triangles = Math.floor(index.length / 3);
  if (!triangles) return null;
  const paint = new Array(triangles).fill(false);
  const rows = Array.isArray(moldDraft?.triangles) ? moldDraft.triangles : [];
  for (let i = 0; i < rows.length; i++) {
    const t = rows[i]?.index;
    if (t >= 0 && t < triangles) paint[t] = true;
  }
  let count = 0;
  for (let t = 0; t < triangles; t++) if (paint[t]) count += 1;
  if (!count) return null;
  const positions = new Float32Array(count * 9);
  const colors = new Float32Array(count * 9);
  let w = 0;
  for (let t = 0; t < triangles; t++) {
    if (!paint[t]) continue;
    for (let k = 0; k < 3; k++) {
      const vi = index[t * 3 + k] * 3;
      positions[w] = src[vi] || 0;
      colors[w] = MOLD_DRAFT_RGB[0];
      w += 1;
      positions[w] = src[vi + 1] || 0;
      colors[w] = MOLD_DRAFT_RGB[1];
      w += 1;
      positions[w] = src[vi + 2] || 0;
      colors[w] = MOLD_DRAFT_RGB[2];
      w += 1;
    }
  }
  const geom = new BufferGeometry();
  geom.setAttribute('position', new BufferAttribute(positions, 3));
  geom.setAttribute('color', new BufferAttribute(colors, 3));
  geom.computeVertexNormals();
  return geom;
}

/** Drop the mold-draft skin and give face paint its previous visibility back. */
export function detachMoldDraftSkin(host) {
  if (!host) return;
  const skin = host.userData?.moldDraftSkin;
  if (skin) {
    host.remove(skin);
    skin.geometry?.dispose?.();
    skin.material?.dispose?.();
  }
  host.userData.moldDraftSkin = null;
  host.userData.moldDraftStamp = null;
  restorePaintSkin(host);
}

/** Draw the draft violations. An empty report removes the skin. */
export function syncMoldDraftSkin(host, moldDraft) {
  if (!host || !moldDraft?.triangles?.length) {
    detachMoldDraftSkin(host);
    return null;
  }
  const stamp = [
    host.geometry?.uuid || '',
    moldDraft.violationCount,
    moldDraft.triangleCount,
    moldDraft.minDraftDeg,
  ].join('|');
  if (host.userData?.moldDraftStamp === stamp && host.userData.moldDraftSkin) {
    hidePaintSkin(host);
    return host.userData.moldDraftSkin;
  }
  const painted = buildGeometry(host.geometry, moldDraft);
  detachMoldDraftSkin(host);
  if (!painted) return null;
  const material = makeFaceSkinMaterial(hostSide(host));
  material.polygonOffsetFactor = -2;
  material.polygonOffsetUnits = -4;
  const skin = new Mesh(painted, material);
  skin.name = SKIN_NAME;
  skin.renderOrder = MOLD_DRAFT_SKIN_RENDER_ORDER;
  skin.frustumCulled = false;
  skin.raycast = () => {};
  skin.userData.moldDraftSkin = true;
  host.add(skin);
  host.userData.moldDraftSkin = skin;
  host.userData.moldDraftStamp = stamp;
  hidePaintSkin(host);
  return skin;
}

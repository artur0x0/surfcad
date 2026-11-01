/**
 * Lit mold-draft skin for the active part.
 *
 * Paints every classified face in the three draft classes. Positive ≥ T uses the
 * cavity colour. Negative ≥ T uses the core colour. Below T, either sign,
 * is the needs-work red with a world-space hatch so it does not depend on
 * hue alone. While the skin is visible the paint skin is hidden. Detach
 * puts that visibility back, unless another mold overlay or a stress skin
 * is still holding it hidden. This is not CAD draft mode.
 */

import { BufferAttribute, BufferGeometry, DoubleSide, FrontSide, Mesh, MeshStandardMaterial } from 'three';
import { adoptSectionClip } from '../utils/sectionClip.js';
import {
  MOLD_DRAFT_HATCH_RGB,
  MOLD_DRAFT_NEEDS_WORK_RGB,
  MOLD_DRAFT_NEGATIVE_RGB,
  MOLD_DRAFT_POSITIVE_RGB,
} from './moldDraft.js';

/** Above the side-action skin (2.42), under the stress skin (2.5). */
export const MOLD_DRAFT_SKIN_RENDER_ORDER = 2.43;

const SKIN_NAME = 'mold-draft-skin';
const PROGRAM_KEY = 'mold-draft-hatch-v2';

const RGB = {
  positive: MOLD_DRAFT_POSITIVE_RGB,
  negative: MOLD_DRAFT_NEGATIVE_RGB,
  below: MOLD_DRAFT_NEEDS_WORK_RGB,
};

function glslVec(rgb) {
  return `vec3(${rgb[0].toFixed(6)}, ${rgb[1].toFixed(6)}, ${rgb[2].toFixed(6)})`;
}

function hostSide(host) {
  const material = host?.material;
  const side = Array.isArray(material) ? material[0]?.side : material?.side;
  return side === DoubleSide ? DoubleSide : FrontSide;
}

/**
 * Face-skin headlight plus a world-space hatch on Below T triangles.
 * The stripe colours match the CSS tokens. They are copied here because a
 * WebGL program cannot read a stylesheet.
 */
export function makeDraftSkinMaterial(side) {
  const material = new MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    metalness: 0,
    roughness: 1,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -4,
    depthTest: true,
    depthWrite: false,
    toneMapped: false,
    side,
  });
  const needsWork = glslVec(MOLD_DRAFT_NEEDS_WORK_RGB);
  const hatch = glslVec(MOLD_DRAFT_HATCH_RGB);
  material.customProgramCacheKey = () => PROGRAM_KEY;
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute float draftNeedsWork;
        varying float vDraftNeedsWork;
        varying vec3 vDraftWorld;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vDraftNeedsWork = draftNeedsWork;
        vDraftWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying float vDraftNeedsWork;
        varying vec3 vDraftWorld;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        if (vDraftNeedsWork > 0.5) {
          float band = step(0.5, fract((vDraftWorld.x + vDraftWorld.y) * 0.45));
          diffuseColor.rgb = mix(${needsWork}, ${hatch}, band);
        }
        diffuseColor.rgb = mix(
          pow((diffuseColor.rgb + vec3(0.055)) / vec3(1.055), vec3(2.4)),
          diffuseColor.rgb * vec3(1.0 / 12.92),
          vec3(lessThanEqual(diffuseColor.rgb, vec3(0.04045)))
        );`,
      )
      .replace(
        '#include <lights_physical_fragment>',
        `#include <lights_physical_fragment>
        material.specularColor = vec3(0.0);`,
      )
      .replace(
        '#include <lights_fragment_begin>',
        `#include <lights_fragment_begin>
        {
          IncidentLight faceSkinHeadlight;
          faceSkinHeadlight.color = vec3(PI);
          faceSkinHeadlight.direction = normalize(vViewPosition);
          faceSkinHeadlight.visible = true;
          RE_Direct(faceSkinHeadlight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight);
        }`,
      );
  };
  adoptSectionClip(material);
  return material;
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

function colorOf(state) {
  return RGB[state] || MOLD_DRAFT_NEEDS_WORK_RGB;
}

function buildGeometry(geometry, moldDraft) {
  const index = geometry?.index?.array;
  const src = geometry?.attributes?.position?.array;
  if (!index?.length || !src?.length) return null;
  const triangles = Math.floor(index.length / 3);
  if (!triangles) return null;
  const state = new Array(triangles).fill(null);
  const rows = Array.isArray(moldDraft?.triangles) ? moldDraft.triangles : [];
  for (let i = 0; i < rows.length; i++) {
    const t = rows[i]?.index;
    if (t >= 0 && t < triangles) state[t] = rows[i].state || 'below';
  }
  let count = 0;
  for (let t = 0; t < triangles; t++) if (state[t]) count += 1;
  if (!count) return null;
  const positions = new Float32Array(count * 9);
  const colors = new Float32Array(count * 9);
  const needsWork = new Float32Array(count * 3);
  let w = 0;
  let v = 0;
  for (let t = 0; t < triangles; t++) {
    if (!state[t]) continue;
    const rgb = colorOf(state[t]);
    const hatch = state[t] === 'below' ? 1 : 0;
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
      needsWork[v] = hatch;
      v += 1;
    }
  }
  const geom = new BufferGeometry();
  geom.setAttribute('position', new BufferAttribute(positions, 3));
  geom.setAttribute('color', new BufferAttribute(colors, 3));
  geom.setAttribute('draftNeedsWork', new BufferAttribute(needsWork, 1));
  geom.computeVertexNormals();
  return geom;
}

function stampOf(host, moldDraft) {
  const rows = Array.isArray(moldDraft?.triangles) ? moldDraft.triangles : [];
  let sig = 0;
  for (let i = 0; i < rows.length; i++) {
    const stateCode = rows[i]?.state === 'negative' ? 3 : rows[i]?.state === 'below' ? 2 : 1;
    sig = (sig + ((rows[i]?.index || 0) + 1) * stateCode) >>> 0;
  }
  return [
    host.geometry?.uuid || '',
    moldDraft?.minDeg,
    moldDraft?.positive?.count,
    moldDraft?.negative?.count,
    moldDraft?.below?.count,
    sig,
  ].join('|');
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

/** Draw the signed draft. An empty report removes the skin. */
export function syncMoldDraftSkin(host, moldDraft) {
  if (!host || !moldDraft?.triangles?.length) {
    detachMoldDraftSkin(host);
    return null;
  }
  const stamp = stampOf(host, moldDraft);
  if (host.userData?.moldDraftStamp === stamp && host.userData.moldDraftSkin) {
    hidePaintSkin(host);
    return host.userData.moldDraftSkin;
  }
  const painted = buildGeometry(host.geometry, moldDraft);
  detachMoldDraftSkin(host);
  if (!painted) return null;
  const material = makeDraftSkinMaterial(hostSide(host));
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

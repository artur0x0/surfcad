/**
 * Sheet-metal faces. Other parts stay on the off-white default part material.
 *
 * The viewport's camera point light is intensity 1 with physical decay 2.
 * At a fitted view that light is ~0, so a Lambert or Standard sheet renders
 * near-black and only the unlit orange handles remain. This material is
 * MeshStandardMaterial (#c8ccd2, mild metal) and adds that same camera
 * headlight in view space with no distance falloff — only on this shader,
 * so the ghost and every non-sheet part are unchanged. DoubleSide plus the
 * headlight lights whichever side of the thin wall faces the camera.
 */
import { DoubleSide, MeshStandardMaterial } from 'three';
import { adoptSectionClip } from '../sectionClip.js';
import { makeDefaultPartMaterial } from '../partMaterial.js';
import { isSheetMesh } from './sheetMeshFlag.js';

export const SHEET_METAL_COLOR = 0xc8ccd2;
export const SHEET_METAL_METALNESS = 0.35;
export const SHEET_METAL_ROUGHNESS = 0.45;
/** View-space headlight intensity. 8 lands a face-on sheet on #c8ccd2. */
export const SHEET_HEADLIGHT_INTENSITY = 8;

const HEADLIGHT_KEY = 'sheet-metal-headlight-v1';

export function makeSheetMetalMaterial() {
  const material = new MeshStandardMaterial({
    name: 'sheetMetal',
    color: SHEET_METAL_COLOR,
    metalness: SHEET_METAL_METALNESS,
    roughness: SHEET_METAL_ROUGHNESS,
    flatShading: true,
    side: DoubleSide,
  });
  material.userData.sheetMetal = true;
  material.customProgramCacheKey = () => HEADLIGHT_KEY;
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <lights_fragment_begin>',
      `#include <lights_fragment_begin>
      {
        IncidentLight sheetHeadlight;
        sheetHeadlight.color = vec3(${SHEET_HEADLIGHT_INTENSITY.toFixed(1)});
        sheetHeadlight.direction = normalize(vViewPosition);
        sheetHeadlight.visible = true;
        RE_Direct(sheetHeadlight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight);
      }
      `,
    );
  };
  adoptSectionClip(material);
  return material;
}

/**
 * Point the mesh at the sheet material or back at `bodyMaterial`.
 * The shared body-material array is never disposed. The sheet material
 * is cached on the mesh and reused. A mesh with no shared material gets
 * its own default part material, cached on the mesh.
 */
export function ensureBodyMaterial(mesh, meshData, bodyMaterial = null) {
  if (!mesh) return;
  const wantSheet = isSheetMesh(meshData);
  const current = mesh.material;
  const sheetNow = !Array.isArray(current) && current?.userData?.sheetMetal === true;
  if (wantSheet) {
    if (sheetNow) return;
    if (!mesh.userData.sheetMaterial) mesh.userData.sheetMaterial = makeSheetMetalMaterial();
    if (!Array.isArray(current) && current && current !== bodyMaterial && current !== mesh.userData.sheetMaterial) {
      current.dispose?.();
    }
    mesh.material = mesh.userData.sheetMaterial;
    return;
  }
  if (sheetNow) {
    if (!bodyMaterial) {
      if (!mesh.userData.defaultPartMaterial) mesh.userData.defaultPartMaterial = makeDefaultPartMaterial();
      mesh.material = mesh.userData.defaultPartMaterial;
    } else {
      mesh.material = bodyMaterial;
    }
    return;
  }
  if (bodyMaterial && current !== bodyMaterial) mesh.material = bodyMaterial;
}

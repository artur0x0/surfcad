/**
 * Unpainted part faces.
 *
 * One flat off-white, not the old per-face normal colors. Face paint, the
 * stress skin, selection and hover fills, and piece-preview tints are
 * overlays and are not this material. Sheet metal keeps its own gray.
 *
 * The viewport point light decays to nothing at a fitted view, so this
 * shader adds the same view-space headlight as the face-color skin. A face
 * pointing at the camera reads as DEFAULT_PART_COLOR. Flat shading keeps a
 * crease as the shade break between two normals. Metalness 0, roughness 1,
 * and the dielectric specular cleared keep that face from picking up a
 * white sheen.
 */
import { MeshStandardMaterial } from 'three';
import { adoptSectionClip } from './sectionClip.js';

/** #ECEAE4. Reads on the #1e1e1e ground under the headlight. */
export const DEFAULT_PART_COLOR = 0xeceae4;

const HEADLIGHT_KEY = 'default-part-headlight-v1';

export function makeDefaultPartMaterial() {
  const material = new MeshStandardMaterial({
    name: 'defaultPart',
    color: DEFAULT_PART_COLOR,
    metalness: 0,
    roughness: 1,
    flatShading: true,
    toneMapped: false,
  });
  material.userData.defaultPart = true;
  material.customProgramCacheKey = () => HEADLIGHT_KEY;
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <lights_physical_fragment>',
        `#include <lights_physical_fragment>
        material.specularColor = vec3(0.0);`,
      )
      .replace(
        '#include <lights_fragment_begin>',
        `#include <lights_fragment_begin>
        {
          IncidentLight partHeadlight;
          partHeadlight.color = vec3(PI);
          partHeadlight.direction = normalize(vViewPosition);
          partHeadlight.visible = true;
          RE_Direct(partHeadlight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight);
        }`,
      );
  };
  adoptSectionClip(material);
  return material;
}

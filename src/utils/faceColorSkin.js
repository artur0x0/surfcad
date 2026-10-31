/**
 * Lit face-color skin for one part.
 *
 * Reads the face graph already built for the shown mesh, matches the saved
 * color entry, and adds a child mesh of those triangles. An instance with
 * no entry of its own uses the definition's paint (`definitionId`). The child
 * does not raycast. The base material stays the off-white part color (or the sheet metal).
 * Ambiguous and missing keys are skipped. This does not write the color map.
 *
 * The viewport point light decays to nothing at a fitted view, so the skin
 * carries its own view-space headlight. Intensity is PI: Standard's diffuse
 * term is albedo / PI, and that cancels on a face whose normal points at the
 * camera. Metalness 0 and roughness 1, with the dielectric specular cleared,
 * keep a face-on swatch from picking up a white sheen. Vertex colors stay
 * sRGB in the buffer; the shader decodes them before lighting.
 */
import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  FrontSide,
  Mesh,
  MeshStandardMaterial,
} from 'three';
import { warmFaceGraph } from './selectFace.js';
import { faceFingerprints, matchFaceColors } from './faceColorMatch.js';
import { colorEntryForPlacement } from './facePaint.js';
import { adoptSectionClip } from './sectionClip.js';

/** Above the solid, under crease lines (3) and pick highlights. */
export const FACE_SKIN_RENDER_ORDER = 2;
/** Selection, hover, and remote pick fills. Opaque skin is 2, so this stays on top. */
export const FACE_HIGHLIGHT_RENDER_ORDER = 6;

const SKIN_NAME = 'face-color-skin';
const HEADLIGHT_KEY = 'face-color-skin-lit-v1';

/** Fully diffuse. A specular lobe would add white and shift the swatch. */
export const FACE_SKIN_METALNESS = 0;
export const FACE_SKIN_ROUGHNESS = 1;

export function makeFaceSkinMaterial(side) {
  const material = new MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    metalness: FACE_SKIN_METALNESS,
    roughness: FACE_SKIN_ROUGHNESS,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -2,
    depthTest: true,
    depthWrite: false,
    toneMapped: false,
    side,
  });
  material.customProgramCacheKey = () => HEADLIGHT_KEY;
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
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

export function readFaceColorDebugFlag(win) {
  const scope = win || (typeof window !== 'undefined' ? window : null);
  if (!scope) return false;
  try {
    const search = scope.location?.search || '';
    const query = search.startsWith('?') ? search.slice(1) : search;
    if (query.split('&').includes('debugFaces=1')) return true;
    return scope.localStorage?.getItem('surfcad.debugFaces') === '1';
  } catch {
    return false;
  }
}

export function colorsAreEmpty(colors) {
  if (!colors || typeof colors !== 'object' || Array.isArray(colors)) return true;
  return Object.keys(colors).length === 0;
}

function rgbOf(hex) {
  if (typeof hex !== 'string' || !/^#[0-9a-f]{6}$/.test(hex)) return null;
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function rainbowRgb(index) {
  const h = (index * 0.61803398875) % 1;
  const s = 0.65;
  const l = 0.55;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h * 12) % 12;
    return l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
  };
  return [f(0), f(8), f(4)];
}

function entryWantsPaint(entry, rainbow) {
  if (rainbow) return true;
  if (!entry || typeof entry !== 'object') return false;
  if (typeof entry.part === 'string') return true;
  return Array.isArray(entry.faces) && entry.faces.length > 0;
}

/**
 * Drop the skin child and its geometry and material. The part mesh stays.
 */
export function detachFaceColorSkin(host) {
  const skin = host?.userData?.faceColorSkin;
  if (!skin) return;
  host.remove(skin);
  skin.geometry?.dispose?.();
  skin.material?.dispose?.();
  host.userData.faceColorSkin = null;
  host.userData.faceColorStamp = null;
}

export function setFaceColorSkinVisible(host, visible) {
  const skin = host?.userData?.faceColorSkin;
  if (skin) skin.visible = !!visible;
}

function paintColors(geometry, { partRgb, rainbow, matched, graph }) {
  const index = geometry.index.array;
  const src = geometry.attributes.position.array;
  const numTri = Math.floor(index.length / 3);
  if (!numTri) return null;
  const colorOf = new Array(numTri);
  const fillAll = !!(partRgb || rainbow);
  if (fillAll) {
    const triPatch = graph?.triPatch;
    for (let t = 0; t < numTri; t++) {
      if (rainbow && triPatch) colorOf[t] = rainbowRgb(triPatch[t] | 0);
      else colorOf[t] = partRgb;
    }
  }
  for (let i = 0; i < matched.length; i++) {
    const rec = matched[i];
    const rgb = rgbOf(rec.color);
    const tris = rec.face?.tris;
    if (!rgb || !tris) continue;
    for (let k = 0; k < tris.length; k++) {
      const t = tris[k];
      if (t >= 0 && t < numTri) colorOf[t] = rgb;
    }
  }
  let count = 0;
  for (let t = 0; t < numTri; t++) if (colorOf[t]) count++;
  if (!count) return null;
  const positions = new Float32Array(count * 9);
  const colors = new Float32Array(count * 9);
  let w = 0;
  for (let t = 0; t < numTri; t++) {
    const rgb = colorOf[t];
    if (!rgb) continue;
    for (let k = 0; k < 3; k++) {
      const vi = index[t * 3 + k] * 3;
      positions[w] = src[vi];
      colors[w] = rgb[0];
      w++;
      positions[w] = src[vi + 1];
      colors[w] = rgb[1];
      w++;
      positions[w] = src[vi + 2];
      colors[w] = rgb[2];
      w++;
    }
  }
  const geom = new BufferGeometry();
  geom.setAttribute('position', new BufferAttribute(positions, 3));
  geom.setAttribute('color', new BufferAttribute(colors, 3));
  geom.computeVertexNormals();
  return geom;
}

function hostSide(host) {
  const material = host?.material;
  const side = Array.isArray(material) ? material[0]?.side : material?.side;
  return side === DoubleSide ? DoubleSide : FrontSide;
}

/**
 * Rebuild this part's skin from the current geometry. No-op when this part
 * has nothing to draw and the debug rainbow is off. A repeat with the same
 * geometry and the same color entry keeps the mesh it already built.
 */
export function syncFaceColorSkin(host, opts = {}) {
  if (!host) return null;
  const geometry = opts.geometry || host.geometry;
  const surfId = opts.surfId != null ? String(opts.surfId) : (host.userData?.surfId != null ? String(host.userData.surfId) : null);
  const colors = opts.colors && typeof opts.colors === 'object' && !Array.isArray(opts.colors) ? opts.colors : null;
  const rainbow = !!opts.rainbow;
  const definitionId = opts.definitionId != null ? String(opts.definitionId) : null;
  const entry = colorEntryForPlacement(colors, surfId, definitionId);
  if (!entryWantsPaint(entry, rainbow)) {
    detachFaceColorSkin(host);
    return null;
  }
  if (!geometry?.attributes?.position || !geometry.index?.array?.length) {
    detachFaceColorSkin(host);
    return null;
  }
  const stamp = [
    geometry.uuid,
    surfId || '',
    rainbow ? '1' : '0',
    JSON.stringify(entry ?? null),
  ].join('\n');
  const wasVisible = host.userData?.faceColorSkin ? host.userData.faceColorSkin.visible !== false : true;
  if (!Array.isArray(opts.faces) && host.userData?.faceColorStamp === stamp && host.userData.faceColorSkin) {
    return host.userData.faceColorSkin;
  }

  let faces = null;
  let graph = null;
  if (Array.isArray(opts.faces)) {
    faces = opts.faces;
    graph = opts.graph || null;
  } else {
    try {
      graph = warmFaceGraph(geometry, opts.faceIDs ?? null);
      faces = faceFingerprints(graph, geometry.userData?.triSource || null, {
        positions: geometry.attributes.position.array,
        indices: geometry.index.array,
      });
    } catch {
      detachFaceColorSkin(host);
      return null;
    }
  }

  let matched = [];
  if (entry && Array.isArray(entry.faces) && entry.faces.length && surfId) {
    const hit = matchFaceColors([{ surfId, faces }], { [surfId]: entry });
    matched = hit.matched;
  }
  const partRgb = rgbOf(entry?.part);
  const painted = paintColors(geometry, { partRgb, rainbow, matched, graph });
  detachFaceColorSkin(host);
  if (!painted) return null;

  const skin = new Mesh(painted, makeFaceSkinMaterial(hostSide(host)));
  skin.name = SKIN_NAME;
  skin.renderOrder = FACE_SKIN_RENDER_ORDER;
  skin.frustumCulled = false;
  skin.raycast = () => {};
  skin.visible = wasVisible;
  skin.userData.faceColorSkin = true;
  host.add(skin);
  host.userData.faceColorSkin = skin;
  host.userData.faceColorStamp = stamp;
  if (surfId) host.userData.surfId = surfId;
  return skin;
}

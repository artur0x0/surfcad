/**
 * Multi-part section fixture: a wheel (disc + spokes) shared by two
 * placements, one translated and one rotated, plus a material created
 * after the tool is on. Throws on failure. The unit test and the golden
 * both call this.
 */
import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  FrontSide,
  Mesh,
  MeshStandardMaterial,
  Scene,
  ShaderMaterial,
  Vector3,
} from 'three';
import { worldPlaneToLocalTrim } from './crossSectionView.js';
import { makeDefaultPartMaterial } from './partMaterial.js';
import { makeSheetMetalMaterial } from './sheetMetal/sheetMaterial.js';
import { PREVIEW_COLORS } from './previewStyle.js';
import {
  adoptSectionClip,
  beginSectionClip,
  endSectionClip,
  nextSectionSpec,
  SECTION_PLANE_COLOR,
  sectionClipActive,
  sectionClipSession,
  sectionKeptBounds,
  sectionKeepsWorldPoint,
  syncSectionClipMeshes,
} from './sectionClip.js';
import {
  createCuttingPlaneWidget,
  disposeCuttingPlaneWidget,
  placeCuttingPlaneWidget,
  syncSectionPreview,
} from './cuttingPlaneWidget.js';

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

/** Disc in the YZ plane (axle along X) plus six radial spokes. */
export function wheelPositions() {
  const positions = [];
  const push = (x, y, z) => {
    positions.push(x, y, z);
  };
  const segs = 16;
  for (const x of [-1, 1]) {
    push(x, 0, 0);
    for (let i = 0; i < segs; i += 1) {
      const a = (i / segs) * Math.PI * 2;
      push(x, Math.cos(a) * 30, Math.sin(a) * 30);
    }
  }
  for (let s = 0; s < 6; s += 1) {
    const a = (s / 6) * Math.PI * 2;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    for (const r of [6, 26]) {
      push(0, ca * r, sa * r);
    }
  }
  return new Float32Array(positions);
}

function wheelGeometry() {
  const geom = new BufferGeometry();
  geom.setAttribute('position', new BufferAttribute(wheelPositions(), 3));
  return geom;
}

function worldOf(mesh, x, y, z) {
  return new Vector3(x, y, z).applyMatrix4(mesh.matrixWorld);
}

export function verifyAssemblySectionClip() {
  endSectionClip();
  try {
  return verifyAssemblySectionClipBody();
  } finally {
    endSectionClip();
  }
}

function verifyAssemblySectionClipBody() {
  endSectionClip();
  const geometry = wheelGeometry();
  const position = geometry.attributes.position.array;
  const vertexCount = position.length;
  const geometryId = geometry.uuid;
  const material = new MeshStandardMaterial({
    color: 0x2563eb,
    side: FrontSide,
    depthWrite: true,
    polygonOffset: false,
  });
  const priorPlanes = material.clippingPlanes;
  const priorShadows = material.clipShadows;
  const priorIntersection = material.clipIntersection;
  const priorSide = material.side;
  const priorDepth = material.depthWrite;
  const priorOpacity = material.opacity;

  const rear = new Mesh(geometry, material);
  const front = new Mesh(geometry, material);
  front.position.set(120, 0, 0);
  front.rotation.z = Math.PI / 5;
  const parked = new Mesh(geometry, material);
  parked.position.set(-160, 0, 0);
  rear.updateMatrixWorld(true);
  front.updateMatrixWorld(true);
  parked.updateMatrixWorld(true);

  // The rear wheel's local plane discards a point on the front wheel that
  // the world plane keeps. That is the instance bug.
  const discardsKept = sharedLocalTrimWouldDiscard(rear, front, [1, 0, 0], 0);
  assert(discardsKept, 'expected the shared local trim to discard a kept-side point');

  beginSectionClip([1, 0, 0], 0);
  const session = sectionClipSession();
  adoptSectionClip(material);
  syncSectionClipMeshes([rear, front, parked]);

  assert(rear.geometry === geometry && front.geometry === geometry, 'instances keep the shared geometry');
  assert(geometry.uuid === geometryId, 'sectioning changed the geometry id');
  assert(geometry.attributes.position.array.length === vertexCount, 'sectioning changed vertex count');
  assert(rear.visible === true && front.visible === true && parked.visible === true, 'sectioning hid a mesh');
  assert(material.side === priorSide, 'sectioning changed material.side');
  assert(material.depthWrite === priorDepth, 'sectioning changed depthWrite');
  assert(material.opacity === priorOpacity, 'sectioning changed opacity');
  assert(material.polygonOffset === false, 'sectioning enabled polygonOffset');
  assert(material.clippingPlanes === session.planes, 'shared material missed the world plane');
  assert(front.material === material && parked.material === material, 'instances stopped sharing the material');

  let rearKept = 0;
  let rearCut = 0;
  let frontKept = 0;
  let parkedKept = 0;
  let parkedCut = 0;
  for (let i = 0; i < position.length; i += 3) {
    const rw = worldOf(rear, position[i], position[i + 1], position[i + 2]);
    if (sectionKeepsWorldPoint(session.plane, rw.x, rw.y, rw.z)) rearKept += 1;
    else rearCut += 1;
    const fw = worldOf(front, position[i], position[i + 1], position[i + 2]);
    if (sectionKeepsWorldPoint(session.plane, fw.x, fw.y, fw.z)) frontKept += 1;
    const pw = worldOf(parked, position[i], position[i + 1], position[i + 2]);
    if (sectionKeepsWorldPoint(session.plane, pw.x, pw.y, pw.z)) parkedKept += 1;
    else parkedCut += 1;
  }
  assert(rearKept > 0 && rearCut > 0, 'the plane should cut the wheel at the origin');
  assert(frontKept === position.length / 3, 'translated wheel on the kept side must stay fully kept');
  assert(parkedKept === 0 && parkedCut > 0, 'wheel entirely past the plane is fully clipped');
  assert(parked.geometry.attributes.position.count > 0, 'a fully clipped part must keep its geometry');

  const later = makeDefaultPartMaterial();
  const sheet = makeSheetMetalMaterial();
  assert(later.clippingPlanes === session.planes, 'material created after enable missed the plane');
  assert(sheet.clippingPlanes === session.planes, 'sheet material created after enable missed the plane');
  assert(later.side === FrontSide, 'later material side was rewritten');
  assert(sheet.side === DoubleSide, 'sheet side was rewritten');

  const clone = material.clone();
  adoptSectionClip(clone);
  beginSectionClip([1, 0, 0], 12);
  assert(clone.clippingPlanes === session.planes, 'cloned material is not on the live plane');
  assert(Math.abs(clone.clippingPlanes[0].constant - session.plane.constant) < 1e-6, 'clone kept a frozen plane copy');

  const childMat = new MeshStandardMaterial({ color: 0x111111 });
  const child = new Mesh(geometry, childMat);
  child.name = 'face-color-skin';
  rear.add(child);
  const seamMat = new ShaderMaterial();
  const seam = new Mesh(geometry, seamMat);
  seam.name = 'contactSeam';
  rear.add(seam);
  syncSectionClipMeshes([rear]);
  assert(childMat.clippingPlanes === session.planes, 'skin created under the part missed the plane');
  assert(seamMat.clippingPlanes == null, 'contact seam shader was given clipping planes');

  beginSectionClip([1, 0, 0], 0);
  const keptBefore = sectionKeptBounds(rear, session.plane);
  const frontBefore = sectionKeptBounds(front, session.plane);
  assert(keptBefore && keptBefore.count > 0 && keptBefore.count < geometry.attributes.position.count,
    'section did not clip the wheel');
  assert(keptBefore.min[0] > -1e-3, 'kept wheel still includes the discarded half');
  const accepted = nextSectionSpec(
    { normal: [1, 0, 0], originOffset: 0, showPlane: true },
    { previewOnly: true, showPlane: false, normal: [0, 0, 1], originOffset: 80 },
  );
  assert(accepted.showPlane === false, 'accept left the preview on');
  assert(Math.abs(accepted.originOffset) < 1e-9 && Math.abs(accepted.normal[0] - 1) < 1e-9
    && Math.abs(accepted.normal[2]) < 1e-9, 'accept replaced the live clip with the panel preset');
  beginSectionClip(accepted.normal, accepted.originOffset);
  const keptAfter = sectionKeptBounds(rear, session.plane);
  const frontAfter = sectionKeptBounds(front, session.plane);
  const sameBox = (a, b) => a && b && a.count === b.count
    && a.min.every((v, i) => Math.abs(v - b.min[i]) < 1e-6)
    && a.max.every((v, i) => Math.abs(v - b.max[i]) < 1e-6);
  assert(sameBox(keptBefore, keptAfter), 'accept changed the clipped bounds');
  assert(sameBox(frontBefore, frontAfter), 'accept changed the other instance bounds');

  const previewScene = new Scene();
  let preview = syncSectionPreview(previewScene, null, {
    showPlane: true,
    normal: accepted.normal,
    originOffset: accepted.originOffset,
    size: 80,
    color: SECTION_PLANE_COLOR,
  });
  assert(preview?.parent === previewScene, 'editing shows the section plane');
  assert(sectionClipActive(), 'clip is active while the preview shows');
  const livePlanes = session.planes;
  assert(material.clippingPlanes === livePlanes, 'clip stays on the part while the preview shows');
  preview = syncSectionPreview(previewScene, preview, { showPlane: false });
  assert(preview == null && previewScene.children.length === 0, 'accept hides the section plane');
  assert(sectionClipActive(), 'accept keeps the section clip');
  assert(material.clippingPlanes === livePlanes, 'accept leaves the clip on the part');
  assert(sameBox(keptBefore, sectionKeptBounds(rear, session.plane)),
    'hiding the preview changed the clipped bounds');
  preview = syncSectionPreview(previewScene, preview, {
    showPlane: true,
    normal: [1, 0, 0],
    originOffset: 0,
    size: 80,
    color: SECTION_PLANE_COLOR,
  });
  assert(preview?.parent === previewScene, 'edit shows the section plane again');
  assert(material.clippingPlanes === livePlanes, 'edit keeps the same clip');
  if (preview) disposeCuttingPlaneWidget(preview);

  endSectionClip();
  assert(material.clippingPlanes === priorPlanes, 'restore did not put the original clippingPlanes back');
  assert(material.clipShadows === priorShadows, 'restore did not put clipShadows back');
  assert(material.clipIntersection === priorIntersection, 'restore did not put clipIntersection back');
  assert(clone.clippingPlanes == null, 'cloned material still clips after the tool is off');
  assert(later.clippingPlanes == null, 'later material still clips after the tool is off');
  assert(childMat.clippingPlanes == null, 'skin still clips after the tool is off');
  assert(material.side === priorSide, 'restore changed material.side');
  assert(geometry.uuid === geometryId, 'restore changed the geometry');
  assert(rear.visible === true && front.visible === true, 'restore hid a mesh');

  const widget = createCuttingPlaneWidget({ normal: [0, 0, 1], originOffset: 4, size: 80 });
  assert(widget.userData.color === PREVIEW_COLORS.skin, 'cut-tool widget default left preview skin');
  assert(widget.userData.sectionClipExempt === true, 'section plane can be clipped by its own plane');
  const stale = new Scene();
  const live = new Scene();
  stale.add(widget);
  const placed = placeCuttingPlaneWidget(live, widget, {
    normal: [1, 0, 0],
    originOffset: -48,
    size: 80,
    color: SECTION_PLANE_COLOR,
  });
  assert(placed.parent === live, 'plane widget was not reattached to the current scene');
  assert(placed.parent !== stale, 'plane widget stayed on the rebuilt scene');
  assert(Math.abs(placed.userData.originOffset - -48) < 1e-6, 'reattached plane kept the old offset');
  assert(placed.userData.color === SECTION_PLANE_COLOR, 'section plane is not text-blue-400');
  assert(SECTION_PLANE_COLOR === 0x60a5fa, 'section plane left the chrome accent');
  assert(placed.userData.color !== PREVIEW_COLORS.skin, 'section plane is still the cyan skin');
  assert(placed.userData.color !== 0x00ff00, 'section plane is still green');
}

function sharedLocalTrimWouldDiscard(sourceMesh, otherMesh, normal, originOffset) {
  const local = worldPlaneToLocalTrim(sourceMesh, normal, originOffset);
  const n = new Vector3(...local.normal).normalize();
  const sample = worldOf(otherMesh, -20, 0, 0);
  const plane = beginSectionClip(normal, originOffset).plane;
  endSectionClip();
  const worldKeeps = sectionKeepsWorldPoint(plane, sample.x, sample.y, sample.z);
  const localPoint = otherMesh.worldToLocal(sample.clone());
  const localKeeps = localPoint.dot(n) >= local.originOffset - 1e-4;
  return worldKeeps && !localKeeps;
}

import assert from 'node:assert/strict';
import test from 'node:test';
import { BoxGeometry, Mesh, MeshBasicMaterial, PerspectiveCamera, PlaneGeometry, Vector3 } from 'three';
import { faceSketchBox, faceSketchPose, sketchAimBox, sketchCameraUp } from './faceSketchCamera.js';

test('face sketch pose looks along the outward normal and frames the face', () => {
  const camera = new PerspectiveCamera(45, 390 / 700, 0.1, 2000);
  camera.position.set(80, -60, 40);
  camera.up.set(0, 0, 1);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const controls = {
    target: new Vector3(0, 0, 0),
    update() { camera.lookAt(this.target); },
  };
  const mesh = new Mesh(new PlaneGeometry(10, 10), new MeshBasicMaterial());
  mesh.name = 'highlight';
  mesh.position.set(0, 0, 18);
  mesh.updateMatrixWorld(true);
  const box = faceSketchBox([mesh]);
  assert.ok(box);
  const pose = faceSketchPose({ camera, controls, box, normal: [0, 0, 1] });
  assert.ok(pose);
  const dx = pose.position[0] - pose.target[0];
  const dy = pose.position[1] - pose.target[1];
  const dz = pose.position[2] - pose.target[2];
  const len = Math.hypot(dx, dy, dz);
  assert.ok(dz / len > 0.98, `view dir ${dz / len}`);
  assert.ok(Math.hypot(pose.target[0], pose.target[1], pose.target[2] - 18) < 1);
  assert.ok(pose.position[2] > 18);
  const up = pose.up;
  assert.ok(up, 'pose has an up hint');
  const upLen = Math.hypot(up[0], up[1], up[2]);
  const upDot = (up[0] * 0 + up[1] * 0 + up[2] * 1) / upLen;
  assert.ok(Math.abs(upDot) < 0.2, `up parallel to the view ${up}`);
  assert.ok(Math.hypot(up[0], up[1] + 1, up[2]) < 1e-6, `+Z sketch up ${up}`);
});

test('normal aim frames the placed part in world space', () => {
  const part = new Mesh(new BoxGeometry(40, 30, 20), new MeshBasicMaterial());
  part.position.set(60, 0, 0);
  part.updateMatrixWorld(true);
  const face = new Mesh(new PlaneGeometry(10, 10), new MeshBasicMaterial());
  face.name = 'highlight';
  face.position.set(0, 0, 10);
  face.updateMatrixWorld(true);
  const bounds = { min: [-20, -15, -10], max: [20, 15, 10] };
  const forced = sketchAimBox({ force: true, highlightMeshes: [face], partMesh: part, bounds });
  const center = forced.getCenter(new Vector3());
  assert.ok(Math.abs(center.x - 60) < 1e-6, `normal center ${center.toArray()}`);
  assert.ok(Math.abs(center.y) < 1e-6 && Math.abs(center.z) < 1e-6);
});

test('select plane still frames a highlighted face ahead of the part', () => {
  const part = new Mesh(new BoxGeometry(40, 30, 20), new MeshBasicMaterial());
  part.position.set(60, 0, 0);
  part.updateMatrixWorld(true);
  const face = new Mesh(new PlaneGeometry(10, 10), new MeshBasicMaterial());
  face.name = 'highlight';
  face.position.set(60, 0, 18);
  face.updateMatrixWorld(true);
  const box = sketchAimBox({
    force: false,
    highlightMeshes: [face],
    partMesh: part,
    bounds: { min: [-20, -15, -10], max: [20, 15, 10] },
  });
  const center = box.getCenter(new Vector3());
  assert.ok(Math.abs(center.x - 60) < 1e-3, `face x ${center.x}`);
  assert.ok(Math.abs(center.z - 18) < 1e-3, `face z ${center.z}`);
});

test('a placed part with no face highlight is framed in world space', () => {
  const part = new Mesh(new BoxGeometry(40, 30, 20), new MeshBasicMaterial());
  part.position.set(60, 0, 0);
  part.updateMatrixWorld(true);
  const box = sketchAimBox({
    force: false,
    partMesh: part,
    bounds: { min: [-20, -15, -10], max: [20, 15, 10] },
  });
  const center = box.getCenter(new Vector3());
  assert.ok(Math.abs(center.x - 60) < 1e-6, `part center ${center.toArray()}`);
});

test('sketch camera up matches the top view on a +Z face and world +Z otherwise', () => {
  const top = sketchCameraUp([0, 0, 1]);
  assert.deepEqual(top, [0, -1, 0]);
  assert.deepEqual(sketchCameraUp([0, 0, -1]), [0, 1, 0]);
  assert.deepEqual(sketchCameraUp([0, 1, 0]), [0, 0, 1]);
  assert.deepEqual(sketchCameraUp([1, 0, 0]), [0, 0, 1]);
});

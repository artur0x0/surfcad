import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { faceSliderFrame, helperFieldSpec, thicknessBehind } from './helperSheetRange.js';

const cube = (name, def, extra = {}) => ({ name, type: 'number', default: def, ...extra });

describe('helper sheet ranges', () => {
  it('keeps the L=100 cube seeds and gives width a 2L end', () => {
    const width = helperFieldSpec('cube', cube('width', 40), { lengthMm: 100 });
    assert.equal(width.seed, 40);
    assert.equal(width.min, 0.1);
    assert.equal(width.max, 200);
    assert.equal(width.shaped, true);
    assert.equal(width.signed, false);
    const pose = helperFieldSpec('cube', cube('x', 0), { lengthMm: 100 });
    assert.equal(pose.seed, 0);
    assert.equal(pose.signed, true);
    assert.ok(pose.min < 0 && pose.max > 0);
    const rot = helperFieldSpec('cube', cube('rx', 0), { lengthMm: 100 });
    assert.equal(rot.shaped, false);
    assert.equal(rot.min, -360);
    assert.equal(rot.max, 360);
  });

  it('scales a fresh cube with L and keeps a saved width', () => {
    const fresh = helperFieldSpec('cube', cube('width', 40), { lengthMm: 40 });
    assert.equal(fresh.seed, 16);
    assert.equal(fresh.max, 80);
    const saved = helperFieldSpec('cube', cube('width', 55), { lengthMm: 40, saved: true });
    assert.equal(saved.seed, 55);
    assert.ok(saved.max >= 55);
  });

  it('caps segments and leaves them linear', () => {
    const seg = helperFieldSpec('roundedBox', cube('segments', 16), { lengthMm: 200 });
    assert.equal(seg.seed, 16);
    assert.equal(seg.min, 1);
    assert.equal(seg.max, 64);
    assert.equal(seg.step, 1);
    assert.equal(seg.shaped, false);
    const cyl = helperFieldSpec('cylinder', cube('segments', 64), { lengthMm: 200 });
    assert.equal(cyl.max, 128);
    assert.equal(cyl.seed, 64);
  });

  it('lets hole U, axial, and cylinder angle leave zero', () => {
    const u = helperFieldSpec('hole', cube('u', 0), { lengthMm: 100 });
    assert.equal(u.signed, true);
    assert.ok(u.min < 0);
    const face = {
      span: { u0: -20, u1: 20, v0: -15, v1: 15, axial0: -10, axial1: 10 },
      normal: [0, 0, 1],
      center: [0, 0, 10],
    };
    const onFace = helperFieldSpec('hole', cube('u', 0), { lengthMm: 100, face });
    assert.equal(onFace.min, -20);
    assert.equal(onFace.max, 20);
    const angle = helperFieldSpec('hole', cube('angleDeg', 30), { lengthMm: 80 });
    assert.equal(angle.seed, 30);
    assert.equal(angle.min, -90);
    assert.equal(angle.max, 90);
    assert.equal(angle.shaped, false);
    const axial = helperFieldSpec('hole', cube('axial', 10), { lengthMm: 80, face });
    assert.equal(axial.seed, 10);
    assert.equal(axial.min, -10);
    assert.equal(axial.max, 10);
  });

  it('signs array spacing and move-face distance', () => {
    const spacing = helperFieldSpec('array3D', cube('sx', 45), { lengthMm: 100 });
    assert.equal(spacing.seed, 45);
    assert.equal(spacing.min, -500);
    assert.equal(spacing.max, 500);
    assert.equal(spacing.signed, true);
    const distance = helperFieldSpec('moveFace', cube('distance', 2), { lengthMm: 100 });
    assert.equal(distance.seed, 2);
    assert.ok(distance.min < 0);
    const counts = helperFieldSpec('array3D', cube('nx', 2), { lengthMm: 200 });
    assert.equal(counts.seed, 2);
    assert.equal(counts.max, 32);
    assert.equal(counts.shaped, false);
  });

  it('keeps a tube inner radius under the outer and caps the round-box edge', () => {
    const values = { outerRadius: 15, sx: 50, sy: 30, sz: 20, width: 40, depth: 20 };
    const inner = helperFieldSpec('tube', cube('innerRadius', 10), { lengthMm: 100, values });
    assert.equal(inner.seed, 10);
    assert.ok(inner.max < 15);
    const edge = helperFieldSpec('roundedBox', cube('edgeRadius', 4), { lengthMm: 100, values });
    assert.equal(edge.seed, 4);
    assert.equal(edge.max, 10);
    const wall = helperFieldSpec('tube', cube('wall', 2.5), { lengthMm: 100, values });
    assert.equal(wall.seed, 2.5);
    assert.equal(wall.max, 9);
  });

  it('scales hole depth to the remaining thickness and floors a counterbore on the thru', () => {
    const face = { normal: [0, 0, 1], center: [0, 0, 10] };
    const bounds = { min: [-20, -15, -10], max: [20, 15, 10] };
    assert.equal(thicknessBehind(bounds, face), 20);
    const depth = helperFieldSpec('hole', cube('depth', 12), { lengthMm: 100, face, bounds });
    assert.equal(depth.seed, 12);
    assert.equal(depth.max, 20);
    const thin = helperFieldSpec('hole', cube('depth', 12), { lengthMm: 40, face, bounds });
    assert.equal(thin.seed, 4.8);
    const cbore = helperFieldSpec('hole', cube('nearCboreDia', 6.5), {
      lengthMm: 100,
      values: { size: 'M3', fit: 'normal', holeType: 'clearance' },
    });
    assert.equal(cbore.seed, 6.5);
    assert.equal(cbore.min, 3.4);
  });

  it('seeds fillet and chamfer at 2 mm on a 0.5–25 mm log slider', () => {
    const bare = helperFieldSpec('filletEdges', cube('radius', 3, { min: 0.01 }), { lengthMm: 400 });
    assert.equal(bare.seed, 2);
    assert.equal(bare.min, 0.5);
    assert.equal(bare.max, 25);
    assert.equal(bare.curve, 'log');
    const edge = [{
      key: '0-1', a: 0, b: 1, length: 40,
      va: [0, 0, 0], vb: [40, 0, 0],
    }];
    const sized = helperFieldSpec('filletEdges', cube('radius', 3), { lengthMm: 100, edges: edge });
    assert.equal(sized.seed, 2);
    assert.equal(sized.max, 25);
    const chamfer = helperFieldSpec('chamferEdges', cube('chamfer', 2), { lengthMm: 400, edges: edge });
    assert.equal(chamfer.seed, 2);
    assert.equal(chamfer.min, 0.5);
    assert.equal(chamfer.max, 25);
    assert.equal(chamfer.curve, 'log');
    const saved = helperFieldSpec('filletEdges', cube('radius', 40), {
      lengthMm: 100, saved: true, values: { radius: 40 },
    });
    assert.equal(saved.seed, 40);
    assert.equal(saved.min, 0.5);
    assert.equal(saved.max, 25);
  });

  it('reads a face frame from its vertices', () => {
    const frame = faceSliderFrame(
      [[-20, -15, 10], [20, -15, 10], [20, 15, 10], [-20, 15, 10]],
      [0, 0, 1],
      [0, 0, 10],
    );
    assert.equal(frame.u0, -20);
    assert.equal(frame.u1, 20);
    assert.equal(frame.v0, -15);
    assert.equal(frame.v1, 15);
  });
});

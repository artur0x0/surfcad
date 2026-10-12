import assert from 'node:assert/strict';
import test from 'node:test';
import { AxesHelper } from 'three';
import {
  TRIAD_AXIS_COLORS,
  applyTriadAxisColors,
  contrastRatio,
  cssHex,
  directionAxis,
  directionButtonStyle,
} from './triadAxis.js';

function pack(attribute, index) {
  const r = Math.round(attribute.getX(index) * 255);
  const g = Math.round(attribute.getY(index) * 255);
  const b = Math.round(attribute.getZ(index) * 255);
  return ((r & 255) << 16) | ((g & 255) << 8) | (b & 255);
}

test('triad axis colors are the AxesHelper origin vertices', () => {
  const helper = new AxesHelper(1);
  const attribute = helper.geometry.getAttribute('color');
  assert.equal(TRIAD_AXIS_COLORS.x, pack(attribute, 0));
  assert.equal(TRIAD_AXIS_COLORS.y, pack(attribute, 2));
  assert.equal(TRIAD_AXIS_COLORS.z, pack(attribute, 4));
  applyTriadAxisColors(helper);
  assert.equal(pack(attribute, 0), TRIAD_AXIS_COLORS.x);
  assert.equal(pack(attribute, 2), TRIAD_AXIS_COLORS.y);
  assert.equal(pack(attribute, 4), TRIAD_AXIS_COLORS.z);
  assert.ok(((TRIAD_AXIS_COLORS.x >> 16) & 255) > ((TRIAD_AXIS_COLORS.x >> 8) & 255));
  assert.ok(((TRIAD_AXIS_COLORS.y >> 8) & 255) > ((TRIAD_AXIS_COLORS.y >> 16) & 255));
  assert.ok((TRIAD_AXIS_COLORS.z & 255) > ((TRIAD_AXIS_COLORS.z >> 16) & 255));
  helper.dispose();
});

test('axis buttons fill with the triad color when selected and outline it otherwise', () => {
  assert.equal(directionAxis('+x'), 'x');
  assert.equal(directionAxis('-y'), 'y');
  assert.equal(directionAxis('-z'), 'z');
  assert.equal(directionAxis('normal'), null);
  for (const axis of ['x', 'y', 'z']) {
    const on = directionButtonStyle(axis, true);
    const off = directionButtonStyle(axis, false);
    const fill = TRIAD_AXIS_COLORS[axis];
    assert.equal(on.backgroundColor, cssHex(fill));
    assert.equal(on.borderColor, cssHex(fill));
    assert.equal(off.backgroundColor, 'transparent');
    assert.equal(off.color, cssHex(fill));
    assert.equal(off.borderColor, cssHex(fill));
    const ink = Number.parseInt(on.color.slice(1), 16);
    assert.ok(contrastRatio(ink, fill) >= 4.5, `${axis} contrast ${contrastRatio(ink, fill)}`);
  }
});

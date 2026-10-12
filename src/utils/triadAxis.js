/**
 * Viewport triad axis colors.
 *
 * The triad is a three.js AxesHelper. Its vertex colors are the source of
 * truth: the origin of each segment is the axis color (X, then Y, then Z).
 * This module reads those vertices once and shares the result. Callers do
 * not type hex values.
 */

import { AxesHelper } from 'three';

function packColor(attribute, index) {
  const r = Math.round(attribute.getX(index) * 255);
  const g = Math.round(attribute.getY(index) * 255);
  const b = Math.round(attribute.getZ(index) * 255);
  return ((r & 255) << 16) | ((g & 255) << 8) | (b & 255);
}

function readTriadAxisColors() {
  const helper = new AxesHelper(1);
  const attribute = helper.geometry.getAttribute('color');
  // AxesHelper layout: X origin, X tip, Y origin, Y tip, Z origin, Z tip.
  const colors = {
    x: packColor(attribute, 0),
    y: packColor(attribute, 2),
    z: packColor(attribute, 4),
  };
  helper.dispose();
  return Object.freeze(colors);
}

/** Origin color of each triad axis, packed as 0xRRGGBB. */
export const TRIAD_AXIS_COLORS = readTriadAxisColors();

/** Write the shared axis colors onto an AxesHelper's origin vertices. */
export function applyTriadAxisColors(helper) {
  const attribute = helper?.geometry?.getAttribute?.('color');
  if (!attribute) return helper;
  const write = (index, hex) => {
    attribute.setXYZ(
      index,
      ((hex >> 16) & 255) / 255,
      ((hex >> 8) & 255) / 255,
      (hex & 255) / 255,
    );
  };
  write(0, TRIAD_AXIS_COLORS.x);
  write(2, TRIAD_AXIS_COLORS.y);
  write(4, TRIAD_AXIS_COLORS.z);
  attribute.needsUpdate = true;
  return helper;
}

export function cssHex(hex) {
  return `#${(hex >>> 0).toString(16).padStart(6, '0')}`;
}

function channelLuminance(value) {
  const s = value / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex) {
  const r = channelLuminance((hex >> 16) & 255);
  const g = channelLuminance((hex >> 8) & 255);
  const b = channelLuminance(hex & 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(foreground, background) {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  return (hi + 0.05) / (lo + 0.05);
}

const INK_DARK = 0x000000;
const INK_LIGHT = 0xffffff;

/** Ink that stays readable on `background`. */
export function contrastInk(background) {
  return contrastRatio(INK_DARK, background) >= contrastRatio(INK_LIGHT, background)
    ? INK_DARK
    : INK_LIGHT;
}

/** `+x` / `-x` → `x`, and the same for Y and Z. Normal has no axis. */
export function directionAxis(value) {
  if (value === '+x' || value === '-x') return 'x';
  if (value === '+y' || value === '-y') return 'y';
  if (value === '+z' || value === '-z') return 'z';
  return null;
}

/**
 * Selected axis buttons are filled with the triad color. Unselected buttons
 * keep that color as an outline and as the label.
 */
export function directionButtonStyle(axis, selected) {
  const fill = TRIAD_AXIS_COLORS[axis];
  if (fill == null) return null;
  const ink = selected ? contrastInk(fill) : fill;
  return {
    backgroundColor: selected ? cssHex(fill) : 'transparent',
    color: cssHex(ink),
    borderColor: cssHex(fill),
  };
}

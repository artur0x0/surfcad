/**
 * Viridis ramp for a wall-thickness heatmap (M1.3).
 *
 * Colours come from `viridis` in `src/fea/colormap.js`. This module does not
 * change that file and does not treat thickness as stress. The legend is
 * three stops: thin, nominal, thick. Nominal sits in the middle of the bar.
 * A thickness at the thin cut (nominal × thinRatio) is the purple end, nominal
 * is the middle, and the thick cut (nominal × thickRatio) is the yellow end.
 * Values past either cut stay on that end. A miss is grey.
 */

import { GREY, viridis } from '../fea/colormap.js';

function clamp01(value) {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function rgbCss(rgb) {
  const [r, g, b] = rgb.map((channel) => Math.round(clamp01(channel) * 255));
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * 0 at the thin cut, 0.5 at nominal, 1 at the thick cut. Null when the
 * sample or the nominal cannot be placed on the ramp.
 */
export function thicknessRampT(thickness, scale = {}) {
  if (thickness == null || thickness === '') return null;
  const nominal = Number(scale.nominal);
  const thinRatio = Number(scale.thinRatio);
  const thickRatio = Number(scale.thickRatio);
  const value = Number(thickness);
  if (!Number.isFinite(value) || !(nominal > 0) || !(thinRatio > 0) || !(thickRatio > thinRatio)) return null;
  const thin = nominal * thinRatio;
  const thick = nominal * thickRatio;
  if (value <= thin) return 0;
  if (value >= thick) return 1;
  if (value <= nominal) {
    const span = nominal - thin;
    if (!(span > 0)) return 0.5;
    return 0.5 * ((value - thin) / span);
  }
  const span = thick - nominal;
  if (!(span > 0)) return 0.5;
  return 0.5 + 0.5 * ((value - nominal) / span);
}

/** sRGB in 0..1. Non-finite thickness is grey. */
export function thicknessRgb(thickness, scale = {}) {
  const t = thicknessRampT(thickness, scale);
  if (t == null) return [GREY[0], GREY[1], GREY[2]];
  return viridis(t);
}

function roundMm(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

/**
 * Legend model for the heatmap chip. Null when the analysis has no nominal.
 * `css` is a left-to-right viridis gradient: thin, nominal, thick.
 */
export function thicknessLegendModel(wall) {
  const nominal = Number(wall?.nominal);
  const thinRatio = Number(wall?.thresholds?.thinRatio);
  const thickRatio = Number(wall?.thresholds?.thickRatio);
  if (!(nominal > 0) || !(thinRatio > 0) || !(thickRatio > thinRatio)) return null;
  const thinMm = nominal * thinRatio;
  const thickMm = nominal * thickRatio;
  const stops = [
    { t: 0, label: 'Thin', mm: roundMm(thinMm), rgb: viridis(0) },
    { t: 0.5, label: 'Nominal', mm: roundMm(nominal), rgb: viridis(0.5) },
    { t: 1, label: 'Thick', mm: roundMm(thickMm), rgb: viridis(1) },
  ];
  const css = `linear-gradient(90deg, ${stops.map((stop) => `${rgbCss(stop.rgb)} ${(stop.t * 100).toFixed(0)}%`).join(', ')})`;
  return {
    thinMm: stops[0].mm,
    nominalMm: stops[1].mm,
    thickMm: stops[2].mm,
    max: roundMm(wall.max),
    css,
    stops,
  };
}

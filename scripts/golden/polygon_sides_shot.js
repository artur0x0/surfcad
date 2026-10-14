/**
 * Polygon card at 3 to 8 sides. The select is the contour card's
 * polygonPreset control. Heptagon and octagon are drawn beside it.
 */
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import ContourModeChip from '../../src/components/ContourModeChip.jsx';
import { regularPolygonContours } from '../../src/utils/crossSectionSubstrate.js';
import { REGULAR_POLYGON_PRESETS, regularPolygonSides } from '../../src/utils/contourSolve.js';

const FIGURES = ['heptagon', 'octagon'];

export function renderPolygonSidesShot(el) {
  createRoot(el).render(React.createElement(Shot));
}

function figurePoints(preset) {
  const ring = regularPolygonContours(regularPolygonSides(preset), 70)[0];
  return ring.map((uv) => `${uv[0].toFixed(2)},${uv[1].toFixed(2)}`).join(' ');
}

function Shot() {
  const [preset, setPreset] = useState('hexagon');
  const [compact, setCompact] = useState(() => window.innerWidth < 700);

  useEffect(() => {
    window.__SET_PRESET__ = (next) => setPreset(next);
    window.__SET_COMPACT__ = (phone) => setCompact(!!phone);
    window.__POLYGON_PRESETS__ = { ...REGULAR_POLYGON_PRESETS };
    window.__READY__ = true;
  }, []);

  return React.createElement(
    'div',
    {
      'data-polygon-sides-shot': preset,
      className: 'viewport-shell relative h-screen w-full overflow-hidden bg-[#111827]',
      'data-mobile-stage': compact ? 'cad' : undefined,
      'data-harness-pane': '',
    },
    React.createElement(
      'div',
      {
        'data-polygon-figures': '',
        style: {
          display: 'flex',
          gap: 16,
          padding: 16,
          justifyContent: 'center',
        },
      },
      FIGURES.map((name) => React.createElement(
        'svg',
        {
          key: name,
          'data-polygon-figure': name,
          'data-sides': String(regularPolygonSides(name)),
          viewBox: '-90 -90 180 180',
          width: compact ? 140 : 180,
          height: compact ? 140 : 180,
        },
        React.createElement('polygon', {
          points: figurePoints(name),
          fill: 'none',
          stroke: '#22d3ee',
          strokeWidth: 3,
        }),
        React.createElement('text', {
          x: 0,
          y: 78,
          textAnchor: 'middle',
          fill: '#e2e8f0',
          fontSize: 12,
        }, name),
      )),
    ),
    React.createElement(ContourModeChip, {
      tool: 'polygon',
      entry: 'crossSection',
      params: { polygonPreset: preset, radius: 8 },
      planePreset: 'z',
      planeLabel: 'default +Z',
      compact,
      lengthMm: 40,
      onParamChange: (name, value) => {
        if (name === 'polygonPreset') setPreset(value);
      },
      onCancel: () => {},
      onConfirm: () => {},
    }),
  );
}

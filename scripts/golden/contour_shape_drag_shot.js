/**
 * Solver cases for a whole-shape drag. Free translates, fully locked stays,
 * and a fixed point plus a length slides the free point.
 */
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { dragContourShape } from '../../src/utils/contourDrag.js';
import { contourFromRectangle } from '../../src/utils/contourSolve.js';

export function renderContourShapeDragShot(el) {
  createRoot(el).render(React.createElement(Shot));
}

function quad() {
  return {
    points: [
      { id: 'p0', at: [0, 0] },
      { id: 'p1', at: [30, 0] },
      { id: 'p2', at: [30, 18] },
      { id: 'p3', at: [0, 18] },
    ],
    lines: [
      { id: 'e0', a: 'p0', b: 'p1' },
      { id: 'e1', a: 'p1', b: 'p2' },
      { id: 'e2', a: 'p2', b: 'p3' },
      { id: 'e3', a: 'p3', b: 'p0' },
    ],
    arcs: [],
    dimensions: [],
    constraints: [],
  };
}

function segment() {
  return {
    points: [
      { id: 'p0', at: [0, 0] },
      { id: 'p1', at: [28, 0] },
    ],
    lines: [{ id: 'e0', a: 'p0', b: 'p1' }],
    arcs: [],
    dimensions: [{ id: 'd0', kind: 'length', edge: 'e0', value: 28 }],
    constraints: [{ id: 'k0', kind: 'fix', items: ['p0'], at: { p0: [0, 0] } }],
  };
}

function ring(spec) {
  const at = Object.fromEntries((spec.points || []).map((point) => [point.id, point.at]));
  const lines = (spec.lines || []).filter((line) => line && !line.guide);
  if (!lines.length) return (spec.points || []).map((point) => point.at);
  const pts = lines.map((line) => at[line.a]);
  if (pts.length >= 3) pts.push(pts[0]);
  return pts;
}

function buildCases() {
  const freeSpec = quad();
  const free = dragContourShape(freeSpec, [36, 14]);
  const lockedSpec = contourFromRectangle(30, 18, true);
  const locked = dragContourShape(lockedSpec, [36, 14]);
  const partialSpec = segment();
  const partial = dragContourShape(partialSpec, [0, 16]);
  const p0 = partial.spec.points.find((point) => point.id === 'p0').at;
  const p1 = partial.spec.points.find((point) => point.id === 'p1').at;
  return {
    free: {
      moved: free.moved === true,
      from: ring(freeSpec),
      to: ring(free.spec),
    },
    locked: {
      moved: locked.moved === true,
      from: ring(lockedSpec),
      to: ring(locked.spec),
    },
    partial: {
      moved: partial.moved === true,
      from: ring(partialSpec),
      to: [p0, p1],
      p0Still: Math.hypot(p0[0], p0[1]) < 1e-3,
      gap: Math.hypot(p1[0] - p0[0], p1[1] - p0[1]),
    },
  };
}

function svgPoints(points, origin, scale) {
  return points.map((p) => `${origin[0] + p[0] * scale},${origin[1] - p[1] * scale}`).join(' ');
}

function Figure({ name, from, to, caption, compact }) {
  const scale = 2;
  const ox = 50;
  const oy = 160;
  return React.createElement(
    'svg',
    {
      'data-shape-figure': name,
      viewBox: '0 0 220 190',
      width: compact ? 108 : 220,
      height: compact ? 96 : 190,
    },
    React.createElement('polyline', {
      points: svgPoints(from, [ox, oy], scale),
      fill: 'none',
      stroke: '#64748b',
      strokeWidth: 2,
    }),
    React.createElement('polyline', {
      points: svgPoints(to, [ox, oy], scale),
      fill: 'none',
      stroke: '#22d3ee',
      strokeWidth: 3,
    }),
    React.createElement('text', {
      x: 110,
      y: 16,
      textAnchor: 'middle',
      fill: '#e2e8f0',
      fontSize: 13,
    }, caption),
  );
}

function Shot() {
  const [compact, setCompact] = useState(() => window.innerWidth < 700);
  const cases = buildCases();

  useEffect(() => {
    window.__SET_COMPACT__ = (phone) => setCompact(!!phone);
    window.__SHAPE_CASES__ = cases;
    window.__READY__ = true;
  }, [cases]);

  return React.createElement(
    'div',
    {
      'data-shape-drag-shot': '',
      className: 'viewport-shell relative h-screen w-full overflow-hidden bg-[#111827]',
      'data-mobile-stage': compact ? 'cad' : undefined,
      'data-harness-pane': '',
    },
    React.createElement(
      'div',
      {
        'data-shape-figures': '',
        style: {
          display: 'flex',
          flexWrap: 'wrap',
          gap: 8,
          padding: 12,
          justifyContent: 'center',
        },
      },
      React.createElement(Figure, {
        name: 'free',
        from: cases.free.from,
        to: cases.free.to,
        caption: 'Free',
        compact,
      }),
      React.createElement(Figure, {
        name: 'locked',
        from: cases.locked.from,
        to: cases.locked.to,
        caption: 'Locked',
        compact,
      }),
      React.createElement(Figure, {
        name: 'partial',
        from: cases.partial.from,
        to: cases.partial.to,
        caption: 'Partial',
        compact,
      }),
    ),
  );
}

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyDimensionFigure,
  dimensionAngle,
  dimensionEndpoints,
  dimensionLayout,
  dimensionMarkup,
  placementFromPointer,
} from './contourDimensionDraw.js';
import { contourFromRectangle, solveContour } from './contourSolve.js';
import { emitSolveContour, parseSolveContour } from './contourScript.js';
import { buildDimension, commitDimension, specFromSolved } from './contourGesture.js';
import { SKETCH_HIT_PX, pickContourScreen } from './contourPick.js';
import { sketchPointScaleFromDistance, SKETCH_POINT_PX, SKETCH_POINT_RADIUS } from './sketchLine.js';

const model = {
  points: [
    { id: 'p0', at: [0, 0] },
    { id: 'p1', at: [30, 0] },
    { id: 'p2', at: [10, 24] },
  ],
  lines: [
    { id: 'e0', a: 'p0', b: 'p1' },
    { id: 'e1', a: 'p1', b: 'p2' },
    { id: 'e2', a: 'p2', b: 'p0' },
  ],
  arcs: [{ id: 'a0', center: 'p0', radius: 8, full: true }],
};

function project(uv) {
  return { x: uv[0] * 4, y: uv[1] * -4 };
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

test('a length dimension offsets a double-headed arrow from the edge', () => {
  const ends = dimensionEndpoints(model, { kind: 'length', edge: 'e0' });
  assert.deepEqual(ends.a, [0, 0]);
  assert.deepEqual(ends.b, [30, 0]);
  const fig = dimensionLayout(model, { kind: 'length', edge: 'e0' }, project);
  assert.equal(fig.kind, 'length');
  assert.equal(fig.extensions.length, 2);
  assert.equal(fig.arrows.length, 2);
  assert.ok(fig.shaft);
  const span = dist(fig.shaft[0], fig.shaft[1]);
  assert.ok(Math.abs(span - 102) < 1, `shaft ${span}`);
  assert.ok(Math.abs(fig.label.x - (fig.shaft[0].x + fig.shaft[1].x) / 2) < 0.5);
  assert.ok(Math.abs(fig.label.y - (fig.shaft[0].y + fig.shaft[1].y) / 2) < 0.5);
  assert.ok(Math.abs(fig.label.y - project([0, 0]).y) > 16, 'the arrow leaves the edge');
  const tipOut = dist(fig.arrows[0].tip, fig.shaft[1]) > dist(fig.arrows[0].left, fig.shaft[1]);
  assert.equal(tipOut, true);
  const onExt = (tip, ext) => {
    const dx = ext.b.x - ext.a.x;
    const dy = ext.b.y - ext.a.y;
    const L2 = dx * dx + dy * dy;
    const t = ((tip.x - ext.a.x) * dx + (tip.y - ext.a.y) * dy) / L2;
    const px = ext.a.x + t * dx;
    const py = ext.a.y + t * dy;
    return { d: Math.hypot(tip.x - px, tip.y - py), t };
  };
  for (const arrow of fig.arrows) {
    const hits = fig.extensions.map((ext) => onExt(arrow.tip, ext));
    const best = hits.reduce((p, q) => (q.d < p.d ? q : p));
    assert.ok(best.d < 0.2, `tip off the extension by ${best.d}`);
    assert.ok(best.t > 0.05 && best.t < 0.98, `tip t ${best.t} does not sit on the extension with room past it`);
  }
  const baseGap = dist(fig.arrows[0].tip, fig.shaft[0]);
  assert.ok(baseGap > 6 && baseGap < 12, `shaft reaches the tip (${baseGap})`);
  const html = dimensionMarkup({ ...fig, id: 'd0' });
  assert.match(html, /data-contour-dim-kind="length"/);
  assert.match(html, /data-contour-dim-ext/);
  assert.match(html, /data-contour-dim-shaft/);
  assert.equal(html.match(/data-contour-dim-arrow/g).length, 2);
});

test('an offset dimension runs from the point to its foot on the line', () => {
  const ends = dimensionEndpoints(model, { kind: 'offset', point: 'p2', edge: 'e0' });
  assert.deepEqual(ends.a, [10, 24]);
  assert.ok(Math.abs(ends.b[0] - 10) < 1e-6 && Math.abs(ends.b[1]) < 1e-6);
  const fig = dimensionLayout(model, { kind: 'offset', point: 'p2', edge: 'e0' }, project);
  assert.equal(fig.arrows.length, 2);
  assert.equal(fig.extensions.length, 2);
});

test('a distance between two points uses those endpoints', () => {
  const ends = dimensionEndpoints(model, { kind: 'distance', a: 'p0', b: 'p2' });
  assert.deepEqual(ends.a, [0, 0]);
  assert.deepEqual(ends.b, [10, 24]);
});

test('a radius dimension connects the center to the rim', () => {
  const ends = dimensionEndpoints(model, { kind: 'radius', arc: 'a0' });
  assert.deepEqual(ends.a, [0, 0]);
  assert.ok(Math.hypot(ends.b[0] - 0, ends.b[1] - 0) - 8 < 1e-6);
  const fig = dimensionLayout(model, { kind: 'radius', arc: 'a0' }, project);
  assert.equal(fig.kind, 'radius');
  assert.equal(fig.arrows.length, 2);
});

test('an angle dimension is an arc with two arrowheads', () => {
  const dim = { kind: 'angle', a: 'e0', b: 'e2', value: 67, sense: 1 };
  const angle = dimensionAngle(model, dim);
  assert.ok(angle);
  assert.ok(Math.abs(angle.vertex[0]) < 1e-6 && Math.abs(angle.vertex[1]) < 1e-6);
  assert.ok(Math.abs(Math.abs(angle.sweep) * 180 / Math.PI - 67) < 2, String(angle.sweep));
  const fig = dimensionLayout(model, dim, project);
  assert.equal(fig.kind, 'angle');
  assert.equal(fig.shaft, null);
  assert.ok(fig.arc.length > 4);
  assert.equal(fig.arrows.length, 2);
  assert.equal(fig.extensions.length, 2);
  const arcEnd = fig.arc[0];
  const tipGap = Math.hypot(fig.arrows[0].tip.x - arcEnd.x, fig.arrows[0].tip.y - arcEnd.y);
  assert.ok(tipGap > 6, `arc runs through the arrowhead (${tipGap})`);
  const onExt = (tip, ext) => {
    const dx = ext.b.x - ext.a.x;
    const dy = ext.b.y - ext.a.y;
    const L2 = dx * dx + dy * dy;
    const t = ((tip.x - ext.a.x) * dx + (tip.y - ext.a.y) * dy) / L2;
    return Math.hypot(tip.x - (ext.a.x + t * dx), tip.y - (ext.a.y + t * dy));
  };
  const tipOn = Math.min(...fig.extensions.map((ext) => onExt(fig.arrows[0].tip, ext)));
  assert.ok(tipOn < 0.2, `angle tip off the extension by ${tipOn}`);
  const html = dimensionMarkup({ ...fig, id: 'd1' });
  assert.match(html, /data-contour-dim-arc/);
  assert.equal(html.match(/data-contour-dim-arrow/g).length, 2);
});

test('a sketch point keeps a constant screen diameter', () => {
  const fov = 45;
  const height = 800;
  for (const distance of [40, 180, 900]) {
    const scale = sketchPointScaleFromDistance(distance, fov, height, 1);
    const worldPerPx = (2 * Math.tan((fov * Math.PI / 180) / 2) * distance) / height;
    const diameterPx = (SKETCH_POINT_RADIUS * scale * 2) / worldPerPx;
    assert.ok(Math.abs(diameterPx - SKETCH_POINT_PX) < 0.05, `${distance} -> ${diameterPx}`);
  }
});

test('a line distance anchors on both taps, and the solve keeps them', () => {
  const rect = contourFromRectangle(40, 20, true);
  const picks = [
    { kind: 'line', id: 'e0', at: [-8, -10] },
    { kind: 'line', id: 'e2', at: [-8, 10] },
  ];
  const built = buildDimension(rect, picks, { kind: 'distance', valueMm: 20, side: 1 });
  assert.equal(built.ok, true);
  const solved = solveContour({
    ...rect,
    dimensions: [...rect.dimensions, built.dimension],
  });
  const dim = solved.dimensions.find((item) => item.kind === 'distance' && item.a === 'e0');
  assert.ok(dim?.anchors);
  assert.ok(Math.abs(dim.anchors[0][0] + 8) < 1e-6);
  const ends = dimensionEndpoints(solved, dim);
  assert.ok(Math.abs(ends.a[0] + 8) < 0.05, `first end ${ends.a} is the midpoint`);
  assert.ok(Math.abs(ends.a[1] + 10) < 0.05, `first end ${ends.a}`);
  assert.ok(Math.abs(ends.b[0] + 8) < 0.05, `second end ${ends.b}`);
  const roundTrip = parseSolveContour(emitSolveContour(specFromSolved(solved)));
  const again = roundTrip.dimensions.find((item) => item.id === dim.id);
  assert.ok(Math.abs(again.anchors[0][0] + 8) < 1e-6);
});

test('sketch entities hit inside 12px and miss outside it', () => {
  assert.equal(SKETCH_HIT_PX, 12);
  const sketch = {
    points: [
      { id: 'p0', at: [0, 0] },
      { id: 'p1', at: [80, 0] },
    ],
    lines: [{ id: 'e0', a: 'p0', b: 'p1' }],
    arcs: [],
  };
  const project = (uv) => ({ x: uv[0], y: uv[1] });
  const lineHit = pickContourScreen(sketch, project, 40, 11);
  assert.equal(lineHit?.kind, 'line');
  assert.equal(lineHit?.id, 'e0');
  assert.equal(pickContourScreen(sketch, project, 40, 13), null);
  const pointHit = pickContourScreen(sketch, project, 0, 11);
  assert.equal(pointHit?.kind, 'point');
  assert.equal(pointHit?.id, 'p0');
});

test('a stored placement shifts a length along the segment normal', () => {
  const edge = project([15, 0]);
  const fig = dimensionLayout(model, { kind: 'length', edge: 'e0', placement: 10 }, project);
  assert.ok(Math.abs(fig.label.x - edge.x) < 0.5, `label x ${fig.label.x}`);
  assert.ok(Math.abs(Math.abs(fig.label.y - edge.y) - 40) < 0.5, `shift ${fig.label.y - edge.y}`);
  const back = placementFromPointer(model, { kind: 'length', edge: 'e0' }, project, fig.label);
  assert.ok(Math.abs(back - 10) < 1e-6, `placement ${back}`);
  const html = dimensionMarkup({ ...fig, id: 'd0' });
  assert.match(html, /data-contour-dim-placement="10"/);
});

test('an angle placement is the arc radius', () => {
  const dim = { kind: 'angle', a: 'e0', b: 'e2', sense: 1, placement: 12 };
  const fig = dimensionLayout(model, dim, project);
  const vertex = project(dimensionAngle(model, dim).vertex);
  const d = dist(fig.label, vertex);
  assert.ok(Math.abs(d - 48) < 1, `label ${d}px from the vertex`);
  assert.equal(fig.arc != null, true);
});

test('placement survives emit, parse, and solve', () => {
  const rect = contourFromRectangle(40, 20, true);
  rect.dimensions = rect.dimensions.map((item) => (
    item.id === 'd0' ? { ...item, placement: -8.5 } : item
  ));
  const solved = solveContour(rect);
  const text = emitSolveContour(specFromSolved(solved));
  assert.match(text, /placement:\s*-8\.5/);
  const again = solveContour(parseSolveContour(text));
  const d0 = again.dimensions.find((item) => item.id === 'd0');
  assert.equal(d0.placement, -8.5);
});

test('editing a dimension keeps a dragged placement', () => {
  const rect = contourFromRectangle(40, 20, true);
  rect.dimensions = rect.dimensions.map((item) => (
    item.id === 'd0' ? { ...item, placement: 14 } : item
  ));
  const result = commitDimension({
    params: { contour: rect },
    picks: [{ kind: 'line', id: 'e0' }],
  }, { kind: 'length', valueMm: 40, id: 'd0' });
  assert.equal(result.error, null);
  const d0 = result.state.params.contour.dimensions.find((item) => item.id === 'd0');
  assert.equal(d0.placement, 14);
});

const XSS_DIM_ID = '"><img src=x onerror=alert(1)>';

function memorySvg() {
  const createElementNS = (_ns, name) => {
    const attrs = Object.create(null);
    const children = [];
    return {
      nodeName: name,
      children,
      setAttribute(key, value) { attrs[key] = String(value); },
      getAttribute(key) { return Object.prototype.hasOwnProperty.call(attrs, key) ? attrs[key] : null; },
      appendChild(node) { children.push(node); return node; },
      querySelectorAll(selector) {
        const want = String(selector).replace(/\[|\]/g, '').toLowerCase();
        const found = [];
        const walk = (node) => {
          if (!node) return;
          if (String(node.nodeName).toLowerCase() === want) found.push(node);
          if (node.getAttribute?.(want) != null) found.push(node);
          for (const child of node.children || []) walk(child);
        };
        walk(this);
        return found;
      },
    };
  };
  return { root: createElementNS('http://www.w3.org/2000/svg', 'svg'), createElementNS };
}

function collectNames(node, out = []) {
  if (node?.nodeName) out.push(String(node.nodeName).toLowerCase());
  for (const child of node?.children || []) collectNames(child, out);
  return out;
}

test('a hostile contour dimension id does not inject elements or attributes', () => {
  const fig = dimensionLayout(model, { kind: 'length', edge: 'e0' }, project);
  assert.ok(fig);
  const html = dimensionMarkup({ ...fig, id: XSS_DIM_ID });
  assert.equal(/<img\b/i.test(html), false, `innerHTML markup injected a tag: ${html}`);
  assert.equal(/<script\b/i.test(html), false);
  assert.match(html, /^<g\b/);
  assert.match(
    html,
    /data-contour-dim="&quot;&gt;&lt;img src=x onerror=alert\(1\)&gt;"/,
    'the id must stay one escaped attribute value',
  );
  const gTag = html.match(/^<g\b((?:[^>"']|"[^"]*"|'[^']*')*)>/);
  assert.ok(gTag, 'the group tag must close without breaking out of quotes');
  assert.equal(/\bonerror\s*=/i.test(gTag[1].replace(/="[^"]*"/g, '')), false, 'onerror must not become an attribute');
  assert.equal(/\ssrc\s*=/i.test(gTag[1].replace(/="[^"]*"/g, '')), false, 'src must not become an attribute');

  const { root, createElementNS } = memorySvg();
  applyDimensionFigure(root, { ...fig, id: XSS_DIM_ID }, { createElementNS });
  const names = collectNames(root);
  assert.ok(names.every((name) => ['svg', 'g', 'line', 'path', 'polygon'].includes(name)), `injected nodes: ${names}`);
  assert.equal(root.querySelectorAll('img').length, 0);
  const group = root.children[0];
  assert.equal(group.getAttribute('data-contour-dim'), XSS_DIM_ID);
  assert.equal(group.getAttribute('onerror'), null);
  assert.equal(group.getAttribute('src'), null);
});

#!/usr/bin/env node
/**
 * Failing parts show in the viewer: a part whose latest run failed gets a
 * red outline + glow on its solid (the last good mesh the viewport still
 * shows). Successful parts carry no overlay.
 *
 * Pure three.js checks of the overlay (red-400 edges, tint, back-face glow
 * rim, no raycast hits, rebuilt on new geometry, disposed when off), the
 * failed-id rule (same as the Parts feed's red row), and wiring checks that
 * App passes the ids on every placement and the viewport syncs them on the
 * extras and the pick mesh.
 */
import { readFileSync } from 'node:fs';
import {
  BoxGeometry,
  BufferGeometry,
  Mesh,
  MeshNormalMaterial,
  Raycaster,
  Vector3,
} from 'three';
import {
  FAILED_OUTLINE_NAME,
  FAILED_PART_RED,
  failedGlowScale,
  failedPartIdsFor,
  failedPartOutlineOf,
  setFailedPartOutline,
} from '../../src/utils/failedPartOutline.js';
import { feedRows } from '../../src/utils/assembly.js';

const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

let failed = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`);
  }
}

console.log('failed part outline — red outline + glow on a failing part in the viewer');

// ── Overlay ────────────────────────────────────────────────────────────
{
  check('red is Tailwind red-400 (strip border / error popup)', FAILED_PART_RED === 0xf87171);
  const mesh = new Mesh(new BoxGeometry(10, 10, 10), new MeshNormalMaterial());
  mesh.position.set(40, 0, 0);
  check('a good part has no overlay', failedPartOutlineOf(mesh) === null && mesh.children.length === 0);
  check('on: overlay added', setFailedPartOutline(mesh, true) === true);
  const outline = failedPartOutlineOf(mesh);
  const names = outline ? outline.children.map((c) => c.name).sort().join(',') : '';
  check('overlay = edges + tint + glow rim', names === 'failedPartEdges,failedPartGlow,failedPartTint', names);
  const edges = outline.children.find((c) => c.name === 'failedPartEdges');
  check('box outline is its 12 edges', edges.geometry.attributes.position.count === 24,
    String(edges.geometry.attributes.position.count));
  check('every overlay child is red-400',
    outline.children.every((c) => c.material.color.getHex() === FAILED_PART_RED));
  const glow = outline.children.find((c) => c.name === 'failedPartGlow');
  check('glow rim is the back faces, a few percent larger',
    glow.material.side === 1 && glow.scale.x > 1 && glow.scale.x <= 1.06);
  check('glow scale: ~0.6 mm, clamped 1–6 %',
    failedGlowScale(10) === 1.06 && failedGlowScale(1000) === 1.01 && Math.abs(failedGlowScale(30) - 1.02) < 1e-12);
  check('on again with the same geometry keeps the overlay', setFailedPartOutline(mesh, true) && failedPartOutlineOf(mesh) === outline);

  mesh.updateMatrixWorld(true);
  const ray = new Raycaster(new Vector3(40, 0, 50), new Vector3(0, 0, -1));
  const hits = ray.intersectObject(mesh, true);
  check('picks hit the solid only (overlay does not raycast)',
    hits.length > 0 && hits.every((h) => h.object === mesh), hits.map((h) => h.object.name || 'solid').join(','));

  let disposed = 0;
  edges.geometry.addEventListener('dispose', () => { disposed++; });
  const shared = mesh.geometry;
  let sharedDisposed = 0;
  shared.addEventListener('dispose', () => { sharedDisposed++; });
  mesh.geometry = new BoxGeometry(4, 4, 4);
  setFailedPartOutline(mesh, true);
  const rebuilt = failedPartOutlineOf(mesh);
  check('new solid geometry rebuilds the overlay', rebuilt && rebuilt !== outline
    && rebuilt.children.find((c) => c.name === 'failedPartTint').geometry === mesh.geometry && disposed === 1);
  check('the solid geometry itself is never disposed by the overlay', sharedDisposed === 0);
  check('off: overlay removed', setFailedPartOutline(mesh, false) === false && failedPartOutlineOf(mesh) === null
    && mesh.children.length === 0);
  const empty = new Mesh(new BufferGeometry(), new MeshNormalMaterial());
  check('an empty (omitted) solid gets no overlay', setFailedPartOutline(empty, true) === false && empty.children.length === 0);
  check('overlay name is stable', FAILED_OUTLINE_NAME === 'failedPartOutline');
}

// ── Which parts ────────────────────────────────────────────────────────
{
  const doc = { parts: [
    { id: 'a', visible: true }, { id: 'b', visible: true }, { id: 'h', visible: false },
    { id: 'e', visible: true }, { id: 'm', visible: true }, { id: 's', visible: true },
  ] };
  const runs = {
    a: { ok: true, mesh: {} },
    b: { ok: false, error: 'boom' },
    h: { ok: false, error: 'boom' },
    e: { ok: false, empty: true },
    m: { ok: false, missing: true },
    s: { ok: false, skipped: true },
  };
  const ids = failedPartIdsFor(doc, runs);
  check('failed = visible parts whose latest run failed (not blank, missing, skipped)', ids.join(',') === 'b', ids.join(','));
  const rows = feedRows(doc, runs, { a: 'x', b: 'x', h: 'x', e: 'x', s: 'x' });
  const feedRed = rows.filter((r) => r.error && r.visible !== false).map((r) => r.id);
  check('same parts as the Parts feed red rows (visible)', feedRed.join(',') === 'b', feedRed.join(','));
}

// ── Wiring ─────────────────────────────────────────────────────────────
{
  const vp = read('src/components/Viewport.jsx');
  const app = read('src/App.jsx');
  // Refresh, group remove, and part delete pass failedPartIdsFor. Showing
  // an empty assembly passes [] so the previous outlines do not stick.
  const placements = [...app.matchAll(/placeAssembly\?\.\(\{([\s\S]*?)\n\s*\}\);/g)].map((m) => m[1]);
  const withIds = placements.filter((block) => /failedIds: failedPartIdsFor\(/.test(block)).length;
  const withEmpty = placements.filter((block) => /failedIds: \[\]/.test(block)).length;
  check('App passes failedIds on every placement',
    placements.length >= 4 && withIds >= 3 && withEmpty >= 1 && withIds + withEmpty === placements.length,
    `placements=${placements.length} failedPartIdsFor=${withIds} empty=${withEmpty}`);
  check('placement stores the failed ids (leftovers as fallback) and syncs',
    /failedPartIdsRef\.current = new Set\(/.test(vp) && /payload\.leftovers\.map\(\(solid\) => solid\?\.id\)/.test(vp)
    && /syncFailedPartOutlinesRef\.current\(\);\n(?:\s+group\.updateMatrixWorld\(true\);\n)?\s+if \(containerRef\.current\)/.test(vp));
  check('sync covers every extra and the pick mesh',
    /for \(const \[id, mesh\] of assemblyExtrasRef\.current\) \{\n\s+setFailedPartOutline\(mesh, failed\.has\(String\(id\)\)\);/.test(vp)
    && /setFailedPartOutline\(\s*resultRef\.current,/.test(vp));
  check('new geometry and part switches re-sync',
    /syncFailedPartOutlinesRef\.current\(\);\n\s+resultRef\.current\.updateMatrixWorld/.test(vp)
    && /New solid geometry: rebuild \(or drop\) the failed outline on it\.\n\s+syncFailedPartOutlinesRef\.current\(\);/.test(vp));
  check('removed extras drop their overlay', (vp.match(/setFailedPartOutline\((mesh|extra), false\)/g) || []).length === 2);
  check('a solo run that restores the last good mesh is outlined; a good run clears it',
    /soloRunFailedRef\.current = !!prev\?\.vertProperties;/.test(vp) && /soloRunFailedRef\.current = false;\n\s+syncFailedPartOutlinesRef/.test(vp));
  check('a recovered extra is not a leftover any more', /mesh\.userData\.leftover = false;/.test(vp));
  check('architecture.md documents the failed outline', /setFailedPartOutline/.test(read('docs/architecture.md')));
}

if (failed) {
  console.log(`\nfailed part outline: ${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nfailed part outline: all checks passed');
process.exit(0);

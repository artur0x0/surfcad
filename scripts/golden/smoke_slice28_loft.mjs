#!/usr/bin/env node
/**
 * Slice 28 — Loft solid (multi-profile, same workplane + offsets).
 * - Loft enters contour mode (Slice 24 shell)
 * - multi-profile list (min 2); each profile = makeCrossSection on offset plane
 * - live solid preview payload as profiles / offsets change
 * - Confirm composes profiles + makeLoft + placeInFrame replace; Auto-Run
 * - 2-profile Confirm keeps distinct stations (script + solid ends)
 * - 3-profile middle station stays on the loft path (continuous, not an island)
 * - second Confirm replaces the same marked block (no duplicate stack)
 * - Back / strip = no orphan loft
 * - Extrude / Revolve stay frame-only; Profile Confirm profile-only; Fillet (#34)
 * - loud fail on <2 profiles or coincident offsets
 */
import Module from '../../built/manifold.js';
import {
  composeHelperInsert,
  isolateLoftStationParams,
  HELPER_PALETTE_ITEMS,
  CONTOUR_LOFT_BEGIN,
  CONTOUR_LOFT_END,
  CONTOUR_EXTRUDE_BEGIN,
} from '../../src/utils/helperPaletteSnippets.js';
import {
  resolveFaceModal,
} from '../../src/utils/faceFeaturePlacement.js';
import {
  pickFilletStrategy,
  resolveFilletStrategy,
} from '../../src/utils/filletAlongPath.js';
import { isFilletEntry } from '../../src/utils/filletMode.js';
import {
  assembleLoftStations,
  buildMakeLoftSolid,
  offsetPlaneFrame,
  rotateContour,
  resolveLoftExtrudeSegs,
  MAKE_LOFT_EXTRUDE_SEGS,
  MAKE_LOFT_EXTRUDE_SEGS_CAP_K,
  MAKE_LOFT_COINCIDENT_EPS,
} from '../../src/utils/makeLoft.js';
import {
  isContourEntry,
  isExtrudeEntry,
  isRevolveEntry,
  isLoftEntry,
  enterContourState,
  defaultLoftProfiles,
  defaultExtrudeParams,
  defaultRevolveParams,
  addLoftProfile,
  removeLoftProfile,
  selectLoftProfile,
  setLoftProfileOffset,
  writeLoftSelected,
  switchContourTool,
  validateLoftProfiles,
  buildLoftSolidPreview,
  composeContourLoft,
  composeContourExtrude,
  composeContourRevolve,
  composeContourCommit,
  stripContourLoftBlock,
  hasContourLoftBlock,
  hasContourExtrudeBlock,
  hasContourRevolveBlock,
  hasContourProfileBlock,
  contourLoftOwnedRegion,
  countMakeCrossSection,
  countMakeExtrude,
  countMakeRevolve,
  countMakeLoft,
  planeFromContourFace,
  resolveContourWorkplane,
} from '../../src/utils/contourMode.js';

let failed = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`);
  }
}

console.log('slice-28 loft multi-profile smoke');

const planarFace = {
  center: [0, 0, 10],
  normal: [0, 0, 1],
  area: 1200,
  triangleCount: 2,
  selectionMode: 'coplanar',
};

const starter = 'let part = Manifold.cube([40, 30, 20], true);\nreturn part;\n';

function rFace() {
  return resolveContourWorkplane(planarFace).face;
}

function circlePts(r, n = 32) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    pts.push([r * Math.cos(t), r * Math.sin(t)]);
  }
  return pts;
}

function squarePts(side) {
  const h = side / 2;
  return [[-h, -h], [h, -h], [h, h], [-h, h]];
}

function rectPts(w, h) {
  return [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]];
}

/** Diamond with the given diagonal length; start at +Y so a start-vertex
 *  / angle-index mismatch is visible (axis-start diamonds can pass by luck). */
function diamondPts(diag) {
  const h = diag / 2;
  return [[0, h], [-h, 0], [0, -h], [h, 0]];
}

function contourArea(cs) {
  const polys = typeof cs?.toPolygons === 'function' ? cs.toPolygons() : [];
  let a = 0;
  for (const p of polys) {
    let s = 0;
    for (let i = 0; i < p.length; i++) {
      const x0 = p[i][0];
      const y0 = p[i][1];
      const x1 = p[(i + 1) % p.length][0];
      const y1 = p[(i + 1) % p.length][1];
      s += x0 * y1 - x1 * y0;
    }
    a += s / 2;
  }
  return Math.abs(a);
}

function xyExtent(cs) {
  const b = cs.bounds();
  return {
    x: b.max[0] - b.min[0],
    y: b.max[1] - b.min[1],
  };
}

// ── Entry / defaults ───────────────────────────────────────────
{
  check('Loft is contour entry', isContourEntry('makeLoft'));
  check('isLoftEntry makeLoft', isLoftEntry('makeLoft'));
  check('isLoftEntry refuses Profile', !isLoftEntry('crossSection'));
  check('isLoftEntry refuses Extrude', !isLoftEntry('makeExtrude'));
  check('isLoftEntry refuses Revolve', !isLoftEntry('makeRevolve'));
  check('isExtrudeEntry still Extrude-only', isExtrudeEntry('makeExtrude') && !isExtrudeEntry('makeLoft'));
  check('isRevolveEntry still Revolve-only', isRevolveEntry('makeRevolve') && !isRevolveEntry('makeLoft'));
  check('Fillet is still not a contour entry', !isContourEntry('filletEdges') && isFilletEntry('filletEdges'));
  check('legacy loft() name is not the palette entry', !isContourEntry('loft'));

  const st = enterContourState('makeLoft', planarFace);
  check('enter Loft keeps entry', st.entry === 'makeLoft');
  check('enter Loft seeds 2 profiles', st.loft && st.loft.profiles.length === 2);
  check('enter Loft selected P1', st.loft.selected === 0);
  check('enter Loft P1 circle r=5 @ 0',
    st.loft.profiles[0].tool === 'circle'
    && st.loft.profiles[0].params.radius === 5
    && st.loft.profiles[0].offset === 0);
  check('enter Loft P2 circle r=8 @ 20',
    st.loft.profiles[1].tool === 'circle'
    && st.loft.profiles[1].params.radius === 8
    && st.loft.profiles[1].offset === 20);
  check('enter Loft still seeds Extrude defaults (unchanged)',
    st.extrude && st.extrude.distance === 10 && st.extrude.direction === 'normal');
  check('enter Loft still seeds Revolve defaults (unchanged)',
    st.revolve && st.revolve.angle === 360 && st.revolve.axis === 'v');

  const defs = defaultLoftProfiles();
  check('defaultLoftProfiles min 2', defs.length === 2);
  const ext = defaultExtrudeParams();
  const rev = defaultRevolveParams();
  check('defaultExtrudeParams unchanged', ext.distance === 10 && ext.sense === 'positive');
  check('defaultRevolveParams unchanged', rev.angle === 360 && rev.axis === 'v');
}

// ── Multi-profile list ─────────────────────────────────────────
{
  let st = enterContourState('makeLoft', planarFace);
  st = addLoftProfile(st);
  check('add profile → 3 stations', st.loft.profiles.length === 3);
  check('add profile selects the new one', st.loft.selected === 2);
  check('add profile offset = last+20', st.loft.profiles[2].offset === 40);

  st = switchContourTool(st, 'rectangle');
  check('switch tool writes through to selected loft profile',
    st.tool === 'rectangle' && st.loft.profiles[2].tool === 'rectangle');

  st = writeLoftSelected(st, { params: { width: 16, height: 10, centered: true } });
  check('param write-through', st.loft.profiles[2].params.width === 16);

  st = selectLoftProfile(st, 0);
  check('select P1 restores circle', st.tool === 'circle' && st.params.radius === 5);

  st = setLoftProfileOffset(st, 5);
  check('offset write-through', st.loft.profiles[0].offset === 5);

  const before = st.loft.profiles.length;
  st = removeLoftProfile(st, 2);
  check('remove extra profile', st.loft.profiles.length === before - 1);

  const two = enterContourState('makeLoft', planarFace);
  const refused = removeLoftProfile(two, 1);
  check('cannot drop below 2 profiles', refused.loft.profiles.length === 2);
}

// ── Params / loud fail ─────────────────────────────────────────
{
  const ok = validateLoftProfiles(defaultLoftProfiles());
  check('default profiles valid', ok.ok && ok.normalized.length === 2);

  const one = validateLoftProfiles([defaultLoftProfiles()[0]]);
  check('<2 profiles loud fail', !one.ok && /at least 2/i.test(one.message || ''));

  const none = validateLoftProfiles([]);
  check('empty list loud fail', !none.ok && /at least 2/i.test(none.message || ''));

  const sameOff = validateLoftProfiles([
    { tool: 'circle', params: { radius: 5, segments: 16 }, offset: 10 },
    { tool: 'circle', params: { radius: 8, segments: 16 }, offset: 10 },
  ]);
  check('coincident offset loud fail', !sameOff.ok && /offset/i.test(sameOff.message || ''));

  const badR = validateLoftProfiles([
    { tool: 'circle', params: { radius: -2, segments: 16 }, offset: 0 },
    { tool: 'circle', params: { radius: 8, segments: 16 }, offset: 20 },
  ]);
  check('bad profile radius loud fail', !badR.ok && /radius/i.test(badR.message || ''));
}

// ── Plane model: same workplane + offsets ──────────────────────
{
  const plane = planeFromContourFace(rFace());
  const off = offsetPlaneFrame(plane, 20);
  check('offset plane keeps normal', Math.abs(off.normal[2] - 1) < 1e-9);
  check('offset plane center +20 along n',
    Math.abs(off.center[2] - (plane.center[2] + 20)) < 1e-9);
  check('offset plane keeps x/y',
    Math.abs(off.x[0] - 1) < 1e-9 && Math.abs(off.y[1] - 1) < 1e-9);

  const xs0 = {
    plane,
    contours: [circlePts(5)],
  };
  const xs1 = {
    plane: offsetPlaneFrame(plane, 20),
    contours: [circlePts(8)],
  };
  const assembled = assembleLoftStations([xs0, xs1]);
  check('assemble 2 stations', assembled.ok && assembled.stations.length === 2);
  check('stations ordered by offset',
    assembled.ok && assembled.stations[0].offset < assembled.stations[1].offset);

  const skew = assembleLoftStations([
    xs0,
    { plane: { center: [0, 0, 10], normal: [1, 0, 0], x: [0, 1, 0], y: [0, 0, 1] }, contours: [circlePts(8)] },
  ]);
  check(
    'perpendicular planes on the same center loud-fail (zero-length loft)',
    !skew.ok && /zero-length|on top of each other/i.test(skew.message || ''),
    skew.ok ? 'ok=true' : (skew.message || ''),
  );
}

// ── Live solid preview ─────────────────────────────────────────
{
  const prev = buildLoftSolidPreview(rFace(), defaultLoftProfiles());
  check('solid preview has 2 stations', prev && prev.stations.length === 2);
  check('solid preview first offset 0', prev && prev.stations[0].offset === 0);
  check('solid preview second offset 20', prev && prev.stations[1].offset === 20);
  check('solid preview rings resampled', prev && prev.stations[0].ring.length >= 8);

  const three = [
    ...defaultLoftProfiles(),
    { id: 'p2', tool: 'rectangle', params: { width: 12, height: 8, centered: true }, offset: 40 },
  ];
  const p3 = buildLoftSolidPreview(rFace(), three);
  check('solid preview 3 stations', p3 && p3.stations.length === 3);

  const bad = buildLoftSolidPreview(rFace(), [defaultLoftProfiles()[0]]);
  check('solid preview refuses <2', bad == null);

  const coincident = buildLoftSolidPreview(rFace(), [
    { tool: 'circle', params: { radius: 5, segments: 16 }, offset: 0 },
    { tool: 'circle', params: { radius: 8, segments: 16 }, offset: 0 },
  ]);
  check('solid preview refuses coincident offset', coincident == null);

  // Regression: circle↔square preview rungs used to pair arc-length index i on
  // each station, so ring[0] sat at 0° on the circle and 225° on the square —
  // an hourglass preview over a part that accepted correctly. Rings are polar
  // now: ring[i] must be at the same angle on every station.
  const cs = buildLoftSolidPreview(rFace(), [
    { tool: 'circle', params: { radius: 8, segments: 32 }, offset: 0 },
    { tool: 'rectangle', params: { width: 20, height: 20, centered: true }, offset: 20 },
  ]);
  const degOf = (q) => {
    const a = Math.atan2(q[1], q[0]) * 180 / Math.PI;
    return a < 0 ? a + 360 : a;
  };
  let maxTwist = 0;
  if (cs) {
    const [A, B] = [cs.stations[0].ring, cs.stations[1].ring];
    check('circle↔square preview rings are index-aligned', A.length === B.length);
    for (let i = 0; i < Math.min(A.length, B.length); i++) {
      let d = Math.abs(degOf(A[i]) - degOf(B[i]));
      if (d > 180) d = 360 - d;
      maxTwist = Math.max(maxTwist, d);
    }
  }
  check(
    'circle↔square preview rungs are not twisted (same polar angle per rung)',
    cs != null && maxTwist < 0.5,
    `max rung twist ${maxTwist.toFixed(1)}°`,
  );
  const corners = [[10, 10], [-10, 10], [-10, -10], [10, -10]];
  check(
    'square preview ring keeps exact corners',
    cs != null && corners.every((c) =>
      cs.stations[1].ring.some((q) => Math.hypot(q[0] - c[0], q[1] - c[1]) < 1e-6)),
  );
  check(
    'square preview ring points all lie on the profile boundary',
    cs != null && cs.stations[1].ring.every(
      (q) => Math.abs(Math.max(Math.abs(q[0]), Math.abs(q[1])) - 10) < 1e-6),
  );
}

// ── Compose Loft ───────────────────────────────────────────────
{
  const face = rFace();
  const first = composeContourLoft(starter, {
    face,
    loft: { profiles: defaultLoftProfiles(), selected: 0 },
  });
  check('compose ok', first.ok && typeof first.buffer === 'string');
  check('compose wants Auto-Run', first.run === true);
  check('has makeCrossSection', /makeCrossSection\s*\(/.test(first.buffer));
  check('has two makeCrossSection', countMakeCrossSection(first.buffer) === 2);
  check('has profileCircle', /profileCircle\s*\(/.test(first.buffer));
  check('2-profile script keeps distinct radii (5 and 8)',
    /profileCircle\s*\(\s*5\s*,/.test(first.buffer)
    && /profileCircle\s*\(\s*8\s*,/.test(first.buffer));
  check('has makeLoft', /makeLoft\s*\(/.test(first.buffer));
  check('has placeInFrame', /placeInFrame\s*\(/.test(first.buffer));
  check('unions onto existing part',
    /Manifold\.cube\(/.test(first.buffer)
    && /part\s*=\s*part\.add\(\s*placeInFrame\s*\(/.test(first.buffer)
    && !/placeOnFace\s*\(/.test(first.buffer));
  check('no placeOnFace', !/placeOnFace\s*\(/.test(first.buffer));
  check('has loft markers', hasContourLoftBlock(first.buffer));
  check('markers wrap solid', first.buffer.includes(CONTOUR_LOFT_BEGIN) && first.buffer.includes(CONTOUR_LOFT_END));
  check('one makeLoft', countMakeLoft(first.buffer) === 1);
  check('no makeExtrude', countMakeExtrude(first.buffer) === 0);
  check('no makeRevolve', countMakeRevolve(first.buffer) === 0);
  check('no legacy loft(', !/\bloft\s*\(/.test(first.buffer));
  check('still returns part', /return\s+part\s*;/.test(first.buffer));
  check('no illegal bare top', !/\btop\b/.test(first.buffer.replace(/topFace/g, 'FACE')));
  check('emits offsetPlaneFrame for P2', /offsetPlaneFrame\s*\([^,]+,\s*20\)/.test(first.buffer));
  check('emits a literal PlaneFrame',
    /center:\s*\[0,\s*0,\s*10\]/.test(first.buffer)
    && /normal:\s*\[0,\s*0,\s*1\]/.test(first.buffer));

  const owned = contourLoftOwnedRegion(first.buffer);
  check('owned region has profiles + solid + placeInFrame',
    /makeCrossSection/.test(owned) && /makeLoft/.test(owned) && /placeInFrame/.test(owned));

  const second = composeContourLoft(first.buffer, {
    face,
    loft: {
      profiles: [
        { tool: 'rectangle', params: { width: 16, height: 10, centered: true }, offset: 0 },
        { tool: 'circle', params: { radius: 6, segments: 32 }, offset: 25 },
      ],
      selected: 0,
    },
  });
  check('update ok', second.ok);
  check('update still two makeCrossSection', countMakeCrossSection(second.buffer) === 2);
  check('update still one makeLoft', countMakeLoft(second.buffer) === 1);
  check('update uses profileRectangle', /profileRectangle\s*\(/.test(second.buffer));
  check('update keeps distinct stations (rect + circle 6)',
    /profileRectangle\s*\(/.test(second.buffer) && /profileCircle\s*\(\s*6\s*,/.test(second.buffer));
  check('update keeps one return', (second.buffer.match(/\breturn\s+part\s*;/g) || []).length === 1);
  check('update still one loft block', (second.buffer.match(/contour-mode loft begin/g) || []).length === 1);

  const three = composeContourLoft(starter, {
    face,
    loft: {
      profiles: [
        ...defaultLoftProfiles(),
        { tool: 'polygon', params: { polygonPreset: 'hexagon', radius: 7 }, offset: 40 },
      ],
    },
  });
  check('3-profile compose ok', three.ok && countMakeCrossSection(three.buffer) === 3);
  check('3-profile one makeLoft', countMakeLoft(three.buffer) === 1);
  check('3-profile has polygon', /profilePolygon/.test(three.buffer));
  check('3-profile keeps P1/P2 distinct + middle polygon',
    /profileCircle\s*\(\s*5\s*,/.test(three.buffer)
    && /profileCircle\s*\(\s*8\s*,/.test(three.buffer)
    && /profilePolygon/.test(three.buffer));

  {
    let st = enterContourState('makeLoft', planarFace);
    st = selectLoftProfile(st, 1);
    st = writeLoftSelected(st, { params: { radius: 12, segments: 32 } });
    const edited = composeContourLoft(starter, {
      face,
      loft: st.loft,
      tool: st.tool,
      params: st.params,
    });
    check('chip-flush Confirm keeps P2 radius 12 (does not collapse to P1)',
      edited.ok
      && /profileCircle\s*\(\s*5\s*,/.test(edited.buffer)
      && /profileCircle\s*\(\s*12\s*,/.test(edited.buffer));

    const clobber = composeContourLoft(starter, {
      face,
      loft: { profiles: defaultLoftProfiles(), selected: 0 },
      tool: 'circle',
      params: { radius: 99, segments: 32 },
    });
    check('selected-chip flush does not rewrite sibling station',
      clobber.ok
      && (clobber.buffer.match(/profileCircle\s*\(\s*99\s*,/g) || []).length === 1
      && (clobber.buffer.match(/profileCircle\s*\(\s*8\s*,/g) || []).length === 1);
  }

  // Isolation lives in helperPaletteSnippets (emit), not composeContourLoft.
  // Parent mergeParams defaults / station-0 chip used to rewrite every
  // profileCircle. Forcing isolateLoftStationParams from `p` / profiles[0]
  // must turn this RED.
  {
    const isolated = isolateLoftStationParams({
      profileType: 'circle',
      radius: 8,
      segments: 32,
    });
    check(
      'isolateLoftStationParams keeps station radius (not parent default)',
      isolated.radius === 8 && isolated.profileType === 'circle',
      JSON.stringify(isolated),
    );
    const bleed = composeHelperInsert(starter, 'crossSection', null, {
      radius: 99,
      segments: 16,
      profileType: 'circle',
      _contourLoft: {
        plane: { center: [0, 0, 0], normal: [0, 0, 1], x: [1, 0, 0], y: [0, 1, 0] },
        profiles: [
          { profileType: 'circle', radius: 5, segments: 32, offset: 0 },
          { profileType: 'circle', radius: 8, segments: 32, offset: 20 },
        ],
      },
    }, null, null);
    check(
      'composeHelperInsert isolates per-station radii (station-0 bleed does not rewrite P2)',
      typeof bleed === 'string'
      && /profileCircle\s*\(\s*5\s*,/.test(bleed)
      && /profileCircle\s*\(\s*8\s*,/.test(bleed)
      && !/profileCircle\s*\(\s*99\s*,/.test(bleed),
      typeof bleed === 'string' ? bleed.match(/profileCircle\s*\([^)]+\)/g)?.join(' ') : String(bleed),
    );
  }

  const defPlane = composeContourLoft(starter, {
    face: null,
    loft: { profiles: defaultLoftProfiles() },
  });
  check('default +Z compose ok', defPlane.ok && /placeInFrame\s*\(/.test(defPlane.buffer));
  check('default +Z uses a literal frame (no host facesByNormal)',
    !/facesByNormal\s*\(\s*part\s*,/.test(defPlane.buffer)
    && /normal:\s*\[0,\s*0,\s*1\]/.test(defPlane.buffer));

  const empty = composeContourLoft('', {
    face,
    loft: { profiles: defaultLoftProfiles() },
  });
  check('empty-buffer compose ok + Auto-Run', empty.ok && empty.run === true);
  check('empty-buffer has no host box',
    !/Manifold\.cube\s*\(/.test(empty.buffer) && !/part\s*=\s*part\.add\(/.test(empty.buffer));
  check('empty-buffer part is placeInFrame (replace)',
    /let\s+part\s*=\s*placeInFrame\s*\(/.test(empty.buffer));

  const refuseN = composeContourLoft(starter, {
    face,
    loft: { profiles: [defaultLoftProfiles()[0]] },
  });
  check('compose refuses <2 profiles', !refuseN.ok && /at least 2/i.test(refuseN.message || ''));

  const refuseOff = composeContourLoft(starter, {
    face,
    loft: {
      profiles: [
        { tool: 'circle', params: { radius: 5, segments: 16 }, offset: 0 },
        { tool: 'circle', params: { radius: 8, segments: 16 }, offset: 0 },
      ],
    },
  });
  check('compose refuses coincident offset', !refuseOff.ok && /offset/i.test(refuseOff.message || ''));

  {
    const item = HELPER_PALETTE_ITEMS.find((h) => h.id === 'crossSection');
    const origBuild = item.build;
    const loftArgs = { face, loft: { profiles: defaultLoftProfiles() } };
    const guardCases = [
      {
        name: 'unbalanced loft markers',
        msg: 'unbalanced loft markers',
        buffer: `${starter}${CONTOUR_LOFT_BEGIN}\n`,
      },
      {
        name: 'makeCrossSection missing',
        msg: 'makeCrossSection missing',
        buffer: starter,
        patch() {
          item.build = () => (
            `${CONTOUR_LOFT_BEGIN}\n`
            + 'let part = placeInFrame({center:[0,0,0],normal:[0,0,1],x:[1,0,0],y:[0,1,0]}, makeLoft([]));\n'
            + `${CONTOUR_LOFT_END}\n`
          );
        },
      },
      {
        name: 'need at least 2 makeCrossSection',
        msg: 'need at least 2 makeCrossSection',
        buffer: starter,
        patch() {
          item.build = () => (
            `${CONTOUR_LOFT_BEGIN}\n`
            + 'const xs0 = makeCrossSection(fr, profileCircle(5));\n'
            + 'let part = placeInFrame(fr, makeLoft([xs0]));\n'
            + `${CONTOUR_LOFT_END}\n`
          );
        },
      },
      {
        name: 'Could not compose Loft',
        msg: 'Could not compose Loft',
        buffer: starter,
        patch() { item.build = () => null; },
      },
    ];
    for (const c of guardCases) {
      try {
        if (c.patch) c.patch();
        const r = composeContourLoft(c.buffer, loftArgs);
        check(
          `compose guard: ${c.name}`,
          !r.ok && new RegExp(c.msg, 'i').test(r.message || ''),
          r.ok ? 'ok=true' : (r.message || ''),
        );
      } finally {
        item.build = origBuild;
      }
    }
  }

  const stripped = stripContourLoftBlock(first.buffer);
  check('strip removes loft markers', !hasContourLoftBlock(stripped));
  check('strip removes makeLoft', countMakeLoft(stripped) === 0);
  check('strip removes makeCrossSection', countMakeCrossSection(stripped) === 0);
  check('strip keeps part', /Manifold\.cube/.test(stripped));
  check('Back-equivalent has no orphan Loft', countMakeLoft(stripped) === 0);
}

// ── Commit router: Loft vs Profile / Extrude / Revolve ─────────
{
  const face = rFace();
  const lofted = composeContourCommit(starter, {
    entry: 'makeLoft',
    face,
    loft: { profiles: defaultLoftProfiles() },
  });
  check('commit Loft emits solid', lofted.ok && lofted.run && countMakeLoft(lofted.buffer) === 1);

  const prof = composeContourCommit(starter, {
    entry: 'crossSection',
    face,
    tool: 'circle',
    params: { radius: 5, segments: 32 },
  });
  check('commit Profile is Profile-only', prof.ok && prof.run === false && countMakeLoft(prof.buffer) === 0);
  check('commit Profile is a named contour', /@contour id=c1/.test(prof.buffer) && !hasContourProfileBlock(prof.buffer));
  check('commit Profile has no Extrude', countMakeExtrude(prof.buffer) === 0);

  const ext = composeContourCommit(starter, {
    entry: 'makeExtrude',
    face,
    tool: 'circle',
    params: { radius: 5, segments: 32 },
    extrude: { distance: 10, direction: 'normal', sense: 'positive' },
  });
  check('commit Extrude unchanged (solid + Auto-Run)', ext.ok && ext.run && countMakeExtrude(ext.buffer) === 1);
  check('commit Extrude has no Loft', countMakeLoft(ext.buffer) === 0);
  check('commit Extrude still has extrude markers', hasContourExtrudeBlock(ext.buffer));
  check('commit Extrude unions onto the cube',
    /placeInFrame\s*\(/.test(ext.buffer)
    && /part\s*=\s*part\.add\(\s*placeInFrame\s*\(/.test(ext.buffer)
    && /Manifold\.cube\(/.test(ext.buffer)
    && !/placeOnFace\s*\(/.test(ext.buffer));

  const rev = composeContourCommit(starter, {
    entry: 'makeRevolve',
    face,
    tool: 'circle',
    params: { radius: 5, segments: 32 },
    revolve: { angle: 360, axis: 'v', sense: 'positive' },
  });
  check('commit Revolve unchanged (solid + Auto-Run)', rev.ok && rev.run && countMakeRevolve(rev.buffer) === 1);
  check('commit Revolve has no Loft', countMakeLoft(rev.buffer) === 0);
  check('commit Revolve still has revolve markers', hasContourRevolveBlock(rev.buffer));
  check('commit Revolve unions onto the cube',
    /placeInFrame\s*\(/.test(rev.buffer)
    && /part\s*=\s*part\.add\(\s*placeInFrame\s*\(/.test(rev.buffer)
    && /Manifold\.cube\(/.test(rev.buffer)
    && !/placeOnFace\s*\(/.test(rev.buffer));

  const thenLoft = composeContourLoft(prof.buffer, {
    face,
    loft: { profiles: defaultLoftProfiles() },
  });
  check('Loft after Profile leaves the named contour', thenLoft.ok && !hasContourProfileBlock(thenLoft.buffer) && /@contour id=c1/.test(thenLoft.buffer));
  check('Loft after Profile has one solid', countMakeLoft(thenLoft.buffer) === 1);

  const fromExt = composeContourLoft(ext.buffer, {
    face,
    loft: { profiles: defaultLoftProfiles() },
  });
  check('Loft after Extrude strips extrude', fromExt.ok && !hasContourExtrudeBlock(fromExt.buffer));
  check('Loft after Extrude no makeExtrude', countMakeExtrude(fromExt.buffer) === 0);
  check('Loft after Extrude one makeLoft', countMakeLoft(fromExt.buffer) === 1);

  const backToExt = composeContourExtrude(lofted.buffer, {
    face,
    tool: 'circle',
    params: { radius: 5, segments: 32 },
    extrude: { distance: 10, direction: 'normal', sense: 'positive' },
  });
  check('Extrude after Loft strips loft', backToExt.ok && !hasContourLoftBlock(backToExt.buffer));
  check('Extrude after Loft one makeExtrude', countMakeExtrude(backToExt.buffer) === 1);
  check('Extrude after Loft no makeLoft', countMakeLoft(backToExt.buffer) === 0);

  const backToRev = composeContourRevolve(lofted.buffer, {
    face,
    tool: 'circle',
    params: { radius: 5, segments: 32 },
    revolve: { angle: 180, axis: 'v', sense: 'positive' },
  });
  check('Revolve after Loft strips loft', backToRev.ok && !hasContourLoftBlock(backToRev.buffer));
  check('Revolve after Loft one makeRevolve', countMakeRevolve(backToRev.buffer) === 1);
  check('Revolve after Loft no makeLoft', countMakeLoft(backToRev.buffer) === 0);
}

// ── Function() under stubs (syntax + bindings) ─────────────────
{
  const face = rFace();
  const composed = composeContourLoft(starter, {
    face,
    loft: { profiles: defaultLoftProfiles() },
  });
  const stubs = {
    Manifold: { cube: () => ({ add(x) { return x; } }) },
    facesByNormal: () => [{ center: [0, 0, 10], normal: [0, 0, 1] }],
    workplaneFromFace: () => ({
      center: [0, 0, 10], normal: [0, 0, 1], x: [1, 0, 0], y: [0, 1, 0],
    }),
    profileCircle: (r) => ({ type: 'circle', contours: [[[r, 0], [0, r], [-r, 0], [0, -r]]] }),
    makeCrossSection: (plane, profile) => ({
      kind: 'crossSection',
      plane,
      contours: profile.contours,
    }),
    makeLoft: () => ({ _t: 'loft' }),
    offsetPlaneFrame: (plane, offset) => ({
      center: [
        plane.center[0],
        plane.center[1],
        plane.center[2] + offset,
      ],
      normal: plane.normal, x: plane.x, y: plane.y,
    }),
    placeInFrame: (_fr, solid) => solid,
    transformByFrame: (_fr, solid) => solid,
    placeOnFace: () => { throw new Error('placeOnFace must not run on new-body Loft'); },
  };
  try {
    const fn = new Function(...Object.keys(stubs), `"use strict";\n${composed.buffer}`);
    const result = fn(...Object.values(stubs));
    check('composed Loft Function() runs', result != null);
  } catch (e) {
    check('composed Loft Function() runs', false, String(e.message || e));
  }

  const empty = composeContourLoft('', {
    face,
    loft: { profiles: defaultLoftProfiles() },
  });
  const emptyStubs = {
    ...stubs,
    Manifold: { cube: () => { throw new Error('starter cube must not run'); } },
    facesByNormal: () => { throw new Error('facesByNormal must not run on hostless Loft'); },
    workplaneFromFace: () => { throw new Error('workplaneFromFace must not query a host'); },
  };
  try {
    const fn = new Function(...Object.keys(emptyStubs), `"use strict";\n${empty.buffer}`);
    const result = fn(...Object.values(emptyStubs));
    check('empty Loft Function() runs without cube', result != null);
  } catch (e) {
    check('empty Loft Function() runs without cube', false, String(e.message || e));
  }
}

// ── Palette / Extrude-Revolve stubs preserved ──────────────────
{
  const ext = composeHelperInsert(starter, 'makeExtrude', null, { height: 10 }, null, null);
  check('composeHelperInsert Extrude still emits makeExtrude', /makeExtrude\s*\(/.test(ext));
  const item = HELPER_PALETTE_ITEMS.find((h) => h.id === 'makeLoft');
  check('palette has Loft item', !!item);
  check('palette title mentions contour mode', /contour/i.test(item.title || ''));
  check('loft begin marker present', CONTOUR_LOFT_BEGIN.includes('loft'));
  check('extrude begin marker unchanged', CONTOUR_EXTRUDE_BEGIN.includes('extrude'));
}

// ── #30 / #34 fillet / sweep stack preserved ───────────────────
{
  check('pickFilletStrategy is sweep', pickFilletStrategy() === 'sweep');
  check('resolveFilletStrategy() is sweep', resolveFilletStrategy() === 'sweep');
  check('resolveFilletStrategy(auto) is sweep', resolveFilletStrategy('auto') === 'sweep');
  check('resolveFilletStrategy(planar) still planar', resolveFilletStrategy('planar') === 'planar');

  const fillet = HELPER_PALETTE_ITEMS.find((h) => h.id === 'filletEdges');
  check('palette Fillet exists', !!fillet);
  const strat = (fillet?.params || []).find((p) => p.name === 'strategy');
  check('palette Fillet Strategy default sweep (#30)', strat && strat.default === 'sweep');

  const edges = [
    { a: 0, b: 1, va: [0, 0, 0], vb: [10, 0, 0], length: 10, key: 'e0' },
    { a: 1, b: 2, va: [10, 0, 0], vb: [10, 8, 0], length: 8, key: 'e1' },
  ];
  const modal = resolveFaceModal(fillet, null, edges);
  check('fillet edge modal opens', modal.mode === 'params');
  const modalStrat = (modal.item?.params || []).find((p) => p.name === 'strategy');
  check('fillet modal Strategy default sweep (#30)', modalStrat && modalStrat.default === 'sweep');

  const filBuf = composeHelperInsert(starter, 'filletEdges', null, {
    body: 'part',
    strategy: 'auto',
    radius: 2,
    sphericalCorners: true,
    profile: 'fillet',
    reverse: false,
    edgeScope: 'selected',
  }, null, edges);
  check('fillet compose still emits filletAlongPath or filletEdges',
    /filletAlongPath\s*\(|filletEdges\s*\(/.test(filBuf || ''));
  check('fillet compose has no loft markers', !hasContourLoftBlock(filBuf || ''));
}

// ── Volume-0 guard at the util layer (mock solid, no wasm) ─────
{
  const plane = {
    center: [0, 0, 0],
    normal: [0, 0, 1],
    x: [1, 0, 0],
    y: [0, 1, 0],
  };
  const fakeSolid = {
    warp() { return this; },
    translate() { return this; },
    add() { return this; },
    volume() { return 0; },
  };
  const FakeManifold = { extrude() { return fakeSolid; } };
  const FakeCrossSection = function FakeCrossSection() {};
  FakeCrossSection.prototype.extrude = function extrude() { return fakeSolid; };
  let msg = '';
  try {
    buildMakeLoftSolid(FakeManifold, FakeCrossSection, [
      { plane, contours: [circlePts(5)] },
      { plane: offsetPlaneFrame(plane, 20), contours: [circlePts(8)] },
    ]);
  } catch (e) {
    msg = (e && e.message) || String(e);
  }
  check(
    'volume-0 guard at util layer',
    /EMPTY|volume 0/i.test(msg),
    msg || 'did not throw',
  );
}

// ── Volume contracts on built/manifold.js ──────────────────────
{
  const wasm = await Module();
  wasm.setup();
  const { Manifold, CrossSection } = wasm;
  const plane = {
    center: [0, 0, 0],
    normal: [0, 0, 1],
    x: [1, 0, 0],
    y: [0, 1, 0],
  };
  const cyl = buildMakeLoftSolid(Manifold, CrossSection, [
    { plane, contours: [circlePts(5, 64)] },
    { plane: offsetPlaneFrame(plane, 20), contours: [circlePts(5, 64)] },
  ], { align: true, resolution: 64 });
  const cylVol = cyl.volume();
  const cylExpect = Math.PI * 25 * 20;
  check(
    'same-radius loft → cylinder vol ≈ πr²h (1480–1650)',
    cylVol > 1480 && cylVol < 1650,
    `vol=${cylVol} expected≈${cylExpect.toFixed(2)}`,
  );

  const frustum = buildMakeLoftSolid(Manifold, CrossSection, [
    { plane, contours: [circlePts(10, 64)] },
    { plane: offsetPlaneFrame(plane, 20), contours: [circlePts(5, 64)] },
  ], { align: true, resolution: 64 });
  const frVol = frustum.volume();
  const frExpect = (1 / 3) * Math.PI * 20 * (100 + 50 + 25);
  check(
    'r=10→5 loft → frustum vol ≈ (1/3)πh(R²+Rr+r²) (3400–3900)',
    frVol > 3400 && frVol < 3900,
    `vol=${frVol} expected≈${frExpect.toFixed(2)}`,
  );

  // Congruent parallel sections → prism: volume = area × height.
  // Tight relative band so a fixed parameterisation bias cannot hide.
  const prismH = 20;
  const prismCases = [
    { name: 'circle r=10', pts: circlePts(10, 64), area: Math.PI * 100 },
    { name: 'square 20x20', pts: squarePts(20), area: 400 },
    { name: 'rect 30x10', pts: rectPts(30, 10), area: 300 },
    { name: 'diamond diagonals 20', pts: diamondPts(20), area: 200 },
  ];
  for (const c of prismCases) {
    const solid = buildMakeLoftSolid(Manifold, CrossSection, [
      { plane, contours: [c.pts] },
      { plane: offsetPlaneFrame(plane, prismH), contours: [c.pts] },
    ], { resolution: 64 });
    const got = solid.volume();
    const expect = c.area * prismH;
    const rel = Math.abs(got - expect) / expect;
    check(
      `congruent ${c.name} loft vol ≈ area×h`,
      rel < 0.02,
      `vol=${got} expected=${expect.toFixed(2)} rel=${(rel * 100).toFixed(2)}%`,
    );
  }

  const rect = rectPts(30, 10);
  const aligned = buildMakeLoftSolid(Manifold, CrossSection, [
    { plane, contours: [rect] },
    { plane: offsetPlaneFrame(plane, 20), contours: [rotateContour(rect, 45)] },
  ], { resolution: 64 });
  const twisted = buildMakeLoftSolid(Manifold, CrossSection, [
    { plane, contours: [rect] },
    { plane: offsetPlaneFrame(plane, 20), contours: [rotateContour(rect, 45)] },
  ], { align: false, resolution: 64 });
  const alignedVol = aligned.volume();
  const twistedVol = twisted.volume();
  const prismVol = 30 * 10 * 20;
  check(
    'align default differs from align:false',
    Math.abs(alignedVol - twistedVol) > 100,
    `default=${alignedVol} align:false=${twistedVol}`,
  );
  check(
    'align default is the aligned arm',
    Math.abs(alignedVol - prismVol) < Math.abs(twistedVol - prismVol),
    `default=${alignedVol} twisted=${twistedVol} prism=${prismVol}`,
  );

  const sectionsAsc = [
    { plane, contours: [circlePts(5, 64)], offset: 0 },
    { plane: offsetPlaneFrame(plane, 20), contours: [circlePts(5, 64)], offset: 20 },
  ];
  const sectionsDesc = [
    { plane: offsetPlaneFrame(plane, 20), contours: [circlePts(5, 64)], offset: 20 },
    { plane, contours: [circlePts(5, 64)], offset: 0 },
  ];
  const ascVol = buildMakeLoftSolid(Manifold, CrossSection, sectionsAsc, { resolution: 64 }).volume();
  const descVol = buildMakeLoftSolid(Manifold, CrossSection, sectionsDesc, { resolution: 64 }).volume();
  check(
    'descending offsets loft same as ascending',
    Math.abs(descVol - ascVol) < 1,
    `asc=${ascVol} desc=${descVol}`,
  );

  {
    const two = buildMakeLoftSolid(Manifold, CrossSection, [
      { plane, contours: [circlePts(5, 64)] },
      { plane: offsetPlaneFrame(plane, 20), contours: [circlePts(8, 64)] },
    ], { resolution: 64 });
    const a0 = contourArea(two.slice(0.2));
    const a1 = contourArea(two.slice(19.8));
    const r0 = Math.sqrt(a0 / Math.PI);
    const r1 = Math.sqrt(a1 / Math.PI);
    check(
      '2-profile distinct ends (bottom ≈ r=5, top ≈ r=8)',
      Math.abs(r0 - 5) < 0.2 && Math.abs(r1 - 8) < 0.2 && Math.abs(r1 - r0) > 2,
      `r0=${r0.toFixed(3)} r1=${r1.toFixed(3)}`,
    );
    check('2-profile one connected solid', two.decompose().length === 1);

    const mid = buildMakeLoftSolid(Manifold, CrossSection, [
      { plane, contours: [circlePts(5, 64)], offset: 0 },
      { plane: offsetPlaneFrame(plane, 20), contours: [rectPts(16, 10)], offset: 20 },
      { plane: offsetPlaneFrame(plane, 40), contours: [circlePts(8, 64)], offset: 40 },
    ], { resolution: 64 });
    const sl19 = mid.slice(19.5);
    const sl20 = mid.slice(20);
    const sl21 = mid.slice(20.5);
    const area20 = contourArea(sl20);
    const e19 = xyExtent(sl19);
    const e20 = xyExtent(sl20);
    const e21 = xyExtent(sl21);
    const yJumpDown = Math.abs(e19.y - e20.y) / Math.max(e20.y, 1e-6);
    const yJumpUp = Math.abs(e21.y - e20.y) / Math.max(e20.y, 1e-6);
    check(
      '3-profile middle station area ≈ 16×10 rect (160)',
      Math.abs(area20 - 160) / 160 < 0.08,
      `area=${area20.toFixed(2)}`,
    );
    check(
      '3-profile middle stays on path (nearby Y extents continuous, not a disjoint snap)',
      yJumpDown < 0.12 && yJumpUp < 0.12,
      `y@19.5=${e19.y.toFixed(2)} y@20=${e20.y.toFixed(2)} y@20.5=${e21.y.toFixed(2)}`,
    );
    check(
      '3-profile middle nearby areas continuous',
      Math.abs(contourArea(sl19) - area20) / area20 < 0.12
      && Math.abs(contourArea(sl21) - area20) / area20 < 0.12,
      `a19=${contourArea(sl19).toFixed(2)} a20=${area20.toFixed(2)} a21=${contourArea(sl21).toFixed(2)}`,
    );
    check('3-profile one connected solid (no island)', mid.decompose().length === 1);

    const threeCirc = buildMakeLoftSolid(Manifold, CrossSection, [
      { plane, contours: [circlePts(5, 64)], offset: 0 },
      { plane: offsetPlaneFrame(plane, 20), contours: [circlePts(8, 64)], offset: 20 },
      { plane: offsetPlaneFrame(plane, 40), contours: [circlePts(12, 64)], offset: 40 },
    ], { resolution: 64 });
    const midR = Math.sqrt(contourArea(threeCirc.slice(20)) / Math.PI);
    check(
      '3-profile circle middle radius ≈ 8 (on the loft path)',
      Math.abs(midR - 8) < 0.2,
      `midR=${midR.toFixed(3)}`,
    );
  }

  const segsCap = MAKE_LOFT_EXTRUDE_SEGS_CAP_K * MAKE_LOFT_EXTRUDE_SEGS;
  const segsTight = resolveLoftExtrudeSegs(40, 5);
  const segsSliver = resolveLoftExtrudeSegs(40, 0.001);
  const segsFloor = resolveLoftExtrudeSegs(40, MAKE_LOFT_COINCIDENT_EPS);
  const segsSigned = resolveLoftExtrudeSegs(40, -2);
  check(
    'tight span inflates segs past default 64 (subdivision is a live net)',
    segsTight > MAKE_LOFT_EXTRUDE_SEGS && segsTight === 128,
    `segs=${segsTight}`,
  );
  check(
    'segs always ≤ k × MAKE_LOFT_EXTRUDE_SEGS',
    segsTight <= segsCap
    && segsSliver <= segsCap
    && segsFloor <= segsCap
    && segsSigned <= segsCap
    && resolveLoftExtrudeSegs(40, 1e-9) <= segsCap
    && resolveLoftExtrudeSegs(40, 5, { extrudeSegments: 1e9 }) <= segsCap,
    `tight=${segsTight} sliver=${segsSliver} floor=${segsFloor} signed=${segsSigned}`,
  );
  check(
    '1e-6 coincident floor is capped (not 640M divisions)',
    segsFloor === segsCap && Number.isFinite(segsFloor),
    `floor=${segsFloor} cap=${segsCap}`,
  );
  check(
    'signed minSpan clamps to coincident floor (not a negative span)',
    segsSigned === segsCap,
    `signed=${segsSigned}`,
  );

  {
    let sliverSolid = null;
    let sliverErr = '';
    try {
      sliverSolid = buildMakeLoftSolid(Manifold, CrossSection, [
        { plane, contours: [circlePts(5, 32)], offset: 0 },
        { plane: offsetPlaneFrame(plane, MAKE_LOFT_COINCIDENT_EPS), contours: [circlePts(6, 32)], offset: MAKE_LOFT_COINCIDENT_EPS },
        { plane: offsetPlaneFrame(plane, 40), contours: [circlePts(8, 32)], offset: 40 },
      ], { resolution: 32 });
    } catch (e) {
      sliverErr = (e && e.message) || String(e);
    }
    check(
      '1e-6 coalescing floor assembles a solid (no WASM throw)',
      sliverSolid != null && typeof sliverSolid.volume === 'function' && sliverSolid.volume() > 1e-9,
      sliverErr || (sliverSolid ? `vol=${sliverSolid.volume()}` : 'null'),
    );
  }

  // Span 0.3125 over height 40: default 64 segs places no vertex on the
  // middle plane (slice interpolates r=5→rect). Inflation+cap (256) does.
  // Dropping the ceil(height/minSpan)*16 term leaves this RED.
  {
    const midOff = 0.3125;
    const tight = buildMakeLoftSolid(Manifold, CrossSection, [
      { plane, contours: [circlePts(5, 64)], offset: 0 },
      { plane: offsetPlaneFrame(plane, midOff), contours: [rectPts(16, 10)], offset: midOff },
      { plane: offsetPlaneFrame(plane, 40), contours: [circlePts(8, 64)], offset: 40 },
    ], { resolution: 64 });
    const slMid = tight.slice(midOff);
    const areaMid = contourArea(slMid);
    const slNear = tight.slice(midOff + 0.05);
    check(
      'tight-span middle station area ≈ 16×10 (subdivision required)',
      Math.abs(areaMid - 160) / 160 < 0.08,
      `area=${areaMid.toFixed(2)} segs=${resolveLoftExtrudeSegs(40, midOff)}`,
    );
    check(
      'tight-span middle stays on path (not a 64-seg skip)',
      Math.abs(contourArea(slNear) - areaMid) / Math.max(areaMid, 1e-6) < 0.12,
      `aMid=${areaMid.toFixed(2)} aNear=${contourArea(slNear).toFixed(2)}`,
    );
    check('tight-span one connected solid', tight.decompose().length === 1);
  }
}

if (failed) {
  console.error(`\nFAILED: ${failed} check(s)`);
  process.exit(1);
}
console.log('\nAll slice-28 checks passed.');

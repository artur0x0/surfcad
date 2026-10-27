#!/usr/bin/env node
/**
 * Slice A — feature ribbon completeness.
 *
 * Left-rail insertables that create a feature (Block primitives, Model
 * one-shots, Polish, Move) emit begin…end markers so FeatureStrip chips
 * appear with per-type badges — same pattern as Fillet.
 *
 * Playtest contract: create Cube then Fillet → both chips in the ribbon.
 * Non-goals: Edges PR2–8, Slice B/C, PWA D, re-land PR2.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  composeHelperInsert,
  CUBE_BEGIN,
  FILLET_MODE_BEGIN,
  CYLINDER_BEGIN,
  SHELL_BEGIN,
  DRAFT_BEGIN,
  CONTOUR_EXTRUDE_BEGIN, CUBE_END, FILLET_MODE_END,} from '../../src/utils/helperPaletteSnippets.js';
import { parseFeatureMarkers, FEATURE_MARKER_KINDS } from '../../src/utils/featureMarkers.js';
import { hasFeatureBlock } from '../../src/utils/featureBlockId.js';

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(join(here, rel), 'utf8');

let failed = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`);
  }
}

console.log('slice A: feature ribbon completeness');

{
  const _markers = read('../../src/utils/featureMarkers.js');
  const strip = read('../../src/components/FeatureStrip.jsx');
  const snippets = read('../../src/utils/helperPaletteSnippets.js');

  check(
    'FEATURE_MARKER_KINDS covers primitives + polish + move',
    FEATURE_MARKER_KINDS.some((k) => k.kind === 'cube') &&
      FEATURE_MARKER_KINDS.some((k) => k.kind === 'cylinder') &&
      FEATURE_MARKER_KINDS.some((k) => k.kind === 'shell') &&
      FEATURE_MARKER_KINDS.some((k) => k.kind === 'draft') &&
      FEATURE_MARKER_KINDS.some((k) => k.kind === 'center') &&
      FEATURE_MARKER_KINDS.some((k) => k.kind === 'fillet'),
  );
  check(
    'FeatureStrip icons include cube / shell / draft',
    /cube:\s*Box/.test(strip) &&
      /shell:\s*PackageOpen/.test(strip) &&
      /draft:\s*Angle/.test(strip),
  );
  check(
    'composers export cube + wrapFeatureBlock',
    /export const CUBE_BEGIN/.test(snippets) &&
      /export function wrapFeatureBlock/.test(snippets) &&
      snippets.includes(CUBE_BEGIN),
  );
}

{
  let buf = composeHelperInsert('', 'cube');
  check('cube insert writes cube markers', hasFeatureBlock(buf, CUBE_BEGIN, CUBE_END) && /cube begin id=cube1 ---/.test(buf));
  let feats = parseFeatureMarkers(buf);
  check('cube alone → one cube chip', feats.length === 1 && feats[0].kind === 'cube' && feats[0].typeIndex === 1);

  buf = composeHelperInsert(buf, 'filletEdges', null, {
    _filletMode: true,
    radius: 3,
    strategy: 'planar',
  });
  check('fillet mode still writes fillet markers', hasFeatureBlock(buf, FILLET_MODE_BEGIN, FILLET_MODE_END));
  feats = parseFeatureMarkers(buf);
  const kinds = feats.map((f) => f.kind);
  check(
    'playtest: cube then fillet → both strip chips',
    kinds.includes('cube') && kinds.includes('fillet') && feats.length === 2,
    `got ${kinds.join(',')}`,
  );
  check('cube typeIndex 1', feats.find((f) => f.kind === 'cube')?.typeIndex === 1);
  check('fillet typeIndex 1', feats.find((f) => f.kind === 'fillet')?.typeIndex === 1);
}

{
  const oneShot = composeHelperInsert(
    composeHelperInsert('', 'cube'),
    'filletEdges',
    null,
    { radius: 2, strategy: 'planar' },
  );
  check(
    'one-shot fillet also marked (strip chip)',
    parseFeatureMarkers(oneShot).some((f) => f.kind === 'fillet'),
  );
}

{
  const samples = [
    ['cylinder', 'cylinder', CYLINDER_BEGIN],
    ['shell', 'shell', SHELL_BEGIN],
    ['addDraft', 'draft', DRAFT_BEGIN],
    ['makeExtrude', 'extrude', CONTOUR_EXTRUDE_BEGIN],
    ['workplane', 'workplane', null],
    ['roundedBox', 'roundedBox', null],
    ['center', 'center', null],
  ];
  for (const [id, kind, begin] of samples) {
    const buf = composeHelperInsert('', id);
    const feats = parseFeatureMarkers(buf || '');
    check(
      `${id} → strip kind ${kind}`,
      feats.some((f) => f.kind === kind),
      `kinds=${feats.map((f) => f.kind).join(',')}`,
    );
    if (begin) check(`${id} writes expected begin marker`, (buf || '').includes(begin));
  }
}

{
  // Two cubes → badges 1 and 2
  let buf = composeHelperInsert('', 'cube');
  buf = composeHelperInsert(buf, 'cube');
  const cubes = parseFeatureMarkers(buf).filter((f) => f.kind === 'cube');
  check('two cubes → typeIndex 1 then 2', cubes.length === 2 && cubes[0].typeIndex === 1 && cubes[1].typeIndex === 2);
  check('chipLabel numbers second cube', cubes[1].chipLabel === 'Cube 2');
}

if (failed) {
  console.log(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nAll slice A feature-ribbon checks passed.');

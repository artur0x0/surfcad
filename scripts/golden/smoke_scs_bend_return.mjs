#!/usr/bin/env node
/**
 * Playtest: Tab, then Bend on an orange edge, then edit that bend.
 * 304 stainless, 16 ga (SST-060). The committed script — not a hand-added
 * `return part` — must run on the real worker and come back as a solid,
 * with no "Script must return a Manifold object" toast.
 * A sheet wrapper (`{ solid, spec }`) unwraps. A bare bag does not.
 */
import { readFileSync } from 'node:fs';
import { joinScsCatalog, findScsSku } from '../../src/utils/scs/scsCatalog.js';
import {
  acceptBaseFlange,
  acceptDraft,
  enterSheetMetalMode,
  pickSheetPlane,
  setSheetTool,
  sheetTap,
  updateDraft,
} from '../../src/utils/sheetMetal/sheetMetalMode.js';
import {
  composeSheetMetalCommit,
  sheetMetalBlock,
} from '../../src/utils/sheetMetal/sheetMetalScript.js';
import { sheetScriptHasExtras } from '../../src/utils/sheetMetal/sheetExport.js';
import { starterCubeScript } from '../../src/utils/helperPaletteSnippets.js';
import { loadSandbox } from './scs_sandbox.mjs';

const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');
const fixture = (name) => JSON.parse(read(`scripts/golden/fixtures/scs/${name}.json`));

let failed = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`);
  }
}

const { exec } = await loadSandbox();
const { manifoldFromScriptResult } = await import('../../src/lib/surfcad/runtime.js');

console.log('sheet return: helper');
{
  const solid = { getMesh() { return { vertProperties: [0] }; } };
  check('a Manifold passes through', manifoldFromScriptResult(solid) === solid);
  const spec = { sku: 'SST-060', t: 1.52, width: 100 };
  check('spec wrapper unwraps to solid', manifoldFromScriptResult({ spec, solid }) === solid);
  check('flat wrapper unwraps to solid', manifoldFromScriptResult({ flat: { area: 6000, loops: [] }, solid }) === solid);
  check('kind:sheet unwraps to solid', manifoldFromScriptResult({ kind: 'sheet', solid }) === solid);
  const reject = (value) => {
    try {
      manifoldFromScriptResult(value);
      return 'accepted';
    } catch (err) {
      return err?.message || String(err);
    }
  };
  const toast = 'Script must return a Manifold object';
  check('null is rejected', reject(null) === toast);
  check('a number is rejected', reject(1) === toast);
  check('an array is rejected', reject([solid]) === toast);
  check('an arbitrary object is rejected', reject({ nope: 1 }) === toast);
  check('a bag with only .solid is rejected', reject({ solid }) === toast);
}

console.log('sheet return: Tab, Bend, edit bend (real worker)');
{
  const { records } = joinScsCatalog(fixture('catalog'), fixture('specs'));
  const alu = findScsSku(records, 'ALU-090');
  // 16 ga 304 stainless from the playtest (0.060 in / 1.52 mm, SST-060).
  // Bend numbers come from the ALU-090 fixture so the sequence is offline;
  // the script identity is the playtest SKU.
  const sst = {
    ...alu,
    sku: 'SST-060',
    name: 'Stainless Steel (304 Series)',
    category: 'Stainless Steel',
    gauge: 16,
    thicknessIn: 0.06,
    thicknessMm: 1.52,
  };
  let mode = acceptBaseFlange(pickSheetPlane(enterSheetMetalMode(sst, 'sheet-1'), 'XY')).mode;
  check('base flange is edit + bend tool', mode.stage === 'edit' && mode.tool === 'bend' && mode.spec.sku === 'SST-060');
  mode = setSheetTool(mode, 'tab');
  mode = sheetTap(mode, { kind: 'edge', panel: 'base', edge: 'v+' });
  check('tab tap opens a tab draft on an edge', mode.draft?.kind === 'tab' && mode.draft.edge === 'v+');
  mode = acceptDraft(mode).mode;
  check('tab is committed', mode.spec.tabs.length === 1 && !mode.draft);
  mode = setSheetTool(mode, 'bend');
  mode = sheetTap(mode, { kind: 'edge', panel: 'base', edge: 'u+' });
  check('orange-edge tap opens a bend draft', mode.draft?.kind === 'bend' && mode.draft.edge === 'u+' && mode.draft.angle === 90);
  mode = acceptDraft(mode).mode;
  const bendId = mode.spec.bends[0]?.id;
  mode = sheetTap(mode, { kind: 'bend', id: bendId });
  check('tap the bend to edit it', mode.draft?.id === bendId && mode.draft.isNew === false);
  mode = updateDraft(mode, { angle: 45, length: 20 });
  const accepted = acceptDraft(mode);
  mode = accepted.mode;
  check('edited bend is 45° × 20', mode.spec.bends[0].angle === 45 && mode.spec.bends[0].length === 20 && !mode.draft);

  const committed = composeSheetMetalCommit(starterCubeScript(), accepted.spec);
  const script = committed.buffer;
  check('commit replaces the starter and returns part after the block',
    committed.ok
    && script.startsWith('// --- sheet-metal begin ---')
    && !/Manifold\.cube/.test(script)
    && /\/\/ --- sheet-metal end ---\s*\nreturn part;/.test(script)
    && script.includes('"sku":"SST-060"')
    && !sheetScriptHasExtras(script));

  let toast = null;
  let solid = null;
  try {
    solid = await exec(script);
  } catch (err) {
    toast = err?.message || String(err);
  }
  check('no error toast', toast == null, toast || '');
  check('valid solid', !!solid?.mesh?.vertProperties?.length && solid.volume > 0 && solid.status === 'NoError',
    toast || `vol=${solid?.volume} status=${solid?.status}`);

  const flatVol = solid?.volume;
  const wrappedSrc = `
const spec = ${JSON.stringify(accepted.spec)};
const solid = sheetMetalSolid(spec);
return { kind: 'sheet', spec, flat: { area: spec.width * spec.height, loops: [] }, solid };
`;
  let wrapped = null;
  let wrapErr = null;
  try {
    wrapped = await exec(wrappedSrc);
  } catch (err) {
    wrapErr = err?.message || String(err);
  }
  check('worker unwraps a sheet wrapper', wrapErr == null && wrapped?.volume > 0
    && Math.abs(wrapped.volume - flatVol) < 1, wrapErr || `vol=${wrapped?.volume}`);

  let missing = null;
  try {
    await exec(sheetMetalBlock(accepted.spec));
  } catch (err) {
    missing = err?.message || String(err);
  }
  check('the block alone (no return) is still an error', missing === 'Script must return a Manifold object', missing || 'accepted');

  let bag = null;
  try {
    await exec('return { solid: Manifold.cube([4, 4, 4], true) };');
  } catch (err) {
    bag = err?.message || String(err);
  }
  check('worker still rejects a non-sheet bag', bag === 'Script must return a Manifold object', bag || 'accepted');
}

if (failed) {
  console.log(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nAll sheet bend-return checks passed');
process.exit(0);

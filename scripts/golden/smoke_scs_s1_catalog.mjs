#!/usr/bin/env node
/**
 * SCS S1 — SendCutSend catalog + SKU bind.
 * Parse + join catalog/specs on sku (soft schema), in-stock filter, daily
 * cache with stale fallback, SKU persisted on the part (local doc + .surf.json),
 * Sheet Metal picker chrome (≥16px, Start disabled until an in-stock SKU).
 */
import { readFileSync } from 'node:fs';
import {
  SCS_CATALOG_URL,
  SCS_SPECS_URL,
  SCS_CACHE_TTL_MS,
  joinScsCatalog,
  inStockSkus,
  findScsSku,
  scsMaterialOptions,
  scsGaugeOptions,
  canStartSheetMetal,
  loadScsCatalog,
  scsNumber,
  scsSize,
  sheetMetalBinding,
  normalizeSheetMetalBinding,
} from '../../src/utils/scs/scsCatalog.js';
import {
  parseAssemblyDocument,
  partSheetMetal,
  serializeAssembly,
  setPartSheetMetal,
  renamePart,
} from '../../src/utils/assembly.js';
import { parseSurfJson, stringifySurfJson, validateSurfJson } from '../../src/utils/git/surfJson.js';
import { sheetMetalReady, SHEET_METAL_BEGIN, SHEET_METAL_END } from '../../src/utils/sheetMetal/sheetMetalScript.js';
import { enterSheetMetalMode } from '../../src/utils/sheetMetal/sheetMetalMode.js';
import { starterCubeScript } from '../../src/utils/helperPaletteSnippets.js';

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

const catalog = fixture('catalog');
const specs = fixture('specs');

console.log('SCS S1 — catalog parse + join');
{
  check('CDN URLs are the v1.2 catalog + specs',
    SCS_CATALOG_URL === 'https://cdn.sendcutsend.com/specs/sendcutsend-catalog-v1.2.json'
    && SCS_SPECS_URL === 'https://cdn.sendcutsend.com/specs/sendcutsend-specs-v1.2.json');
  check('numbers: strings, N/A, inch marks', scsNumber('0.032') === 0.032 && scsNumber(0.035) === 0.035
    && scsNumber('N/A') === null && scsNumber('0.229"') === 0.229 && scsNumber(undefined) === null);
  check('sizes: "44 x 30" and "0.375x0.25"',
    JSON.stringify(scsSize('44 x 30')) === '[44,30]' && JSON.stringify(scsSize('0.375x0.25')) === '[0.375,0.25]');

  const { records, meta } = joinScsCatalog(catalog, specs);
  check('joined one record per catalog sku; specs-only sku dropped',
    records.length === 9 && !findScsSku(records, 'SPECS-ONLY-1'), String(records.length));
  check('unknown schema_version + extra fields tolerated', meta.catalogSchema === '1.3-future');
  const alu = findScsSku(records, 'ALU-090');
  check('ALU-090 normalized shape', alu
    && alu.name === '5052 H32 Aluminum' && alu.thicknessIn === 0.09
    && Math.abs(alu.thicknessMm - 2.286) < 1e-6 && alu.gauge === 11
    && alu.inStock === true && alu.bendable === true && alu.services.includes('bending'),
    JSON.stringify(alu));
  check('ALU-090 bend + DFM fields from specs', alu?.bend
    && alu.bend.radiusIn === 0.032 && alu.bend.kFactor === 0.37 && alu.bend.bendDeductionIn === 0.142
    && alu.bend.minFlangeIn === 0.326 && alu.bend.maxAngleDeg === 130
    && alu.dfm.minHoleIn > 0 && alu.dfm.minBridgeIn > 0 && alu.dfm.minHoleToEdgeIn > 0,
    JSON.stringify(alu?.bend));
  const uhmw = findScsSku(records, 'UHMWBLACK-500');
  check('catalog row without specs still loads (DFM null, flat only)',
    uhmw && uhmw.bend === null && uhmw.dfm.minHoleIn === null && uhmw.bendable === false);
  const al6061 = findScsSku(records, 'ALU6061-100');
  check('no bending service → not bendable', al6061 && al6061.bendable === false && al6061.bend === null);

  console.log('SCS S1 — in-stock filter + dropdowns');
  const live = inStockSkus(records);
  check('in-stock filter drops out_of_stock', live.length === 8 && !live.some((r) => r.sku === 'ALU-080-OOS'));
  const mats = scsMaterialOptions(records);
  check('material dropdown: distinct names, bendable first',
    mats.length === 6 && mats[0].bendable && !mats[mats.length - 1].bendable,
    JSON.stringify(mats.map((m) => m.name)));
  const gauges = scsGaugeOptions(records, '5052 H32 Aluminum');
  check('gauge dropdown: every SKU, thinnest first, out of stock kept',
    JSON.stringify(gauges.map((g) => g.sku)) === '["ALU-063","ALU-080","ALU-080-OOS","ALU-090"]',
    JSON.stringify(gauges.map((g) => g.sku)));
  const live90 = gauges.find((g) => g.sku === 'ALU-090');
  const oos = gauges.find((g) => g.sku === 'ALU-080-OOS');
  check('gauge label shows inch, gauge, mm', /0\.090" · 11 ga · 2\.29 mm/.test(live90?.label), live90?.label);
  check('out-of-stock gauge is disabled and labeled out of stock',
    !!oos && oos.disabled === true && oos.inStock === false && /out of stock/.test(oos.label)
    && gauges.filter((g) => g.inStock).every((g) => g.disabled === false),
    oos?.label);
  const ghost = {
    sku: 'GHOST', name: 'Unobtainium', category: 'Z', thicknessIn: 0.05, thicknessMm: 1.27,
    gauge: null, inStock: false, bendable: false,
  };
  check('out-of-stock-only material is still listed',
    scsMaterialOptions([...records, ghost]).some((m) => m.name === 'Unobtainium' && m.inStock === false));
  const ghostGauges = scsGaugeOptions([...records, ghost], 'Unobtainium');
  check('its gauge is disabled and labeled out of stock',
    ghostGauges.length === 1 && ghostGauges[0].disabled && /out of stock/.test(ghostGauges[0].label),
    ghostGauges[0]?.label);
  check('Start needs an in-stock SKU', canStartSheetMetal(records, 'ALU-090')
    && !canStartSheetMetal(records, 'ALU-080-OOS') && !canStartSheetMetal(records, '') && !canStartSheetMetal(records, 'NOPE'));
}

console.log('SCS S1 — cache: daily refresh + stale fallback');
{
  const mem = () => {
    let entry = null;
    return { get: async () => entry, put: async (e) => { entry = e; }, peek: () => entry };
  };
  let calls = 0;
  const okFetch = async (url) => {
    calls += 1;
    return url === SCS_CATALOG_URL ? catalog : specs;
  };
  const failFetch = async () => {
    calls += 1;
    throw new Error('SendCutSend catalog fetch failed (Failed to fetch)');
  };
  const cache = mem();
  const t0 = 1_000_000;
  const first = await loadScsCatalog({ cache, fetchJson: okFetch, now: () => t0 });
  check('cold: network fetch of both files, cache written',
    first.source === 'network' && calls === 2 && cache.peek()?.records?.length === 9 && cache.peek().fetchedAt === t0);
  calls = 0;
  const warm = await loadScsCatalog({ cache, fetchJson: failFetch, now: () => t0 + SCS_CACHE_TTL_MS - 1 });
  check('< 24 h: cache only, no fetch', warm.source === 'cache' && !warm.stale && calls === 0);
  const forced = await loadScsCatalog({ cache, fetchJson: okFetch, now: () => t0 + 5, force: true });
  check('Retry (force) refetches even when fresh', forced.source === 'network' && calls === 2);
  calls = 0;
  const stale = await loadScsCatalog({ cache, fetchJson: failFetch, now: () => t0 + 2 * SCS_CACHE_TTL_MS });
  check('> 24 h + fetch fails → stale cache, flagged',
    stale.source === 'cache' && stale.stale === true && stale.records.length === 9 && /fetch failed/.test(stale.error));
  const refreshed = await loadScsCatalog({ cache, fetchJson: okFetch, now: () => t0 + 3 * SCS_CACHE_TTL_MS });
  check('> 24 h + fetch ok → refreshed cache', refreshed.source === 'network' && cache.peek().fetchedAt === t0 + 3 * SCS_CACHE_TTL_MS);
  const none = await loadScsCatalog({ cache: mem(), fetchJson: failFetch, now: () => t0 });
  check('no cache + offline → empty list + error (picker shows Retry)',
    none.records.length === 0 && none.source === 'none' && !!none.error);
  const brokenCache = { get: async () => { throw new Error('idb'); }, put: async () => { throw new Error('idb'); } };
  const viaBroken = await loadScsCatalog({ cache: brokenCache, fetchJson: okFetch, now: () => t0 });
  check('IDB failure never blocks the network path', viaBroken.source === 'network' && viaBroken.records.length === 9);
}

console.log('SCS S1 — SKU persists on the part');
{
  const { records } = joinScsCatalog(catalog, specs);
  const binding = sheetMetalBinding(findScsSku(records, 'ALU-090'));
  check('binding shape', JSON.stringify(binding) === JSON.stringify({ sku: 'ALU-090', name: '5052 H32 Aluminum', thicknessIn: 0.09, gauge: 11 }));
  check('malformed bindings drop', normalizeSheetMetalBinding({}) === null && normalizeSheetMetalBinding('x') === null
    && normalizeSheetMetalBinding({ sku: '' }) === null);

  const local = serializeAssembly({
    source: 'local', name: 'Box', activeId: 'p1',
    parts: [{ id: 'p1', name: 'Plate', visible: true, order: 0 }, { id: 'p2', name: 'Other', visible: true, order: 1 }],
  });
  const bound = setPartSheetMetal(local, 'p1', binding);
  check('setPartSheetMetal binds the one row', partSheetMetal(bound, 'p1')?.sku === 'ALU-090' && partSheetMetal(bound, 'p2') === null);
  const reloaded = parseAssemblyDocument(JSON.stringify(bound));
  check('local reload (IndexedDB JSON) keeps the SKU', partSheetMetal(reloaded, 'p1')?.sku === 'ALU-090');
  check('rename keeps the SKU', partSheetMetal(renamePart(bound, 'p1', 'Bracket'), 'p1')?.gauge === 11);
  check('clear with null', partSheetMetal(setPartSheetMetal(bound, 'p1', null), 'p1') === null);

  const git = serializeAssembly({
    source: 'git', name: 'Box', activeId: 'assemblies/Box/Plate.js',
    parts: [{ id: 'assemblies/Box/Plate.js', name: 'Plate', visible: true, order: 0 }],
  });
  const gitBound = setPartSheetMetal(git, 'assemblies/Box/Plate.js', binding);
  const text = stringifySurfJson(gitBound);
  check('.surf.json carries sheetMetal on the part', /"sheetMetal": \{\s*"sku": "ALU-090"/.test(text), text);
  check('.surf.json round-trips the SKU', partSheetMetal(parseSurfJson(text), 'assemblies/Box/Plate.js')?.thicknessIn === 0.09);
  check('.surf.json without sheetMetal is unchanged', !/sheetMetal/.test(stringifySurfJson(git)));
  const bad = JSON.parse(text);
  bad.parts[0].sheetMetal = { nope: 1 };
  check('.surf.json rejects a malformed sheetMetal', !validateSurfJson(bad).ok);
}

console.log('SCS S1 — mode entry + chrome');
{
  check('sheet-ready: empty / starter / existing block',
    sheetMetalReady('') && sheetMetalReady(starterCubeScript())
    && sheetMetalReady(`${SHEET_METAL_BEGIN}\nlet part = 1;\n${SHEET_METAL_END}`)
    && !sheetMetalReady('let part = Manifold.sphere(5);'));
  const { records } = joinScsCatalog(catalog, specs);
  const m = enterSheetMetalMode(findScsSku(records, 'ALU-090'), 'p1');
  check('Start enters sheet-metal mode at the plane step', m?.stage === 'plane' && m.sku.sku === 'ALU-090' && m.partId === 'p1');
  check('no SKU → no mode', enterSheetMetalMode(null) === null);

  const picker = read('src/components/sheetMetal/SheetMetalPicker.jsx');
  const controls = read('src/components/sheetMetal/SmControls.jsx');
  const palette = read('src/components/HelperInsertPalette.jsx');
  const panel = read('src/components/CrossSectionPanel.jsx');
  const view = read('src/components/Viewport.jsx');
  const app = read('src/App.jsx');
  check('Start designing disabled until canStart', /disabled=\{!canStart\}/.test(picker) && /canStartSheetMetal/.test(picker));
  check('picker disables out-of-stock gauge options', /disabled: !!g\.disabled/.test(picker)
    && /out of stock/.test(read('src/utils/scs/scsCatalog.js')));
  check('picker reads IDB cache + stale/Retry states',
    /scsCatalogCache/.test(picker) && /data-scs-status="stale"/.test(picker) && /load\(true\)/.test(picker));
  check('selects + numbers use the ≥16px token',
    /PARTS_TEXT_INPUT_STYLE/.test(controls) && (controls.match(/style=\{PARTS_TEXT_INPUT_STYLE\}/g) || []).length >= 2
    && /min-h-\[44px\]/.test(controls));
  check('Sheet Metal button sits in the left-rail Shape group',
    /section\.section === 'shape' && onOpenSheetMetal/.test(palette)
    && /data-sheet-metal-button/.test(palette)
    && /data-sheet-metal-icon/.test(palette)
    && /text-blue-700 hover:bg-blue-100 active:bg-blue-200/.test(palette)
    && !/text-orange-700/.test(palette)
    && !/FoldVertical/.test(palette)
    && /onOpenSheetMetal=\{mode !== 'game' && onBindSheetMetal/.test(view)
    && !/data-sheet-metal-button/.test(panel)
    && !/data-sheet-metal-group="inspection"/.test(panel)
    && !/data-palette-section="sheet"/.test(palette));
  check('rail swaps while in sheet metal', /!deleteFaceMode && !sheetMetalMode && \(/.test(view) && /<SheetMetalRail/.test(view));
  check('Start binds then enters mode', /onBindSheetMetal\?\.\(record\)/.test(view) && /enterSheetMetalMode\(record, bound\.partId/.test(view));
  check('App binds SKU on the open part; Sheet (n) only when none is open',
    /setPartSheetMetal\(doc, partId, binding\)/.test(app)
    && /sheetMetalFresh\(live\)/.test(app)
    && /if \(!doc\.activeId\)/.test(app)
    && /nextNumberedName\('Sheet', names\)/.test(app)
    && /handleAddPart\(sheetName/.test(app));
  const arch = read('docs/architecture.md');
  check('architecture.md has the SCS section', /## SendCutSend sheet metal/.test(arch) && /sendcutsend-catalog-v1\.2\.json/.test(arch));
}

if (failed) {
  console.log(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nAll SCS S1 checks passed');

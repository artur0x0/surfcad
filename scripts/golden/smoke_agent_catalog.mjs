/**
 * The agent catalog must name every helper the worker injects, with a
 * signature and a one-line description. A new HELPER_FUNCTIONS key without
 * a regenerated catalog fails this golden.
 */
import { readFileSync } from 'node:fs';
import { HELPER_FUNCTIONS } from '../../src/lib/surfcad/runtime.js';
import { validateSurfJson } from '../../src/utils/git/surfJson.js';

const root = new URL('../..', import.meta.url);
const read = (rel) => readFileSync(new URL(rel, root), 'utf8');

let failed = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`);
  }
}

const helpersDoc = JSON.parse(read('src/lib/surfcad/catalog/helpers.json'));
const manifold = JSON.parse(read('src/lib/surfcad/catalog/manifold.json'));
const assembly = JSON.parse(read('src/lib/surfcad/catalog/assembly.schema.json'));
const sheet = JSON.parse(read('src/lib/surfcad/catalog/sheet-metal.json'));

const exposed = Object.keys(HELPER_FUNCTIONS);
const catalogNames = helpersDoc.helpers.map((h) => h.name);
check('catalog count matches exposed helpers', catalogNames.length === exposed.length && helpersDoc.count === exposed.length,
  `exposed ${exposed.length} catalog ${catalogNames.length}`);

const byName = new Map(helpersDoc.helpers.map((h) => [h.name, h]));
const missing = exposed.filter((name) => !byName.has(name));
check('every exposed helper has a catalog entry', missing.length === 0, missing.join(', '));
const extra = catalogNames.filter((name) => !exposed.includes(name));
check('catalog has no helper the worker does not expose', extra.length === 0, extra.join(', '));

for (const name of exposed) {
  const row = byName.get(name);
  if (!row) continue;
  const sigOk = typeof row.signature === 'string' && row.signature.startsWith(`${name}(`);
  const descOk = typeof row.description === 'string' && row.description.trim().length > 8;
  if (!sigOk || !descOk) {
    failed++;
    console.log(`  ❌ ${name} signature + description`, JSON.stringify({ signature: row.signature, description: row.description }));
  }
}
check('every catalog helper has a signature and a one-line description',
  exposed.every((name) => {
    const row = byName.get(name);
    return row && row.signature.startsWith(`${name}(`) && row.description.trim().length > 8;
  }));

check('manifold catalog is the shipped build', manifold.kernel === 'built/manifold.js'
  && manifold.Manifold.some((m) => m.name === 'cube' && m.kind === 'static' && m.signature.includes('('))
  && manifold.CrossSection.some((m) => m.name === 'circle' && m.kind === 'static')
  && manifold.Manifold.some((m) => m.name === 'getMesh' && m.description));

check('assembly schema is surfcad.assembly v1', assembly.properties?.format?.const === 'surfcad.assembly'
  && assembly.properties?.version?.const === 1
  && assembly.properties?.parts?.items?.properties?.id
  && assembly.properties?.parts?.items?.properties?.path
  && /[Pp]ermanent/.test(assembly.properties.parts.items.properties.id.description || '')
  && !/not yet pushed/.test(assembly.properties.parts.items.properties.id.description || '')
  && /@surf-id/.test(JSON.stringify(assembly.defs || assembly.$defs || assembly))
  && assembly.properties?.colors?.minProperties === 1
  && assembly.properties?.colors?.additionalProperties?.additionalProperties === false
  && assembly.properties?.colors?.additionalProperties?.properties?.part?.pattern === '^#[0-9a-f]{6}$');

const v2 = assembly.defs?.v2;
const v2Id = v2?.properties?.id?.pattern || '';
check('assembly schema has a v2 branch', v2?.properties?.version?.const === 2
  && Array.isArray(v2.required) && v2.required.includes('id')
  && v2.properties?.id
  && !/\(\?:local-\)\?/.test(v2Id)
  && v2.properties?.parts?.items?.required?.includes('id')
  && !v2.properties?.parts?.items?.required?.includes('path')
  && !v2.properties?.parts?.items?.properties?.path
  && v2.properties?.parts?.items?.properties?.name?.minLength === 1
  && v2.properties?.activeId?.anyOf?.some((row) => row.type === 'null')
  && v2.properties?.activeId?.anyOf?.some((row) => row.pattern === v2Id)
  && v2.properties?.groups?.items?.properties?.source?.anyOf?.some((row) => row.type === 'null')
  && assembly.defs?.surfNameHeader?.pattern?.includes('@name'));

const sample = {
  format: 'surfcad.assembly',
  version: 1,
  name: 'Bracket',
  activeId: null,
  parts: [{
    id: 'local-2026-10-07-20-56-31-0423-a3f9',
    path: 'assemblies/Bracket/Plate.js',
    name: 'Plate',
    visible: true,
    order: 0,
    position: [0, 0, 0],
  }],
  colors: {
    'local-2026-10-07-20-56-31-0423-a3f9': { part: '#aabbcc' },
  },
};
const verdict = validateSurfJson(sample);
check('sample .surf.json with a legacy local- id still validates', verdict.ok, (verdict.errors || []).join('; '));

check('sheet-metal catalog names the part binding, the script block, and DFM',
  sheet.partSheetMetal?.fields?.sku?.required === true
  && sheet.script?.begin === '// --- sheet-metal begin ---'
  && sheet.script?.solid.includes('sheetMetalSolid')
  && sheet.dfm?.rules?.some((r) => r.rule === 'min-hole' && r.level === 'fail')
  && sheet.dfm?.rules?.some((r) => r.rule === 'no-bending')
  && /brepToStep|true-curve|cylinders/.test(sheet.export?.step || ''));

if (failed) {
  console.log(`\nagent catalog: ${failed} check(s) failed`);
  process.exit(1);
}
console.log(`\nagent catalog: ${exposed.length} helpers, checks passed`);

#!/usr/bin/env node
/**
 * Face colors live on the assembly, version stays 1. Hex is lowercase
 * #rrggbb. Unknown keys are rejected. An empty map is omitted. A surf id
 * that is not in parts is pruned on load. The local- migration rewrites
 * color keys. Copy to this assembly does not copy colors.
 */
import { parseAssemblyDocument, removePart, serializeAssembly } from '../../src/utils/assembly.js';
import { copyGroupToAssembly } from '../../src/utils/partGroups.js';
import { assemblyFilePath, assemblyPartPath } from '../../src/utils/git/vaultLayout.js';
import { planCopyToAssembly } from '../../src/utils/git/gitWorkspace.js';
import { fileWrite } from '../../src/utils/git/githubAdapterInterface.js';
import { mintSurfId, withSurfId } from '../../src/utils/git/surfId.js';
import { migrateAssemblyRecords, migrateOutboxOp, planSurfIdMigrationCommit } from '../../src/utils/git/surfIdMigration.js';
import { parseSurfJson, stringifySurfJson, toSurfJson, validateSurfJson } from '../../src/utils/git/surfJson.js';

let failed = 0;
let passed = 0;
function ok(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${extra ? ` — ${extra}` : ''}`); }
}
function eq(name, got, want) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  ok(name, g === w, `got ${g}, want ${w}`);
}

const WHEN = new Date('2026-10-07T20:56:31.423Z');
const BODY = mintSurfId({ now: WHEN, rand: 'a3f9' });
const OTHER = mintSurfId({ now: new Date('2026-10-07T20:56:32.100Z'), rand: 'b10c' });
const LOCAL = `local-${BODY}`;
const GB = assemblyPartPath('Gearbox', 'Bracket');
const LID = assemblyPartPath('Cover', 'Lid');
const GROUP = mintSurfId({ now: WHEN, rand: 'ab12' });

const face = {
  color: '#e11d48',
  key: { at: [10, 0, 5], n: [0, 0, 1], area: 400, src: -1, ord: 0 },
};
const colors = {
  [BODY]: { part: '#6b7280', faces: [face] },
};

function fileFor(extra = {}) {
  return {
    format: 'surfcad.assembly',
    version: 1,
    name: 'Gearbox',
    activeId: GB,
    parts: [{
      id: BODY,
      path: GB,
      name: 'Bracket',
      visible: true,
      order: 0,
    }],
    ...extra,
  };
}

console.log('version 1 round trip');
{
  const doc = serializeAssembly({
    source: 'git',
    name: 'Gearbox',
    activeId: GB,
    parts: [{ id: GB, name: 'Bracket', visible: true, order: 0, surfId: BODY }],
    colors,
  });
  eq('in-app document keeps colors', doc.colors, colors);
  ok('version stays 1', doc.version === 1 && toSurfJson(doc).version === 1);
  const text = stringifySurfJson(doc);
  ok('file has colors', text.includes('"colors"') && text.includes('#e11d48'));
  eq('parse then save is stable', stringifySurfJson(parseSurfJson(text)), text);
  const bare = serializeAssembly({
    source: 'git',
    name: 'Gearbox',
    activeId: GB,
    parts: [{ id: GB, name: 'Bracket', visible: true, order: 0, surfId: BODY }],
    colors: {},
  });
  ok('empty colors are omitted', bare.colors == null && !stringifySurfJson(bare).includes('"colors"'));
  const local = parseAssemblyDocument({
    version: 1,
    source: 'local',
    name: 'Assembly',
    activeId: 'local:1',
    parts: [{ id: 'local:1', name: 'Part', visible: true, order: 0, surfId: BODY, isSynced: false }],
    colors,
  });
  eq('local document keeps colors', local.colors, colors);
  ok('isSynced stays off .surf.json', !stringifySurfJson({ ...doc, source: 'git' }).includes('isSynced'));
  const gone = removePart(doc, GB);
  ok('removing the part drops its colors', gone.colors == null);
}

console.log('\nvalidate');
{
  const good = validateSurfJson(fileFor({ colors }));
  ok('lowercase hex validates', good.ok, (good.errors || []).join('; '));
  const legacy = validateSurfJson(fileFor({
    parts: [{ id: LOCAL, path: GB, name: 'Bracket', visible: true, order: 0 }],
    colors: { [LOCAL]: { part: '#aabbcc' } },
  }));
  ok('legacy local- color key still validates', legacy.ok, (legacy.errors || []).join('; '));
  const upper = validateSurfJson(fileFor({ colors: { [BODY]: { part: '#AABBCC' } } }));
  ok('uppercase hex is rejected', !upper.ok && upper.errors.some((e) => e.includes('#rrggbb')));
  const short = validateSurfJson(fileFor({ colors: { [BODY]: { part: '#abc' } } }));
  ok('short hex is rejected', !short.ok);
  const unknown = validateSurfJson(fileFor({ colors: { [BODY]: { part: '#aabbcc', tint: '#112233' } } }));
  ok('unknown entry key is rejected', !unknown.ok && unknown.errors.some((e) => e.includes('unknown key "tint"')));
  const faceKey = validateSurfJson(fileFor({
    colors: { [BODY]: { faces: [{ color: '#aabbcc', key: { at: [0, 0, 0], n: [0, 0, 1], area: 1, bbox: [0, 0, 0] } }] } },
  }));
  ok('unknown face-key field is rejected', !faceKey.ok && faceKey.errors.some((e) => e.includes('unknown key "bbox"')));
  const half = validateSurfJson(fileFor({
    colors: { [BODY]: { faces: [{ color: '#aabbcc', key: { at: [0, 0, 0], n: [0, 0, 1], area: 1, src: -1 } }] } },
  }));
  ok('src without ord is rejected', !half.ok && half.errors.some((e) => e.includes('src and ord')));
  const positive = validateSurfJson(fileFor({
    colors: { [BODY]: { faces: [{ color: '#aabbcc', key: { at: [0, 0, 0], n: [0, 0, 1], area: 1, src: 2, ord: 0 } }] } },
  }));
  ok('positive src is rejected', !positive.ok && positive.errors.some((e) => e.includes('negative')));
  const empty = validateSurfJson(fileFor({ colors: {} }));
  ok('empty colors object is rejected', !empty.ok && empty.errors.some((e) => e.includes('omitted')));
  const badKey = validateSurfJson(fileFor({ colors: { red: { part: '#aabbcc' } } }));
  ok('non-surf color key is rejected', !badKey.ok && badKey.errors.some((e) => e.includes('surf id')));
  const dangling = fileFor({
    colors: { [BODY]: { part: '#112233' }, [OTHER]: { part: '#aabbcc' } },
  });
  const direct = validateSurfJson(dangling);
  ok('dangling surf id fails validate', !direct.ok && direct.errors.some((e) => e.includes(OTHER)));
  const loaded = parseSurfJson(dangling);
  eq('load prunes a surf id that is not a part', loaded.colors, { [BODY]: { part: '#112233' } });
  ok('pruned file validates', validateSurfJson(toSurfJson(loaded)).ok);
  const oldFile = fileFor();
  ok('a file with no colors still validates', validateSurfJson(oldFile).ok);
  eq('a file with no colors loads without the key', parseSurfJson(oldFile).colors, undefined);
}

console.log('\nmigration rewrites color keys');
{
  const painted = stringifySurfJson({
    source: 'git',
    name: 'Gearbox',
    activeId: GB,
    parts: [{ id: GB, name: 'Bracket', visible: true, order: 0, surfId: LOCAL }],
    colors: { [LOCAL]: { part: '#aabbcc', faces: [face] } },
  });
  const bareFile = JSON.parse(stringifySurfJson({
    source: 'git',
    name: 'Gearbox',
    activeId: GB,
    parts: [{ id: GB, name: 'Bracket', visible: true, order: 0, surfId: BODY }],
  }));
  const both = JSON.parse(painted);
  both.parts[0].id = BODY;
  both.colors = { [BODY]: { part: '#111111' }, [LOCAL]: { part: '#222222' } };
  const bothText = `${JSON.stringify(both, null, 2)}\n`;
  const onlyPrefixed = bareFile;
  onlyPrefixed.colors = { [LOCAL]: { part: '#aabbcc' } };
  const onlyText = `${JSON.stringify(onlyPrefixed, null, 2)}\n`;
  const once = planSurfIdMigrationCommit([
    { path: GB, content: withSurfId('return 1;\n', LOCAL) },
    { path: assemblyFilePath('Gearbox'), content: painted },
    { path: assemblyFilePath('Cover'), content: bothText },
    { path: assemblyFilePath('Plate'), content: onlyText },
  ]);
  const gear = parseSurfJson(once.files.find((file) => file.path === assemblyFilePath('Gearbox')).content);
  eq('part id and color key keep the body', [gear.parts[0].surfId, gear.colors], [BODY, { [BODY]: { part: '#aabbcc', faces: [face] } }]);
  const cover = parseSurfJson(once.files.find((file) => file.path === assemblyFilePath('Cover')).content);
  eq('bare color key wins over the prefixed duplicate', cover.colors, { [BODY]: { part: '#111111' } });
  const plate = parseSurfJson(once.files.find((file) => file.path === assemblyFilePath('Plate')).content);
  eq('a prefixed key whose part is already bare is renamed', plate.colors, { [BODY]: { part: '#aabbcc' } });
  const after = [
    { path: GB, content: withSurfId('return 1;\n', BODY) },
    { path: assemblyFilePath('Gearbox'), content: once.files.find((file) => file.path === assemblyFilePath('Gearbox')).content },
  ];
  ok('color migration second pass is a no-op', planSurfIdMigrationCommit(after).changed === false);
  const local = migrateAssemblyRecords({
    doc: {
      name: 'Gearbox',
      source: 'git',
      parts: [{ id: GB, name: 'Bracket', surfId: LOCAL }],
      colors: { [LOCAL]: { part: '#aabbcc' } },
    },
    scripts: {},
  });
  eq('working copy color key keeps the body', local.doc.colors, { [BODY]: { part: '#aabbcc' } });
  eq('working copy surf id keeps the body', local.doc.parts[0].surfId, BODY);
  ok('working copy second pass is a no-op', migrateAssemblyRecords({ doc: local.doc, scripts: {} }).changed === false);
  const op = migrateOutboxOp({
    op: 'save',
    files: [fileWrite(assemblyFilePath('Gearbox'), painted)],
    payload: { colors: { [LOCAL]: { part: '#aabbcc' } } },
  });
  eq('outbox payload color key keeps the body', op.payload.colors, { [BODY]: { part: '#aabbcc' } });
  eq('outbox file color key keeps the body', parseSurfJson(op.files[0].content).colors[BODY].part, '#aabbcc');
}

console.log('\ncopy does not copy colors');
{
  const doc = serializeAssembly({
    source: 'git',
    name: 'Gearbox',
    activeId: GB,
    parts: [
      { id: GB, name: 'Bracket', visible: true, order: 0, surfId: BODY },
      { id: LID, name: 'Lid', visible: true, order: 1, surfId: OTHER },
    ],
    groups: [{ id: GROUP, name: 'Cover', source: assemblyFilePath('Cover'), partIds: [OTHER] }],
    colors: {
      [BODY]: { part: '#112233' },
      [OTHER]: { part: '#6b7280', faces: [face] },
    },
  });
  const plan = planCopyToAssembly(doc, doc.parts[1], 'return 1;\n', { now: WHEN, rand: 'e1e1' });
  ok('copy plan has a new id', plan.surfId !== OTHER && !String(plan.surfId).startsWith('local-'));
  const copied = copyGroupToAssembly(doc, { [LID]: 'return 1;\n' }, GROUP, {
    now: WHEN,
    randFor: () => 'e1e1',
  });
  eq('sibling color stays', copied.doc.colors, { [BODY]: { part: '#112233' } });
  // The copied row is id-only (no path) until its first Save, so the v1
  // serializer cannot take the document; the color map on the doc is the
  // same map the writer would serialize.
  ok('new id is uncolored', (copied.doc.colors || {})[copied.copies[0].surfId] == null);
}

if (failed) {
  console.log(`\nface colors: ${failed} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`\nface colors: ${passed} passed`);

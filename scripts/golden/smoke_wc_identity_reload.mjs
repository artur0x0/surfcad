#!/usr/bin/env node
/**
 * PR 2: UUID working-copy boot then reload. Paint, joints, and FEA study
 * part refs follow the collapsed surf-ids and stay put on the second pass.
 * Mock / in-memory only — no Chrome, no git writes.
 */
import { collapseWorkingCopyIds } from '../../src/utils/git/wcIdentity.js';
import { isSurfId, mintSurfId, partSurfId } from '../../src/utils/git/surfId.js';
import { composeViewportParts } from '../../src/utils/assembly.js';
import { normalizeAssemblyJoints } from '../../src/utils/jointSchema.js';

let failed = 0;
let passed = 0;
function ok(name, cond, extra = '') {
  if (cond) { passed += 1; console.log(`  ✅ ${name}`); }
  else { failed += 1; console.log(`  ❌ ${name}${extra ? ` — ${extra}` : ''}`); }
}

const UUID_A = '5f0c3c1e-0000-4000-8000-00000000aaa1';
const UUID_B = '5f0c3c1e-0000-4000-8000-00000000bbb2';
const NOW = new Date('2026-10-18T12:00:00.000Z');
const JOINT_ID = mintSurfId({ now: NOW, rand: 'j01a' });
const ASM = mintSurfId({ now: NOW, rand: 'aa01' });

const FACE_A = {
  faceID: 1, at: [0, 0, 0], n: [0, 0, 1], area: 100, part: UUID_A,
};
const FACE_B = {
  faceID: 2, at: [10, 0, 0], n: [1, 0, 0], area: 100, part: UUID_B,
};
const STUDY = {
  v: 1,
  id: 's1',
  name: 'Static 1',
  type: 'linear-static',
  material: { id: 'al-6061-t6' },
  fixtures: [{ kind: 'fixed', faces: [FACE_A] }],
  loads: [{ kind: 'force', faces: [FACE_B], vector: [0, 0, -1] }],
  scope: { kind: 'parts', ids: [UUID_A, UUID_B] },
  parts: [
    { id: UUID_A, material: { id: 'al-6061-t6' } },
    { id: UUID_B, material: { id: 'al-6061-t6' } },
  ],
  contacts: [{ kind: 'bonded', a: { part: UUID_A, faceID: 1 }, b: { part: UUID_B, faceID: 2 } }],
  result: null,
};
const SCRIPT_A = `return Manifold.cube([20, 20, 20], true);
// --- fea-study begin ---
// @fea-study ${JSON.stringify(STUDY)}
// --- fea-study end ---
`;

function readStudy(script) {
  const tag = '// @fea-study ';
  const line = String(script || '').split('\n').find((row) => row.startsWith(tag));
  return line ? JSON.parse(line.slice(tag.length)) : null;
}

console.log('wc identity — UUID boot then reload');

const doc = {
  source: 'git',
  name: 'Reload',
  activeId: UUID_A,
  parts: [
    { id: UUID_A, name: 'Left', visible: true, order: 0, position: [0, 0, 0] },
    { id: UUID_B, name: 'Right', visible: true, order: 1, position: [80, 0, 0] },
  ],
  colors: { [UUID_A]: { part: '#ff0000' }, [UUID_B]: { part: '#00ff00' } },
  joints: [
    { id: JOINT_ID, name: 'Fixed 1', type: 'fixed', a: { part: UUID_A } },
    { id: mintSurfId({ now: NOW, rand: 'j02b' }), name: 'Fixed 2', type: 'fixed', a: { part: UUID_B } },
  ],
};
const scripts = {
  [UUID_A]: SCRIPT_A,
  [UUID_B]: 'return Manifold.cube([10, 10, 10], true);\n',
};
const randFor = (part) => {
  if (part?.id === '$assembly') return 'aa01';
  if (part?.id === UUID_B) return 'bbb2';
  return 'aaa1';
};

const boot = collapseWorkingCopyIds(doc, scripts, { now: NOW, randFor });
const idA = boot.doc.parts[0].id;
const idB = boot.doc.parts[1].id;
ok('boot mints surf-ids', isSurfId(idA) && isSurfId(idB) && idA !== UUID_A && idB !== UUID_B);
ok('boot assembly id is stable', boot.doc.id === ASM);
ok('boot activeId follows Left', boot.doc.activeId === idA);
ok('paint colors move to the new ids', boot.doc.colors[idA]?.part === '#ff0000' && boot.doc.colors[idB]?.part === '#00ff00');
ok('paint does not keep UUID keys', !Object.hasOwn(boot.doc.colors, UUID_A) && !Object.hasOwn(boot.doc.colors, UUID_B));
const joints = normalizeAssemblyJoints(boot.doc.joints, boot.doc.parts);
ok('joint on Left follows collapse', joints?.[0]?.a?.part === idA);
ok('joint on Right follows collapse', joints?.[1]?.a?.part === idB);
ok('partSurfId is the collapsed id', partSurfId(boot.doc.parts[0]) === idA);
const mesh = { vertProperties: new Float32Array(9), triVerts: new Uint32Array(3) };
const solids = composeViewportParts(boot.doc, {
  [idA]: { ok: true, mesh },
  [idB]: { ok: true, mesh },
});
ok('viewport solids paint with collapsed ids', solids[0].surfId === idA && solids[1].surfId === idB);

const study = readStudy(boot.scripts[idA]);
ok('FEA fixture face.part is Left', study?.fixtures?.[0]?.faces?.[0]?.part === idA);
ok('FEA load face.part is Right', study?.loads?.[0]?.faces?.[0]?.part === idB);
ok('FEA contact a/b follow the new ids', study?.contacts?.[0]?.a?.part === idA && study?.contacts?.[0]?.b?.part === idB);
ok('FEA scope.ids follow the new ids', JSON.stringify(study?.scope?.ids) === JSON.stringify([idA, idB]));
ok('FEA body ids follow the new ids', study?.parts?.[0]?.id === idA && study?.parts?.[1]?.id === idB);

const reload = collapseWorkingCopyIds(boot.doc, boot.scripts, {
  now: new Date('2026-10-21T00:00:00.000Z'),
  randFor: () => 'ffff',
});
ok('reload changed:false', reload.changed === false);
ok('reload ids unchanged', reload.doc.parts[0].id === idA && reload.doc.parts[1].id === idB);
ok('reload paint unchanged', reload.doc.colors[idA]?.part === '#ff0000' && reload.doc.colors[idB]?.part === '#00ff00');
ok('reload joints unchanged', reload.doc.joints[0].a.part === idA && reload.doc.joints[1].a.part === idB);
ok('reload FEA script unchanged', reload.scripts[idA] === boot.scripts[idA]);

if (failed) {
  console.log(`\nwc identity reload: ${failed} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`\nwc identity reload: ${passed} passed`);

/**
 * save-model v2 PR 6: pure planSave. One named test per §7 case, plus
 * extras for empty plan, idempotence, shared-part adopt, delete rules,
 * and file-level compare. No git I/O.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { gitBlobSha } from './binaryContent.js';
import { assemblyIdPath, partIdPath, partMeshIdPath } from './idPaths.js';
import { makeAssemblyCommit, makeBranchTip } from './lastCommit.js';
import { planSave } from './planSave.js';
import { mintSurfId, withSurfId, withSurfName } from './surfId.js';
import { stringifySurfJsonV2, toSurfJsonV2 } from './surfJsonV2.js';

const REPO = { owner: 'artur', name: 'surfcad-vault' };
const TIP = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const REMOTE = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const NOW = 1_700_000_000_000;
const A = mintSurfId({ now: new Date('2026-10-18T02:50:00.001Z'), rand: 'aa01' });
const B = mintSurfId({ now: new Date('2026-10-18T02:50:00.002Z'), rand: 'bb02' });
const P = mintSurfId({ now: new Date('2026-10-18T02:50:00.003Z'), rand: 'cc03' });
const Q = mintSurfId({ now: new Date('2026-10-18T02:50:00.004Z'), rand: 'dd04' });
const BODY = 'return 1;\n';
const BODY_Q = 'return 2;\n';
const MESH = new Uint8Array([1, 2, 3, 4]);

function blobHash(content) {
  if (typeof content === 'string') return gitBlobSha(new TextEncoder().encode(content));
  return gitBlobSha(content);
}

function stamped(script, id, name) {
  return withSurfName(withSurfId(script, id), name);
}

function row(id, name, extra = {}) {
  return {
    id,
    name,
    visible: true,
    order: extra.order ?? 0,
    ...extra,
  };
}

function doc(id, name, parts, extra = {}) {
  return {
    id,
    name,
    source: 'git',
    rev: 1,
    activeId: extra.activeId !== undefined ? extra.activeId : (parts[0]?.id ?? null),
    parts,
    vaultLayout: 'v2',
    ...extra,
  };
}

function wc(assembly, scripts, extra = {}) {
  return { ...assembly, scripts, now: NOW, ...extra };
}

function tip(sha = TIP) {
  return makeBranchTip({ repo: REPO, branch: 'main', tipSha: sha });
}

function commitFrom(assembly, scripts, meshes = {}) {
  const json = toSurfJsonV2(assembly);
  const files = {
    [assemblyIdPath(assembly.id)]: { contentHash: blobHash(stringifySurfJsonV2(assembly)) },
  };
  for (const part of assembly.parts || []) {
    const script = scripts?.[part.id];
    if (typeof script === 'string') {
      files[partIdPath(part.id)] = { contentHash: blobHash(stamped(script, part.id, part.name)) };
    }
    const mesh = meshes[part.id];
    if (mesh) files[partMeshIdPath(part.id)] = { contentHash: blobHash(mesh) };
  }
  return makeAssemblyCommit({
    assemblyId: assembly.id,
    files,
    json,
    capturedAt: NOW,
  });
}

function pathsOf(files) {
  return (files || []).map((file) => file.path).sort();
}

function deletesOf(files) {
  return (files || []).filter((file) => file.delete).map((file) => file.path).sort();
}

function writeAt(files, path) {
  return (files || []).find((file) => file.path === path && !file.delete) || null;
}

function compare(paths) {
  return {
    status: 'ahead',
    files: paths.map((path) => ({ path, status: 'modified' })),
  };
}

function plan(branchTip, assemblyCommit, workingCopy, remoteTip, compareFiles) {
  return planSave(branchTip, assemblyCommit, workingCopy, remoteTip, compareFiles);
}

test('§7 case 1: new assembly', () => {
  const assembly = doc(A, 'Gear Box', [row(P, 'Seed Cube')]);
  const working = wc(assembly, { [P]: BODY }, { meshes: { [P]: MESH } });
  const result = plan(tip(null), null, working, REMOTE, compare([
    assemblyIdPath(A),
    partIdPath(P),
  ]));
  assert.equal(result.conflict, undefined);
  assert.deepEqual(pathsOf(result.files), [
    assemblyIdPath(A),
    partIdPath(P),
    partMeshIdPath(P),
  ]);
  assert.equal(writeAt(result.files, assemblyIdPath(A)).content, stringifySurfJsonV2(assembly));
  assert.equal(writeAt(result.files, partIdPath(P)).content, stamped(BODY, P, 'Seed Cube'));
  assert.deepEqual(writeAt(result.files, partMeshIdPath(P)).content, MESH);
  assert.equal(result.files.some((file) => file.path === 'README.md'), false);
  assert.equal(result.files.some((file) => file.path === 'surfcad.json'), false);
  assert.equal(result.nextAssemblyCommit.json.name, 'Gear Box');
  assert.equal(result.nextAssemblyCommit.json.parts[0].path, undefined);

  const collision = plan(
    tip(TIP),
    null,
    working,
    REMOTE,
    compare([assemblyIdPath(A)]),
  );
  assert.equal(collision.conflict, true);
  assert.deepEqual(collision.paths, [assemblyIdPath(A)]);
});

test('§7 case 2: assembly rename', () => {
  const before = doc(A, 'Gearbox', [row(P, 'Bracket')]);
  const after = doc(A, 'Gearbox Two', [row(P, 'Bracket')]);
  const scripts = { [P]: BODY };
  const result = plan(tip(), commitFrom(before, scripts), wc(after, scripts), TIP, []);
  assert.equal(result.conflict, undefined);
  assert.deepEqual(pathsOf(result.files), [assemblyIdPath(A)]);
  assert.equal(deletesOf(result.files).length, 0);
  assert.match(writeAt(result.files, assemblyIdPath(A)).content, /"name": "Gearbox Two"/);
  assert.equal(result.nextAssemblyCommit.json.id, A);
});

test('§7 case 3: new part', () => {
  const before = doc(A, 'Gearbox', [row(P, 'Bracket')]);
  const after = doc(A, 'Gearbox', [row(P, 'Bracket'), row(Q, 'Shaft', { order: 1 })]);
  const result = plan(
    tip(),
    commitFrom(before, { [P]: BODY }),
    wc(after, { [P]: BODY, [Q]: BODY_Q }, { meshes: { [Q]: MESH } }),
    TIP,
    [],
  );
  assert.equal(result.conflict, undefined);
  assert.deepEqual(pathsOf(result.files), [
    assemblyIdPath(A),
    partIdPath(Q),
    partMeshIdPath(Q),
  ]);
  assert.equal(writeAt(result.files, partIdPath(Q)).content, stamped(BODY_Q, Q, 'Shaft'));
  assert.equal(writeAt(result.files, partIdPath(P)), null);
});

test('§7 case 4: part rename, one parent', () => {
  const before = doc(A, 'Gearbox', [row(P, 'Bracket')]);
  const after = doc(A, 'Gearbox', [row(P, 'Brace')]);
  const result = plan(
    tip(),
    commitFrom(before, { [P]: BODY }),
    wc(after, { [P]: BODY }),
    TIP,
    [],
  );
  assert.equal(result.conflict, undefined);
  assert.deepEqual(pathsOf(result.files), [assemblyIdPath(A), partIdPath(P)]);
  assert.equal(writeAt(result.files, partIdPath(P)).content, stamped(BODY, P, 'Brace'));
  assert.match(writeAt(result.files, assemblyIdPath(A)).content, /"name": "Brace"/);
  assert.equal(deletesOf(result.files).length, 0);
});

test('§7 case 5: part rename, several parents', () => {
  const beforeA = doc(A, 'Gearbox', [row(P, 'Bracket')]);
  const afterA = doc(A, 'Gearbox', [row(P, 'Brace')]);
  const bDoc = doc(B, 'Cover', [row(P, 'Bracket')]);
  const bCommit = commitFrom(bDoc, { [P]: BODY });
  const result = plan(
    tip(),
    commitFrom(beforeA, { [P]: BODY }),
    wc(afterA, { [P]: BODY }, { otherAssemblyCommits: [bCommit] }),
    TIP,
    [],
  );
  assert.equal(result.conflict, undefined);
  assert.deepEqual(pathsOf(result.files), [assemblyIdPath(A), partIdPath(P)]);
  assert.equal(result.files.some((file) => file.path === assemblyIdPath(B)), false);
  assert.equal(result.adopt.length, 1);
  assert.equal(result.adopt[0].assemblyId, B);
  assert.equal(
    result.adopt[0].files[partIdPath(P)].contentHash,
    blobHash(stamped(BODY, P, 'Brace')),
  );
});

test('§7 case 6: existing part added (reference)', () => {
  const before = doc(A, 'Gearbox', [row(Q, 'Shaft')]);
  const after = doc(A, 'Gearbox', [row(Q, 'Shaft'), row(P, 'Bracket', { order: 1 })]);
  const bCommit = commitFrom(doc(B, 'Cover', [row(P, 'Bracket')]), { [P]: BODY });
  const result = plan(
    tip(),
    commitFrom(before, { [Q]: BODY_Q }),
    wc(after, { [Q]: BODY_Q, [P]: BODY }, { otherAssemblyCommits: [bCommit] }),
    TIP,
    [],
  );
  assert.equal(result.conflict, undefined);
  assert.deepEqual(pathsOf(result.files), [assemblyIdPath(A)]);
  assert.equal(writeAt(result.files, partIdPath(P)), null);
  assert.match(writeAt(result.files, assemblyIdPath(A)).content, new RegExp(P));
  assert.equal(result.nextAssemblyCommit.json.parts.some((part) => part.id === P), true);
});

test('§7 case 7: remote changed part-only', () => {
  const before = doc(A, 'Gearbox', [row(P, 'Bracket'), row(Q, 'Shaft', { order: 1 })]);
  const painted = doc(A, 'Gearbox', [row(P, 'Bracket'), row(Q, 'Shaft', { order: 1 })], {
    colors: { [P]: { part: '#ff0000' } },
  });
  const scripts = { [P]: BODY, [Q]: BODY_Q };
  const assemblyOnly = plan(
    tip(TIP),
    commitFrom(before, scripts),
    wc(painted, scripts),
    REMOTE,
    compare([partIdPath(P)]),
  );
  assert.equal(assemblyOnly.conflict, undefined);
  assert.deepEqual(pathsOf(assemblyOnly.files), [assemblyIdPath(A)]);

  const edited = doc(A, 'Gearbox', [row(P, 'Bracket'), row(Q, 'Shaft', { order: 1 })]);
  const partTouch = plan(
    tip(TIP),
    commitFrom(before, scripts),
    wc(edited, { [P]: 'return 9;\n', [Q]: BODY_Q }),
    REMOTE,
    compare([partIdPath(P)]),
  );
  assert.equal(partTouch.conflict, true);
  assert.deepEqual(partTouch.paths, [partIdPath(P)]);
});

test('§7 case 8: remote changed assembly', () => {
  const beforeA = doc(A, 'Gearbox', [row(P, 'Bracket')]);
  const afterA = doc(A, 'Gearbox Two', [row(P, 'Bracket')]);
  const ofA = plan(
    tip(TIP),
    commitFrom(beforeA, { [P]: BODY }),
    wc(afterA, { [P]: BODY }),
    REMOTE,
    compare([assemblyIdPath(A)]),
  );
  assert.equal(ofA.conflict, true);
  assert.deepEqual(ofA.paths, [assemblyIdPath(A)]);

  const beforeB = doc(B, 'Cover', [row(Q, 'Lid')]);
  const afterB = doc(B, 'Cover Two', [row(Q, 'Lid')]);
  const ofB = plan(
    tip(TIP),
    commitFrom(beforeB, { [Q]: BODY_Q }),
    wc(afterB, { [Q]: BODY_Q }),
    REMOTE,
    compare([assemblyIdPath(A)]),
  );
  assert.equal(ofB.conflict, undefined);
  assert.deepEqual(pathsOf(ofB.files), [assemblyIdPath(B)]);
});

test('§7 case 9: overwrite assembly', () => {
  const before = doc(A, 'Gearbox', [row(P, 'Bracket')]);
  const after = doc(A, 'Mine', [row(P, 'Bracket')]);
  const result = plan(
    tip(REMOTE),
    commitFrom(before, { [P]: BODY }),
    wc(after, { [P]: BODY }),
    REMOTE,
    compare([assemblyIdPath(A), partIdPath(P)]),
  );
  assert.equal(result.conflict, undefined);
  assert.deepEqual(pathsOf(result.files), [assemblyIdPath(A)]);
  assert.match(writeAt(result.files, assemblyIdPath(A)).content, /"name": "Mine"/);
  assert.equal(writeAt(result.files, partIdPath(P)), null);
});

test('§7 case 10: overwrite part', () => {
  const before = doc(A, 'Gearbox', [row(P, 'Bracket')]);
  const result = plan(
    tip(REMOTE),
    commitFrom(before, { [P]: BODY }),
    wc(before, { [P]: 'return 9;\n' }),
    REMOTE,
    compare([assemblyIdPath(A), partIdPath(P)]),
  );
  assert.equal(result.conflict, undefined);
  assert.deepEqual(pathsOf(result.files), [partIdPath(P)]);
  assert.equal(writeAt(result.files, partIdPath(P)).content, stamped('return 9;\n', P, 'Bracket'));
  assert.equal(writeAt(result.files, assemblyIdPath(A)), null);
});

test('§7 case 11: overwrite both', () => {
  const before = doc(A, 'Gearbox', [row(P, 'Bracket')]);
  const after = doc(A, 'Mine', [row(P, 'Bracket')]);
  const result = plan(
    tip(REMOTE),
    commitFrom(before, { [P]: BODY }),
    wc(after, { [P]: 'return 9;\n' }),
    REMOTE,
    compare([assemblyIdPath(A), partIdPath(P), assemblyIdPath(B)]),
  );
  assert.equal(result.conflict, undefined);
  assert.deepEqual(pathsOf(result.files), [assemblyIdPath(A), partIdPath(P)]);
  assert.match(writeAt(result.files, assemblyIdPath(A)).content, /"name": "Mine"/);
  assert.equal(writeAt(result.files, partIdPath(P)).content, stamped('return 9;\n', P, 'Bracket'));
  assert.equal(result.files.some((file) => file.path === assemblyIdPath(B)), false);
});

test('§7 case 12: normal save', () => {
  const before = doc(A, 'Gearbox', [
    row(P, 'Bracket'),
    row(Q, 'Shaft', { order: 1 }),
  ]);
  const after = doc(A, 'Gearbox', [row(P, 'Brace')], {
    colors: { [P]: { part: '#00ff00' } },
  });
  const result = plan(
    tip(TIP),
    commitFrom(before, { [P]: BODY, [Q]: BODY_Q }, { [Q]: MESH }),
    wc(after, { [P]: 'return 3;\n' }),
    TIP,
    compare([assemblyIdPath(B), 'README.md']),
  );
  assert.equal(result.conflict, undefined);
  assert.deepEqual(pathsOf(result.files), [
    assemblyIdPath(A),
    partIdPath(P),
    partIdPath(Q),
    partMeshIdPath(Q),
  ]);
  assert.deepEqual(deletesOf(result.files), [partIdPath(Q), partMeshIdPath(Q)]);
  assert.equal(writeAt(result.files, partIdPath(P)).content, stamped('return 3;\n', P, 'Brace'));
  assert.equal(result.nextAssemblyCommit.files[partIdPath(Q)], undefined);
  assert.equal(result.nextBranchTip.tipSha, TIP);
  assert.equal(
    result.nextAssemblyCommit.files[partIdPath(P)].contentHash,
    blobHash(stamped('return 3;\n', P, 'Brace')),
  );
});

test('unchanged working copy gives an empty plan', () => {
  const assembly = doc(A, 'Gearbox', [row(P, 'Bracket')]);
  const scripts = { [P]: BODY };
  const result = plan(tip(), commitFrom(assembly, scripts), wc(assembly, scripts), TIP, []);
  assert.equal(result.conflict, undefined);
  assert.deepEqual(result.files, []);
  assert.equal(result.nextAssemblyCommit.files[assemblyIdPath(A)].contentHash, blobHash(stringifySurfJsonV2(assembly)));
});

test('planning again from the result tip gives an empty plan', () => {
  const before = doc(A, 'Gearbox', [row(P, 'Bracket')]);
  const after = doc(A, 'Renamed', [row(P, 'Brace')]);
  const first = plan(tip(), commitFrom(before, { [P]: BODY }), wc(after, { [P]: BODY }), TIP, []);
  assert.ok(first.files.length > 0);
  const second = plan(first.nextBranchTip, first.nextAssemblyCommit, wc(after, { [P]: BODY }), TIP, []);
  assert.equal(second.conflict, undefined);
  assert.deepEqual(second.files, []);
});

test('shared part referenced by another assembly is not deleted on delete-from-assembly', () => {
  const before = doc(A, 'Gearbox', [row(P, 'Bracket'), row(Q, 'Shaft', { order: 1 })]);
  const after = doc(A, 'Gearbox', [row(Q, 'Shaft')]);
  const result = plan(
    tip(),
    commitFrom(before, { [P]: BODY, [Q]: BODY_Q }),
    wc(after, { [Q]: BODY_Q }, {
      branchAssemblies: [{ id: B, name: 'Cover', parts: [{ id: P }] }],
    }),
    TIP,
    [],
  );
  assert.equal(result.conflict, undefined);
  assert.equal(deletesOf(result.files).includes(partIdPath(P)), false);
  assert.deepEqual(pathsOf(result.files), [assemblyIdPath(A)]);
  assert.equal(result.partStillReferenced, undefined);
});

test('delete-from-repo of a referenced part is flagged and the file is kept', () => {
  const before = doc(A, 'Gearbox', [row(P, 'Bracket')]);
  const after = doc(A, 'Gearbox', []);
  const result = plan(
    tip(),
    commitFrom(before, { [P]: BODY }),
    wc(after, {}, {
      deleteFromRepo: [P],
      otherAssemblyCommits: [commitFrom(doc(B, 'Cover', [row(P, 'Bracket')]), { [P]: BODY })],
    }),
    TIP,
    [],
  );
  assert.equal(result.conflict, undefined);
  assert.equal(deletesOf(result.files).includes(partIdPath(P)), false);
  assert.equal(result.partStillReferenced.length, 1);
  assert.equal(result.partStillReferenced[0].partId, P);
  assert.deepEqual(result.partStillReferenced[0].assemblies, [{ id: B, name: 'Cover' }]);
  assert.deepEqual(pathsOf(result.files), [assemblyIdPath(A)]);
});

test('remote moved on an unrelated file is not a conflict; the same file is', () => {
  const before = doc(A, 'Gearbox', [row(P, 'Bracket')]);
  const after = doc(A, 'Mine', [row(P, 'Bracket')]);
  const unrelated = plan(
    tip(TIP),
    commitFrom(before, { [P]: BODY }),
    wc(after, { [P]: BODY }),
    REMOTE,
    compare([assemblyIdPath(B), partIdPath(Q), 'README.md']),
  );
  assert.equal(unrelated.conflict, undefined);
  assert.deepEqual(pathsOf(unrelated.files), [assemblyIdPath(A)]);

  const same = plan(
    tip(TIP),
    commitFrom(before, { [P]: BODY }),
    wc(after, { [P]: BODY }),
    REMOTE,
    compare([assemblyIdPath(A)]),
  );
  assert.equal(same.conflict, true);
  assert.deepEqual(same.paths, [assemblyIdPath(A)]);
});

test('shared-part adopt updates B whether B is clean or dirty', () => {
  const beforeA = doc(A, 'Gearbox', [row(P, 'Bracket')]);
  const afterA = doc(A, 'Gearbox', [row(P, 'Bracket')]);
  const bClean = commitFrom(doc(B, 'Cover', [row(P, 'Bracket')]), { [P]: BODY });
  const clean = plan(
    tip(),
    commitFrom(beforeA, { [P]: BODY }),
    wc(afterA, { [P]: 'return 8;\n' }, { otherAssemblyCommits: [bClean] }),
    TIP,
    [],
  );
  assert.equal(clean.files.some((file) => file.path === assemblyIdPath(B)), false);
  assert.equal(clean.adopt[0].assemblyId, B);
  assert.equal(
    clean.adopt[0].files[partIdPath(P)].contentHash,
    blobHash(stamped('return 8;\n', P, 'Bracket')),
  );

  const dirtyScript = 'return 7;\n';
  const bDirty = commitFrom(doc(B, 'Cover', [row(P, 'Bracket')]), { [P]: dirtyScript });
  const dirty = plan(
    tip(),
    commitFrom(beforeA, { [P]: BODY }),
    wc(afterA, { [P]: 'return 8;\n' }, { otherAssemblyCommits: [bDirty] }),
    TIP,
    [],
  );
  assert.equal(dirty.files.some((file) => file.path === assemblyIdPath(B)), false);
  assert.equal(dirty.adopt[0].assemblyId, B);
  assert.equal(
    dirty.adopt[0].files[partIdPath(P)].contentHash,
    blobHash(stamped('return 8;\n', P, 'Bracket')),
  );
});

test('copiedFrom is not a reference; last parent still deletes the file', () => {
  const before = doc(A, 'Gearbox', [row(P, 'Bracket')]);
  const after = doc(A, 'Gearbox', []);
  const copy = doc(B, 'Cover', [row(Q, 'Bracket copy', { copiedFrom: P })]);
  const result = plan(
    tip(),
    commitFrom(before, { [P]: BODY }),
    wc(after, {}, { otherAssemblyCommits: [commitFrom(copy, { [Q]: BODY })] }),
    TIP,
    [],
  );
  assert.deepEqual(deletesOf(result.files), [partIdPath(P)]);
});

test('missing part does not synthesize an empty script', () => {
  const assembly = doc(A, 'Gearbox', [row(P, 'Bracket', { missing: true })]);
  const committed = makeAssemblyCommit({
    assemblyId: A,
    files: {
      [assemblyIdPath(A)]: { contentHash: blobHash(stringifySurfJsonV2(assembly)) },
    },
    json: toSurfJsonV2(assembly),
    capturedAt: NOW,
  });
  const result = plan(tip(), committed, wc(assembly, {}), TIP, []);
  assert.equal(result.conflict, undefined);
  assert.deepEqual(result.files, []);
  assert.equal(result.nextAssemblyCommit.json.parts[0].id, P);
  assert.equal(result.nextAssemblyCommit.files[partIdPath(P)], undefined);
});

test('truncated compare on a non-empty plan is a fail-closed conflict', () => {
  const before = doc(A, 'Gearbox', [row(P, 'Bracket')]);
  const after = doc(A, 'Mine', [row(P, 'Bracket')]);
  const result = plan(
    tip(TIP),
    commitFrom(before, { [P]: BODY }),
    wc(after, { [P]: BODY }),
    REMOTE,
    { status: 'ahead', truncated: true, files: [] },
  );
  assert.equal(result.conflict, true);
  assert.deepEqual(result.paths, [assemblyIdPath(A)]);
});

test('planSave does not import or call commitFiles / createRepo', () => {
  const src = readFileSync(new URL('./planSave.js', import.meta.url), 'utf8');
  assert.equal(/commitFiles/.test(src), false);
  assert.equal(/createRepo/.test(src), false);
  assert.equal(/adapter\.compare/.test(src), false);
});

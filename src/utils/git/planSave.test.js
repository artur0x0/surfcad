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
const R = mintSurfId({ now: new Date('2026-10-18T02:50:00.005Z'), rand: 'ee05' });
const GROUP = mintSurfId({ now: new Date('2026-10-18T02:50:00.006Z'), rand: 'ff06' });
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
    // Files are per definition: an instance row (instanceOf) adds none.
    if (part.instanceOf) continue;
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
    wc(after, { [P]: 'return 3;\n' }, { branchAssemblies: [] }),
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
    wc(after, {}, {
      branchAssemblies: [],
      otherAssemblyCommits: [commitFrom(copy, { [Q]: BODY })],
    }),
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

test('§7 cases 2–6: remote change to a planned file is a conflict', () => {
  const scriptsP = { [P]: BODY };
  const case2 = plan(
    tip(TIP),
    commitFrom(doc(A, 'Gearbox', [row(P, 'Bracket')]), scriptsP),
    wc(doc(A, 'Gearbox Two', [row(P, 'Bracket')]), scriptsP),
    REMOTE,
    compare([assemblyIdPath(A)]),
  );
  assert.equal(case2.conflict, true);
  assert.deepEqual(case2.paths, [assemblyIdPath(A)]);

  const before3 = doc(A, 'Gearbox', [row(P, 'Bracket')]);
  const after3 = doc(A, 'Gearbox', [row(P, 'Bracket'), row(Q, 'Shaft', { order: 1 })]);
  const wc3 = wc(after3, { [P]: BODY, [Q]: BODY_Q }, { meshes: { [Q]: MESH } });
  const commit3 = commitFrom(before3, { [P]: BODY });
  for (const path of [assemblyIdPath(A), partIdPath(Q), partMeshIdPath(Q)]) {
    const hit = plan(tip(TIP), commit3, wc3, REMOTE, compare([path]));
    assert.equal(hit.conflict, true, path);
    assert.deepEqual(hit.paths, [path]);
  }

  const case4 = plan(
    tip(TIP),
    commitFrom(doc(A, 'Gearbox', [row(P, 'Bracket')]), scriptsP),
    wc(doc(A, 'Gearbox', [row(P, 'Brace')]), scriptsP),
    REMOTE,
    compare([partIdPath(P)]),
  );
  assert.equal(case4.conflict, true);
  assert.deepEqual(case4.paths, [partIdPath(P)]);

  const case5 = plan(
    tip(TIP),
    commitFrom(doc(A, 'Gearbox', [row(P, 'Bracket')]), scriptsP),
    wc(doc(A, 'Gearbox', [row(P, 'Brace')]), scriptsP, {
      otherAssemblyCommits: [commitFrom(doc(B, 'Cover', [row(P, 'Bracket')]), scriptsP)],
    }),
    REMOTE,
    compare([assemblyIdPath(A), partIdPath(P)]),
  );
  assert.equal(case5.conflict, true);
  assert.deepEqual(case5.paths, [assemblyIdPath(A), partIdPath(P)]);

  const before6 = doc(A, 'Gearbox', [row(Q, 'Shaft')]);
  const after6 = doc(A, 'Gearbox', [row(Q, 'Shaft'), row(P, 'Bracket', { order: 1 })]);
  const bCommit = commitFrom(doc(B, 'Cover', [row(P, 'Bracket')]), scriptsP);
  const wc6 = wc(after6, { [Q]: BODY_Q, [P]: BODY }, { otherAssemblyCommits: [bCommit] });
  const commit6 = commitFrom(before6, { [Q]: BODY_Q });
  const case6asm = plan(tip(TIP), commit6, wc6, REMOTE, compare([assemblyIdPath(A)]));
  assert.equal(case6asm.conflict, true);
  assert.deepEqual(case6asm.paths, [assemblyIdPath(A)]);
  const case6part = plan(tip(TIP), commit6, wc6, REMOTE, compare([partIdPath(P)]));
  assert.equal(case6part.conflict, undefined);
  assert.deepEqual(pathsOf(case6part.files), [assemblyIdPath(A)]);
});

test('§7 case 6: copy instead writes a new id + copiedFrom', () => {
  const before = doc(A, 'Gearbox', [row(Q, 'Shaft')]);
  const after = doc(A, 'Gearbox', [
    row(Q, 'Shaft'),
    row(R, 'Bracket', { order: 1, copiedFrom: P }),
  ]);
  const result = plan(
    tip(),
    commitFrom(before, { [Q]: BODY_Q }),
    wc(after, { [Q]: BODY_Q, [R]: BODY }),
    TIP,
    [],
  );
  assert.equal(result.conflict, undefined);
  assert.deepEqual(pathsOf(result.files), [assemblyIdPath(A), partIdPath(R)]);
  assert.equal(writeAt(result.files, partIdPath(P)), null);
  assert.equal(writeAt(result.files, partIdPath(R)).content, stamped(BODY, R, 'Bracket'));
  const copied = result.nextAssemblyCommit.json.parts.find((part) => part.id === R);
  assert.equal(copied.copiedFrom, P);
});

test('M1: null or invalid remoteTip refuses a writable plan', () => {
  const assembly = doc(A, 'Gearbox', [row(P, 'Bracket')]);
  const committed = commitFrom(assembly, { [P]: BODY });
  const dirty = wc(assembly, { [P]: 'return 9;\n' });

  const missingRemote = plan(tip(TIP), committed, dirty, null, null);
  assert.equal(missingRemote.conflict, true);
  assert.deepEqual(missingRemote.paths, [partIdPath(P)]);
  assert.equal(missingRemote.files, undefined);

  const branchName = plan(tip(TIP), committed, dirty, 'main', compare([partIdPath(P)]));
  assert.equal(branchName.conflict, true);
  assert.deepEqual(branchName.paths, [partIdPath(P)]);
  assert.equal(branchName.files, undefined);
});

test('M2: omitted reference inputs refuse a part-file delete', () => {
  const before = doc(A, 'Gearbox', [row(P, 'Bracket'), row(Q, 'Shaft', { order: 1 })]);
  const after = doc(A, 'Gearbox', [row(Q, 'Shaft')]);
  assert.throws(
    () => plan(tip(), commitFrom(before, { [P]: BODY, [Q]: BODY_Q }), wc(after, { [Q]: BODY_Q }), TIP, []),
    /part file delete requires branchAssemblies from the current remote tip/,
  );
});

test('L-a: present-but-non-array reference inputs throw', () => {
  const before = doc(A, 'Gearbox', [row(P, 'Bracket'), row(Q, 'Shaft', { order: 1 })]);
  const after = doc(A, 'Gearbox', [row(Q, 'Shaft')]);
  const committed = commitFrom(before, { [P]: BODY, [Q]: BODY_Q });
  for (const bad of [undefined, null, 'oops']) {
    assert.throws(
      () => plan(tip(), committed, wc(after, { [Q]: BODY_Q }, { branchAssemblies: bad }), TIP, []),
      /branchAssemblies must be an array/,
    );
  }
});

test('M3: assemblyCommit for another assembly throws', () => {
  const ofB = commitFrom(doc(B, 'Cover', [row(Q, 'Lid')]), { [Q]: BODY_Q });
  const ofA = wc(doc(A, 'Gearbox', [row(P, 'Bracket')]), { [P]: BODY });
  assert.throws(
    () => plan(tip(), ofB, ofA, TIP, []),
    /assemblyCommit\.assemblyId does not match workingCopy\.id/,
  );
});

test('L1: group-only part id is not owned for delete', () => {
  const live = doc(A, 'Gearbox', [row(Q, 'Shaft')]);
  const json = {
    ...toSurfJsonV2(live),
    groups: [{
      id: GROUP,
      name: 'Orphans',
      source: null,
      partIds: [P],
    }],
  };
  const committed = makeAssemblyCommit({
    assemblyId: A,
    files: {
      [assemblyIdPath(A)]: { contentHash: blobHash(`${JSON.stringify(json, null, 2)}\n`) },
      [partIdPath(Q)]: { contentHash: blobHash(stamped(BODY_Q, Q, 'Shaft')) },
      [partIdPath(P)]: { contentHash: blobHash(stamped(BODY, P, 'Bracket')) },
    },
    json,
    capturedAt: NOW,
  });
  const result = plan(tip(), committed, wc(live, { [Q]: BODY_Q }), TIP, []);
  assert.equal(result.conflict, undefined);
  assert.equal(deletesOf(result.files).includes(partIdPath(P)), false);
  assert.deepEqual(pathsOf(result.files), [assemblyIdPath(A)]);
});

test('planSave does not import or call commitFiles / createRepo', () => {
  const src = readFileSync(new URL('./planSave.js', import.meta.url), 'utf8');
  assert.equal(/commitFiles/.test(src), false);
  assert.equal(/createRepo/.test(src), false);
  assert.equal(/adapter\.compare/.test(src), false);
});

test('json-shaped branchAssemblies keep a referenced part; unidentifiable rows refuse the delete', () => {
  const before = doc(A, 'Gearbox', [row(P, 'Bracket'), row(Q, 'Shaft', { order: 1 })]);
  const after = doc(A, 'Gearbox', [row(Q, 'Shaft')]);
  const committed = commitFrom(before, { [P]: BODY, [Q]: BODY_Q });
  const kept = plan(
    tip(),
    committed,
    wc(after, { [Q]: BODY_Q }, {
      branchAssemblies: [{ json: { id: B, name: 'Cover', parts: [{ id: P }] } }],
    }),
    TIP,
    [],
  );
  assert.equal(kept.conflict, undefined);
  assert.equal(deletesOf(kept.files).includes(partIdPath(P)), false);
  assert.deepEqual(pathsOf(kept.files), [assemblyIdPath(A)]);

  assert.throws(
    () => plan(
      tip(),
      committed,
      wc(after, { [Q]: BODY_Q }, {
        branchAssemblies: [{ json: { parts: [{ id: P }] } }],
      }),
      TIP,
      [],
    ),
    /part file delete refused: a reference row has no v2 assembly id/,
  );
});

test('empty openWorkingCopies or otherAssemblyCommits without branchAssemblies refuses a delete', () => {
  const before = doc(A, 'Gearbox', [row(P, 'Bracket'), row(Q, 'Shaft', { order: 1 })]);
  const after = doc(A, 'Gearbox', [row(Q, 'Shaft')]);
  const committed = commitFrom(before, { [P]: BODY, [Q]: BODY_Q });
  for (const extra of [{ openWorkingCopies: [] }, { otherAssemblyCommits: [] }]) {
    assert.throws(
      () => plan(tip(), committed, wc(after, { [Q]: BODY_Q }, extra), TIP, []),
      /part file delete requires branchAssemblies from the current remote tip/,
    );
  }
});

test('remote-added assembly file while deleting is a conflict even if P.js is untouched', () => {
  const before = doc(A, 'Gearbox', [row(P, 'Bracket'), row(Q, 'Shaft', { order: 1 })]);
  const after = doc(A, 'Gearbox', [row(Q, 'Shaft')]);
  const result = plan(
    tip(TIP),
    commitFrom(before, { [P]: BODY, [Q]: BODY_Q }),
    wc(after, { [Q]: BODY_Q }, { branchAssemblies: [] }),
    REMOTE,
    compare([assemblyIdPath(B)]),
  );
  assert.equal(result.conflict, true);
  assert.equal(result.files, undefined);
  assert.ok(result.paths.includes(assemblyIdPath(B)));
  assert.ok(result.paths.includes(partIdPath(P)));
});

test('present-but-unreadable BranchTip throws; AssemblyCommit without a tip is not first Save', () => {
  const before = doc(A, 'Gearbox', [row(Q, 'Shaft')]);
  const committed = commitFrom(before, { [Q]: BODY_Q });
  const dirty = wc(before, { [Q]: 'return 9;\n' });
  const remoteOnQ = compare([partIdPath(Q)]);

  assert.throws(
    () => plan(
      { schemaVersion: 99, repo: REPO, branch: 'main', tipSha: TIP },
      committed,
      dirty,
      REMOTE,
      remoteOnQ,
    ),
    /branchTip is present but unreadable/,
  );

  assert.throws(
    () => plan(null, committed, dirty, REMOTE, remoteOnQ),
    /AssemblyCommit requires a readable BranchTip with tipSha/,
  );

  assert.throws(
    () => plan(
      tip(),
      committed,
      wc(before, { [Q]: 'return 9;\n' }, { repo: { owner: 'other', name: 'vault' }, branch: 'main' }),
      TIP,
      [],
    ),
    /BranchTip repo\/branch does not match the save target/,
  );
});

test('shared part with no known hash refuses the write rather than overwrite', () => {
  const before = doc(A, 'Gearbox', [row(Q, 'Shaft')]);
  const after = doc(A, 'Gearbox', [row(Q, 'Shaft'), row(P, 'Bracket', { order: 1 })]);
  const refused = plan(
    tip(),
    commitFrom(before, { [Q]: BODY_Q }),
    wc(after, { [Q]: BODY_Q, [P]: BODY }, {
      branchAssemblies: [{ id: B, name: 'Cover', parts: [{ id: P }] }],
    }),
    TIP,
    [],
  );
  assert.equal(refused.conflict, true);
  assert.deepEqual(refused.paths, [partIdPath(P)]);
  assert.equal(refused.files, undefined);

  const known = blobHash(stamped(BODY, P, 'Bracket'));
  const allowed = plan(
    tip(),
    commitFrom(before, { [Q]: BODY_Q }),
    wc(after, { [Q]: BODY_Q, [P]: BODY }, {
      branchAssemblies: [{ id: B, name: 'Cover', parts: [{ id: P }] }],
      branchFiles: { [partIdPath(P)]: known },
    }),
    TIP,
    [],
  );
  assert.equal(allowed.conflict, undefined);
  assert.equal(writeAt(allowed.files, partIdPath(P)), null);
  assert.deepEqual(pathsOf(allowed.files), [assemblyIdPath(A)]);
});

test('planSave does not read scripts keyed by vault path', () => {
  const assembly = doc(A, 'Gear Box', [row(P, 'Seed Cube')]);
  const working = wc(assembly, { [partIdPath(P)]: BODY });
  const result = plan(tip(null), null, working, REMOTE, compare([
    assemblyIdPath(A),
    partIdPath(P),
  ]));
  assert.equal(result.conflict, undefined);
  assert.equal(writeAt(result.files, partIdPath(P)), null);
  assert.equal(pathsOf(result.files).includes(partIdPath(P)), false);
});

test('assemblyCommit json.id mismatch throws when raw assemblyId is not v2', () => {
  const ofB = {
    schemaVersion: 1,
    assemblyId: 'Cover',
    files: {
      [assemblyIdPath(B)]: { contentHash: blobHash(stringifySurfJsonV2(doc(B, 'Cover', [row(Q, 'Lid')]))) },
    },
    json: { ...toSurfJsonV2(doc(B, 'Cover', [row(Q, 'Lid')])), id: B },
    capturedAt: NOW,
  };
  assert.throws(
    () => plan(tip(), ofB, wc(doc(A, 'Gearbox', [row(P, 'Bracket')]), { [P]: BODY }), TIP, []),
    /assemblyCommit\.assemblyId does not match workingCopy\.id/,
  );
});

test('instances: two rows of one definition write one script and one mesh, named by the primary', () => {
  const before = doc(A, 'Trainer', [row(P, 'Roller')]);
  const after = doc(A, 'Trainer', [
    row(P, 'Roller'),
    row(Q, 'Roller (2)', { order: 1, instanceOf: P, position: [0, 0, 120] }),
    row(R, 'Roller (3)', { order: 2, instanceOf: P, position: [60, 0, 120] }),
  ], { activeId: Q });
  const result = plan(
    tip(),
    commitFrom(before, { [P]: BODY }),
    wc(after, { [P]: BODY_Q }, { meshes: { [P]: MESH } }),
    TIP,
    [],
  );
  assert.equal(result.conflict, undefined);
  assert.deepEqual(pathsOf(result.files), [assemblyIdPath(A), partIdPath(P), partMeshIdPath(P)]);
  assert.equal(writeAt(result.files, partIdPath(P)).content, stamped(BODY_Q, P, 'Roller'));
  assert.equal(writeAt(result.files, partIdPath(Q)), null, 'an instance row has no file');
  assert.equal(writeAt(result.files, partIdPath(R)), null);
  const json = JSON.parse(writeAt(result.files, assemblyIdPath(A)).content);
  assert.deepEqual(json.parts.map((p) => [p.id, p.instanceOf ?? null]), [[P, null], [Q, P], [R, P]]);
  assert.equal(json.activeId, Q);
  assert.deepEqual(Object.keys(result.nextAssemblyCommit.files).sort(), [assemblyIdPath(A), partIdPath(P), partMeshIdPath(P)].sort());
});

test('instances: without a primary row the lowest-order instance names the script', () => {
  const after = doc(A, 'Trainer', [
    row(R, 'Roller (3)', { order: 5, instanceOf: P }),
    row(Q, 'Roller (2)', { order: 1, instanceOf: P }),
  ], { activeId: Q });
  const result = plan(null, null, wc(after, { [P]: BODY }), null, null);
  assert.equal(result.conflict, undefined);
  assert.deepEqual(pathsOf(result.files), [assemblyIdPath(A), partIdPath(P)]);
  assert.equal(writeAt(result.files, partIdPath(P)).content, stamped(BODY, P, 'Roller (2)'));
});

test('instances: deleting the primary row keeps the script while an instance remains; deleting the last row drops it', () => {
  const before = doc(A, 'Trainer', [row(P, 'Roller'), row(Q, 'Roller (2)', { order: 1, instanceOf: P })]);
  const noPrimary = doc(A, 'Trainer', [row(Q, 'Roller (2)', { instanceOf: P })], { activeId: Q });
  const kept = plan(
    tip(),
    commitFrom(before, { [P]: BODY }),
    wc(noPrimary, { [P]: BODY }, { branchAssemblies: [] }),
    TIP,
    [],
  );
  assert.equal(kept.conflict, undefined);
  assert.deepEqual(deletesOf(kept.files), []);
  // The file stays; its @name now comes from the only row left, Roller (2).
  assert.deepEqual(pathsOf(kept.files), [assemblyIdPath(A), partIdPath(P)]);
  assert.equal(writeAt(kept.files, partIdPath(P)).content, stamped(BODY, P, 'Roller (2)'));
  assert.equal(kept.nextAssemblyCommit.files[partIdPath(P)]?.contentHash, blobHash(stamped(BODY, P, 'Roller (2)')));

  const none = doc(A, 'Trainer', [], { activeId: null });
  const dropped = plan(
    tip(),
    commitFrom(before, { [P]: BODY }),
    wc(none, {}, { branchAssemblies: [] }),
    TIP,
    [],
  );
  assert.equal(dropped.conflict, undefined);
  assert.deepEqual(deletesOf(dropped.files), [partIdPath(P)]);
});

test('instances: an instance row in another assembly is a reference that keeps the file', () => {
  const before = doc(A, 'Trainer', [row(P, 'Roller')]);
  const after = doc(A, 'Trainer', [], { activeId: null });
  const result = plan(
    tip(),
    commitFrom(before, { [P]: BODY }),
    wc(after, {}, {
      deleteFromRepo: [P],
      branchAssemblies: [{ id: B, name: 'Bike', parts: [{ id: Q, instanceOf: P }] }],
    }),
    TIP,
    [],
  );
  assert.equal(result.conflict, undefined);
  assert.equal(deletesOf(result.files).includes(partIdPath(P)), false);
  assert.equal(result.partStillReferenced?.[0]?.partId, P);
  assert.deepEqual(result.partStillReferenced[0].assemblies, [{ id: B, name: 'Bike' }]);
});

/**
 * save-model v2 PR 7: Save through planSave + writeVaultCommit.
 * One behavioural test per §7 case, fake GitHub only.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { gitBlobSha } from './binaryContent.js';
import {
  applySaveReload,
  executePlanSave,
  executePlanSaveConflictChoice,
} from './executePlanSave.js';
import { fileWrite } from './githubAdapterInterface.js';
import { assemblyIdPath, partIdPath, partMeshIdPath } from './idPaths.js';
import { lastCommitReloadPlan, parseAssemblyCommit, parseBranchTip } from './lastCommit.js';
import { createMockGithubAdapter } from './mockGithubAdapter.js';
import { mintSurfId, withSurfId, withSurfName } from './surfId.js';
import { createSpyGithubAdapter, spyCalls } from './spyGithubAdapter.js';
import { stringifySurfJsonV2 } from './surfJsonV2.js';
import { createSyncStore } from './syncStore.js';
import { SURFCAD_JSON_V2 } from './writeVaultCommit.js';

const REPO = { owner: 'artur', name: 'surfcad-vault' };
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
    rev: extra.rev ?? 1,
    activeId: extra.activeId !== undefined ? extra.activeId : (parts[0]?.id ?? null),
    parts,
    vaultLayout: 'v2',
    ...extra,
  };
}

function wc(assembly, scripts, extra = {}) {
  return {
    doc: assembly,
    scripts,
    now: NOW,
    repo: REPO,
    branch: 'main',
    saveTarget: { repo: REPO, branch: 'main' },
    ...extra,
  };
}

async function fresh() {
  const inner = createMockGithubAdapter({ login: 'artur' });
  const spy = createSpyGithubAdapter(inner);
  const store = createSyncStore({ persist: false });
  await store.ready();
  return { inner, spy, store };
}

function saveWrites(spy) {
  return spyCalls(spy, 'commitFiles');
}

async function runSave({ spy, store, workingCopy, message = 'Save', force = false, create = false, online = true }) {
  return executePlanSave({
    adapter: spy,
    repo: REPO,
    branch: 'main',
    store,
    workingCopy,
    message,
    force,
    create,
    online,
    now: NOW,
  });
}

async function seedA(assembly, scripts, extra = {}) {
  const ctx = await fresh();
  const result = await runSave({
    ...ctx,
    workingCopy: wc(assembly, scripts, extra),
    message: 'seed',
    create: true,
  });
  assert.equal(result.status, 'committed', result.error);
  return { ...ctx, seedWrites: saveWrites(ctx.spy).length, sha: result.sha };
}

async function readText(inner, path, ref = 'main') {
  const file = await inner.readFile(REPO, path, ref);
  return file ? file.content : null;
}

function treePaths(inner, ref = 'main') {
  return inner.listTree(REPO, ref).then((tree) => tree.map((entry) => entry.path).sort());
}

function lastCommitFiles(spy) {
  const rows = saveWrites(spy);
  return rows[rows.length - 1]?.opts?.files || [];
}

test('executePlanSave plans with planSave and writes only through writeVaultCommit', () => {
  const src = readFileSync(new URL('./executePlanSave.js', import.meta.url), 'utf8');
  assert.match(src, /planSave\(/);
  assert.match(src, /writeVaultCommit\(/);
  assert.equal(/adapter\.commitFiles/.test(src), false);
  assert.equal(/adapter\.createRepo/.test(src), false);
  // #613: planSave only checks these when they are passed, so the Save
  // call site always forwards all three.
  const planAt = src.indexOf('const planInput = {');
  assert.ok(planAt >= 0);
  const planInput = src.slice(planAt, src.indexOf('planSave(', planAt));
  assert.match(planInput, /\bsaveTarget,/);
  assert.match(planInput, /\bbranchAssemblies,/);
  assert.match(planInput, /\bbranchFiles,/);
  assert.match(src, /loaded\.treeFailed/);
  assert.match(src, /truncated: true/);
});

test('§7 case 1: new assembly — one commit, seed v2, no README, tipSha advances, reload is clean', async () => {
  const assembly = doc(A, 'Gear Box', [row(P, 'Seed Cube')]);
  const { inner, spy, store, sha } = await seedA(assembly, { [P]: BODY }, { meshes: { [P]: MESH } });
  assert.equal(saveWrites(spy).length, 1);
  assert.equal(spyCalls(spy, 'createRepo').length, 1);
  const files = lastCommitFiles(spy);
  const paths = files.map((file) => file.path).sort();
  assert.equal(paths.includes('README.md'), false);
  assert.equal(paths.includes('surfcad.json'), true);
  assert.equal(paths.includes(assemblyIdPath(A)), true);
  assert.equal(paths.includes(partIdPath(P)), true);
  assert.equal(paths.includes(partMeshIdPath(P)), true);
  const marker = files.find((file) => file.path === 'surfcad.json');
  assert.equal(marker.content, SURFCAD_JSON_V2);
  assert.equal(await readText(inner, 'README.md'), null);
  assert.equal(await readText(inner, assemblyIdPath(A)), stringifySurfJsonV2(assembly));
  assert.equal(await readText(inner, partIdPath(P)), stamped(BODY, P, 'Seed Cube'));

  const tip = parseBranchTip(store.getBranchTip(REPO, 'main'));
  assert.equal(tip.tipSha, sha);
  const commit = parseAssemblyCommit(store.getAssemblyCommit(REPO, 'main', A));
  assert.equal(commit.files[partIdPath(P)].contentHash, blobHash(stamped(BODY, P, 'Seed Cube')));
  assert.equal(lastCommitReloadPlan(store, REPO, 'main', A).skip, true);

  const again = await runSave({
    spy,
    store,
    workingCopy: wc(assembly, { [P]: BODY }, { meshes: { [P]: MESH } }),
  });
  assert.equal(again.status, 'clean');
  assert.equal(saveWrites(spy).length, 1);
});

test('§7 case 2: assembly rename is an in-place name edit, not a move', async () => {
  const before = doc(A, 'Gearbox', [row(P, 'Bracket')]);
  const after = doc(A, 'Gearbox Two', [row(P, 'Bracket')]);
  const { inner, spy, store, seedWrites } = await seedA(before, { [P]: BODY });
  const result = await runSave({
    spy,
    store,
    workingCopy: wc(after, { [P]: BODY }),
    message: 'Rename assembly',
  });
  assert.equal(result.status, 'committed', result.error);
  assert.equal(saveWrites(spy).length, seedWrites + 1);
  const files = lastCommitFiles(spy);
  assert.deepEqual(files.map((file) => file.path).sort(), [assemblyIdPath(A)]);
  assert.equal(files.some((file) => file.delete), false);
  assert.match(await readText(inner, assemblyIdPath(A)), /"name": "Gearbox Two"/);
  assert.equal(await readText(inner, partIdPath(P)), stamped(BODY, P, 'Bracket'));
  assert.equal(parseBranchTip(store.getBranchTip(REPO, 'main')).tipSha, result.sha);

  const clean = await runSave({ spy, store, workingCopy: wc(after, { [P]: BODY }) });
  assert.equal(clean.status, 'clean');
  assert.equal(saveWrites(spy).length, seedWrites + 1);
});

test('§7 case 3: new part writes parts/<id>.js and the assembly file', async () => {
  const before = doc(A, 'Gearbox', [row(P, 'Bracket')]);
  const after = doc(A, 'Gearbox', [row(P, 'Bracket'), row(Q, 'Shaft', { order: 1 })]);
  const { inner, spy, store, seedWrites } = await seedA(before, { [P]: BODY });
  const result = await runSave({
    spy,
    store,
    workingCopy: wc(after, { [P]: BODY, [Q]: BODY_Q }, { meshes: { [Q]: MESH } }),
  });
  assert.equal(result.status, 'committed', result.error);
  assert.equal(saveWrites(spy).length, seedWrites + 1);
  assert.deepEqual(lastCommitFiles(spy).map((file) => file.path).sort(), [
    assemblyIdPath(A),
    partIdPath(Q),
    partMeshIdPath(Q),
  ]);
  assert.equal(await readText(inner, partIdPath(Q)), stamped(BODY_Q, Q, 'Shaft'));
  assert.equal(await readText(inner, partIdPath(P)), stamped(BODY, P, 'Bracket'));
});

test('§7 case 4: part rename, one parent — same path, new @name', async () => {
  const before = doc(A, 'Gearbox', [row(P, 'Bracket')]);
  const after = doc(A, 'Gearbox', [row(P, 'Brace')]);
  const { inner, spy, store, seedWrites } = await seedA(before, { [P]: BODY });
  const result = await runSave({
    spy,
    store,
    workingCopy: wc(after, { [P]: BODY }),
  });
  assert.equal(result.status, 'committed', result.error);
  assert.equal(saveWrites(spy).length, seedWrites + 1);
  assert.deepEqual(lastCommitFiles(spy).map((file) => file.path).sort(), [
    assemblyIdPath(A),
    partIdPath(P),
  ]);
  assert.equal(await readText(inner, partIdPath(P)), stamped(BODY, P, 'Brace'));
  assert.match(await readText(inner, assemblyIdPath(A)), /"name": "Brace"/);
  const tree = await treePaths(inner);
  assert.equal(tree.includes(partIdPath(P)), true);
  assert.equal(tree.some((path) => path.includes('Brace')), false);
});

test('§7 case 5: part rename, several parents — do not write B; B adopts the hash', async () => {
  const aDoc = doc(A, 'Gearbox', [row(P, 'Bracket')]);
  const bDoc = doc(B, 'Cover', [row(P, 'Bracket')]);
  const { spy, store, seedWrites } = await seedA(aDoc, { [P]: BODY });
  const savedB = await runSave({
    spy,
    store,
    workingCopy: wc(bDoc, { [P]: BODY }),
  });
  assert.equal(savedB.status, 'committed', savedB.error);
  const writesBefore = saveWrites(spy).length;
  assert.equal(writesBefore, seedWrites + 1);

  const renamed = doc(A, 'Gearbox', [row(P, 'Brace')]);
  const result = await runSave({
    spy,
    store,
    workingCopy: wc(renamed, { [P]: BODY }),
  });
  assert.equal(result.status, 'committed', result.error);
  assert.equal(saveWrites(spy).length, writesBefore + 1);
  const paths = lastCommitFiles(spy).map((file) => file.path).sort();
  assert.deepEqual(paths, [assemblyIdPath(A), partIdPath(P)]);
  assert.equal(paths.includes(assemblyIdPath(B)), false);
  const adopted = parseAssemblyCommit(store.getAssemblyCommit(REPO, 'main', B));
  assert.equal(adopted.files[partIdPath(P)].contentHash, blobHash(stamped(BODY, P, 'Brace')));
});

test('§7 case 6: existing part added as a reference writes only this assembly file', async () => {
  const aDoc = doc(A, 'Gearbox', [row(Q, 'Shaft')]);
  const bDoc = doc(B, 'Cover', [row(P, 'Bracket')]);
  const { inner, spy, store } = await seedA(aDoc, { [Q]: BODY_Q });
  const savedB = await runSave({
    spy,
    store,
    workingCopy: wc(bDoc, { [P]: BODY }),
  });
  assert.equal(savedB.status, 'committed', savedB.error);
  const writesBefore = saveWrites(spy).length;
  const after = doc(A, 'Gearbox', [row(Q, 'Shaft'), row(P, 'Bracket', { order: 1 })]);
  const result = await runSave({
    spy,
    store,
    workingCopy: wc(after, { [Q]: BODY_Q, [P]: BODY }),
  });
  assert.equal(result.status, 'committed', result.error);
  assert.equal(saveWrites(spy).length, writesBefore + 1);
  assert.deepEqual(lastCommitFiles(spy).map((file) => file.path), [assemblyIdPath(A)]);
  assert.match(await readText(inner, assemblyIdPath(A)), new RegExp(P));
  assert.equal(await readText(inner, partIdPath(P)), stamped(BODY, P, 'Bracket'));
});

test('§7 case 7: remote changed part-only — assembly-only Save proceeds; part Save conflicts', async () => {
  const before = doc(A, 'Gearbox', [row(P, 'Bracket'), row(Q, 'Shaft', { order: 1 })]);
  const painted = doc(A, 'Gearbox', [row(P, 'Bracket'), row(Q, 'Shaft', { order: 1 })], {
    colors: { [P]: { part: '#ff0000' } },
  });
  const { inner, spy, store, seedWrites, sha } = await seedA(before, { [P]: BODY, [Q]: BODY_Q });
  await inner.commitFiles(REPO, {
    branch: 'main',
    message: 'remote part',
    files: [fileWrite(partIdPath(P), stamped('return 9;\n', P, 'Bracket'))],
    baseSha: sha,
  });
  const assemblyOnly = await runSave({
    spy,
    store,
    workingCopy: wc(painted, { [P]: BODY, [Q]: BODY_Q }),
  });
  assert.equal(assemblyOnly.status, 'committed', assemblyOnly.error);
  assert.equal(saveWrites(spy).length, seedWrites + 1);
  assert.deepEqual(lastCommitFiles(spy).map((file) => file.path), [assemblyIdPath(A)]);

  const tip = parseBranchTip(store.getBranchTip(REPO, 'main'));
  await inner.commitFiles(REPO, {
    branch: 'main',
    message: 'remote part again',
    files: [fileWrite(partIdPath(P), stamped('return 8;\n', P, 'Bracket'))],
    baseSha: assemblyOnly.sha,
  });
  const writes = saveWrites(spy).length;
  const partTouch = await runSave({
    spy,
    store,
    workingCopy: wc(painted, { [P]: 'return 3;\n', [Q]: BODY_Q }),
  });
  assert.equal(partTouch.status, 'conflict');
  assert.equal(partTouch.paths.includes(partIdPath(P)), true);
  assert.equal(saveWrites(spy).length, writes);
  assert.equal(parseBranchTip(store.getBranchTip(REPO, 'main')).tipSha, tip.tipSha);
});

test('§7 case 8: remote changed assembly A — Save of A conflicts; Save of B does not', async () => {
  const aDoc = doc(A, 'Gearbox', [row(P, 'Bracket')]);
  const bDoc = doc(B, 'Cover', [row(Q, 'Shaft')]);
  const { inner, spy, store } = await seedA(aDoc, { [P]: BODY });
  const savedB = await runSave({
    spy,
    store,
    workingCopy: wc(bDoc, { [Q]: BODY_Q }),
  });
  assert.equal(savedB.status, 'committed', savedB.error);
  await inner.commitFiles(REPO, {
    branch: 'main',
    message: 'remote A',
    files: [fileWrite(assemblyIdPath(A), stringifySurfJsonV2(doc(A, 'Remote A', [row(P, 'Bracket')])))],
    baseSha: savedB.sha,
  });
  const writes = saveWrites(spy).length;
  const ofA = await runSave({
    spy,
    store,
    workingCopy: wc(doc(A, 'Mine A', [row(P, 'Bracket')]), { [P]: BODY }),
  });
  assert.equal(ofA.status, 'conflict');
  assert.deepEqual(ofA.paths, [assemblyIdPath(A)]);
  assert.equal(saveWrites(spy).length, writes);

  const ofB = await runSave({
    spy,
    store,
    workingCopy: wc(doc(B, 'Cover Two', [row(Q, 'Shaft')]), { [Q]: BODY_Q }),
  });
  assert.equal(ofB.status, 'committed', ofB.error);
  assert.equal(saveWrites(spy).length, writes + 1);
  assert.deepEqual(lastCommitFiles(spy).map((file) => file.path), [assemblyIdPath(B)]);
});

test('§7 case 9: overwrite assembly writes mine; remote part files stay', async () => {
  const before = doc(A, 'Gearbox', [row(P, 'Bracket')]);
  const { inner, spy, store, sha } = await seedA(before, { [P]: BODY });
  const remotePart = stamped('return remote;\n', P, 'Bracket');
  await inner.commitFiles(REPO, {
    branch: 'main',
    message: 'remote both',
    files: [
      fileWrite(assemblyIdPath(A), stringifySurfJsonV2(doc(A, 'Remote', [row(P, 'Bracket')]))),
      fileWrite(partIdPath(P), remotePart),
    ],
    baseSha: sha,
  });
  const writes = saveWrites(spy).length;
  const blocked = await runSave({
    spy,
    store,
    workingCopy: wc(doc(A, 'Mine', [row(P, 'Bracket')]), { [P]: BODY }),
  });
  assert.equal(blocked.status, 'conflict');
  assert.equal(saveWrites(spy).length, writes);

  const over = await executePlanSaveConflictChoice({
    action: 'overwrite',
    adapter: spy,
    repo: REPO,
    branch: 'main',
    store,
    workingCopy: wc(doc(A, 'Mine', [row(P, 'Bracket')]), { [P]: BODY }),
    message: 'Overwrite assembly',
    paths: blocked.paths,
    now: NOW,
  });
  assert.equal(over.status, 'committed', over.error);
  assert.equal(saveWrites(spy).length, writes + 1);
  assert.deepEqual(lastCommitFiles(spy).map((file) => file.path), [assemblyIdPath(A)]);
  assert.match(await readText(inner, assemblyIdPath(A)), /"name": "Mine"/);
  assert.equal(await readText(inner, partIdPath(P)), remotePart);
});

test('§7 case 10: overwrite part writes mine; remote assembly file stays', async () => {
  const before = doc(A, 'Gearbox', [row(P, 'Bracket')]);
  const { inner, spy, store, sha } = await seedA(before, { [P]: BODY });
  const remoteAsm = stringifySurfJsonV2(doc(A, 'Remote', [row(P, 'Bracket')]));
  await inner.commitFiles(REPO, {
    branch: 'main',
    message: 'remote both',
    files: [
      fileWrite(assemblyIdPath(A), remoteAsm),
      fileWrite(partIdPath(P), stamped('return remote;\n', P, 'Bracket')),
    ],
    baseSha: sha,
  });
  const writes = saveWrites(spy).length;
  const blocked = await runSave({
    spy,
    store,
    workingCopy: wc(before, { [P]: 'return 9;\n' }),
  });
  assert.equal(blocked.status, 'conflict');
  const over = await executePlanSaveConflictChoice({
    action: 'overwrite',
    adapter: spy,
    repo: REPO,
    branch: 'main',
    store,
    workingCopy: wc(before, { [P]: 'return 9;\n' }),
    message: 'Overwrite part',
    paths: blocked.paths,
    now: NOW,
  });
  assert.equal(over.status, 'committed', over.error);
  assert.equal(saveWrites(spy).length, writes + 1);
  assert.deepEqual(lastCommitFiles(spy).map((file) => file.path), [partIdPath(P)]);
  assert.equal(await readText(inner, partIdPath(P)), stamped('return 9;\n', P, 'Bracket'));
  assert.equal(await readText(inner, assemblyIdPath(A)), remoteAsm);
});

test('§7 case 11: overwrite both writes mine; other remote files stay', async () => {
  const before = doc(A, 'Gearbox', [row(P, 'Bracket')]);
  const bDoc = doc(B, 'Cover', [row(Q, 'Shaft')]);
  const { inner, spy, store } = await seedA(before, { [P]: BODY });
  const savedB = await runSave({ spy, store, workingCopy: wc(bDoc, { [Q]: BODY_Q }) });
  assert.equal(savedB.status, 'committed', savedB.error);
  await inner.commitFiles(REPO, {
    branch: 'main',
    message: 'remote A and leftover',
    files: [
      fileWrite(assemblyIdPath(A), stringifySurfJsonV2(doc(A, 'Remote', [row(P, 'Bracket')]))),
      fileWrite(partIdPath(P), stamped('return remote;\n', P, 'Bracket')),
      fileWrite(assemblyIdPath(B), stringifySurfJsonV2(doc(B, 'Remote B', [row(Q, 'Shaft')]))),
    ],
    baseSha: savedB.sha,
  });
  const writes = saveWrites(spy).length;
  const working = wc(doc(A, 'Mine', [row(P, 'Bracket')]), { [P]: 'return 9;\n' });
  const blocked = await runSave({ spy, store, workingCopy: working });
  assert.equal(blocked.status, 'conflict');
  const over = await executePlanSaveConflictChoice({
    action: 'overwrite',
    adapter: spy,
    repo: REPO,
    branch: 'main',
    store,
    workingCopy: working,
    message: 'Overwrite both',
    paths: blocked.paths,
    now: NOW,
  });
  assert.equal(over.status, 'committed', over.error);
  assert.equal(saveWrites(spy).length, writes + 1);
  assert.deepEqual(lastCommitFiles(spy).map((file) => file.path).sort(), [
    assemblyIdPath(A),
    partIdPath(P),
  ]);
  assert.match(await readText(inner, assemblyIdPath(A)), /"name": "Mine"/);
  assert.equal(await readText(inner, partIdPath(P)), stamped('return 9;\n', P, 'Bracket'));
  assert.match(await readText(inner, assemblyIdPath(B)), /"name": "Remote B"/);
});

test('§7 case 12: normal save writes dirty files and deletes; Get latest writes no git', async () => {
  const before = doc(A, 'Gearbox', [
    row(P, 'Bracket'),
    row(Q, 'Shaft', { order: 1 }),
  ]);
  const after = doc(A, 'Gearbox', [row(P, 'Brace')], {
    colors: { [P]: { part: '#00ff00' } },
  });
  const { inner, spy, store, seedWrites } = await seedA(
    before,
    { [P]: BODY, [Q]: BODY_Q },
    { meshes: { [Q]: MESH } },
  );
  const result = await runSave({
    spy,
    store,
    workingCopy: wc(after, { [P]: 'return 3;\n' }, { branchAssemblies: [] }),
  });
  assert.equal(result.status, 'committed', result.error);
  assert.equal(saveWrites(spy).length, seedWrites + 1);
  const files = lastCommitFiles(spy);
  assert.deepEqual(files.map((file) => file.path).sort(), [
    assemblyIdPath(A),
    partIdPath(P),
    partIdPath(Q),
    partMeshIdPath(Q),
  ]);
  assert.deepEqual(files.filter((file) => file.delete).map((file) => file.path).sort(), [
    partIdPath(Q),
    partMeshIdPath(Q),
  ]);
  assert.equal(await readText(inner, partIdPath(P)), stamped('return 3;\n', P, 'Brace'));
  assert.equal(await readText(inner, partIdPath(Q)), null);
  assert.equal(parseBranchTip(store.getBranchTip(REPO, 'main')).tipSha, result.sha);
  const commit = parseAssemblyCommit(store.getAssemblyCommit(REPO, 'main', A));
  assert.equal(commit.files[partIdPath(Q)], undefined);

  const clean = await runSave({
    spy,
    store,
    workingCopy: wc(after, { [P]: 'return 3;\n' }),
  });
  assert.equal(clean.status, 'clean');
  assert.equal(saveWrites(spy).length, seedWrites + 1);
  assert.equal(lastCommitReloadPlan(store, REPO, 'main', A).skip, true);
});

test('Get latest replaces conflicting WC files and does not write git', async () => {
  const before = doc(A, 'Gearbox', [row(P, 'Bracket')]);
  const { inner, spy, store, sha } = await seedA(before, { [P]: BODY });
  await inner.commitFiles(REPO, {
    branch: 'main',
    message: 'remote part',
    files: [fileWrite(partIdPath(P), stamped('return remote;\n', P, 'Bracket'))],
    baseSha: sha,
  });
  const working = wc(before, { [P]: 'return local;\n' });
  const blocked = await runSave({ spy, store, workingCopy: working });
  assert.equal(blocked.status, 'conflict');
  const writes = saveWrites(spy).length;
  const reloaded = await executePlanSaveConflictChoice({
    action: 'reload',
    adapter: spy,
    repo: REPO,
    branch: 'main',
    store,
    workingCopy: working,
    paths: blocked.paths,
    now: NOW,
  });
  assert.equal(reloaded.status, 'reloaded');
  assert.equal(saveWrites(spy).length, writes);
  assert.match(String(reloaded.contents[partIdPath(P)]), /remote/);
  const applied = applySaveReload(before, { [P]: 'return local;\n' }, reloaded.contents);
  assert.match(applied.scripts[P], /remote/);
  assert.equal(applied.doc.activeId, P);
});

test('Save mine to a new branch writes planned files off the last tip', async () => {
  const before = doc(A, 'Gearbox', [row(P, 'Bracket')]);
  const { inner, spy, store, sha } = await seedA(before, { [P]: BODY });
  await inner.commitFiles(REPO, {
    branch: 'main',
    message: 'remote part',
    files: [fileWrite(partIdPath(P), stamped('return remote;\n', P, 'Bracket'))],
    baseSha: sha,
  });
  const working = wc(before, { [P]: 'return mine;\n' });
  const blocked = await runSave({ spy, store, workingCopy: working });
  assert.equal(blocked.status, 'conflict');
  const writes = saveWrites(spy).length;
  const branched = await executePlanSaveConflictChoice({
    action: 'branch',
    adapter: spy,
    repo: REPO,
    branch: 'main',
    store,
    workingCopy: working,
    message: 'Save mine',
    paths: blocked.paths,
    now: NOW,
  });
  assert.equal(branched.status, 'branched', branched.error);
  assert.equal(branched.fromSha, sha);
  assert.equal(saveWrites(spy).length, writes + 1);
  assert.match(await readText(inner, partIdPath(P), branched.branch), /mine/);
  assert.match(await readText(inner, partIdPath(P), 'main'), /remote/);
});

test('Dismiss and a planner refusal write nothing', async () => {
  const before = doc(A, 'Gearbox', [row(P, 'Bracket')]);
  const { spy, store, seedWrites } = await seedA(before, { [P]: BODY });
  const dismissed = await executePlanSaveConflictChoice({
    action: 'dismiss',
    adapter: spy,
    repo: REPO,
    workingCopy: wc(before, { [P]: BODY }),
  });
  assert.equal(dismissed.status, 'dismissed');
  assert.equal(saveWrites(spy).length, seedWrites);

  const orig = spy.listTree.bind(spy);
  spy.listTree = async () => {
    throw new Error('listTree down');
  };
  const after = doc(A, 'Gearbox', []);
  const refused = await runSave({
    spy,
    store,
    workingCopy: wc(after, {}),
  });
  spy.listTree = orig;
  assert.equal(refused.status, 'error');
  assert.equal(refused.code, 'save_refused');
  assert.match(refused.message, /Nothing was written/);
  assert.equal(saveWrites(spy).length, seedWrites);
});

test('compare truncated:true is a conflict and does not write', async () => {
  const before = doc(A, 'Gearbox', [row(P, 'Bracket')]);
  const inner = createMockGithubAdapter({ login: 'artur' });
  const spy = createSpyGithubAdapter(inner, {
    compare: async () => ({ truncated: true, files: [] }),
  });
  const store = createSyncStore({ persist: false });
  await store.ready();
  const seeded = await runSave({
    spy,
    store,
    workingCopy: wc(before, { [P]: BODY }),
    message: 'seed',
    create: true,
  });
  assert.equal(seeded.status, 'committed', seeded.error);
  await inner.commitFiles(REPO, {
    branch: 'main',
    message: 'unrelated',
    files: [fileWrite(partIdPath(Q), stamped(BODY_Q, Q, 'Shaft'))],
    baseSha: seeded.sha,
  });
  const writes = saveWrites(spy).length;
  const blocked = await runSave({
    spy,
    store,
    workingCopy: wc(doc(A, 'Gearbox Two', [row(P, 'Bracket')]), { [P]: BODY }),
  });
  assert.equal(blocked.status, 'conflict');
  assert.equal(blocked.truncated, true);
  assert.equal(blocked.paths.includes(assemblyIdPath(A)), true);
  assert.equal(saveWrites(spy).length, writes);
});

test('saveTarget owner/repo match BranchTip case-insensitively', async () => {
  const before = doc(A, 'Gearbox', [row(P, 'Bracket')]);
  const after = doc(A, 'Gearbox Two', [row(P, 'Bracket')]);
  const { spy, store, seedWrites } = await seedA(before, { [P]: BODY });
  const tip = parseBranchTip(store.getBranchTip(REPO, 'main'));
  await store.putBranchTip(REPO, 'main', {
    ...tip,
    repo: { owner: 'Artur', name: 'SurfCAD-Vault' },
  });
  const result = await runSave({
    spy,
    store,
    workingCopy: wc(after, { [P]: BODY }),
    message: 'Rename',
  });
  assert.equal(result.status, 'committed', result.error);
  assert.equal(saveWrites(spy).length, seedWrites + 1);
});

test('offline Save stores one pending write; a second Save pushes; online does not', async () => {
  const before = doc(A, 'Gearbox', [row(P, 'Bracket')]);
  const after = doc(A, 'Gearbox Two', [row(P, 'Bracket')]);
  const { spy, store, seedWrites } = await seedA(before, { [P]: BODY });
  const pending = await runSave({
    spy,
    store,
    workingCopy: wc(after, { [P]: BODY }),
    online: false,
  });
  assert.equal(pending.status, 'pending');
  assert.equal(saveWrites(spy).length, seedWrites);
  assert.ok(store.getPendingSave(REPO, 'main'));

  const pushed = await runSave({
    spy,
    store,
    workingCopy: wc(after, { [P]: BODY }),
    online: true,
  });
  assert.equal(pushed.status, 'committed', pushed.error);
  assert.equal(saveWrites(spy).length, seedWrites + 1);
  assert.equal(store.getPendingSave(REPO, 'main'), null);
});

test('Save of a non-overlapping file does not take the remote unwritten files', async () => {
  const before = doc(A, 'Gearbox', [row(P, 'Bracket'), row(Q, 'Shaft', { order: 1 })]);
  const renamed = doc(A, 'Gearbox Two', [row(P, 'Bracket'), row(Q, 'Shaft', { order: 1 })]);
  const { inner, spy, store, sha } = await seedA(before, { [P]: BODY, [Q]: BODY_Q });
  const remoteQ = stamped('return remote-q;\n', Q, 'Shaft');
  await inner.commitFiles(REPO, {
    branch: 'main',
    message: 'remote Q',
    files: [fileWrite(partIdPath(Q), remoteQ)],
    baseSha: sha,
  });
  const renamedSave = await runSave({
    spy,
    store,
    workingCopy: wc(renamed, { [P]: BODY, [Q]: BODY_Q }),
    message: 'Rename A',
  });
  assert.equal(renamedSave.status, 'committed', renamedSave.error);
  assert.equal(await readText(inner, partIdPath(Q)), remoteQ);
  const writes = saveWrites(spy).length;
  const later = await runSave({
    spy,
    store,
    workingCopy: wc(renamed, { [P]: BODY, [Q]: 'return local-q;\n' }),
    message: 'Edit Q',
  });
  assert.equal(later.status, 'conflict');
  assert.equal(later.paths.includes(partIdPath(Q)), true);
  assert.equal(saveWrites(spy).length, writes);
  assert.equal(await readText(inner, partIdPath(Q)), remoteQ);
});

test('Get latest reloads every this-assembly file the remote changed', async () => {
  const before = doc(A, 'Gearbox', [row(P, 'Bracket'), row(Q, 'Shaft', { order: 1 })]);
  const { inner, spy, store, sha } = await seedA(before, { [P]: BODY, [Q]: BODY_Q });
  const remoteP = stamped('return remote-p;\n', P, 'Bracket');
  const remoteQ = stamped('return remote-q;\n', Q, 'Shaft');
  await inner.commitFiles(REPO, {
    branch: 'main',
    message: 'remote P and Q',
    files: [
      fileWrite(partIdPath(P), remoteP),
      fileWrite(partIdPath(Q), remoteQ),
    ],
    baseSha: sha,
  });
  const working = wc(before, { [P]: 'return local-p;\n', [Q]: BODY_Q });
  const blocked = await runSave({ spy, store, workingCopy: working });
  assert.equal(blocked.status, 'conflict');
  const writes = saveWrites(spy).length;
  const reloaded = await executePlanSaveConflictChoice({
    action: 'reload',
    adapter: spy,
    repo: REPO,
    branch: 'main',
    store,
    workingCopy: working,
    paths: blocked.paths,
    now: NOW,
  });
  assert.equal(reloaded.status, 'reloaded');
  assert.equal(saveWrites(spy).length, writes);
  assert.match(String(reloaded.contents[partIdPath(P)]), /remote-p/);
  assert.match(String(reloaded.contents[partIdPath(Q)]), /remote-q/);
  const applied = applySaveReload(before, working.scripts, reloaded.contents);
  const next = await runSave({
    spy,
    store,
    workingCopy: wc(applied.doc, applied.scripts),
  });
  assert.notEqual(next.status, 'conflict', next.error);
  assert.equal(await readText(inner, partIdPath(Q)), remoteQ);
  if (next.status === 'committed') {
    const qFile = lastCommitFiles(spy).find((file) => file.path === partIdPath(Q));
    if (qFile) assert.match(String(qFile.content), /remote-q/);
  }
});

test('failed assembly file read refuses Save and does not delete parts', async () => {
  const aDoc = doc(A, 'Gearbox', [row(P, 'Bracket')]);
  const bDoc = doc(B, 'Cover', [row(P, 'Bracket')]);
  const { inner, spy, store } = await seedA(aDoc, { [P]: BODY });
  const savedB = await runSave({ spy, store, workingCopy: wc(bDoc, { [P]: BODY }) });
  assert.equal(savedB.status, 'committed', savedB.error);
  const orig = spy.readFile.bind(spy);
  spy.readFile = async (repo, path, ref) => {
    if (path === assemblyIdPath(B)) throw new Error('503');
    return orig(repo, path, ref);
  };
  const writes = saveWrites(spy).length;
  const dropped = await runSave({
    spy,
    store,
    workingCopy: wc(doc(A, 'Gearbox', []), {}),
  });
  spy.readFile = orig;
  assert.equal(dropped.status, 'error');
  assert.equal(dropped.code, 'save_refused');
  assert.equal(saveWrites(spy).length, writes);
  assert.equal(await readText(inner, partIdPath(P)), stamped(BODY, P, 'Bracket'));
});

test('Save without a stored tip or record refuses when the remote already has this assembly', async () => {
  const before = doc(A, 'Gearbox', [row(P, 'Bracket')]);
  const { inner, spy, sha } = await seedA(before, { [P]: BODY });
  const remoteP = stamped('return remote-p;\n', P, 'Bracket');
  await inner.commitFiles(REPO, {
    branch: 'main',
    message: 'remote P',
    files: [fileWrite(partIdPath(P), remoteP)],
    baseSha: sha,
  });
  const empty = createSyncStore({ persist: false });
  await empty.ready();
  const writes = saveWrites(spy).length;
  const result = await runSave({
    spy,
    store: empty,
    workingCopy: wc(doc(A, 'Gearbox Two', [row(P, 'Bracket')]), { [P]: BODY }),
    message: 'Rename',
  });
  assert.equal(result.status, 'error');
  assert.match(result.message, /Get latest first/);
  assert.equal(saveWrites(spy).length, writes);
  assert.equal(await readText(inner, partIdPath(P)), remoteP);
});

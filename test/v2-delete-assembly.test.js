/**
 * Confirmed delete of a committed v2 assembly is one writeVaultCommit.
 * Rename and an unconfirmed delete write nothing. A failed reference
 * scan refuses. Delete parts keeps a part file another assembly shares.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { assemblyRows } from '../src/agent/state/assemblyRows.js';
import { partAlsoUsedCopy, renamePart } from '../src/utils/assembly.js';
import { executeDeleteV2Assembly, executeDeleteV2Part } from '../src/utils/git/deleteV2Assembly.js';
import { executePlanSave } from '../src/utils/git/executePlanSave.js';
import { assemblyIdPath, partIdPath } from '../src/utils/git/idPaths.js';
import { createMockGithubAdapter } from '../src/utils/git/mockGithubAdapter.js';
import { mintSurfId } from '../src/utils/git/surfId.js';
import { createSyncStore } from '../src/utils/git/syncStore.js';
import { listV2Assemblies, scanOtherAssemblyPartUses } from '../src/utils/git/v2VaultRead.js';

const ASM_A = mintSurfId({ now: new Date('2026-10-18T03:10:00.001Z'), rand: 'a11a' });
const ASM_B = mintSurfId({ now: new Date('2026-10-18T03:10:00.002Z'), rand: 'b22b' });
const SHARED = mintSurfId({ now: new Date('2026-10-18T03:10:00.003Z'), rand: 'c33c' });
const ONLY = mintSurfId({ now: new Date('2026-10-18T03:10:00.004Z'), rand: 'd44d' });
const REPO = { owner: 'artur', name: 'surfcad-vault' };

function commits(adapter) {
  return adapter._log.filter((row) => row.op === 'commitFiles');
}

function doc(id, name, parts) {
  return {
    id,
    source: 'git',
    vaultLayout: 'v2',
    name,
    activeId: parts[0]?.id ?? null,
    parts,
  };
}

async function gitSave(adapter, store, assembly, scripts, message, create = false) {
  return executePlanSave({
    adapter,
    repo: REPO,
    branch: 'main',
    store,
    workingCopy: {
      doc: assembly,
      scripts,
      now: 1_700_000_000_000,
      repo: REPO,
      branch: 'main',
      saveTarget: { repo: REPO, branch: 'main' },
    },
    message,
    create,
  });
}

async function seedPair() {
  const adapter = createMockGithubAdapter({ login: 'artur' });
  const store = createSyncStore({ persist: false });
  await store.ready();
  const a = doc(ASM_A, 'Metallll', [
    { id: SHARED, name: 'Shared pin', visible: true, order: 0 },
    { id: ONLY, name: 'Testing Long Part Name', visible: true, order: 1 },
  ]);
  const b = doc(ASM_B, 'Other', [
    { id: SHARED, name: 'Shared pin', visible: true, order: 0 },
  ]);
  const scripts = {
    [SHARED]: 'return 1;\n',
    [ONLY]: 'return 2;\n',
  };
  const first = await gitSave(adapter, store, a, scripts, 'Save Metallll', true);
  assert.equal(first.status, 'committed', first.error);
  const second = await gitSave(adapter, store, b, { [SHARED]: scripts[SHARED] }, 'Save Other');
  assert.equal(second.status, 'committed', second.error);
  const sibling = (await adapter.readFile(REPO, assemblyIdPath(ASM_B), 'main')).content;
  return { adapter, store, a, b, sibling };
}

test('rename writes no git and delete writes nothing until confirmed', async () => {
  const { adapter, store, a } = await seedPair();
  const before = commits(adapter).length;
  const renamed = renamePart(a, ONLY, 'Pin');
  assert.equal(renamed.id, ASM_A);
  assert.equal(renamed.parts.find((row) => row.id === ONLY).name, 'Pin');
  assert.equal(commits(adapter).length, before);

  const held = await executeDeleteV2Assembly({
    adapter,
    repo: REPO,
    store,
    assemblyId: ASM_A,
    openDoc: a,
    deleteParts: true,
    confirm: false,
  });
  assert.equal(held.code, 'confirm_required');
  assert.equal(commits(adapter).length, before);
  assert.ok(await adapter.readFile(REPO, assemblyIdPath(ASM_A), 'main'));
  assert.equal(a.name, 'Metallll');
});

test('a confirmed delete drops the assembly from list_assemblies after reload', async () => {
  const { adapter, store, a, sibling } = await seedPair();
  const before = commits(adapter).length;
  const result = await executeDeleteV2Assembly({
    adapter,
    repo: REPO,
    store,
    assemblyId: ASM_A,
    openDoc: a,
    deleteParts: false,
    confirm: true,
    message: 'Delete Metallll',
  });
  assert.equal(result.status, 'committed', result.error);
  assert.equal(commits(adapter).length, before + 1);
  assert.equal(result.files.every((file) => file.delete), true);
  assert.equal(result.files.some((file) => file.path === assemblyIdPath(ASM_B)), false);
  assert.equal(await adapter.readFile(REPO, assemblyIdPath(ASM_A), 'main'), null);
  assert.equal((await adapter.readFile(REPO, assemblyIdPath(ASM_B), 'main')).content, sibling);
  assert.ok(await adapter.readFile(REPO, partIdPath(ONLY), 'main'));
  assert.ok(await adapter.readFile(REPO, partIdPath(SHARED), 'main'));
  assert.equal(store.getAssemblyCommit(REPO, 'main', ASM_A), null);

  const listed = await listV2Assemblies(adapter, REPO, 'main');
  const rows = assemblyRows({
    v2: listed,
    open: { id: mintSurfId({ now: new Date('2026-10-18T03:10:00.009Z'), rand: 'e55e' }), name: 'Assembly' },
  });
  assert.equal(rows.some((row) => row.id === ASM_A), false);
  assert.equal(rows.some((row) => row.id === ASM_B), true);
  assert.equal(a.name, 'Metallll');
});

test('Delete parts keeps a part file another assembly shares', async () => {
  const { adapter, store, a, sibling } = await seedPair();
  const before = commits(adapter).length;
  const result = await executeDeleteV2Assembly({
    adapter,
    repo: REPO,
    store,
    assemblyId: ASM_A,
    openDoc: a,
    deleteParts: true,
    confirm: true,
  });
  assert.equal(result.status, 'committed', result.error);
  assert.equal(commits(adapter).length, before + 1);
  const paths = result.files.map((file) => file.path).sort();
  assert.deepEqual(paths, [assemblyIdPath(ASM_A), partIdPath(ONLY)].sort());
  assert.equal(await adapter.readFile(REPO, partIdPath(ONLY), 'main'), null);
  assert.ok(await adapter.readFile(REPO, partIdPath(SHARED), 'main'));
  assert.equal((await adapter.readFile(REPO, assemblyIdPath(ASM_B), 'main')).content, sibling);
  const listed = await listV2Assemblies(adapter, REPO, 'main');
  assert.equal(listed.some((row) => row.id === ASM_A), false);
});

test('a failed reference scan refuses the delete', async () => {
  const { adapter, store, a } = await seedPair();
  const before = commits(adapter).length;
  adapter.listTree = async () => {
    throw new Error('tree down');
  };
  const result = await executeDeleteV2Assembly({
    adapter,
    repo: REPO,
    store,
    assemblyId: ASM_A,
    openDoc: a,
    deleteParts: true,
    confirm: true,
  });
  assert.equal(result.status, 'error');
  assert.equal(result.code, 'delete_refused');
  assert.equal(commits(adapter).length, before);
  assert.ok(await adapter.readFile(REPO, assemblyIdPath(ASM_A), 'main'));
  assert.ok(await adapter.readFile(REPO, partIdPath(ONLY), 'main'));
  assert.equal(a.name, 'Metallll');
});

test('offline delete waits, and a moved tip is a conflict with no write', async () => {
  const { adapter, store, a } = await seedPair();
  const before = commits(adapter).length;
  const parked = await executeDeleteV2Assembly({
    adapter,
    repo: REPO,
    store,
    assemblyId: ASM_A,
    openDoc: a,
    deleteParts: false,
    confirm: true,
    online: false,
  });
  assert.equal(parked.status, 'pending');
  assert.equal(parked.code, 'pending_save');
  assert.equal(commits(adapter).length, before);
  assert.ok(await adapter.readFile(REPO, assemblyIdPath(ASM_A), 'main'));

  const pushed = await executeDeleteV2Assembly({
    adapter,
    repo: REPO,
    store,
    assemblyId: ASM_A,
    openDoc: a,
    deleteParts: false,
    confirm: true,
    online: true,
  });
  assert.equal(pushed.status, 'committed', pushed.error);
  assert.equal(commits(adapter).length, before + 1);
  assert.equal(await adapter.readFile(REPO, assemblyIdPath(ASM_A), 'main'), null);

  const again = await seedPair();
  const remoteBefore = commits(again.adapter).length;
  const current = await again.adapter.readFile(REPO, assemblyIdPath(ASM_A), 'main');
  await again.adapter.commitFiles(REPO, {
    branch: 'main',
    message: 'remote edit',
    files: [{ path: assemblyIdPath(ASM_A), content: `${current.content}\n` }],
  });
  const conflicted = await executeDeleteV2Assembly({
    adapter: again.adapter,
    repo: REPO,
    store: again.store,
    assemblyId: ASM_A,
    openDoc: again.a,
    deleteParts: false,
    confirm: true,
  });
  assert.equal(conflicted.status, 'conflict');
  assert.equal(conflicted.code, 'conflict');
  assert.equal(commits(again.adapter).length, remoteBefore + 1);
  assert.ok(await again.adapter.readFile(REPO, assemblyIdPath(ASM_A), 'main'));
  assert.equal(again.a.name, 'Metallll');
});

test('deleting an assembly that is not open removes it after reload', async () => {
  const { adapter, store, a } = await seedPair();
  const openBytes = (await adapter.readFile(REPO, assemblyIdPath(ASM_A), 'main')).content;
  const before = commits(adapter).length;
  const result = await executeDeleteV2Assembly({
    adapter,
    repo: REPO,
    store,
    assemblyId: ASM_B,
    openDoc: a,
    deleteParts: false,
    confirm: true,
  });
  assert.equal(result.status, 'committed', result.error);
  assert.equal(commits(adapter).length, before + 1);
  assert.equal(await adapter.readFile(REPO, assemblyIdPath(ASM_B), 'main'), null);
  assert.equal((await adapter.readFile(REPO, assemblyIdPath(ASM_A), 'main')).content, openBytes);
  assert.ok(await adapter.readFile(REPO, partIdPath(SHARED), 'main'));
  const listed = await listV2Assemblies(adapter, REPO, 'main');
  assert.equal(listed.some((row) => row.id === ASM_B), false);
  assert.equal(listed.some((row) => row.id === ASM_A), true);
  assert.equal(a.name, 'Metallll');
});

test('part delete names the other assembly, writes nothing until confirmed, and leaves that assembly', async () => {
  const { adapter, store, a, sibling } = await seedPair();
  assert.equal(
    partAlsoUsedCopy(['Bike Frame', 'Pi 5 Case']),
    'This part is also used in: Bike Frame, Pi 5 Case.',
  );
  const scan = await scanOtherAssemblyPartUses(adapter, REPO, 'main', [SHARED], {
    exceptAssemblyId: ASM_A,
  });
  assert.equal(scan.ok, true);
  assert.deepEqual(scan.assemblies.map((row) => row.name), ['Other']);
  assert.equal(scan.assemblies.some((row) => row.id === ASM_A), false);

  const before = commits(adapter).length;
  const held = await executeDeleteV2Part({
    adapter,
    repo: REPO,
    store,
    partId: SHARED,
    openDoc: a,
    confirm: false,
  });
  assert.equal(held.code, 'confirm_required');
  assert.equal(commits(adapter).length, before);
  assert.ok(await adapter.readFile(REPO, partIdPath(SHARED), 'main'));

  const result = await executeDeleteV2Part({
    adapter,
    repo: REPO,
    store,
    partId: SHARED,
    openDoc: a,
    confirm: true,
  });
  assert.equal(result.status, 'committed', result.error);
  assert.equal(commits(adapter).length, before + 1);
  assert.equal(result.assemblies.some((row) => row.name === 'Other'), true);
  assert.equal(await adapter.readFile(REPO, partIdPath(SHARED), 'main'), null);
  assert.ok(await adapter.readFile(REPO, partIdPath(ONLY), 'main'));
  assert.equal((await adapter.readFile(REPO, assemblyIdPath(ASM_B), 'main')).content, sibling);
  const openText = (await adapter.readFile(REPO, assemblyIdPath(ASM_A), 'main')).content;
  assert.equal(openText.includes(SHARED), false);
  assert.equal(openText.includes(ONLY), true);
  const remembered = store.getAssemblyCommit(REPO, 'main', ASM_A);
  assert.equal(remembered.files[partIdPath(SHARED)], undefined);
  assert.equal(JSON.stringify(remembered.json).includes(SHARED), false);
  assert.equal(a.name, 'Metallll');
});

test('a failed part scan refuses and writes nothing', async () => {
  const { adapter, store, a } = await seedPair();
  const before = commits(adapter).length;
  adapter.listTree = async () => {
    throw new Error('tree down');
  };
  const result = await executeDeleteV2Part({
    adapter,
    repo: REPO,
    store,
    partId: ONLY,
    openDoc: a,
    confirm: true,
  });
  assert.equal(result.status, 'error');
  assert.equal(result.code, 'delete_refused');
  assert.match(result.error, /Couldn't check where this part is used/);
  assert.equal(commits(adapter).length, before);
  assert.ok(await adapter.readFile(REPO, partIdPath(ONLY), 'main'));
  assert.ok(await adapter.readFile(REPO, assemblyIdPath(ASM_A), 'main'));
});

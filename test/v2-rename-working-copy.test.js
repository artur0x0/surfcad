/**
 * v2 rename is a working-copy name edit. It does not commit.
 * The id and parts/<id>.js stay put. The row goes dirty. The next Save
 * writes // @name and parts[].name and the dot clears.
 * Metallll / "Testing Long Part Name" is the production repro.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { compareWorkingCopyToCommit } from '../src/agent/state/workingCopyUnsaved.js';
import { renamePart } from '../src/utils/assembly.js';
import { executePlanSave } from '../src/utils/git/executePlanSave.js';
import { partRowGitChrome } from '../src/utils/git/gitAssemblyRename.js';
import { assemblyIdPath, partIdPath } from '../src/utils/git/idPaths.js';
import { createMockGithubAdapter } from '../src/utils/git/mockGithubAdapter.js';
import { mintSurfId, readSurfName } from '../src/utils/git/surfId.js';
import { createSyncStore } from '../src/utils/git/syncStore.js';
import {
  listV2BrowseItems,
  overlayWorkingCopyBrowseNames,
} from '../src/utils/git/v2VaultRead.js';

const APP = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const ASM = mintSurfId({ now: new Date('2026-10-18T02:50:00.001Z'), rand: 'aa01' });
const PART = mintSurfId({ now: new Date('2026-10-18T02:50:00.002Z'), rand: 'bb02' });
const OTHER = mintSurfId({ now: new Date('2026-10-18T02:50:00.003Z'), rand: 'cc03' });
const REPO = { owner: 'artur', name: 'surfcad-vault' };
const OLD_PART = 'Testing Long Part Name';
const NEW_PART = 'Pin';
const ASM_NAME = 'Metallll';
const NEW_ASM = 'Frame';

function commits(adapter) {
  return adapter._log.filter((row) => row.op === 'commitFiles');
}

function docWith(parts, name = ASM_NAME) {
  return {
    id: ASM,
    source: 'git',
    vaultLayout: 'v2',
    name,
    activeId: parts[0]?.id ?? null,
    parts,
  };
}

function metallll() {
  return docWith([
    { id: PART, name: OLD_PART, visible: true, order: 0 },
    { id: OTHER, name: 'Cover', visible: true, order: 1 },
  ]);
}

async function gitSave(adapter, store, doc, scripts, message, create = false) {
  return executePlanSave({
    adapter,
    repo: REPO,
    branch: 'main',
    store,
    workingCopy: {
      doc,
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

async function openScripts(adapter, doc) {
  const scripts = {};
  for (const part of doc.parts) {
    const file = await adapter.readFile(REPO, partIdPath(part.id), 'main');
    assert.ok(file?.content, part.id);
    scripts[part.id] = file.content;
  }
  return scripts;
}

function rowDot(partIds, id) {
  return partRowGitChrome({ contentDirty: partIds.includes(id) }).dirty;
}

test('part rename keeps the id, writes no git, dirties the row, and Save clears it', async () => {
  const adapter = createMockGithubAdapter({ login: 'artur' });
  const store = createSyncStore({ persist: false });
  await store.ready();
  const doc = metallll();
  const body = {
    [PART]: 'return Manifold.cube([10, 10, 40], true);\n',
    [OTHER]: 'return Manifold.cube([4, 4, 4], true);\n',
  };
  const seeded = await gitSave(adapter, store, doc, body, 'Save Metallll', true);
  assert.equal(seeded.status, 'committed', seeded.error);
  const before = commits(adapter).length;
  const scripts = await openScripts(adapter, doc);
  assert.match(scripts[PART], new RegExp(`@name ${OLD_PART}`));
  assert.match(scripts[PART], new RegExp(`@surf-id ${PART}`));

  const renamed = renamePart(doc, PART, NEW_PART);
  assert.notEqual(renamed, doc);
  assert.equal(renamed.id, ASM);
  assert.equal(renamed.parts.find((row) => row.id === PART).name, NEW_PART);
  assert.equal(renamed.parts.find((row) => row.id === OTHER).name, 'Cover');
  const dirty = compareWorkingCopyToCommit({
    doc: renamed,
    scripts,
    assemblyCommit: seeded.nextAssemblyCommit,
  });
  assert.equal(dirty.unsaved, true);
  assert.equal(dirty.assemblyDirty, true);
  assert.deepEqual(dirty.partIds, [PART]);
  assert.equal(rowDot(dirty.partIds, PART), true);
  assert.equal(rowDot(dirty.partIds, OTHER), false);
  assert.equal(commits(adapter).length, before, 'rename writes no git');

  const saved = await gitSave(adapter, store, renamed, scripts, 'Rename part');
  assert.equal(saved.status, 'committed', saved.error);
  assert.equal(commits(adapter).length, before + 1);
  const writes = saved.files || [];
  assert.equal(writes.some((file) => file.delete), false);
  assert.ok(writes.some((file) => file.path === partIdPath(PART) && !file.delete));
  assert.ok(writes.some((file) => file.path === assemblyIdPath(ASM) && !file.delete));
  assert.equal(writes.some((file) => file.path === partIdPath(OTHER)), false);

  const partFile = await adapter.readFile(REPO, partIdPath(PART), 'main');
  assert.equal(readSurfName(partFile.content), NEW_PART);
  assert.match(partFile.content, new RegExp(`@surf-id ${PART}`));
  const asm = JSON.parse((await adapter.readFile(REPO, assemblyIdPath(ASM), 'main')).content);
  assert.equal(asm.id, ASM);
  assert.equal(asm.name, ASM_NAME);
  assert.equal(asm.parts.find((row) => row.id === PART).name, NEW_PART);
  assert.equal(asm.parts.find((row) => row.id === OTHER).name, 'Cover');

  const clean = compareWorkingCopyToCommit({
    doc: renamed,
    scripts,
    assemblyCommit: saved.nextAssemblyCommit,
  });
  assert.equal(clean.unsaved, false);
  assert.equal(clean.assemblyDirty, false);
  assert.deepEqual(clean.partIds, []);
  assert.equal(rowDot(clean.partIds, PART), false);
});

test('assembly rename keeps the id, dirties Save, and the next Save writes the name', async () => {
  const adapter = createMockGithubAdapter({ login: 'artur' });
  const store = createSyncStore({ persist: false });
  await store.ready();
  const doc = metallll();
  const body = {
    [PART]: 'return 1;\n',
    [OTHER]: 'return 2;\n',
  };
  const seeded = await gitSave(adapter, store, doc, body, 'Save Metallll', true);
  assert.equal(seeded.status, 'committed', seeded.error);
  const before = commits(adapter).length;
  const scripts = await openScripts(adapter, doc);
  const partBefore = scripts[PART];

  const renamed = { ...doc, name: NEW_ASM };
  const dirty = compareWorkingCopyToCommit({
    doc: renamed,
    scripts,
    assemblyCommit: seeded.nextAssemblyCommit,
  });
  assert.equal(dirty.unsaved, true);
  assert.equal(dirty.assemblyDirty, true);
  assert.deepEqual(dirty.partIds, []);
  assert.equal(rowDot(dirty.partIds, PART), false);
  assert.equal(commits(adapter).length, before);

  const saved = await gitSave(adapter, store, renamed, scripts, 'Rename assembly');
  assert.equal(saved.status, 'committed', saved.error);
  assert.equal(commits(adapter).length, before + 1);
  assert.equal((saved.files || []).some((file) => file.delete), false);
  assert.ok((saved.files || []).some((file) => file.path === assemblyIdPath(ASM) && !file.delete));
  assert.equal((saved.files || []).some((file) => file.path === partIdPath(PART)), false);
  const asm = JSON.parse((await adapter.readFile(REPO, assemblyIdPath(ASM), 'main')).content);
  assert.equal(asm.id, ASM);
  assert.equal(asm.name, NEW_ASM);
  assert.equal(asm.parts.find((row) => row.id === PART).name, OLD_PART);
  const partAfter = await adapter.readFile(REPO, partIdPath(PART), 'main');
  assert.equal(partAfter.content, partBefore);

  const clean = compareWorkingCopyToCommit({
    doc: renamed,
    scripts,
    assemblyCommit: saved.nextAssemblyCommit,
  });
  assert.equal(clean.unsaved, false);
  assert.equal(clean.assemblyDirty, false);
  assert.deepEqual(clean.partIds, []);
});

test('v2 allows a repeated part name and the Open dialog shows the unsaved name', async () => {
  const adapter = createMockGithubAdapter({ login: 'artur' });
  const store = createSyncStore({ persist: false });
  await store.ready();
  const doc = metallll();
  const body = {
    [PART]: 'return 1;\n',
    [OTHER]: 'return 2;\n',
  };
  const seeded = await gitSave(adapter, store, doc, body, 'Save Metallll', true);
  assert.equal(seeded.status, 'committed', seeded.error);
  const committed = await listV2BrowseItems(adapter, REPO, 'main');
  assert.equal(committed.assemblies.find((row) => row.id === ASM).name, ASM_NAME);
  assert.equal(committed.parts.find((row) => row.id === PART).name, OLD_PART);

  const renamed = { ...renamePart(doc, PART, 'Cover'), name: NEW_ASM };
  assert.equal(renamed.parts.filter((row) => row.name === 'Cover').length, 2);
  assert.deepEqual(renamed.parts.map((row) => row.id), [PART, OTHER]);
  const overlay = overlayWorkingCopyBrowseNames(committed, renamed);
  assert.equal(overlay.assemblies.find((row) => row.id === ASM).name, NEW_ASM);
  assert.equal(overlay.parts.find((row) => row.id === PART).name, 'Cover');
  assert.equal(committed.parts.find((row) => row.id === PART).name, OLD_PART);
  assert.equal(commits(adapter).length, 1);

  const saved = await gitSave(adapter, store, renamed, body, 'Save names');
  assert.equal(saved.status, 'committed', saved.error);
  const listed = await listV2BrowseItems(adapter, REPO, 'main');
  assert.equal(listed.assemblies.find((row) => row.id === ASM).name, NEW_ASM);
  assert.equal(listed.parts.find((row) => row.id === PART).name, 'Cover');
  assert.equal(listed.parts.find((row) => row.id === OTHER).name, 'Cover');
});

test('App no longer blocks v2 rename or delete with the old folder-layout sentence', () => {
  assert.equal(/blocked until v2 Save/.test(APP), false);
  assert.equal(/old folder layout and is blocked/.test(APP), false);
  const rename = APP.slice(
    APP.indexOf('const handleRenameAssembly'),
    APP.indexOf('const current = assemblyName(doc)'),
  );
  assert.match(rename, /vaultLayout === 'v2'/);
  assert.match(rename, /moved: false/);
  assert.equal(/setUploadError/.test(rename), false);
  assert.equal(/recordRenameFrom/.test(rename), false);
  const part = APP.slice(APP.indexOf('const handleRenamePart'), APP.indexOf('const handleRenameFile'));
  assert.match(part, /moved: false/);
  assert.match(part, /if \(!v2\)/);
  assert.match(part, /Couldn't rename the part\. Nothing was changed\./);
  const delStart = APP.indexOf('const handleDeleteAssembly');
  const del = APP.slice(delStart, APP.indexOf('if (assemblyOpenLockRef.current)', delStart));
  assert.match(del, /vaultLayout === 'v2'/);
  assert.match(del, /seedAgentAssembly\(\{\}\)/);
  assert.match(del, /Couldn't delete the assembly\. Nothing was changed\./);
  assert.equal(/planDeleteAssembly\(/.test(del), false);
});

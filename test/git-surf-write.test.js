/**
 * Non-Save git .surf.json writers: promote path-less siblings or refuse
 * before the caller mutates the working copy. Mock adapter only.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMockGithubAdapter } from '../src/utils/git/mockGithubAdapter.js';
import { findOrCreateVault } from '../src/utils/git/vault.js';
import { assemblyFilePath, assemblyPartPath, sharedPartPath } from '../src/utils/git/vaultLayout.js';
import { readFileSync } from 'node:fs';
import { parseSurfJson, validateSurfJson } from '../src/utils/git/surfJson.js';
import { mintSurfId } from '../src/utils/git/surfId.js';
import { mintGroupId } from '../src/utils/partGroups.js';
import { removePart, serializeAssembly } from '../src/utils/assembly.js';
import { fileWrite } from '../src/utils/git/githubAdapterInterface.js';
import {
  PATH_LESS_PARTS,
  VAULT_TREE_UNAVAILABLE,
  deletePartFromRepo,
  prepareAssemblySurfWrite,
  prepareVaultPartRename,
} from '../src/utils/git/gitCommit.js';
import { planAssemblyRename } from '../src/utils/git/gitAssemblyRename.js';
import { commitOpenAssemblyText, projectPendingOps } from '../src/utils/git/gitDeleteAssembly.js';
import { checkInMineToBranch } from '../src/utils/git/gitPull.js';
import { buildRenameCommitFiles } from '../src/utils/git/gitRename.js';

const ASM = 'Kettle';
const BRACKET = sharedPartPath('Bracket');
const STRAY = 'local:agent-lid';
const LID = assemblyPartPath(ASM, 'Lid');
const MOUNT = sharedPartPath('Mount');

function fixture() {
  const surfId = mintSurfId();
  const strayId = mintSurfId();
  const doc = {
    source: 'git',
    name: ASM,
    activeId: BRACKET,
    parts: [
      { id: BRACKET, name: 'Bracket', visible: true, order: 0, surfId },
      { id: STRAY, name: 'Lid', visible: true, order: 1, surfId: strayId },
    ],
  };
  const scripts = {
    [BRACKET]: '// bracket\n',
    [STRAY]: '// lid\n',
  };
  return { doc, scripts, surfId, strayId };
}

function surfFromFiles(files) {
  const asm = files.find((file) => file.path === assemblyFilePath(ASM) && !file.delete);
  assert.ok(asm, 'writer includes assemblies/Kettle/.surf.json');
  const raw = JSON.parse(asm.content);
  assert.equal(validateSurfJson(raw).ok, true, validateSurfJson(raw).errors?.join('; '));
  return raw;
}

async function seededVault() {
  const gh = createMockGithubAdapter({ login: 'agent' });
  const vault = await findOrCreateVault(gh);
  return { gh, vault };
}

test('delete with a path-less sibling promotes and writes the sibling blob', async () => {
  const { gh, vault } = await seededVault();
  const { doc, scripts } = fixture();
  const original = JSON.parse(JSON.stringify(doc));
  const prepared = await prepareAssemblySurfWrite(gh, vault.repo, {
    doc: removePart(doc, BRACKET),
    scripts: { [STRAY]: scripts[STRAY] },
    extraFiles: [{ path: BRACKET, delete: true }],
  });
  assert.equal(prepared.status, 'ready');
  assert.deepEqual(original.parts.map((p) => p.id), [BRACKET, STRAY], 'input doc is unchanged');
  assert.equal(prepared.doc.parts.length, 1);
  assert.equal(prepared.doc.parts[0].id, STRAY);
  assert.equal(prepared.doc.parts[0].path, LID);
  const raw = surfFromFiles(prepared.files);
  assert.equal(raw.parts[0].path, LID);
  assert.ok(prepared.files.some((file) => file.path === LID && file.content === '// lid\n'));
  assert.ok(prepared.files.some((file) => file.path === BRACKET && file.delete));
});

test('rename with a path-less sibling promotes and writes the sibling blob', async () => {
  const { gh, vault } = await seededVault();
  const { doc, scripts } = fixture();
  const beforeId = doc.parts[0].id;
  const prepared = await prepareVaultPartRename(gh, vault.repo, {
    doc,
    scripts,
    from: BRACKET,
    nextName: 'Plate',
  });
  assert.equal(prepared.status, 'ready', prepared.error);
  assert.equal(doc.parts[0].id, beforeId, 'input doc is unchanged');
  assert.equal(prepared.from, BRACKET);
  assert.equal(prepared.to, sharedPartPath('Plate'));
  assert.ok(prepared.moved.some((move) => move.from === STRAY && move.to === LID));
  const raw = surfFromFiles(prepared.files);
  assert.ok(raw.parts.some((part) => part.path === sharedPartPath('Plate')));
  assert.ok(raw.parts.some((part) => part.path === LID));
  assert.ok(prepared.files.some((file) => file.path === LID && file.content === '// lid\n'));
});

test('paint with a path-less sibling promotes and writes', async () => {
  const { gh, vault } = await seededVault();
  const { doc, scripts, surfId } = fixture();
  const painted = serializeAssembly({
    ...doc,
    colors: { [surfId]: { part: '#ff5a1f' } },
  });
  const prepared = await prepareAssemblySurfWrite(gh, vault.repo, {
    doc: painted,
    scripts,
  });
  assert.equal(prepared.status, 'ready');
  const raw = surfFromFiles(prepared.files);
  assert.equal(raw.colors[surfId].part, '#ff5a1f');
  assert.ok(raw.parts.some((part) => part.path === LID));
  assert.ok(prepared.files.some((file) => file.path === LID));
});

test('group with a path-less sibling promotes and writes', async () => {
  const { gh, vault } = await seededVault();
  const { doc, scripts, surfId } = fixture();
  const grouped = serializeAssembly({
    ...doc,
    groups: [{
      id: mintGroupId(),
      name: 'Cover',
      source: assemblyFilePath('Cover'),
      partIds: [surfId],
    }],
  });
  const prepared = await prepareAssemblySurfWrite(gh, vault.repo, {
    doc: grouped,
    scripts,
  });
  assert.equal(prepared.status, 'ready');
  const raw = surfFromFiles(prepared.files);
  assert.equal(raw.groups[0].name, 'Cover');
  assert.ok(raw.parts.some((part) => part.path === LID));
  assert.ok(prepared.files.some((file) => file.path === LID));
});

test('+Part with a path-less sibling promotes and writes both blobs', async () => {
  const { gh, vault } = await seededVault();
  const { doc, scripts } = fixture();
  const added = sharedPartPath('New');
  const nextDoc = {
    ...doc,
    activeId: added,
    parts: [
      ...doc.parts,
      { id: added, name: 'New', visible: true, order: 2, surfId: mintSurfId() },
    ],
  };
  const nextScripts = { ...scripts, [added]: '// new\n' };
  const prepared = await prepareAssemblySurfWrite(gh, vault.repo, {
    doc: nextDoc,
    scripts: nextScripts,
    extraFiles: [fileWrite(added, '// new\n')],
  });
  assert.equal(prepared.status, 'ready');
  const raw = surfFromFiles(prepared.files);
  assert.ok(raw.parts.some((part) => part.path === added));
  assert.ok(raw.parts.some((part) => part.path === LID));
  assert.ok(prepared.files.some((file) => file.path === added && file.content === '// new\n'));
  assert.ok(prepared.files.some((file) => file.path === LID && file.content === '// lid\n'));
  assert.equal(doc.parts.length, 2, 'input doc is unchanged');
});

test('unpromotable leftovers refuse with path_less_parts and write nothing', async () => {
  const { gh, vault } = await seededVault();
  const doc = {
    source: 'git',
    name: '',
    activeId: STRAY,
    parts: [{ id: STRAY, name: 'Lid', visible: true, order: 0, surfId: mintSurfId() }],
  };
  await assert.rejects(
    () => prepareAssemblySurfWrite(gh, vault.repo, { doc, scripts: { [STRAY]: '// lid\n' } }),
    (err) => err.code === PATH_LESS_PARTS && /unchanged/.test(err.message),
  );
});

test('rename_part with remote Mount.js and throwing listTree does not plan a write', async () => {
  const { gh, vault } = await seededVault();
  await gh.commitFiles(vault.repo, {
    branch: 'main',
    message: 'remote Mount',
    baseSha: vault.headSha,
    files: [fileWrite(MOUNT, '// remote mount\n')],
  });
  const { doc, scripts } = fixture();
  const before = JSON.parse(JSON.stringify(doc.parts.map((p) => p.id)));
  gh.listTree = async () => {
    throw new Error('network down');
  };
  const out = await prepareVaultPartRename(gh, vault.repo, {
    doc,
    scripts,
    from: BRACKET,
    nextName: 'Mount',
  });
  assert.equal(out.status, 'error');
  assert.equal(out.code, VAULT_TREE_UNAVAILABLE);
  assert.deepEqual(doc.parts.map((p) => p.id), before);
  assert.equal(out.files, undefined);
  assert.equal(out.to, undefined);
});

test('rename commit files include promoted sibling blobs from extraFiles', () => {
  const assemblyText = JSON.stringify({
    format: 'surfcad.assembly',
    version: 1,
    name: ASM,
    activeId: sharedPartPath('Plate'),
    parts: [
      { path: sharedPartPath('Plate'), name: 'Plate', visible: true, order: 0 },
      { path: LID, name: 'Lid', visible: true, order: 1 },
    ],
  }, null, 2) + '\n';
  const built = buildRenameCommitFiles({
    entries: [
      { path: BRACKET, content: '// bracket\n' },
      { path: assemblyFilePath(ASM), content: '{}\n' },
    ],
    plan: {
      kind: 'part',
      from: BRACKET,
      to: sharedPartPath('Plate'),
      content: '// bracket\n',
      assemblyPath: assemblyFilePath(ASM),
      assemblyText,
      extraFiles: [fileWrite(LID, '// lid\n')],
    },
  });
  assert.ok(built.files.some((file) => file.path === LID && file.content === '// lid\n'));
  assert.ok(built.files.some((file) => file.path === assemblyFilePath(ASM) && file.content === assemblyText));
  assert.ok(built.files.some((file) => file.path === sharedPartPath('Plate')));
});

test('parseSurfJson accepts a promoted delete write', async () => {
  const { gh, vault } = await seededVault();
  const { doc, scripts, strayId } = fixture();
  const prepared = await prepareAssemblySurfWrite(gh, vault.repo, {
    doc: removePart(doc, BRACKET),
    scripts: { [STRAY]: scripts[STRAY] },
  });
  const reopened = parseSurfJson(prepared.assemblyText);
  assert.deepEqual(reopened.parts.map((p) => p.path), [LID]);
  assert.equal(reopened.parts[0].id, strayId);
});

test('planAssemblyRename promotes a path-less sibling before writing .surf.json', async () => {
  const { gh, vault } = await seededVault();
  const { doc, scripts } = fixture();
  const before = JSON.parse(JSON.stringify(doc.parts.map((part) => part.id)));
  const plan = await planAssemblyRename({
    doc,
    scripts,
    nextName: 'Pot',
    adapter: gh,
    repo: vault.repo,
    branch: 'main',
  });
  assert.deepEqual(doc.parts.map((part) => part.id), before, 'input doc is unchanged');
  const potLid = assemblyPartPath('Pot', 'Lid');
  assert.ok(plan.doc.parts.some((part) => part.path === potLid || part.id === potLid));
  assert.ok(plan.doc.parts.some((part) => part.id === STRAY || part.id === BRACKET));
  const raw = parseSurfJson(plan.assemblyText);
  assert.ok(raw.parts.some((part) => part.id === potLid || part.path === potLid));
  assert.ok(
    plan.payload.localFiles.some((file) => file.path === potLid && file.content === '// lid\n'),
    'promoted sibling blob is in the rename payload',
  );
});

test('checkInMineToBranch promotes a path-less sibling and does not create a branch on refuse', async () => {
  const { gh, vault } = await seededVault();
  const { doc, scripts } = fixture();
  const baseline = {
    branch: 'main',
    headSha: vault.headSha,
    assemblyPath: assemblyFilePath(ASM),
  };
  const beforeIds = JSON.parse(JSON.stringify(doc.parts.map((part) => part.id)));
  const res = await checkInMineToBranch(gh, vault.repo, {
    doc,
    scripts,
    baseline,
    path: assemblyFilePath(ASM),
    kind: 'assembly',
    now: new Date('2026-10-17T00:00:00Z'),
  });
  assert.equal(res.status, 'branched');
  assert.deepEqual(doc.parts.map((part) => part.id), beforeIds, 'working copy is unchanged');
  const written = parseSurfJson((await gh.readFile(vault.repo, assemblyFilePath(ASM), res.branch)).content);
  assert.ok(written.parts.some((part) => part.path === LID || part.id === LID));
  assert.equal((await gh.readFile(vault.repo, LID, res.branch)).content, '// lid\n');
  assert.equal(await gh.readFile(vault.repo, assemblyFilePath(ASM), 'main'), null);

  const leftoverDoc = {
    source: 'git',
    name: '',
    activeId: STRAY,
    parts: [{ id: STRAY, name: 'Lid', visible: true, order: 0, surfId: mintSurfId() }],
  };
  const branchesBefore = (await gh.listBranches(vault.repo)).map((row) => row.name).sort();
  await assert.rejects(
    () => checkInMineToBranch(gh, vault.repo, {
      doc: leftoverDoc,
      scripts: { [STRAY]: '// lid\n' },
      baseline,
      path: assemblyFilePath('Assembly'),
      kind: 'assembly',
      now: new Date('2026-10-17T00:00:00Z'),
    }),
    (err) => err.code === PATH_LESS_PARTS,
  );
  const branchesAfter = (await gh.listBranches(vault.repo)).map((row) => row.name).sort();
  assert.deepEqual(branchesAfter, branchesBefore, 'no side branch before a prepare throw');
});

test('commitOpenAssemblyText promotes a path-less sibling and leaves the input doc alone', async () => {
  const { gh, vault } = await seededVault();
  const { doc, scripts } = fixture();
  const before = JSON.parse(JSON.stringify(doc.parts.map((part) => part.id)));
  const asmPath = assemblyFilePath(ASM);
  const out = await commitOpenAssemblyText(
    [fileWrite(asmPath, '{}\n'), fileWrite(BRACKET, '// bracket\n')],
    asmPath,
    doc,
    { adapter: gh, repo: vault.repo, scripts, branch: 'main' },
  );
  assert.deepEqual(doc.parts.map((part) => part.id), before, 'input doc is unchanged');
  assert.ok(out.doc.parts.some((part) => part.path === LID || part.id === LID));
  const asm = out.files.find((file) => file.path === asmPath && !file.delete);
  assert.ok(asm);
  const raw = parseSurfJson(asm.content);
  assert.ok(raw.parts.some((part) => part.path === LID || part.id === LID));
  assert.ok(out.files.some((file) => file.path === LID && file.content === '// lid\n'));
});

test('deletePartFromRepo promotes a path-less sibling before the assembly write', async () => {
  const { gh, vault } = await seededVault();
  const { doc, scripts } = fixture();
  await gh.commitFiles(vault.repo, {
    branch: 'main',
    message: 'seed bracket',
    baseSha: vault.headSha,
    files: [fileWrite(BRACKET, '// bracket\n')],
  });
  const before = JSON.parse(JSON.stringify(doc.parts.map((part) => part.id)));
  const removed = await deletePartFromRepo(gh, vault.repo, {
    doc: removePart(doc, BRACKET),
    scripts,
    baseline: { branch: 'main', headSha: (await gh.getBranch(vault.repo, 'main')).sha, scripts: {} },
    partPath: BRACKET,
  });
  assert.equal(removed.status, 'committed', removed.error);
  assert.deepEqual(doc.parts.map((part) => part.id), before, 'input doc is unchanged');
  const raw = parseSurfJson((await gh.readFile(vault.repo, assemblyFilePath(ASM), 'main')).content);
  assert.ok(raw.parts.some((part) => part.path === LID || part.id === LID));
  assert.equal((await gh.readFile(vault.repo, LID, 'main')).content, '// lid\n');
  assert.equal(await gh.readFile(vault.repo, BRACKET, 'main'), null);
});

test('projectPendingOps includes a rename payload extraFiles', () => {
  const plate = sharedPartPath('Plate');
  const projected = projectPendingOps(
    [
      { path: BRACKET, content: '// bracket\n' },
      { path: assemblyFilePath(ASM), content: '{}\n' },
    ],
    [{
      op: 'rename',
      status: 'queued',
      payload: {
        kind: 'part',
        from: BRACKET,
        to: plate,
        content: '// bracket\n',
        extraFiles: [fileWrite(LID, '// lid\n')],
      },
    }],
  );
  assert.ok(projected.some((entry) => entry.path === LID && entry.content === '// lid\n'));
  assert.ok(projected.some((entry) => entry.path === plate));
  assert.equal(projected.some((entry) => entry.path === BRACKET), false);
});

test('mesh import fails loud when the vault tree cannot be listed', () => {
  const src = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
  const start = src.indexOf('const name = dedupedImportName');
  const end = src.indexOf('id = newLocalPartId()', start);
  assert.ok(start >= 0 && end > start, 'mesh import occupancy block');
  const block = src.slice(start, end);
  assert.match(block, /listVaultTreePaths/);
  assert.match(block, /setUploadError/);
  assert.match(block, /VAULT_TREE_UNAVAILABLE/);
  assert.equal(/open document still blocks collisions/.test(block), false);
});

test('CI runs the G7 real-adapter golden', () => {
  const yml = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  assert.match(yml, /smoke_git_g7_real_adapter\.mjs/);
});

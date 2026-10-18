/**
 * Part rename commits the tip file move + `.surf.json` path/name only.
 * Pending script, placement, and other dirty rows stay for Save.
 * Mock adapter, no network.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createMockGithubAdapter } from '../src/utils/git/mockGithubAdapter.js';
import { findOrCreateVault } from '../src/utils/git/vault.js';
import { assemblyFilePath, assemblyPartPath } from '../src/utils/git/vaultLayout.js';
import { parseSurfJson, stringifySurfJson } from '../src/utils/git/surfJson.js';
import { serializeAssembly } from '../src/utils/assembly.js';
import {
  assembleCommitFiles,
  baselineAfterPartRename,
  commitWorkspace,
  firstCommitBaseline,
  partRenameNeedsCommit,
  prepareVaultPartRename,
  stagePartRename,
} from '../src/utils/git/gitCommit.js';
import { buildRenameCommitFiles, rewriteSurfText } from '../src/utils/git/gitRename.js';
import { createSyncStore } from '../src/utils/git/syncStore.js';
import { flushSyncQueue } from '../src/utils/git/syncWorker.js';
import {
  dirtyPartIds,
  isAssemblyDirty,
  isPartDirty,
  isWorkspaceDirty,
  openVaultAssembly,
} from '../src/utils/git/gitWorkspace.js';
import { findAssemblyPart, partRepoPath } from '../src/utils/git/partIdentity.js';

const ASM = 'Kettle-MCP';
const IDS = [
  '5f0c3c1e-0000-4000-8000-000000000001',
  '5f0c3c1e-0000-4000-8000-000000000002',
];
const NAMES = ['Kettle Body', 'Kettle Lid'];
const TIP_BODY = `// ${NAMES[0]}\nreturn Manifold.cube([1, 1, 1], true);\n`;
const TIP_LID = `// ${NAMES[1]}\nreturn Manifold.cube([2, 1, 1], true);\n`;
const PLACE_Q = [0, 0, Math.SQRT1_2, Math.SQRT1_2];

function kettle() {
  const doc = {
    source: 'git',
    name: ASM,
    activeId: IDS[0],
    parts: IDS.map((id, order) => ({
      id,
      name: NAMES[order],
      visible: true,
      order,
      isSynced: false,
    })),
  };
  const scripts = {
    [IDS[0]]: TIP_BODY,
    [IDS[1]]: TIP_LID,
  };
  return { doc, scripts };
}

function watchCommits(gh) {
  const seen = [];
  const inner = gh.commitFiles.bind(gh);
  gh.commitFiles = async (repo, opts) => {
    seen.push({ message: opts.message, files: opts.files });
    return inner(repo, opts);
  };
  return seen;
}

function dirtyWorkingCopy(saved) {
  const parts = saved.doc.parts.map((part) => (
    part.id === IDS[0]
      ? { ...part, placement: { t: [12, 0, 0], q: PLACE_Q.slice() } }
      : part
  ));
  return {
    doc: serializeAssembly({ ...saved.doc, source: 'git', parts }),
    scripts: {
      ...saved.scripts,
      [IDS[0]]: `${saved.scripts[IDS[0]]}// pending body edit\n`,
      [IDS[1]]: `${saved.scripts[IDS[1]]}// pending lid edit\n`,
    },
  };
}

test('rewriteSurfText updates that part path and name only', () => {
  const from = assemblyPartPath(ASM, 'Kettle Body');
  const to = assemblyPartPath(ASM, 'Body');
  const tip = stringifySurfJson({
    source: 'git',
    name: ASM,
    activeId: IDS[0],
    parts: [
      { id: IDS[0], path: from, name: 'Kettle Body', visible: true, order: 0 },
      { id: IDS[1], path: assemblyPartPath(ASM, 'Kettle Lid'), name: 'Kettle Lid', visible: true, order: 1 },
    ],
  });
  const next = rewriteSurfText(tip, {
    surfId: IDS[0],
    from,
    to,
    name: 'Body',
  });
  const parsed = JSON.parse(next);
  assert.equal(parsed.parts[0].path, to);
  assert.equal(parsed.parts[0].name, 'Body');
  assert.equal(parsed.parts[1].path, assemblyPartPath(ASM, 'Kettle Lid'));
  assert.equal(parsed.parts[1].name, 'Kettle Lid');
  assert.equal(parsed.activeId, to);
  assert.equal(parsed.parts[0].placement, undefined);
});

test('rename commit prefers tip bytes over live payload content', () => {
  const from = assemblyPartPath(ASM, 'Kettle Body');
  const to = assemblyPartPath(ASM, 'Body');
  const built = buildRenameCommitFiles({
    entries: [
      { path: from, content: TIP_BODY },
      { path: assemblyFilePath(ASM), content: '{}\n' },
    ],
    plan: {
      kind: 'part',
      surfId: IDS[0],
      from,
      to,
      name: 'Body',
      content: `${TIP_BODY}// pending body edit\n`,
    },
  });
  const moved = built.files.find((file) => file.path === to && !file.delete);
  assert.equal(moved?.content, TIP_BODY);
  assert.equal(built.files.some((file) => file.path === from && file.delete), true);
});

test('path-less rename does not need a commit', () => {
  const { doc } = kettle();
  assert.equal(partRenameNeedsCommit({
    doc,
    part: doc.parts[0],
    repo: { owner: 'agent', name: 'surfcad-vault' },
  }), false);
});

test('rename commit is tip move + surf.json path/name; Save takes the edit and placement', async () => {
  const gh = createMockGithubAdapter({ login: 'agent' });
  const vault = await findOrCreateVault(gh);
  const { doc, scripts } = kettle();
  const saved = await commitWorkspace(gh, vault.repo, {
    doc,
    scripts,
    baseline: firstCommitBaseline({ headSha: vault.headSha }),
    message: 'Save Kettle',
  });
  assert.equal(saved.status, 'committed');
  const tipBody = (await gh.readFile(vault.repo, assemblyPartPath(ASM, 'Kettle Body'), 'main')).content;
  assert.equal(tipBody, saved.scripts[IDS[0]]);
  const writesBefore = gh._log.filter((row) => row.op === 'commitFiles').length;
  const seen = watchCommits(gh);

  const dirty = dirtyWorkingCopy(saved);
  assert.equal(isPartDirty(IDS[0], dirty.scripts[IDS[0]], saved.baseline), true);
  assert.equal(isAssemblyDirty(dirty.doc, saved.baseline), true);

  const staged = await stagePartRename({
    adapter: gh,
    repo: vault.repo,
    doc: dirty.doc,
    scripts: dirty.scripts,
    from: IDS[0],
    nextName: 'Body',
    branch: 'main',
  });
  assert.equal(staged.status, 'staged', staged.error);
  assert.equal(staged.commit, true);
  assert.equal(staged.fromId, IDS[0]);
  assert.equal(staged.to, assemblyPartPath(ASM, 'Body'));
  assert.equal(staged.payload.content, undefined);
  assert.equal(staged.payload.assemblyText, undefined);
  assert.equal(staged.payload.extraFiles, undefined);
  assert.equal(staged.payload.surfId, IDS[0]);
  const renamed = findAssemblyPart(staged.doc, IDS[0]);
  assert.equal(renamed.path, staged.to);
  assert.equal(renamed.name, 'Body');
  assert.equal(staged.scripts[IDS[0]], dirty.scripts[IDS[0]]);
  assert.equal(staged.scripts[IDS[1]], dirty.scripts[IDS[1]]);
  assert.deepEqual(renamed.placement?.t, [12, 0, 0]);
  assert.equal(partRepoPath(findAssemblyPart(staged.doc, IDS[1])), assemblyPartPath(ASM, 'Kettle Lid'));

  const store = createSyncStore({ persist: false });
  await store.ready();
  await store.setLastSyncedSha(vault.repo, saved.sha, 'main');
  await store.enqueue(vault.repo, { branch: 'main', ...staged.enqueue });
  const flushed = await flushSyncQueue({
    store, adapter: gh, repo: vault.repo, branch: 'main', online: true,
  });
  assert.equal(flushed.status, 'synced', flushed.error);
  assert.equal(flushed.partRenameOnly, true);
  assert.equal(gh._log.filter((row) => row.op === 'commitFiles').length, writesBefore + 1);
  assert.equal(seen.length, 1);
  assert.match(seen[0].message, /^Rename Kettle Body to Body$/);
  const renamePaths = seen[0].files.map((file) => file.path);
  assert.equal(renamePaths.includes(assemblyPartPath(ASM, 'Kettle Body')), true);
  assert.equal(renamePaths.includes(staged.to), true);
  assert.equal(renamePaths.includes(assemblyFilePath(ASM)), true);
  assert.equal(renamePaths.includes(assemblyPartPath(ASM, 'Kettle Lid')), false);
  const moved = seen[0].files.find((file) => file.path === staged.to && !file.delete);
  assert.equal(moved.content, tipBody);
  assert.equal(moved.content.includes('pending body edit'), false);

  const surfAfterRename = parseSurfJson(
    (await gh.readFile(vault.repo, assemblyFilePath(ASM), 'main')).content,
  );
  const bodyRow = surfAfterRename.parts.find((part) => part.id === IDS[0]);
  const lidRow = surfAfterRename.parts.find((part) => part.id === IDS[1]);
  assert.equal(bodyRow.path, staged.to);
  assert.equal(bodyRow.name, 'Body');
  assert.equal(bodyRow.placement, undefined);
  assert.equal(bodyRow.position, undefined);
  assert.equal(lidRow.path, assemblyPartPath(ASM, 'Kettle Lid'));
  assert.equal(lidRow.name, 'Kettle Lid');

  const nextBaseline = baselineAfterPartRename(saved.baseline, {
    from: staged.from,
    to: staged.to,
    name: staged.name,
    surfId: IDS[0],
    headSha: flushed.sha,
    branch: 'main',
  });
  const baseSurf = JSON.parse(nextBaseline.assemblyText);
  const baseRow = baseSurf.parts.find((part) => part.id === IDS[0]);
  assert.equal(baseRow.path, staged.to, 'rename baseline uses the new path');
  assert.equal(baseRow.name, 'Body');
  assert.equal(baseRow.placement, undefined);
  assert.equal(nextBaseline.scripts[IDS[0]], tipBody);
  assert.equal(isPartDirty(IDS[0], staged.scripts[IDS[0]], nextBaseline), true);
  assert.equal(isPartDirty(IDS[1], staged.scripts[IDS[1]], nextBaseline), true);
  assert.equal(isAssemblyDirty(staged.doc, nextBaseline), true);
  assert.equal(isWorkspaceDirty(staged.doc, staged.scripts, nextBaseline), true);
  assert.deepEqual([...dirtyPartIds(staged.doc, staged.scripts, nextBaseline)].sort(), [IDS[0], IDS[1]].sort());

  const open = await openVaultAssembly(gh, vault.repo, ASM, {
    branch: 'main',
    headSha: flushed.sha,
  });
  assert.equal(gh._log.filter((row) => row.op === 'commitFiles').length, writesBefore + 1);
  assert.equal(findAssemblyPart(open.doc, IDS[0])?.path, staged.to);

  const assembled = await assembleCommitFiles(gh, vault.repo, {
    doc: staged.doc,
    scripts: staged.scripts,
    baseline: nextBaseline,
    message: 'Save edits',
  });
  assert.equal(assembled.status, 'ready', JSON.stringify(assembled));
  const saveBody = assembled.files.find((file) => file.path === staged.to && !file.delete);
  assert.equal(saveBody?.content, dirty.scripts[IDS[0]]);
  const saveSurf = parseSurfJson(
    assembled.files.find((file) => file.path === assemblyFilePath(ASM) && !file.delete).content,
  );
  const savedBody = saveSurf.parts.find((part) => part.id === IDS[0]);
  assert.equal(savedBody.path, staged.to);
  assert.deepEqual(savedBody.placement?.t, [12, 0, 0]);
  const saveLid = assembled.files.find((file) => file.path === assemblyPartPath(ASM, 'Kettle Lid') && !file.delete);
  assert.equal(saveLid?.content, dirty.scripts[IDS[1]]);

  const stored = await commitWorkspace(gh, vault.repo, {
    doc: staged.doc,
    scripts: staged.scripts,
    baseline: nextBaseline,
    message: 'Save edits',
  });
  assert.equal(stored.status, 'committed');
  assert.equal(seen.length, 2);
  assert.equal(seen[1].message, 'Save edits');
  assert.equal(
    (await gh.readFile(vault.repo, staged.to, 'main')).content,
    dirty.scripts[IDS[0]],
  );
  const surfAfterSave = parseSurfJson(
    (await gh.readFile(vault.repo, assemblyFilePath(ASM), 'main')).content,
  );
  assert.deepEqual(surfAfterSave.parts.find((part) => part.id === IDS[0]).placement?.t, [12, 0, 0]);
});

test('never-committed part rename is local; prepareVaultPartRename does not write', async () => {
  const gh = createMockGithubAdapter({ login: 'agent' });
  const vault = await findOrCreateVault(gh);
  const { doc, scripts } = kettle();
  const staged = await stagePartRename({
    adapter: gh,
    repo: vault.repo,
    doc,
    scripts,
    from: IDS[0],
    nextName: 'Body',
  });
  assert.equal(staged.status, 'local');
  assert.equal(staged.commit, false);
  const before = gh._log.filter((row) => row.op === 'commitFiles').length;
  const prepared = await prepareVaultPartRename(gh, vault.repo, {
    doc,
    scripts,
    from: IDS[0],
    nextName: 'Body',
  });
  assert.equal(prepared.status, 'error');
  assert.equal(prepared.files, undefined);
  assert.equal(gh._log.filter((row) => row.op === 'commitFiles').length, before);
});

test('UI and agent share stagePartRename and omit live bytes from the payload', () => {
  const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
  const start = app.indexOf('const handleRenamePart');
  const end = app.indexOf('const handleRenameFile');
  assert.ok(start >= 0 && end > start);
  const block = app.slice(start, end);
  assert.match(block, /stagePartRename\(/);
  assert.equal(/assemblyText:/.test(block), false);
  assert.equal(/content: text/.test(block), false);
  assert.equal(/extraFiles/.test(block), false);
  assert.equal(/wrapUnmarkedPartScripts|wrapRawScript/.test(block), false);
  assert.match(app, /async agentRenamePart\(\{ partId, name \}\) \{[\s\S]*?handleRenamePart\(part\.id, name\)/);
});

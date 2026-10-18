import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { newPartStarterScript } from './helperPaletteSnippets.js';
import { parseFeatureMarkers } from './featureMarkers.js';
import { featureStripChips } from './sheetMetal/sheetRibbon.js';
import { buildDirtyState } from '../agent/state/dirty.js';
import { editedPartIdsSinceSnapshot, snapshotPartScripts } from '../agent/state/editedSinceLoad.js';
import { adoptSavedScript, historyForPart } from './partHistory.js';
import { buildFeatureTree } from '../agent/state/featureTree.js';
import { runScript } from '../lib/surfcad/index.js';
import { createMockGithubAdapter } from './git/mockGithubAdapter.js';
import { findOrCreateVault } from './git/vault.js';
import { dirtyPartIds, isWorkspaceDirty, openVaultAssembly } from './git/gitWorkspace.js';
import { assembleCommitFiles } from './git/gitCommit.js';
import { fileWrite } from './git/githubAdapterInterface.js';
import { stringifySurfJson } from './git/surfJson.js';
import { assemblyFilePath, assemblyPartPath } from './git/vaultLayout.js';
import { partRepoPath } from './git/partIdentity.js';
import { mintSurfId, withSurfId } from './git/surfId.js';
import {
  CODE_BEGIN,
  CODE_END,
  hasAnyFeatureMarker,
  scriptNeedsCodeWrap,
  unmarkedCodeChip,
  wrapRawScript,
  wrapUnmarkedPartScripts,
} from './wrapRawScript.js';

const RAW = [
  'let part = Manifold.cube([20, 20, 20], true);',
  'part = part.subtract(Manifold.cylinder(30, 4, 4, 32, true));',
  'return part;',
  '',
].join('\n');

const STARTER = newPartStarterScript();
const APP = readFileSync(new URL('../App.jsx', import.meta.url), 'utf8');
const BRIDGE = readFileSync(new URL('./agentBridge.js', import.meta.url), 'utf8');
const EDITOR = readFileSync(new URL('../components/CodeEditor.jsx', import.meta.url), 'utf8');
const GIT_COMMIT = readFileSync(new URL('./git/gitCommit.js', import.meta.url), 'utf8');

async function seedUnmarkedVault(login = 'wrap-open', { name = 'WrapOpen', rows } = {}) {
  const gh = createMockGithubAdapter({ login });
  const vault = await findOrCreateVault(gh);
  const parts = (rows || [{ id: '5f0c3c1e-0000-4000-8000-0000000000aa', name: 'Bracket' }]).map((row, order) => ({
    id: row.id,
    name: row.name,
    visible: true,
    order,
    path: assemblyPartPath(name, row.name),
  }));
  const doc = {
    source: 'git',
    name,
    activeId: parts[0].id,
    parts,
  };
  const seed = await gh.commitFiles(vault.repo, {
    branch: 'main',
    message: 'seed unmarked part',
    baseSha: vault.headSha,
    files: [
      fileWrite(assemblyFilePath(name), stringifySurfJson(doc)),
      ...parts.map((part) => fileWrite(part.path, RAW)),
    ],
  });
  return { gh, vault, name, parts, doc, headSha: seed.sha };
}

function meshSnapshot(run) {
  const vp = run.mesh?.vertProperties;
  const tv = run.mesh?.triVerts;
  return {
    volume: run.volume,
    tris: run.tris,
    bbox: run.boundingBox,
    vp: vp ? Array.from(vp) : [],
    tv: tv ? Array.from(tv) : [],
  };
}

test('wrapRawScript wraps unmarked source in one Code block', () => {
  const wrapped = wrapRawScript(RAW);
  assert.match(wrapped, new RegExp(`^${CODE_BEGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'm'));
  assert.ok(wrapped.includes(CODE_BEGIN));
  assert.ok(wrapped.includes(CODE_END));
  assert.ok(wrapped.includes('Manifold.cube([20, 20, 20], true)'));
  const chips = parseFeatureMarkers(wrapped);
  assert.equal(chips.length, 1);
  assert.equal(chips[0].kind, 'code');
  assert.equal(featureStripChips(wrapped)[0].kind, 'code');
  assert.equal(featureStripChips(wrapped)[0].virtual, undefined);
});

test('wrapRawScript keeps a surf-id header above the Code block', () => {
  const id = mintSurfId({ now: new Date('2026-10-17T00:00:00Z'), rand: 'abcd' });
  const stamped = withSurfId(RAW, id);
  const wrapped = wrapRawScript(stamped);
  assert.ok(wrapped.startsWith(`// @surf-id ${id}`));
  assert.ok(wrapped.indexOf('// @surf-id') < wrapped.indexOf(CODE_BEGIN));
  assert.equal(parseFeatureMarkers(wrapped).length, 1);
  assert.equal(wrapRawScript(wrapped), wrapped);
  const uuid = '550e8400-e29b-41d4-a716-446655440000';
  const uuidHeadered = `// @surf-id ${uuid}\n${RAW}`;
  const uuidWrapped = wrapRawScript(uuidHeadered);
  assert.ok(uuidWrapped.startsWith(`// @surf-id ${uuid}\n`));
  assert.ok(uuidWrapped.indexOf(CODE_BEGIN) > uuidWrapped.indexOf('// @surf-id'));
  assert.equal(uuidWrapped.slice(uuidWrapped.indexOf(CODE_BEGIN)).includes('@surf-id'), false);
  assert.equal(wrapRawScript(uuidWrapped), uuidWrapped);
});

test('already-marked and partially marked scripts are left alone', () => {
  assert.equal(wrapRawScript(STARTER), STARTER);
  const partial = `${STARTER.split('\n')[0]}\nlet part = Manifold.cube([8, 8, 8], true);\nreturn part;\n`;
  assert.equal(hasAnyFeatureMarker(partial), true);
  assert.equal(wrapRawScript(partial), partial);
  assert.equal(unmarkedCodeChip(partial), null);
  const custom = '// --- pin begin id=pin ---\nreturn Manifold.cylinder(16, 5, 5, 30, true);\n// --- pin end ---\n';
  assert.equal(wrapRawScript(custom), custom);
  assert.equal(wrapRawScript(''), '');
  assert.equal(wrapRawScript('   \n'), '   \n');
});

test('opening unmarked repo or browser source shows a Code chip with zero unsaved parts and no write', async () => {
  const localId = 'local:pin';
  const localScripts = { [localId]: RAW };
  const localSnap = snapshotPartScripts(localScripts);
  const localEdited = editedPartIdsSinceSnapshot(localSnap, localScripts, { partIds: [localId] });
  const localDirty = buildDirtyState({ editedSinceLoad: localEdited });
  const localChips = featureStripChips(localScripts[localId]);
  assert.equal(localChips.length, 1);
  assert.equal(localChips[0].kind, 'code');
  assert.equal(localChips[0].virtual, true);
  assert.equal(buildFeatureTree({ script: RAW }).features[0].kind, 'code');
  assert.equal(localDirty.unsaved, false);
  assert.deepEqual(localDirty.editedSinceLoad, []);
  assert.equal(localScripts[localId], RAW);
  assert.equal(scriptNeedsCodeWrap(RAW), true);

  const { gh, vault, name, parts, headSha } = await seedUnmarkedVault();
  const opened = await openVaultAssembly(gh, vault.repo, name, {
    branch: 'main',
    headSha,
  });
  const part = opened.doc.parts[0];
  const id = part.id;
  const path = partRepoPath(part) || parts[0].path;
  assert.equal(opened.scripts[id], RAW);
  const chips = featureStripChips(opened.scripts[id]);
  assert.equal(chips.length, 1);
  assert.equal(chips[0].kind, 'code');
  assert.equal(chips[0].virtual, true);
  const snap = snapshotPartScripts(opened.scripts);
  const edited = editedPartIdsSinceSnapshot(snap, opened.scripts, { partIds: [id] });
  const gitIds = [...dirtyPartIds(opened.doc, opened.scripts, opened.baseline)];
  const dirty = buildDirtyState({
    editedSinceLoad: edited,
    partIds: gitIds,
    workspaceDirty: isWorkspaceDirty(opened.doc, opened.scripts, opened.baseline),
  });
  assert.equal(dirty.unsaved, false);
  assert.deepEqual(dirty.editedSinceLoad, []);
  assert.equal(dirty.workspaceDirty, false);
  assert.deepEqual(dirty.partIds, []);
  const noop = await assembleCommitFiles(gh, vault.repo, {
    doc: opened.doc,
    scripts: opened.scripts,
    baseline: opened.baseline,
    message: 'noop',
  });
  assert.equal(noop.status, 'clean');
  const onDisk = await gh.readFile(vault.repo, path, 'main');
  assert.equal(onDisk.content, RAW);
  const head = await gh.getBranch(vault.repo, 'main');
  assert.equal(head.sha, headSha);
});

test('wrapping unmarked source does not change volume or mesh bytes', { timeout: 60_000 }, async () => {
  const before = await runScript(RAW);
  const wrapped = wrapRawScript(RAW);
  const after = await runScript(wrapped);
  assert.equal(after.status, 'NoError');
  const a = meshSnapshot(before);
  const b = meshSnapshot(after);
  assert.equal(b.volume, a.volume);
  assert.equal(b.tris, a.tris);
  assert.deepEqual(b.bbox, a.bbox);
  assert.deepEqual(b.vp, a.vp);
  assert.deepEqual(b.tv, a.tv);
  before.manifold?.delete?.();
  after.manifold?.delete?.();
});

test('Save of an opened unmarked part writes the wrapped script', async () => {
  const { gh, vault, name, headSha } = await seedUnmarkedVault('wrap-save');
  const opened = await openVaultAssembly(gh, vault.repo, name, {
    branch: 'main',
    headSha,
  });
  const part = opened.doc.parts[0];
  const id = part.id;
  const path = partRepoPath(part);
  assert.equal(opened.scripts[id], RAW);
  const edited = `${RAW}// edit\n`;
  const scripts = { ...opened.scripts, [id]: edited };
  const wrapIds = dirtyPartIds(opened.doc, scripts, opened.baseline);
  assert.deepEqual([...wrapIds], [id]);
  const wrappedScripts = wrapUnmarkedPartScripts(scripts, wrapIds);
  assert.notEqual(wrappedScripts[id], edited);
  assert.ok(wrappedScripts[id].includes(CODE_BEGIN));
  const ready = await assembleCommitFiles(gh, vault.repo, {
    doc: opened.doc,
    scripts: wrappedScripts,
    baseline: opened.baseline,
    message: 'wrap markers',
  });
  assert.equal(ready.status, 'ready');
  const file = ready.files.find((row) => row.path === path);
  assert.ok(file);
  assert.ok(file.content.includes(CODE_BEGIN));
  assert.ok(file.content.includes('Manifold.cube([20, 20, 20], true)'));
  const committed = await gh.commitFiles(vault.repo, {
    branch: 'main',
    message: ready.message,
    files: ready.files,
    baseSha: headSha,
  });
  const saved = await gh.readFile(vault.repo, path, 'main');
  assert.ok(saved.content.includes(CODE_BEGIN));
  assert.ok(saved.content.includes(CODE_END));
  assert.ok(saved.content.includes('Manifold.cube([20, 20, 20], true)'));
  const head = await gh.getBranch(vault.repo, 'main');
  assert.equal(head.sha, committed.sha);
  assert.notEqual(head.sha, headSha);
});

test('Save of edited part A does not wrap or rewrite untouched unmarked part B', async () => {
  const { gh, vault, name, headSha } = await seedUnmarkedVault('wrap-scope', {
    name: 'WrapScope',
    rows: [
      { id: '5f0c3c1e-0000-4000-8000-0000000000aa', name: 'Edited' },
      { id: '5f0c3c1e-0000-4000-8000-0000000000bb', name: 'Untouched' },
    ],
  });
  const opened = await openVaultAssembly(gh, vault.repo, name, {
    branch: 'main',
    headSha,
  });
  const partA = opened.doc.parts.find((row) => row.name === 'Edited');
  const partB = opened.doc.parts.find((row) => row.name === 'Untouched');
  const idA = partA.id;
  const idB = partB.id;
  const pathA = partRepoPath(partA);
  const pathB = partRepoPath(partB);
  assert.equal(opened.scripts[idA], RAW);
  assert.equal(opened.scripts[idB], RAW);
  const editedA = `${RAW}// save A\n`;
  const live = { ...opened.scripts, [idA]: editedA };
  assert.equal(wrapUnmarkedPartScripts(live)[idA], editedA);
  const wrapIds = dirtyPartIds(opened.doc, live, opened.baseline);
  assert.deepEqual([...wrapIds], [idA]);
  const wrapped = wrapUnmarkedPartScripts(live, wrapIds);
  assert.ok(wrapped[idA].includes(CODE_BEGIN));
  assert.equal(wrapped[idB], RAW);
  const ready = await assembleCommitFiles(gh, vault.repo, {
    doc: opened.doc,
    scripts: wrapped,
    baseline: opened.baseline,
    message: 'save A',
  });
  assert.equal(ready.status, 'ready');
  const paths = ready.files.map((row) => row.path);
  assert.ok(paths.includes(pathA));
  assert.equal(paths.includes(pathB), false);
  const fileA = ready.files.find((row) => row.path === pathA);
  assert.ok(fileA.content.includes(CODE_BEGIN));
  const committed = await gh.commitFiles(vault.repo, {
    branch: 'main',
    message: ready.message,
    files: ready.files,
    baseSha: headSha,
  });
  const savedA = await gh.readFile(vault.repo, pathA, 'main');
  const savedB = await gh.readFile(vault.repo, pathB, 'main');
  assert.ok(savedA.content.includes(CODE_BEGIN));
  assert.equal(savedB.content, RAW);
  const head = await gh.getBranch(vault.repo, 'main');
  assert.equal(head.sha, committed.sha);
});

test('wrap-on-Save adopts wrapped text as undo head and leaves dirty clean', () => {
  const wrapped = wrapRawScript(RAW);
  assert.notEqual(wrapped, RAW);
  const unwrappedHistory = historyForPart({}, 'p', RAW);
  const liveAfterSave = wrapped;
  assert.equal(liveAfterSave !== unwrappedHistory.commits[unwrappedHistory.head].code, true);

  const adopted = adoptSavedScript(unwrappedHistory, wrapped);
  assert.equal(adopted.commits[adopted.head].code, wrapped);
  const undoStackDirty = liveAfterSave !== adopted.commits[adopted.head].code;
  assert.equal(undoStackDirty, false);

  const snapStale = snapshotPartScripts({ p: RAW });
  assert.deepEqual(
    editedPartIdsSinceSnapshot(snapStale, { p: wrapped }, { liveId: 'p', liveScript: wrapped }),
    ['p'],
  );
  const snapSaved = snapshotPartScripts({ p: wrapped }, { liveId: 'p', liveScript: wrapped });
  assert.deepEqual(
    editedPartIdsSinceSnapshot(snapSaved, { p: wrapped }, { liveId: 'p', liveScript: wrapped }),
    [],
  );

  const dirty = buildDirtyState({
    editedSinceLoad: [],
    undoStackDirty,
    workspaceDirty: false,
  });
  assert.equal(dirty.unsaved, false);
  assert.equal(dirty.workspaceDirty, false);
  assert.equal(dirty.undoStackDirty, undefined);

  const markedHistory = historyForPart({}, 'p', wrapped);
  const markedAdopt = adoptSavedScript(markedHistory, wrapped);
  assert.equal(markedAdopt.head, markedHistory.head);
  assert.equal(markedAdopt.commits[markedAdopt.head].code, wrapped);
});

test('App wraps on set/paste/save and never on open', () => {
  const finish = APP.slice(
    APP.indexOf('const finishOpenedPart ='),
    APP.indexOf('finishOpenedPartRef.current = finishOpenedPart'),
  );
  assert.doesNotMatch(finish, /wrapRawScript|wrapUnmarkedPartScripts/);
  const openPart = APP.slice(
    APP.indexOf('const handleOpenVaultPart'),
    APP.indexOf('const handleCopyPartToAssembly'),
  );
  assert.doesNotMatch(openPart, /wrapRawScript|wrapUnmarkedPartScripts/);
  const setEditor = APP.slice(APP.indexOf('setEditor(src)'), APP.indexOf('readHistory()'));
  assert.match(setEditor, /wrapRawScript\(/);
  const save = APP.slice(APP.indexOf('const handleGitCommit'), APP.indexOf('const absorbOverwriteFiles'));
  assert.match(save, /wrapUnmarkedPartScripts\(scriptsBeforeWrap, wrapIds\)/);
  assert.match(save, /dirtyPartIds\(placed\.doc, scriptsBeforeWrap, baseline/);
  const apply = APP.slice(
    APP.indexOf('const applyCommittedWorkspace'),
    APP.indexOf('const handleToggleSource'),
  );
  assert.match(apply, /adoptSavedScript/);
  assert.match(finish, /captureAgentScriptSnapshot\(\)/);
  assert.match(APP, /async agentGitSave\(\{ message \}\) \{[\s\S]*?return handleGitCommit\(draft\);/);
  assert.doesNotMatch(APP, /wrapPending/);
  assert.equal([...APP.matchAll(/wrapRawScript\(/g)].length, 2);
  assert.equal([...APP.matchAll(/wrapUnmarkedPartScripts\(/g)].length, 1);
  assert.doesNotMatch(GIT_COMMIT, /wrapRawScript|wrapUnmarkedPartScripts/);
  assert.match(BRIDGE, /wrapRawScript\(normalized\)/);
  assert.match(BRIDGE, /function normalizeAgentScript/);
  assert.match(EDITOR, /onDidPaste/);
  assert.match(EDITOR, /wrapRawScript\(/);
  assert.match(
    EDITOR,
    /onDidPaste\(\(\) => \{[\s\S]*?programmaticValueRef\.current = next[\s\S]*?onCodeChange\?\.\(next, 'Paste'\)/,
  );
});

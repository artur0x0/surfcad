import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { newPartStarterScript } from './helperPaletteSnippets.js';
import { parseFeatureMarkers } from './featureMarkers.js';
import { featureStripChips } from './sheetMetal/sheetRibbon.js';
import { buildDirtyState } from '../agent/state/dirty.js';
import { editedPartIdsSinceSnapshot, snapshotPartScripts } from '../agent/state/editedSinceLoad.js';
import { buildFeatureTree } from '../agent/state/featureTree.js';
import { runScript } from '../lib/surfcad/index.js';
import { createMockGithubAdapter } from './git/mockGithubAdapter.js';
import { findOrCreateVault } from './git/vault.js';
import { dirtyPartIds, isWorkspaceDirty, openVaultAssembly } from './git/gitWorkspace.js';
import { assembleCommitFiles } from './git/gitCommit.js';
import { fileWrite } from './git/githubAdapterInterface.js';
import { stringifySurfJson } from './git/surfJson.js';
import { assemblyFilePath, assemblyPartPath } from './git/vaultLayout.js';
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

async function seedUnmarkedVault(login = 'wrap-open') {
  const gh = createMockGithubAdapter({ login });
  const vault = await findOrCreateVault(gh);
  const name = 'WrapOpen';
  const part = assemblyPartPath(name, 'Bracket');
  const doc = {
    source: 'git',
    name,
    activeId: part,
    parts: [{ id: part, name: 'Bracket', visible: true, order: 0 }],
  };
  const seed = await gh.commitFiles(vault.repo, {
    branch: 'main',
    message: 'seed unmarked part',
    baseSha: vault.headSha,
    files: [
      fileWrite(assemblyFilePath(name), stringifySurfJson(doc)),
      fileWrite(part, RAW),
    ],
  });
  return { gh, vault, name, part, doc, headSha: seed.sha };
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

  const { gh, vault, name, part, headSha } = await seedUnmarkedVault();
  const opened = await openVaultAssembly(gh, vault.repo, name, {
    branch: 'main',
    headSha,
  });
  assert.equal(opened.scripts[part], RAW);
  const chips = featureStripChips(opened.scripts[part]);
  assert.equal(chips.length, 1);
  assert.equal(chips[0].kind, 'code');
  assert.equal(chips[0].virtual, true);
  const snap = snapshotPartScripts(opened.scripts);
  const edited = editedPartIdsSinceSnapshot(snap, opened.scripts, { partIds: [part] });
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
  const onDisk = await gh.readFile(vault.repo, part, 'main');
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
  const { gh, vault, name, part, headSha } = await seedUnmarkedVault('wrap-save');
  const opened = await openVaultAssembly(gh, vault.repo, name, {
    branch: 'main',
    headSha,
  });
  assert.equal(opened.scripts[part], RAW);
  const wrappedScripts = wrapUnmarkedPartScripts(opened.scripts);
  assert.notEqual(wrappedScripts[part], RAW);
  assert.ok(wrappedScripts[part].includes(CODE_BEGIN));
  const ready = await assembleCommitFiles(gh, vault.repo, {
    doc: opened.doc,
    scripts: wrappedScripts,
    baseline: opened.baseline,
    message: 'wrap markers',
  });
  assert.equal(ready.status, 'ready');
  const file = ready.files.find((row) => row.path === part);
  assert.ok(file);
  assert.ok(file.content.includes(CODE_BEGIN));
  assert.ok(file.content.includes('Manifold.cube([20, 20, 20], true)'));
  const committed = await gh.commitFiles(vault.repo, {
    branch: 'main',
    message: ready.message,
    files: ready.files,
    baseSha: headSha,
  });
  const saved = await gh.readFile(vault.repo, part, 'main');
  assert.ok(saved.content.includes(CODE_BEGIN));
  assert.ok(saved.content.includes(CODE_END));
  assert.ok(saved.content.includes('Manifold.cube([20, 20, 20], true)'));
  const head = await gh.getBranch(vault.repo, 'main');
  assert.equal(head.sha, committed.sha);
  assert.notEqual(head.sha, headSha);
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
  assert.match(save, /wrapUnmarkedPartScripts\(/);
  assert.match(APP, /async agentGitSave\(\{ message \}\) \{[\s\S]*?return handleGitCommit\(draft\);/);
  assert.equal([...APP.matchAll(/wrapRawScript\(/g)].length, 2);
  assert.equal([...APP.matchAll(/wrapUnmarkedPartScripts\(/g)].length, 1);
  assert.doesNotMatch(GIT_COMMIT, /wrapRawScript|wrapUnmarkedPartScripts/);
  assert.match(BRIDGE, /wrapRawScript\(/);
  assert.match(EDITOR, /onDidPaste/);
  assert.match(EDITOR, /wrapRawScript\(/);
});

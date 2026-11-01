/**
 * After a clean save + reload, the active part must not look dirty just
 * because Monaco skipped onExecute, and switching parts must not badge the
 * assembly. Mock adapter only.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createMockGithubAdapter, MOCK_GITHUB_STORE_KEY, peekMockVaultName } from '../src/utils/git/mockGithubAdapter.js';
import { findOrCreateVault } from '../src/utils/git/vault.js';
import { assemblyIdPath } from '../src/utils/git/idPaths.js';
import { mintSurfId, showAddToRepo, withSurfId } from '../src/utils/git/surfId.js';
import { fileWrite } from '../src/utils/git/githubAdapterInterface.js';
import {
  captureBaseline,
  dirtyPartIds,
  gitDirtyLiveScript,
  isAssemblyDirty,
  isWorkspaceDirty,
} from '../src/utils/git/gitWorkspace.js';

const ASM = 'ReloadBox';
const ASM_ID = mintSurfId({ now: new Date('2026-10-17T12:00:02.000Z'), rand: 'eeee' });
const BODY_ID = mintSurfId({ now: new Date('2026-10-17T12:00:00.000Z'), rand: 'cccc' });
const LID_ID = mintSurfId({ now: new Date('2026-10-17T12:00:01.000Z'), rand: 'dddd' });
const BODY_TEXT = withSurfId('return Manifold.cube([20, 20, 10], true);\n', BODY_ID);
const LID_TEXT = withSurfId('return Manifold.cube([20, 20, 2], true);\n', LID_ID);

function doc(activeId = BODY_ID) {
  return {
    format: 'surfcad.assembly',
    version: 2,
    id: ASM_ID,
    name: ASM,
    activeId,
    parts: [
      { id: BODY_ID, name: 'Body', visible: true, order: 0 },
      { id: LID_ID, name: 'Lid', visible: true, order: 1 },
    ],
  };
}

function seed() {
  const scripts = { [BODY_ID]: BODY_TEXT, [LID_ID]: LID_TEXT };
  const live = { ...doc(), source: 'git' };
  const baseline = captureBaseline({
    assemblyPath: assemblyIdPath(ASM_ID),
    assemblyName: ASM,
    doc: live,
    scripts,
    branch: 'main',
    headSha: 'abc',
  });
  return { opened: { doc: live, scripts, baseline, assemblyPath: baseline.assemblyPath } };
}

test('showAddToRepo uses the repo path, not the stable part id', () => {
  const path = 'assemblies/ReloadBox/Body.js';
  assert.equal(showAddToRepo({ id: BODY_ID, path }), false);
  assert.equal(showAddToRepo({ id: BODY_ID, path, isSynced: true }), false);
  assert.equal(showAddToRepo({ id: BODY_ID, path, isSynced: false }), true);
  assert.equal(showAddToRepo({ id: BODY_ID }), true);
  assert.equal(showAddToRepo({ id: path }), false);
  assert.equal(showAddToRepo({ id: path, path }), false);
});

test('gitDirtyLiveScript ignores the unseeded empty editor buffer', () => {
  assert.equal(gitDirtyLiveScript({
    source: 'git',
    activeId: BODY_ID,
    highlightId: BODY_ID,
    editorLive: false,
    script: '',
  }), null);
  assert.equal(gitDirtyLiveScript({
    source: 'git',
    activeId: BODY_ID,
    highlightId: BODY_ID,
    editorLive: true,
    script: '',
  }), '');
  assert.equal(gitDirtyLiveScript({
    source: 'git',
    activeId: BODY_ID,
    highlightId: BODY_ID,
    editorLive: true,
    script: BODY_TEXT,
  }), BODY_TEXT);
  assert.equal(gitDirtyLiveScript({
    source: 'git',
    activeId: BODY_ID,
    highlightId: LID_ID,
    editorLive: true,
    script: BODY_TEXT,
  }), null);
});

test('reload of a clean two-part assembly is not dirty, including an empty live script', async () => {
  const { opened } = await seed();
  const { doc: liveDoc, scripts, baseline } = opened;
  assert.equal(isWorkspaceDirty(liveDoc, scripts, baseline), false);
  assert.equal(dirtyPartIds(liveDoc, scripts, baseline).size, 0);

  const unseeded = gitDirtyLiveScript({
    source: 'git',
    activeId: liveDoc.activeId,
    highlightId: liveDoc.activeId,
    editorLive: false,
    script: '',
  });
  assert.equal(unseeded, null);
  assert.equal(
    dirtyPartIds(liveDoc, scripts, baseline, { liveId: liveDoc.activeId, liveScript: unseeded }).size,
    0,
  );

  const falseLive = dirtyPartIds(liveDoc, scripts, baseline, {
    liveId: liveDoc.activeId,
    liveScript: '',
  });
  assert.equal(falseLive.has(liveDoc.activeId), true, 'empty liveScript is what painted the false badge');
});

test('switching the open part does not dirty the assembly; a real edit does', async () => {
  const { opened } = await seed();
  const { doc: liveDoc, scripts, baseline } = opened;
  const switched = { ...liveDoc, activeId: LID_ID };
  assert.equal(isAssemblyDirty(switched, baseline), false);
  assert.equal(isWorkspaceDirty(switched, scripts, baseline), false);

  const renamed = {
    ...liveDoc,
    parts: liveDoc.parts.map((part) => (
      part.id === BODY_ID ? { ...part, name: 'Body renamed' } : part
    )),
  };
  assert.equal(isAssemblyDirty(renamed, baseline), true);

  const edited = { ...scripts, [BODY_ID]: `${BODY_TEXT}// typed\n` };
  assert.equal(isWorkspaceDirty(liveDoc, edited, baseline), true);
  assert.deepEqual([...dirtyPartIds(liveDoc, edited, baseline)], [BODY_ID]);

  const liveEdit = dirtyPartIds(liveDoc, scripts, baseline, {
    liveId: BODY_ID,
    liveScript: `${BODY_TEXT}// typing\n`,
  });
  assert.deepEqual([...liveEdit], [BODY_ID]);
});

test('captureBaseline of the switched doc still differs in .surf.json activeId', async () => {
  const { opened } = await seed();
  const switched = { ...opened.doc, activeId: LID_ID };
  const next = captureBaseline({
    assemblyPath: opened.assemblyPath,
    assemblyName: ASM,
    doc: switched,
    scripts: opened.scripts,
    branch: 'main',
    headSha: opened.baseline.headSha,
  });
  assert.notEqual(next.assemblyText, opened.baseline.assemblyText);
  assert.equal(isAssemblyDirty(switched, opened.baseline), false);
});

test('mock adapter restores the vault from sessionStorage across a new instance', async () => {
  const mem = new Map();
  const previous = globalThis.sessionStorage;
  globalThis.sessionStorage = {
    getItem: (key) => (mem.has(key) ? mem.get(key) : null),
    setItem: (key, value) => { mem.set(key, String(value)); },
    removeItem: (key) => { mem.delete(key); },
  };
  try {
    const first = createMockGithubAdapter({ login: 'persist-user', persist: true });
    const vault = await findOrCreateVault(first, { name: 'playtest-git-h12-vault' });
    await first.commitFiles(vault.repo, {
      branch: 'main',
      message: 'keep',
      baseSha: vault.headSha,
      files: [fileWrite(assemblyIdPath(ASM_ID), `${JSON.stringify(doc(), null, 2)}\n`)],
    });
    assert.equal(peekMockVaultName(), 'playtest-git-h12-vault');
    assert.ok(mem.get(MOCK_GITHUB_STORE_KEY));

    const second = createMockGithubAdapter({ login: 'persist-user', persist: true });
    const again = await second.getRepo(vault.repo);
    assert.equal(again?.name, 'playtest-git-h12-vault');
    const file = await second.readFile(vault.repo, assemblyIdPath(ASM_ID), 'main');
    assert.ok(file?.content.includes(ASM));
  } finally {
    if (previous === undefined) delete globalThis.sessionStorage;
    else globalThis.sessionStorage = previous;
  }
});

test('App gates live dirty on editorLive and seeds currentScript on editor seed', () => {
  const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
  assert.match(app, /gitDirtyLiveScript\(/);
  assert.match(app, /editorLive:\s*editorLiveRef\.current/);
  assert.match(app, /if \(typeof script === 'string'\) setCurrentScript\(script\)/);
  assert.match(app, /if \(typeof nextScript === 'string'\) setCurrentScript\(nextScript\)/);
  assert.match(app, /bootResume !== 'reauth'/);
  assert.match(app, /peekMockVaultName/);
  assert.match(app, /createMockGithubAdapter\(\{ login: 'local-user', persist: true \}\)/);
  assert.match(app, /rememberAssembly\(nextDoc, \{ force: true \}\)/);
  assert.match(app, /captureAgentScriptSnapshot\(\{ useEditor: false \}\)/);
  assert.match(app, /liveEditorOverride/);
  assert.match(app, /adoptSavedScript/);
});

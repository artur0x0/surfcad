import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { newPartStarterScript } from './helperPaletteSnippets.js';
import { parseFeatureMarkers } from './featureMarkers.js';
import { featureStripChips } from './sheetMetal/sheetRibbon.js';
import { editedPartIdsSinceSnapshot, snapshotPartScripts } from '../agent/state/editedSinceLoad.js';
import { runScript } from '../lib/surfcad/index.js';
import { createMockGithubAdapter } from './git/mockGithubAdapter.js';
import { findOrCreateVault } from './git/vault.js';
import { captureBaseline } from './git/gitWorkspace.js';
import { assembleCommitFiles } from './git/gitCommit.js';
import { assemblyFilePath, assemblyPartPath } from './git/vaultLayout.js';
import { mintSurfId, withSurfId } from './git/surfId.js';
import {
  CODE_BEGIN,
  CODE_END,
  hasAnyFeatureMarker,
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

test('opened unmarked source shows a virtual Code chip and is not dirty', () => {
  const chip = unmarkedCodeChip(RAW);
  assert.equal(chip.kind, 'code');
  assert.equal(chip.virtual, true);
  assert.equal(featureStripChips(RAW)[0].kind, 'code');
  assert.equal(featureStripChips(RAW)[0].virtual, true);
  const snap = snapshotPartScripts({ pin: RAW });
  assert.deepEqual(editedPartIdsSinceSnapshot(snap, { pin: RAW }, { partIds: ['pin'] }), []);
  assert.notEqual(wrapRawScript(RAW), RAW);
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

test('git save of an unmarked part writes the wrapped script; matching unmarked is clean', async () => {
  const gh = createMockGithubAdapter({ login: 'wrap' });
  const vault = await findOrCreateVault(gh);
  const name = 'WrapSave';
  const part = assemblyPartPath(name, 'Bracket');
  const doc = {
    source: 'git',
    name,
    activeId: part,
    parts: [{ id: part, name: 'Bracket', visible: true, order: 0 }],
  };
  const scripts = { [part]: RAW };
  const baseline = captureBaseline({
    assemblyPath: assemblyFilePath(name),
    assemblyName: name,
    doc,
    scripts,
    branch: 'main',
    headSha: vault.headSha || 'head',
  });
  const clean = await assembleCommitFiles(gh, vault.repo, {
    doc,
    scripts,
    baseline,
    message: 'noop',
  });
  assert.equal(clean.status, 'clean');

  const wrappedScripts = wrapUnmarkedPartScripts(scripts);
  const ready = await assembleCommitFiles(gh, vault.repo, {
    doc,
    scripts: wrappedScripts,
    baseline,
    message: 'wrap markers',
  });
  assert.equal(ready.status, 'ready');
  const file = ready.files.find((row) => row.path === part);
  assert.ok(file);
  assert.ok(file.content.includes(CODE_BEGIN));
  assert.ok(file.content.includes('Manifold.cube([20, 20, 20], true)'));
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
  assert.match(BRIDGE, /wrapRawScript\(/);
  assert.match(EDITOR, /onDidPaste/);
  assert.match(EDITOR, /wrapRawScript\(/);
});

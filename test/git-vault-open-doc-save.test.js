/**
 * App vault-open / reseed must not adopt a persist whose IDB doc save failed.
 * Slice the App path and run the same persist-then-remember sequence.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { serializeAssembly } from '../src/utils/assembly.js';
import {
  captureBaseline,
  captureBaselineFromTip,
  remapTipDocThroughPairs,
} from '../src/utils/git/gitBaseline.js';
import { isAssemblyDirty, isWorkspaceDirty } from '../src/utils/git/gitWorkspace.js';
import { mintSurfId } from '../src/utils/git/surfId.js';
import {
  assemblyRekeyKey,
  collapseWorkingCopyIds,
  persistCollapsedWorkingCopy,
  WORKING_COPY_DOC_UNSAVED,
} from '../src/utils/git/wcIdentity.js';

const APP = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const SURF = mintSurfId({ now: new Date('2026-10-18T00:00:00.000Z'), rand: 'a3f9' });
const PREV = mintSurfId({ now: new Date('2026-10-18T00:00:01.000Z'), rand: 'bbbb' });
const PATH = 'assemblies/A/Pin.js';
const LID = 'assemblies/A/Lid.js';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function sliceBetween(src, startNeedle, endNeedle) {
  const start = src.indexOf(startNeedle);
  const end = src.indexOf(endNeedle, start + startNeedle.length);
  assert.ok(start >= 0 && end > start, `missing ${startNeedle}`);
  return src.slice(start, end);
}

function previousWorkingCopy() {
  const doc = serializeAssembly({
    id: PREV,
    source: 'local',
    name: 'Prev',
    activeId: SURF,
    parts: [{ id: SURF, name: 'Kept', visible: true, order: 0 }],
  });
  const scripts = { [SURF]: 'return prev;\n' };
  return { doc, scripts };
}

function openedTip() {
  const doc = {
    source: 'git',
    name: 'A',
    activeId: PATH,
    parts: [{ id: PATH, path: PATH, name: 'Pin', visible: true, order: 0 }],
  };
  const scripts = { [PATH]: 'return tip;\n' };
  return { doc, scripts };
}

/**
 * App adoptVaultOpening persist tail: persistCollapsedWorkingCopy, then
 * either abort on docSaved === false or rememberAssembly(openedDoc).
 */
async function appAdoptVaultOpeningPersist({ saveDocFails }) {
  const previous = previousWorkingCopy();
  const opened = openedTip();
  const idb = {
    doc: clone(previous.doc),
    map: new Map(Object.entries(previous.scripts)),
    remembered: [],
  };
  const memory = {
    doc: clone(previous.doc),
    scripts: { ...previous.scripts },
  };
  const rememberScripts = (scripts) => {
    memory.scripts = { ...scripts };
  };
  const rememberAssembly = (doc, opts = {}) => {
    const clean = serializeAssembly(doc);
    memory.doc = clean;
    idb.remembered.push({ persist: opts.persist !== false, id: clean.parts[0]?.id });
    if (opts.persist !== false) idb.doc = clone(clean);
    return clean;
  };
  const persistSource = { doc: opened.doc, scripts: opened.scripts };
  const collapsed = collapseWorkingCopyIds(opened.doc, opened.scripts);
  let openedDoc = opened.doc;
  let openedScripts = opened.scripts;
  const persisted = await persistCollapsedWorkingCopy({
    collapsed: {
      doc: collapsed.doc,
      scripts: collapsed.scripts,
      pairs: collapsed.pairs,
    },
    sourceDoc: persistSource.doc,
    sourceScripts: persistSource.scripts,
    heldScripts: {},
    save: async (id, script) => { idb.map.set(id, script); return true; },
    load: async (id) => idb.map.get(id),
    remove: async (id) => { idb.map.delete(id); },
    saveDoc: async (doc) => {
      if (saveDocFails) return null;
      idb.doc = clone(doc);
      return doc;
    },
    assemblyKey: assemblyRekeyKey(persistSource.doc),
    apply: ({ doc: nextDoc, scripts: nextScripts }) => {
      openedDoc = nextDoc;
      openedScripts = nextScripts;
      rememberScripts(nextScripts);
      rememberAssembly(nextDoc, { persist: false });
    },
  });
  if (persisted.docSaved === false) {
    return { aborted: true, idb, memory, persisted, previous };
  }
  openedDoc = persisted.doc;
  openedScripts = persisted.scripts;
  rememberScripts(openedScripts);
  rememberAssembly(openedDoc);
  return { aborted: false, idb, memory, persisted, previous };
}

test('App adoptVaultOpening aborts before rememberAssembly when docSaved is false', () => {
  const adopt = sliceBetween(APP, 'const adoptVaultOpening', 'const handleOpenVaultAssembly');
  const persistAt = adopt.indexOf('const persisted = await persistCollapsedWorkingCopy');
  const abortAt = adopt.indexOf('if (persisted.docSaved === false)');
  const throwAt = adopt.indexOf('throw new Error(WORKING_COPY_DOC_UNSAVED)');
  const rememberAt = adopt.indexOf('saved = rememberAssembly(openedDoc)');
  assert.ok(persistAt >= 0 && abortAt > persistAt, 'docSaved check must follow persist');
  assert.ok(throwAt > abortAt && throwAt < rememberAt);
  assert.ok(rememberAt > throwAt, 'rememberAssembly(openedDoc) must follow the abort');
  assert.match(adopt, /throw new Error\(WORKING_COPY_DOC_UNSAVED\)/);
  assert.match(WORKING_COPY_DOC_UNSAVED, /previous working copy was kept/);
  const abortBlock = adopt.slice(abortAt, throwAt);
  assert.equal(/rememberAssembly\(/.test(abortBlock), false);
  assert.equal(/rememberScripts\(/.test(abortBlock), false);
});

test('App vault open keeps the previous working copy when saveDoc fails', async () => {
  const { aborted, idb, memory, previous } = await appAdoptVaultOpeningPersist({ saveDocFails: true });
  assert.equal(aborted, true);
  assert.equal(memory.doc.parts[0].id, SURF);
  assert.equal(memory.doc.name, 'Prev');
  assert.equal(idb.doc.parts[0].id, SURF);
  assert.equal(idb.doc.name, 'Prev');
  assert.equal(idb.remembered.length, 0);
  assert.equal(memory.scripts[SURF], previous.scripts[SURF]);
  assert.equal(idb.doc.id, previous.doc.id);
});

test('App vault open rememberAssembly runs only after a saved doc', async () => {
  const { aborted, idb, memory } = await appAdoptVaultOpeningPersist({ saveDocFails: false });
  assert.equal(aborted, false);
  assert.notEqual(memory.doc.parts[0].id, PATH);
  assert.equal(idb.doc.parts[0].id, memory.doc.parts[0].id);
  assert.ok(idb.remembered.some((row) => row.persist === true));
});

test('App reseed skips adoptReseedBaseline when docSaved is false', () => {
  const reseed = sliceBetween(APP, '// After reload, baseline is gone', 'handleFlushLocalAssembly');
  const persistAt = reseed.indexOf('const persisted = await persistCollapsedWorkingCopy');
  const skipAt = reseed.indexOf('if (persisted.docSaved === false) return;');
  const earlyAt = reseed.indexOf('await adoptReseedBaseline()');
  const lateAt = reseed.lastIndexOf('await adoptReseedBaseline()');
  assert.ok(persistAt >= 0 && skipAt > persistAt);
  assert.ok(earlyAt >= 0 && earlyAt < persistAt, 'early tip adopt already ran');
  assert.ok(lateAt > skipAt, 'late adoptReseedBaseline must be after the docSaved skip');
});

test('App reseed adopts tip baseline before persist and recaptures from the remapped tip', () => {
  const reseed = sliceBetween(APP, '// After reload, baseline is gone', 'handleFlushLocalAssembly');
  const persistAt = reseed.indexOf('const persisted = await persistCollapsedWorkingCopy');
  const earlyAt = reseed.indexOf('await adoptReseedBaseline()');
  const switchAt = reseed.indexOf('const switchReseedMemory');
  const liveAt = reseed.indexOf('live: () => {');
  assert.ok(persistAt >= 0 && earlyAt >= 0 && switchAt >= 0 && liveAt >= 0);
  assert.ok(earlyAt < persistAt, 'tip baseline must land before persist so reload is not falsely clean');
  const switchBody = reseed.slice(switchAt, persistAt);
  const recapture = switchBody.slice(switchBody.indexOf('rememberGitBaseline('));
  assert.match(recapture, /rememberGitBaseline\(captureBaselineFromTip\(/);
  assert.match(recapture, /tipDoc:\s*opened\.doc/);
  assert.match(recapture, /tipBaseline:\s*opened\.baseline/);
  assert.match(recapture, /pairs:\s*persistPairs/);
  assert.match(recapture, /failedFrom/);
  assert.equal(
    /nextDoc/.test(recapture),
    false,
    'never stringify nextDoc: that would hide a pre-reload rename/hide/removal',
  );
  assert.equal(
    /scripts:\s*nextScripts/.test(recapture),
    false,
    'folding live nextScripts into the baseline would hide a reload edit',
  );
  assert.ok(liveAt > persistAt, 'persist live() must fold the editor so a reload edit moves to the new key');
  const liveFn = reseed.slice(liveAt, reseed.indexOf('return scripts;', liveAt));
  assert.match(liveFn, /editorLiveRef\.current/);
  assert.match(liveFn, /appModeRef\.current !== 'game'/);
});

test('a reload edit on the old key stays dirty after collapse persist', async () => {
  const tip = 'return tip;\n';
  const edited = `${tip}// dirty-check\n`;
  const sourceDoc = {
    source: 'git',
    name: 'A',
    activeId: PATH,
    parts: [{ id: PATH, path: PATH, name: 'Pin', visible: true, order: 0 }],
  };
  const sourceScripts = { [PATH]: tip };
  const tipBaseline = captureBaseline({
    assemblyPath: 'assemblies/A/.surf.json',
    assemblyName: 'A',
    doc: sourceDoc,
    scripts: sourceScripts,
    branch: 'main',
    headSha: 'tip',
  });
  assert.equal(isWorkspaceDirty(sourceDoc, sourceScripts, null), false);
  assert.equal(isWorkspaceDirty(sourceDoc, { [PATH]: edited }, null), false);
  assert.equal(isWorkspaceDirty(sourceDoc, sourceScripts, tipBaseline), false);
  assert.equal(isWorkspaceDirty(sourceDoc, { [PATH]: edited }, tipBaseline, {
    liveId: PATH,
    liveScript: edited,
  }), true);

  const live = { [PATH]: edited };
  const collapsed = collapseWorkingCopyIds(sourceDoc, sourceScripts);
  const idb = new Map(Object.entries(sourceScripts));
  const persisted = await persistCollapsedWorkingCopy({
    collapsed: { doc: collapsed.doc, scripts: collapsed.scripts, pairs: collapsed.pairs },
    sourceDoc,
    sourceScripts,
    save: async (id, script) => { idb.set(id, script); return true; },
    load: async (id) => idb.get(id),
    remove: async (id) => { idb.delete(id); },
    saveDoc: async (doc) => doc,
    live: () => live,
  });
  assert.equal(persisted.docSaved, true);
  const nextId = persisted.doc.parts[0].id;
  assert.notEqual(nextId, PATH);
  assert.equal(String(persisted.scripts[nextId] || '').includes('dirty-check'), true);

  const recapturedFromTip = captureBaselineFromTip({
    tipDoc: sourceDoc,
    tipBaseline,
    pairs: collapsed.pairs,
    failedFrom: persisted.failedFrom,
  });
  assert.equal(
    isWorkspaceDirty(persisted.doc, persisted.scripts, recapturedFromTip),
    true,
    'tip recapture must keep the live reload edit dirty',
  );

  const recapturedFromLive = captureBaseline({
    assemblyPath: 'assemblies/A/.surf.json',
    assemblyName: 'A',
    doc: persisted.doc,
    scripts: persisted.scripts,
    branch: 'main',
    headSha: 'tip',
  });
  assert.equal(
    isWorkspaceDirty(persisted.doc, persisted.scripts, recapturedFromLive),
    false,
    'capturing the baseline from live/persisted scripts would hide the edit',
  );
});

function twoPartTip() {
  const doc = {
    source: 'git',
    name: 'A',
    activeId: PATH,
    parts: [
      { id: PATH, path: PATH, name: 'Pin', visible: true, order: 0 },
      { id: LID, path: LID, name: 'Lid', visible: true, order: 1 },
    ],
  };
  const scripts = { [PATH]: 'return pin;\n', [LID]: 'return lid;\n' };
  return { doc, scripts };
}

async function persistRekey(wcDoc, wcScripts) {
  const collapsed = collapseWorkingCopyIds(wcDoc, wcScripts);
  const idb = new Map(Object.entries(wcScripts));
  const persisted = await persistCollapsedWorkingCopy({
    collapsed: { doc: collapsed.doc, scripts: collapsed.scripts, pairs: collapsed.pairs },
    sourceDoc: wcDoc,
    sourceScripts: wcScripts,
    save: async (id, script) => { idb.set(id, script); return true; },
    load: async (id) => idb.get(id),
    remove: async (id) => { idb.delete(id); },
    saveDoc: async (doc) => doc,
  });
  return { collapsed, persisted };
}

function tipBaselineFor(doc, scripts) {
  return captureBaseline({
    assemblyPath: 'assemblies/A/.surf.json',
    assemblyName: 'A',
    doc,
    scripts,
    branch: 'main',
    headSha: 'tip',
  });
}

test('remapTipDocThroughPairs maps ids and skips failed rows', () => {
  const { doc } = twoPartTip();
  const pairs = [
    { from: PATH, to: SURF },
    { from: LID, to: PREV },
  ];
  const remapped = remapTipDocThroughPairs(doc, pairs);
  assert.equal(remapped.parts[0].id, SURF);
  assert.equal(remapped.parts[0].name, 'Pin');
  assert.equal(remapped.parts[1].id, PREV);
  const skipped = remapTipDocThroughPairs(doc, pairs, [PATH]);
  assert.equal(skipped.parts[0].id, PATH);
  assert.equal(skipped.parts[1].id, PREV);
});

test('unsaved rename, hide, and removal stay dirty across a re-keying reload; a clean WC stays clean', async () => {
  const tip = twoPartTip();
  const tipBaseline = tipBaselineFor(tip.doc, tip.scripts);

  const renamed = {
    ...tip.doc,
    parts: tip.doc.parts.map((part) => (
      part.id === PATH ? { ...part, name: 'Renamed' } : part
    )),
  };
  const hidden = {
    ...tip.doc,
    parts: tip.doc.parts.map((part) => (
      part.id === LID ? { ...part, visible: false } : part
    )),
  };
  const removed = {
    ...tip.doc,
    activeId: PATH,
    parts: tip.doc.parts.filter((part) => part.id !== LID),
  };
  const removedScripts = { [PATH]: tip.scripts[PATH] };

  for (const [label, wcDoc, wcScripts] of [
    ['rename', renamed, tip.scripts],
    ['hide', hidden, tip.scripts],
    ['removal', removed, removedScripts],
  ]) {
    const { collapsed, persisted } = await persistRekey(wcDoc, wcScripts);
    assert.equal(persisted.docSaved, true);
    const baseline = captureBaselineFromTip({
      tipDoc: tip.doc,
      tipBaseline,
      pairs: collapsed.pairs,
      failedFrom: persisted.failedFrom,
    });
    assert.equal(
      isAssemblyDirty(persisted.doc, baseline),
      true,
      `${label} must stay dirty after recapture from the remapped tip`,
    );
    const fromNextDoc = captureBaseline({
      assemblyPath: 'assemblies/A/.surf.json',
      assemblyName: 'A',
      doc: persisted.doc,
      scripts: tipBaseline.scripts,
      branch: 'main',
      headSha: 'tip',
    });
    assert.equal(
      isAssemblyDirty(persisted.doc, fromNextDoc),
      false,
      `${label} would look clean if recapture stringified nextDoc`,
    );
  }

  const { collapsed, persisted } = await persistRekey(tip.doc, tip.scripts);
  const cleanBaseline = captureBaselineFromTip({
    tipDoc: tip.doc,
    tipBaseline,
    pairs: collapsed.pairs,
    failedFrom: persisted.failedFrom,
  });
  assert.equal(isAssemblyDirty(persisted.doc, cleanBaseline), false);
  assert.equal(isWorkspaceDirty(persisted.doc, persisted.scripts, cleanBaseline), false);
});

test('failed saveDoc leaves the early tip baseline; WC can only look too dirty', async () => {
  const tip = twoPartTip();
  const tipBaseline = tipBaselineFor(tip.doc, tip.scripts);
  let gitBaseline = tipBaseline;
  const collapsed = collapseWorkingCopyIds(tip.doc, tip.scripts);
  let applyCalled = false;
  const persisted = await persistCollapsedWorkingCopy({
    collapsed: { doc: collapsed.doc, scripts: collapsed.scripts, pairs: collapsed.pairs },
    sourceDoc: tip.doc,
    sourceScripts: tip.scripts,
    save: async () => true,
    load: async () => 'return pin;\n',
    remove: async () => {},
    saveDoc: async () => null,
    apply: () => { applyCalled = true; },
  });
  assert.equal(persisted.docSaved, false);
  assert.equal(applyCalled, false);
  // App returns before recapture; the early tip baseline stays.
  assert.equal(gitBaseline, tipBaseline);

  const renamed = {
    ...tip.doc,
    parts: tip.doc.parts.map((part) => (
      part.id === PATH ? { ...part, name: 'Renamed' } : part
    )),
  };
  assert.equal(isAssemblyDirty(renamed, gitBaseline), true);
  assert.equal(isAssemblyDirty(tip.doc, gitBaseline), false);
  assert.equal(
    isAssemblyDirty(collapsed.doc, gitBaseline),
    true,
    'ids that already moved look too dirty against the leftover tip baseline, never falsely clean',
  );
});

test('App reseed keeps mixed ids out of memory when saveDoc fails', async () => {
  const previous = previousWorkingCopy();
  const idb = {
    doc: clone(previous.doc),
    map: new Map(Object.entries(previous.scripts)),
  };
  let baselineAdopted = false;
  const adoptReseedBaseline = async () => { baselineAdopted = true; };
  const opened = openedTip();
  const persistSource = { doc: previous.doc, scripts: previous.scripts };
  const collapsed = collapseWorkingCopyIds(opened.doc, opened.scripts);
  const persisted = await persistCollapsedWorkingCopy({
    collapsed: { doc: collapsed.doc, scripts: collapsed.scripts, pairs: collapsed.pairs },
    sourceDoc: persistSource.doc,
    sourceScripts: persistSource.scripts,
    save: async (id, script) => { idb.map.set(id, script); return true; },
    load: async (id) => idb.map.get(id),
    remove: async (id) => { idb.map.delete(id); },
    saveDoc: async () => null,
    apply: () => { throw new Error('apply must not run'); },
  });
  if (persisted.docSaved === false) {
    // App returns before adoptReseedBaseline.
  } else {
    await adoptReseedBaseline();
  }
  assert.equal(persisted.docSaved, false);
  assert.equal(baselineAdopted, false);
  assert.equal(idb.doc.parts[0].id, SURF);
  assert.equal(previous.doc.parts[0].id, SURF);
});

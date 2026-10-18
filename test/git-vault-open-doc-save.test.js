/**
 * App vault-open / reseed must not adopt a persist whose IDB doc save failed.
 * Slice the App path and run the same persist-then-remember sequence.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { serializeAssembly } from '../src/utils/assembly.js';
import { captureBaseline } from '../src/utils/git/gitBaseline.js';
import { isWorkspaceDirty } from '../src/utils/git/gitWorkspace.js';
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
  const baselineAt = reseed.lastIndexOf('await adoptReseedBaseline()');
  assert.ok(persistAt >= 0 && skipAt > persistAt);
  assert.ok(baselineAt > skipAt, 'adoptReseedBaseline must be after the docSaved skip');
});

test('App reseed adopts tip baseline before persist and recaptures from tip scripts', () => {
  const reseed = sliceBetween(APP, '// After reload, baseline is gone', 'handleFlushLocalAssembly');
  const persistAt = reseed.indexOf('const persisted = await persistCollapsedWorkingCopy');
  const earlyAt = reseed.indexOf('await adoptReseedBaseline()');
  const switchAt = reseed.indexOf('const switchReseedMemory');
  const liveAt = reseed.indexOf('codeEditorRef.current?.getContent?.()');
  assert.ok(persistAt >= 0 && earlyAt >= 0 && switchAt >= 0 && liveAt >= 0);
  assert.ok(earlyAt < persistAt, 'tip baseline must land before persist so reload is not falsely clean');
  const switchBody = reseed.slice(switchAt, persistAt);
  const recapture = switchBody.slice(switchBody.indexOf('rememberGitBaseline(captureBaseline'));
  assert.match(recapture, /rememberGitBaseline\(captureBaseline\(/);
  assert.match(
    recapture,
    /scripts:\s*opened\.baseline\?\.scripts/,
    'recapture must use tip scripts, not live nextScripts',
  );
  assert.equal(
    /scripts:\s*nextScripts/.test(recapture),
    false,
    'folding live nextScripts into the baseline would hide a reload edit',
  );
  assert.ok(liveAt > persistAt, 'persist live() must fold the editor so a reload edit moves to the new key');
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

  const recapturedFromTip = captureBaseline({
    assemblyPath: 'assemblies/A/.surf.json',
    assemblyName: 'A',
    doc: persisted.doc,
    scripts: tipBaseline.scripts,
    branch: 'main',
    headSha: 'tip',
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

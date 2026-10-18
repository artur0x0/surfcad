#!/usr/bin/env node
/**
 * Clear local CAD data — helpers + profile-menu wiring.
 *
 * Clear local cache (the confirm popup) calls the same wipe. This golden
 * keeps the store contract: draft, assembly, model cache, OAuth hand-off,
 * GitHub session token kept, reload after the wipe.
 *
 * Runtime: localStorage-only clearEditorDraft (no IndexedDB / ManifoldWorker).
 * clearAssemblyStore + clearLocalCadData orchestration are source-checked;
 * editor-draft golden already covers IDB clearEditorDraft thoroughly.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

let failed = 0;
let passed = 0;
function ok(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${extra ? ` — ${extra}` : ''}`); }
}

console.log('clear-local-cad — source wiring');
{
  const util = readFileSync(join(root, 'src/utils/clearLocalCadData.js'), 'utf8');
  const assembly = readFileSync(join(root, 'src/utils/assemblyStore.js'), 'utf8');
  const chip = readFileSync(join(root, 'src/components/ProfileChip.jsx'), 'utf8');
  const panel = readFileSync(join(root, 'src/components/ProfilePanel.jsx'), 'utf8');
  const account = readFileSync(join(root, 'src/components/AccountPane.jsx'), 'utf8');
  const dialog = readFileSync(join(root, 'src/components/ClearCacheDialog.jsx'), 'utf8');
  const app = readFileSync(join(root, 'src/App.jsx'), 'utf8');
  const feed = readFileSync(join(root, 'src/components/PartFeed.jsx'), 'utf8');
  const editor = readFileSync(join(root, 'src/components/CodeEditor.jsx'), 'utf8');
  const view = readFileSync(join(root, 'src/components/Viewport.jsx'), 'utf8');
  const arch = readFileSync(join(root, 'docs/architecture.md'), 'utf8');
  const pkg = readFileSync(join(root, 'package.json'), 'utf8');

  ok('util reuses clearEditorDraft + clearAssemblyStore + clearModelCache + clearEditorState',
    /clearEditorDraft/.test(util)
    && /clearAssemblyStore/.test(util)
    && /clearModelCache/.test(util)
    && /clearEditorState/.test(util)
    && /export async function clearLocalCadData/.test(util));
  ok('assemblyStore exports clearAssemblyStore (clears both stores)',
    /export async function clearAssemblyStore/.test(assembly)
    && /DOC_STORE[\s\S]*store\.clear\(\)/.test(assembly)
    && /PART_STORE[\s\S]*store\.clear\(\)/.test(assembly));
  ok('confirm copy keeps GitHub account/repo + session token',
    /GitHub account and\s+repo are not deleted/.test(dialog)
    && /session token is kept/.test(dialog)
    && /data-clear-cache-dialog/.test(dialog));
  ok('panel has Sign in + Clear for signed-out mode',
    /data-profile-sign-in/.test(panel)
    && /data-profile-clear-local/.test(panel)
    && /data-clear-cache/.test(panel)
    && /data-profile-panel-mode/.test(panel));
  ok('signed-in Account pane keeps Clear local cache',
    /data-profile-clear-local/.test(account)
    && /data-clear-cache/.test(account));
  ok('a chip with Clear opens the panel when signed out',
    /canClear/.test(chip)
    && /onClearLocalCadData/.test(chip)
    && /if \(canClear \|\| agentBridgeLive\)/.test(chip)
    && /setPanelOpen/.test(chip));
  ok('Sign in still reaches onAccount',
    /onAccount\?\.|onAccount\(/.test(chip)
    && /if \(signedIn\)/.test(chip)
    && /onSignIn=\{canClear \? \(\) => \{ onAccount\?\.\(\); \} : null\}/.test(chip));
  {
    const m = view.match(/<ProfileChip[\s\S]*?variant="viewport"[\s\S]*?\/>/);
    ok('viewport chip JSX includes onClearLocalCadData',
      m && /onClearLocalCadData/.test(m[0]));
  }
  ok('Parts + Script pass onClearLocalCadData',
    /onClearLocalCadData=\{onClearLocalCadData\}/.test(feed)
    && /onClearLocalCadData=\{onClearLocalCadData\}/.test(editor));
  ok('App handleClearLocalCadData suppresses flush then reloads',
    /handleClearLocalCadData/.test(app)
    && /suppressPartSaveRef\.current = true/.test(app)
    && /editorLiveRef\.current = false/.test(app)
    && /clearLocalCadData\(\)/.test(app)
    && /window\.location\.reload\(\)/.test(app));
  ok('App wires the opener into PartFeed, CodeEditor, and Viewport',
    (app.match(/onClearLocalCadData=\{openClearLocalCache\}/g) || []).length >= 5);
  ok('architecture documents Clear local cache contract',
    /Clear local cache/.test(arch)
    && /sessionStorage GitHub token/.test(arch));
  ok('package.json has golden:clear-local-cad', /golden:clear-local-cad/.test(pkg));
}

console.log('\nclear-local-cad — localStorage draft fallback clear');
{
  const map = new Map();
  globalThis.localStorage = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
  // Force fallback path (no IndexedDB).
  delete globalThis.indexedDB;

  const draftUrl = pathToFileURL(join(root, 'src/utils/editorDraft.js')).href
    + `?t=${Date.now()}`;
  const { saveEditorDraft, loadEditorDraft, clearEditorDraft } = await import(draftUrl);
  const saved = await saveEditorDraft({
    script: 'const part = cube(1);',
    filename: 'part1',
    partId: 'local:1',
  });
  ok('fallback save durable', saved === true);
  ok('fallback wrote key', map.has('surfcad_editor_draft'));
  ok('fallback load round-trips', (await loadEditorDraft())?.script === 'const part = cube(1);');
  await clearEditorDraft();
  ok('fallback clear empties storage', !map.has('surfcad_editor_draft')
    && !(await loadEditorDraft())?.script);

  const handOffUrl = pathToFileURL(join(root, 'src/utils/editorStorage.js')).href
    + `?t=${Date.now()}`;
  const { saveEditorState, clearEditorState, hasPendingEditorState } = await import(handOffUrl);
  saveEditorState({ currentScript: 'x', currentFilename: 'y' });
  ok('hand-off pending before clear', hasPendingEditorState() === true);
  clearEditorState();
  ok('hand-off cleared', hasPendingEditorState() === false);
}

console.log(failed ? `\n❌ FAIL (${failed} failed, ${passed} passed)` : `\n✅ PASS (${passed})`);
process.exit(failed ? 1 : 0);

#!/usr/bin/env node
/**
 * Multi-part Block drop: a feature lands in the part that is picked.
 *
 * Artur, two parts: pick part B in the viewer, open a Block. The preview is
 * drawn on B (the viewport anchors it on the picked part), but Confirm wrote
 * the block into A at the same relative pose, because a face / edge pick
 * moves the CAD selection (cadPartId) and leaves the editor on activeId, and
 * every writer writes the editor buffer. The strip (picked part) then showed
 * B, B's sheet Delete ran B's offsets on A's buffer ("invalid range", or it
 * silently cut A's cube when the offsets happened to fit), and Undo walked
 * A's stack.
 *
 * Fix: featureWriteTarget(doc, { pickedId, payloadPartId }) names the part a
 * write / sheet / Undo acts on; App's focusWritePart loads it into the
 * editor (keeping picks, focusing its own Undo stack) before every writer,
 * on palette open, on feature-session start, before sheet open / Accept /
 * Delete, and before Undo / Redo.
 *
 * This replays the reported sequence through the real composer, part
 * history and worker, and checks every feature writer's wiring.
 */
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { featureWriteTarget } from '../../src/utils/pickRetarget.js';
import { composeHelperInsert } from '../../src/utils/helperPaletteSnippets.js';
import { parseFeatureMarkers } from '../../src/utils/featureMarkers.js';
import { deleteFeatureBlock, liveSheetFeature } from '../../src/utils/featureSheetWriteback.js';
import {
  historyForPart,
  pushPartHistory,
  redoPartHistory,
  undoPartHistory,
} from '../../src/utils/partHistory.js';
import { serializeAssembly } from '../../src/utils/assembly.js';

const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');
let failed = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`);
  }
}

register('./manifold-resolve-hook.mjs', import.meta.url);
const pending = new Map();
let msgId = 0;
const workerSelf = {
  onmessage: null,
  postMessage(msg) {
    if (msg.type === 'loaded') return;
    const w = pending.get(msg.id);
    if (!w) return;
    pending.delete(msg.id);
    w.resolve(msg);
  },
};
globalThis.self = workerSelf;
function send(type, payload = {}) {
  return new Promise((resolve) => {
    const id = ++msgId;
    pending.set(id, { resolve });
    Promise.resolve().then(() => workerSelf.onmessage({ data: { type, payload, id } }));
  });
}
await import('../../src/workers/sandboxWorker.js');
await send('init');
const volumeOf = async (script) => {
  const r = await send('execute', { script, importedModels: {}, memoryLimitMB: 512 });
  return r.type === 'result' ? r.payload.volume : NaN;
};

console.log('multi-part block drop — a Block confirmed on picked part B lands in B');

const A = '// --- cube begin ---\nlet box1 = Manifold.cube([20, 20, 20], true);\nlet part = box1;\n// --- cube end ---\nreturn part;\n';
const B = '// --- sphere begin ---\nlet sphere1 = Manifold.sphere(12, 48);\nlet part = sphere1;\n// --- sphere end ---\nreturn part;\n';
const doc = serializeAssembly({
  version: 1,
  source: 'local',
  name: 'Asm',
  activeId: 'pa',
  parts: [
    { id: 'pa', name: 'Alpha', visible: true, order: 0, position: [-25, 0, 0] },
    { id: 'pb', name: 'Beta', visible: true, order: 1, position: [25, 0, 0] },
  ],
});

// ── Target rule ────────────────────────────────────────────────
{
  const t = featureWriteTarget(doc, { pickedId: 'pb' });
  check('B picked, editor on A → write B, load it first', t.id === 'pb' && t.load === true, JSON.stringify(t));
  check('nothing picked → the editor part, no load', JSON.stringify(featureWriteTarget(doc, {})) === '{"id":"pa","load":false}');
  check('A picked → A, no load', featureWriteTarget(doc, { pickedId: 'pa' }).load === false);
  check('the viewport\'s own part wins over a stale pick',
    featureWriteTarget(doc, { pickedId: 'pa', payloadPartId: 'pb' }).id === 'pb');
  check('a deleted / unknown part falls back to the editor part',
    featureWriteTarget(doc, { pickedId: 'gone', payloadPartId: 'nope' }).id === 'pa');
  check('no doc → nothing', featureWriteTarget(null, { pickedId: 'pb' }).id === null);
}

// ── Replay: pick B, Block Confirm, strip, Undo ─────────────────
const scripts = { pa: A, pb: B };
const histories = {};
let editor = { id: doc.activeId, text: A };
histories.pa = historyForPart(histories, 'pa', A);
/** App's focusWritePart → handleSelectPart(id, { keepPicks: true }). */
const focusWritePart = (pickedId, payloadPartId = null) => {
  const t = featureWriteTarget({ ...doc, activeId: editor.id }, { pickedId, payloadPartId });
  if (!t.load) return;
  scripts[editor.id] = editor.text;
  histories[editor.id] = pushPartHistory(historyForPart(histories, editor.id, editor.text), editor.text, 'Part');
  editor = { id: t.id, text: scripts[t.id] };
  histories[t.id] = historyForPart(histories, t.id, editor.text);
};
const write = (text, msg) => {
  editor.text = text;
  scripts[editor.id] = text;
  histories[editor.id] = pushPartHistory(histories[editor.id], text, msg);
};
const POSE = { width: 10, depth: 10, height: 10, x: 0, y: 14, z: 0 };
{
  const picked = 'pb';
  // Palette open (onOpen → focusWritePart) — the buffer snapshot is B's.
  focusWritePart(picked);
  check('opening the Block sheet loads B into the editor', editor.id === 'pb' && editor.text === B);
  // Confirm (handleInsertHelper → focusWritePart, then insert).
  focusWritePart(picked);
  const next = composeHelperInsert(editor.text, 'cube', null, POSE);
  write(next, 'Cube');
  check('the block is written into B\'s script', /Manifold\.cube\(\[10, 10, 10\], true\)/.test(scripts.pb), scripts.pb);
  check('A\'s script is untouched', scripts.pa === A);
  const stripScript = editor.id === picked ? editor.text : scripts[picked];
  const kinds = parseFeatureMarkers(stripScript).map((f) => f.id).join(',');
  check('the strip (picked part) lists B\'s sphere and the new cube', kinds === 'sphere-0,cube-1', kinds);
  check('A\'s strip still has only its cube', parseFeatureMarkers(scripts.pa).map((f) => f.id).join(',') === 'cube-0');
  const vA = await volumeOf(scripts.pa);
  const vB = await volumeOf(scripts.pb);
  const vB0 = await volumeOf(B);
  check('A still runs as the 20 mm cube', Math.abs(vA - 8000) < 1e-3, String(vA));
  check('B runs with the cube added', vB > vB0 + 100, `B=${vB} was ${vB0}`);

  // Undo on the picked part's stack (handleUndo → focusWritePart first).
  focusWritePart(picked);
  const u = undoPartHistory(histories[editor.id]);
  check('Undo steps B back to the sphere', editor.id === 'pb' && u.code === B, String(u.code).slice(0, 80));
  histories.pb = u.history;
  const r = redoPartHistory(histories.pb);
  check('Redo brings the cube back on B', r.code === next);
  check('A\'s stack never saw the cube', (histories.pa?.commits || []).every((c) => !/cube\(\[10, 10, 10\]/.test(c.code)));
}

// ── The old behaviour, and the sheet Delete guard ──────────────
{
  const oldWrite = composeHelperInsert(A, 'cube', null, POSE);
  check('(old) writing the editor buffer put the cube in A', /cube\(\[10, 10, 10\]/.test(oldWrite));
  const bSphere = parseFeatureMarkers(B)[0];
  const stale = deleteFeatureBlock(A, bSphere);
  check('(old) B\'s chip offsets on A\'s buffer delete the wrong text',
    stale.ok && !/cube begin/.test(stale.buffer), stale.message || stale.buffer);
  check('liveSheetFeature: B\'s sphere is not in A → null (no stale offsets)', liveSheetFeature(A, bSphere) === null);
  check('liveSheetFeature: found again in B', liveSheetFeature(B, bSphere)?.startOffset === bSphere.startOffset);
  const del = deleteFeatureBlock(B, liveSheetFeature(B, bSphere));
  check('Delete on B removes only B\'s sphere', del.ok && !/sphere begin/.test(del.buffer) && /return part/.test(del.buffer));
}

// ── Wiring: every writer, preview, sheet and Undo ──────────────
{
  const app = read('src/App.jsx');
  const vp = read('src/components/Viewport.jsx');
  const pal = read('src/components/HelperInsertPalette.jsx');
  const body = (name) => {
    const at = app.indexOf(`const ${name} = (`);
    return at < 0 ? '' : app.slice(at, at + 700);
  };
  const first = (name, re) => {
    const b = body(name);
    const call = b.search(re);
    const buf = b.search(/getContent\?\.\(\)|insertHelper\?\.\(|historyKey\(\)/);
    return call > 0 && (buf < 0 || call < buf);
  };
  check('focusWritePart uses featureWriteTarget with the picked part and loads with keepPicks',
    /featureWriteTarget\(doc, \{ pickedId: cadPartIdRef\.current, payloadPartId \}\)/.test(app)
    && /handleSelectPart\(target\.id, \{ keepPicks: true \}\)/.test(app));
  check('Block / palette Confirm (handleInsertHelper) targets the picked part before reading the buffer',
    first('handleInsertHelper', /focusWritePart\(null\)/));
  for (const [name, label] of [
    ['handleCommitContourProfile', 'Contour / Extrude / Revolve / Loft / Sweep / Workplane'],
    ['handleCommitFillet', 'Fillet / Chamfer'],
    ['handleCommitShell', 'Shell'],
    ['handleCommitDraft', 'Draft'],
    ['handleCommitCut', 'Cut'],
    ['handleCommitDeleteFace', 'Delete Face'],
    ['handleCommitMoveFace', 'Move Face'],
    ['handleCommitMove', 'Move'],
  ]) {
    check(`${label} Confirm targets the viewport's part first`, first(name, /focusWritePart\(payload\?\.partId\)/));
  }
  check('Boolean keeps its own target (first pick) load', /handleSelectPart\(target, \{ keepPicks: true \}\)/.test(body('handleCommitBoolean') + app.slice(app.indexOf('const handleCommitBoolean'), app.indexOf('const handleCommitBoolean') + 1200)));
  check('Undo and Redo act on the picked part\'s stack',
    first('handleUndo', /focusWritePart\(null\)/) && first('handleRedo', /focusWritePart\(null\)/));
  for (const name of ['openFeatureSheetFor', 'openFeatureSheetFromCad', 'handleFeatureSheetAccept', 'handleFeatureSheetDelete', 'handleFeatureStripJump', 'handleDesktopFeatureStripJump']) {
    check(`${name} loads the picked part first`, /focusWritePartRef\.current\(null\)/.test(body(name)));
  }
  check('sheet Accept / Delete never fall back to stale offsets',
    // Sheet Accept, sheet Delete, the strip jump, and the agent delete_feature prepare.
    (app.match(/const live = liveSheetFeature\(buf, feature\);/g) || []).length === 4 && !/\|\| feature;\n/.test(app));
  check('a feature session start and a palette open edit the picked part',
    /if \(on && !featureSessionRef\.current\) focusWritePart\(null\)/.test(app)
    && (app.match(/onFeatureOpen=\{handleFeatureOpen\}/g) || []).length === 2
    && /onOpen=\{onFeatureOpen\}/.test(vp)
    && /const openParams = \(item\) => \{\n[^\n]*\n\s*onOpen\?\.\(item\);/.test(pal));
  const payloads = [
    /onCommitContourProfile\?\.\(\{\n\s*partId: activePartIdRef\.current/,
    /onCommitShell\?\.\(\{\n\s*partId: activePartIdRef\.current/,
    /onCommitDraft\?\.\(\{ state, partId: activePartIdRef\.current \}\)/,
    /onCommitCut\?\.\(\{ state, mesh: \{ positions, index, bodyCount \}, partId: activePartIdRef\.current \}\)/,
    /onCommitMove\?\.\(\{ state, partId: activePartIdRef\.current \}\)/,
    /onCommitMoveFace\?\.\(\{ state, partId: activePartIdRef\.current \}\)/,
    /onCommitDeleteFace\?\.\(\{ state, partId: activePartIdRef\.current \}\)/,
  ];
  check('viewport commits name the part they were made on', payloads.every((re) => re.test(vp)),
    payloads.filter((re) => !re.test(vp)).map(String).join(' '));
  const paint = vp.slice(vp.indexOf('const paintBlockPreview'), vp.indexOf('const setBlockPreview'));
  check('the Block preview still anchors on the picked part', /anchorToActivePart\(group\)/.test(paint));
  check('architecture.md documents the write target', /featureWriteTarget/.test(read('docs/architecture.md'))
    && /golden:multi-part-block-drop/.test(read('docs/architecture.md')));
}

if (failed) {
  console.log(`\nmulti-part block drop: ${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nmulti-part block drop: all checks passed');
process.exit(0);

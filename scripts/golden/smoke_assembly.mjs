#!/usr/bin/env node
/**
 * Assemblies: a parts feed, one script in the editor, every visible part
 * in the viewport.
 *
 * Selecting a row loads that part's script. Hiding a row drops it from the
 * composed viewport. A failed script highlights the row and contributes no
 * solid, including no previous solid. The saved assembly lists ids, never
 * inline scripts. Deleting a row drops that part from the list and from the
 * composed viewport. The other parts stay.
 *
 * Spawning a new part still auto-drops a 20 mm box, and that box is a Cube
 * feature (same markers as a palette Cube). An unmarked `let part = cube`
 * would run the solid and leave the feature strip empty.
 */
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { BufferAttribute, BufferGeometry } from 'three';
import {
  assemblyName,
  assemblyNameForLoad,
  assemblyNameFromFile,
  composeViewportParts,
  dropPartRecord,
  feedRows,
  preserveHiddenPartRuns,
  formatViewerTitle,
  parseAssemblyDocument,
  partListDeleteAction,
  partCanDeleteFromRepo,
  recordPartRun,
  removePart,
  resolvePartId,
  sanitizeAssemblyName,
  scriptForRow,
  serializeAssembly,
  setPartVisible,
  needsAssemblyLeaveGuard,
  isDefaultBlankAssembly,
  DEFAULT_ASSEMBLY_NAME,
  DEFAULT_PART_NAME,
  nextNumberedName,
} from '../../src/utils/assembly.js';
import { meshPreviewKey, partPreviewKind } from '../../src/utils/partPreview.js';
import {
  historyForPart,
  pushPartHistory,
  undoPartHistory,
} from '../../src/utils/partHistory.js';
import { buildCoherentEdges, buildFeatureEdges, pickNearestEdge } from '../../src/utils/selectEdge.js';
import { pickActivePartEdge, resolveActivePartOverlay } from '../../src/utils/activePartOverlay.js';
import { stampBoundaryOnSelection } from '../../src/utils/boundaryEdgeIds.js';
import { selectGraphFace, warmFaceGraph } from '../../src/utils/selectFace.js';
import { runAssemblyParts } from '../../src/utils/assemblyRun.js';
import {
  composeHelperInsert,
  newPartStarterScript,
  CUBE_BEGIN,
  CUBE_END,
} from '../../src/utils/helperPaletteSnippets.js';
import { parseFeatureMarkers } from '../../src/utils/featureMarkers.js';

const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

let failed = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`);
  }
}

const BOX = 'let part = Manifold.cube([10, 10, 10], true);\nreturn part;\n';
const WIDE = 'let part = Manifold.cube([4, 4, 4], true);\nreturn part;\n';
const BAD = 'let part = Manifold.cube([10, 10, 10], true);\nreturn part.missingMethod();\n';

{
  const app = read('src/App.jsx');
  const feed = read('src/components/PartFeed.jsx');
  const preview = read('src/utils/partPreview.js');
  const store = read('src/utils/assemblyStore.js');
  const view = read('src/components/Viewport.jsx');
  const toggle = read('src/components/MobileStageToggle.jsx');
  const arch = read('docs/architecture.md');
  const selectFn = app.slice(app.indexOf('const handleSelectPart'), app.indexOf('const handleTogglePartVisible'));
  const place = view.slice(view.indexOf('placeAssemblyRef.current ='), view.indexOf('Download the current model'));
  const fail = view.slice(view.indexOf('assembly-fail:'), view.indexOf('return noShadow'));

  check('desktop feed sits to the left of the editor',
    (() => {
      const desk = app.slice(app.lastIndexOf('flex h-dvh bg-gray-900'));
      const feedAt = desk.indexOf('data-parts-feed-placement="desktop-left"');
      const editorAt = desk.indexOf('<CodeEditor');
      return feedAt >= 0 && editorAt > feedAt;
    })());
  check('selecting a row loads that part script into Monaco',
    /scriptForRow\(/.test(selectFn) && /loadContent\(picked\.script/.test(selectFn));
  check('an eye toggles visibility and the viewport is recomposed',
    /setPartVisible\(/.test(app) && /composeViewportParts\(/.test(app) && /placeAssembly/.test(app));
  check('feed row has a thumbnail, a blue selection bar, an eye, and delete',
    /data-part-thumbnail/.test(feed)
    && /data-part-preview=\{kind\}/.test(feed)
    && /partPreviewKind\(mesh\)/.test(feed)
    && /data-part-selected-bar/.test(feed)
    && /data-part-selected-bar=""\s*className="[^"]*bg-blue-500/.test(feed)
    && /selected && !row\.error \? 'bg-blue-950\/50'/.test(feed)
    && !/selected && !row\.error \? 'bg-red/.test(feed)
    && /row\.error \? 'bg-red-950\/55 ring-1 ring-inset ring-red-500\/80'/.test(feed)
    && /data-part-visibility=/.test(feed)
    && /data-part-delete=/.test(feed)
    && !/fillRect\(sx, sy/.test(feed));
  check('part snapshot uses the viewer material, light, and background, and caches the mesh',
    /makeDefaultPartMaterial\(\)/.test(preview)
    && /new PointLight\(0xffffff, 1\)/.test(preview)
    && /0x1e1e1e/.test(preview)
    && /fitView\(/.test(preview)
    && /peekPartPreview\(/.test(preview)
    && /cache\.get\(key\)/.test(preview)
    && !/requestAnimationFrame/.test(preview)
    && /takePartPreview\(meshRef\.current\)/.test(feed)
    && /\[previewKey, showLive, cached\]/.test(feed)
    && /assemblyNameForLoad\(raw, filename\)/.test(read('src/utils/assembly.js'))
    && /saveAssemblyDocument\(clean\)/.test(store));
  const del = app.slice(app.indexOf('const handleDeletePart'), app.indexOf('const handleGameRun'));
  check('delete removes that part from the document, the script, and the viewport',
    /removePart\(/.test(del)
    && /dropPartRecord\(/.test(del)
    && /deletePartScript\(/.test(del)
    && /composeViewportParts\(/.test(del)
    && /placeAssembly/.test(del)
    && /onDeletePart=\{handleDeletePart\}/.test(app));
  check('a failed row is highlighted and a missing row offers find or upload',
    /data-part-status=\{status\}/.test(feed)
    && /data-part-error/.test(feed)
    && /Add to Repo/.test(feed)
    && /Upload/.test(feed)
    && /data-assembly-load/.test(feed));
  check('mobile pager order is CAD then Parts, with no script button',
    (() => {
      const cad = toggle.indexOf('data-stage-dot="cad"');
      const parts = toggle.indexOf('data-stage-dot="parts"');
      const cadBtn = toggle.indexOf('data-stage-btn="cad"');
      const partsBtn = toggle.indexOf('data-stage-btn="parts"');
      return cad >= 0 && cad < parts
        && cadBtn >= 0 && cadBtn < partsBtn
        && !/data-stage-btn="script"/.test(toggle)
        && !/data-stage-dot="script"/.test(toggle)
        && /data-stage-icon="box"/.test(toggle)
        && /data-stage-icon="layout-list"/.test(toggle)
        && /data-stage-pane="parts"/.test(app);
    })());
  const titleStart = view.indexOf('data-viewer-title');
  const title = view.slice(titleStart, view.indexOf("mode === 'game' && gameSuccess", titleStart));
  const namedTitle = formatViewerTitle('Bracket', 'Gearbox');
  const defaultTitle = formatViewerTitle('part1', 'Assembly');
  const bareTitle = formatViewerTitle('Bracket', '');
  const blankTitle = formatViewerTitle('Bracket', '   ');
  check('CAD title with an assembly name reads part in assembly',
    titleStart >= 0
    && namedTitle.text === 'Bracket in Gearbox'
    && namedTitle.connector === 'in'
    && namedTitle.part === 'Bracket'
    && namedTitle.assembly === 'Gearbox'
    && defaultTitle.text === 'part1 in Assembly'
    && defaultTitle.connector === 'in'
    && defaultTitle.assembly === 'Assembly'
    && title.indexOf('ViewportTitleChip inline value={currentFilename}') >= 0
    && title.indexOf('ViewportTitleChip inline value={currentFilename}') < title.indexOf('data-title-in')
    && title.indexOf('data-title-in') < title.indexOf('noun="Assembly"')
    && /\{titleParts\.connector\}/.test(title)
    && /\{titleParts\.assembly\}/.test(title)
    && !/data-title-dash/.test(view)
    && !/Untitled Assembly/.test(view)
    && !/>\s*Assembly\s*</.test(title));
  check('a blank title string still omits an empty in',
    bareTitle.text === 'Bracket'
    && bareTitle.connector === ''
    && bareTitle.assembly === ''
    && !bareTitle.text.includes(' in')
    && blankTitle.text === 'Bracket'
    && blankTitle.connector === ''
    && formatViewerTitle('Part 1', null).text === 'Part 1'
    && /titleParts\.connector \?/.test(title));
  const ribbonStart = feed.indexOf('data-parts-feed-ribbon');
  const ribbon = feed.slice(ribbonStart, feed.indexOf('data-parts-rows'));
  const toolbar = ribbon.slice(ribbon.indexOf('data-parts-feed-toolbar'), ribbon.indexOf('data-parts-ribbon-end'));
  const ribbonEnd = ribbon.slice(ribbon.indexOf('data-parts-ribbon-end'));
  check('parts ribbon centers the assembly name; profile chip on the right',
    /data-parts-ribbon-center/.test(ribbon)
    && /RibbonAssemblyName[\s\S]{0,120}name=\{ribbonName\}/.test(ribbon)
    && /data-parts-ribbon-end/.test(ribbon)
    && /shrink-0/.test(ribbonEnd.slice(0, 180))
    && ribbon.indexOf('data-parts-feed-toolbar') < ribbon.indexOf('data-parts-ribbon-end')
    && !/data-parts-source-label/.test(toolbar)
    && !/data-parts-source-label/.test(ribbonEnd)
    && /data-parts-profile-chip/.test(ribbonEnd)
    && /max-w-full/.test(feed) && /data-parts-ribbon-center/.test(ribbon) && /flex-1/.test(ribbon)
    && /data-part-add-menu/.test(toolbar)
    && /data-part-open-menu/.test(toolbar)
    && /data-part-add-action="part"/.test(feed)
    && /data-part-add-action="assembly"/.test(feed)
    && /data-part-open-action="assembly"/.test(feed)
    && !/data-part-add-action="existing"/.test(feed)
    && /assemblyName=\{assemblyLabel\}/.test(app));
  const ask = feed.slice(feed.indexOf('const askDeletePart'), feed.indexOf('const cancelDeletePart'));
  const cancel = feed.slice(feed.indexOf('const cancelDeletePart'), feed.indexOf('const confirmDeletePart'));
  const confirmAt = feed.indexOf('const confirmDeletePart');
  const confirmDel = feed.slice(confirmAt, feed.indexOf('return (', confirmAt));
  check('delete asks before it drops',
    /setPendingDelete\(/.test(ask)
    && !/onDeletePart/.test(ask)
    && /partListDeleteAction\('cancel'\) !== 'keep'/.test(cancel)
    && !/onDeletePart/.test(cancel)
    && !/removePart/.test(cancel)
    && /data-part-delete-cancel/.test(feed)
    && /askDeletePart\(row\.id/.test(feed));
  check('confirm drops through the existing handler and cancel keeps the part',
    partListDeleteAction('cancel') === 'keep'
    && partListDeleteAction('dismiss') === 'keep'
    && partListDeleteAction(undefined) === 'keep'
    && partListDeleteAction('confirm') === 'drop'
    && partListDeleteAction('assembly') === 'drop'
    && partListDeleteAction('repo') === 'drop-repo'
    && /partListDeleteAction\(choice\)/.test(confirmDel)
    && /onDeletePart\?\.\(pending\.id, \{ fromRepo:/.test(confirmDel)
    && /data-part-delete-confirm/.test(feed)
    && /data-part-delete-scope="assembly"/.test(feed)
    && /Remove \$\{pendingDelete\.name\} from this assembly\?/.test(feed)
    && !/This drops the row, its script, and its solid/.test(feed)
    && /Delete from assembly/.test(feed)
    && /data-part-delete-confirm-repo/.test(feed)
    && /partCanDeleteFromRepo/.test(feed)
    && partCanDeleteFromRepo('git', 'assemblies/Gearbox/Bracket.js') === true
    && partCanDeleteFromRepo('git', 'local:abc') === false
    && partCanDeleteFromRepo('local', 'assemblies/Gearbox/Bracket.js') === false);
  check('assembly name in the title and the ribbon uses the same commit rules',
    /onRenameAssembly/.test(view)
    && /noun="Assembly"/.test(view)
    && /if \(e\.key === 'Enter'\)/.test(feed)
    && /if \(e\.key === 'Escape'\)/.test(feed)
    && /onBlur=\{commit\}/.test(feed)
    && /sanitizeAssemblyName\(draft\)/.test(feed)
    && /if \(next && next !== \(name \|\| ''\)\) onRename\(next\)/.test(feed)
    && /handleRenameAssembly/.test(app)
    && sanitizeAssemblyName('  Gear/box  ') === 'Gearbox'
    && sanitizeAssemblyName('') === ''
    && sanitizeAssemblyName('x'.repeat(80)).length === 60);
  const adoptStart = view.indexOf('adoptActiveSolidRef.current =');
  const adopt = view.slice(adoptStart, view.indexOf('placeAssemblyRef.current', adoptStart));
  const filletPaint = view.slice(view.indexOf('const paintFilletBlendPreview'), view.indexOf('const exitContourMode'));
  const filletLabels = view.slice(view.indexOf("group.name = 'filletIdLabels'"), view.indexOf('const rebuildFeatureEdges'));
  check('fillet preview and id labels anchor to the active part',
    filletPaint.includes('anchorToActivePart(group)')
    && filletLabels.includes('anchorToActivePart(group)')
    && /resolveActivePartOverlay\(/.test(view)
    && /overlay\.foreign/.test(view));
  check('part switch rebinds face, edge, and contour graphs on the active solid',
    adoptStart >= 0
    && /warmFaceGraph\(/.test(adopt)
    && /featureEdgesSourceRef\.current = null/.test(adopt)
    && /syncFeatureEdges\(/.test(adopt)
    && /adoptActiveSolid/.test(selectFn)
    && selectFn.indexOf('adoptActiveSolid') < selectFn.indexOf('loadContent')
    && /focusPartHistory\(/.test(selectFn)
    && selectFn.indexOf('focusPartHistory') < selectFn.indexOf('loadContent')
    && /adoptActiveSolidRef\.current/.test(place)
    && !/syncFeatureEdges\(/.test(place));
  check('a failed assembly part drops the cached solid and does not rebuild from it',
    /noShadow/.test(view)
    && /cachedMeshDataRef\.current = null/.test(fail)
    && !/renderMeshData\(prev\)/.test(fail)
    && !/previousMesh/.test(place)
    && /syncFeatureEdges\(/.test(view));
  check('placeAssembly draws the other visible parts and does not sync their graphs',
    /assembly-parts/.test(place) && !/syncFeatureEdges\(/.test(place));
  check('architecture covers the feed, ids, failure, and graph rebuild',
    /Parts feed/.test(arch)
    && /repo path/.test(arch)
    && /IndexedDB key/.test(arch)
    && /no shadow solid/.test(arch)
    && /does not rebuild from a previous solid/.test(arch));
  const undoFn = app.slice(app.indexOf('const handleUndo = '), app.indexOf('const handleRedo = '));
  check('undo steps only the active part stack',
    /const id = historyKey\(\)/.test(undoFn)
    && /undoPartHistory\(/.test(undoFn)
    && /partHistoriesRef/.test(undoFn)
    && /\.setTextOnly\s*\?/.test(undoFn)
    && !/\.loadContent\s*\(/.test(undoFn));
}

{
  const SCRIPT_A = 'let part = cubeA;\nreturn part;\n';
  const SCRIPT_B = 'let part = cubeB;\nreturn part;\n';
  const FEATURE = `${SCRIPT_A}// fillet on A\n`;
  const histories = {};
  histories.A = historyForPart(histories, 'A', SCRIPT_A);
  histories.B = historyForPart(histories, 'B', SCRIPT_B);
  histories.A = historyForPart(histories, 'A', SCRIPT_B);
  histories.A = pushPartHistory(histories.A, FEATURE, 'fillet');
  const undone = undoPartHistory(histories.A);
  const undoneB = undoPartHistory(histories.B);
  check('undo after A→B→A restores A and leaves B',
    undone.code === SCRIPT_A
    && undone.code !== SCRIPT_B
    && !String(undone.code).includes('cubeB')
    && undoneB.code == null
    && histories.B.commits[histories.B.head].code === SCRIPT_B
    && undone.history.head === 0
    && histories.A.head === 1);
}

{
  const starter = newPartStarterScript();
  const feats = parseFeatureMarkers(starter);
  const cubes = feats.filter((f) => f.kind === 'cube');
  const placed = composeHelperInsert('', 'cube', null, {
    width: 20,
    depth: 20,
    height: 20,
    center: true,
  });
  const placedFeats = parseFeatureMarkers(placed || '');
  check('new-part starter still drops a 20 mm box',
    /Manifold\.cube\(\[20,\s*20,\s*20\],\s*true\)/.test(starter)
    && /return part;/.test(starter));
  check('new-part starter box registers as a cube feature',
    cubes.length === 1
    && cubes[0].kind === 'cube'
    && starter.includes(CUBE_BEGIN)
    && starter.includes(CUBE_END),
    `kinds=${feats.map((f) => f.kind).join(',') || '(none)'}`);
  check('starter feature matches a user-placed 20 mm cube',
    starter === placed
    && placedFeats.length === 1
    && placedFeats[0].kind === 'cube'
    && placedFeats[0].chipLabel === cubes[0]?.chipLabel);

  const app = read('src/App.jsx');
  const add = app.slice(app.indexOf('const handleAddPart'), app.indexOf('const handleDeletePart'));
  check('spawn writes the marked starter, not an unmarked cube',
    /newPartStarterScript\(/.test(add)
    && !/let part = Manifold\.cube\(\[20,\s*20,\s*20\]/.test(add));

  let ops = composeHelperInsert('', 'cube');
  ops = composeHelperInsert(ops, 'filletEdges', null, { radius: 2, strategy: 'planar' });
  const opFeats = parseFeatureMarkers(ops || '');
  check('a user cube then a fillet still both register',
    opFeats.some((f) => f.kind === 'cube') && opFeats.some((f) => f.kind === 'fillet'),
    `kinds=${opFeats.map((f) => f.kind).join(',') || '(none)'}`);

  const after = composeHelperInsert(starter, 'cylinder');
  const afterFeats = parseFeatureMarkers(after || '');
  check('starter cube stays a feature after a later operation',
    afterFeats.filter((f) => f.kind === 'cube').length === 1
    && afterFeats.some((f) => f.kind === 'cylinder'),
    `kinds=${afterFeats.map((f) => f.kind).join(',') || '(none)'}`);
}

{
  const doc = serializeAssembly({
    source: 'local',
    activeId: 'local:wide',
    parts: [
      { id: 'local:box', name: 'Box', visible: true, order: 0, position: [30, 0, 0], script: BOX },
      { id: 'local:wide', name: 'Wide', visible: true, order: 1, script: WIDE },
    ],
  });
  const scripts = { 'local:box': BOX, 'local:wide': WIDE };
  const saved = JSON.stringify(doc);
  check('saved assembly lists ids and not inline scripts',
    saved.includes('local:box')
    && saved.includes('"order":0')
    && saved.includes('"visible":true')
    && !saved.includes('Manifold')
    && !saved.includes('"script"'));
  check('a stored position is kept and a missing one is omitted',
    doc.parts.find((part) => part.id === 'local:box').position[0] === 30
    && !('position' in doc.parts.find((part) => part.id === 'local:wide')));
  const created = serializeAssembly({
    source: 'local',
    activeId: 'local:box',
    parts: [{ id: 'local:box', name: 'part1', visible: true, order: 0 }],
  });
  check('a new assembly is named Assembly',
    created.name === 'Assembly'
    && assemblyName(created) === 'Assembly'
    && formatViewerTitle('part1', assemblyName(created)).text === 'part1 in Assembly'
    && assemblyName(null) === '');
  check('a document with no assembly name is saved as Assembly',
    doc.name === 'Assembly' && assemblyName(doc) === 'Assembly');
  const named = serializeAssembly({ ...doc, name: '  Gearbox  ' });
  const blankName = serializeAssembly({ ...doc, name: '   ' });
  check('a real assembly name is kept and a blank one becomes Assembly',
    named.name === 'Gearbox'
    && assemblyName(named) === 'Gearbox'
    && blankName.name === 'Assembly'
    && assemblyName(blankName) === 'Assembly'
    && assemblyName({ name: 'Gearbox', parts: [] }) === 'Gearbox');
  const round = parseAssemblyDocument(JSON.stringify({
    name: 'Gearbox',
    source: 'local',
    activeId: 'local:wide',
    parts: [{ id: 'local:wide', name: 'Wide', visible: true, order: 0 }],
  }));
  const blankRound = parseAssemblyDocument({
    name: '  ',
    source: 'local',
    parts: [{ id: 'local:wide', name: 'Wide' }],
  });
  const missingRound = parseAssemblyDocument({
    source: 'local',
    parts: [{ id: 'local:wide', name: 'Wide' }],
  });
  check('parse keeps a custom name and migrates a blank one to Assembly',
    round.name === 'Gearbox'
    && blankRound.name === 'Assembly'
    && missingRound.name === 'Assembly');
  check('a loaded file name is used only when the document has none',
    assemblyNameFromFile('projects/Gearbox.json') === 'Gearbox'
    && assemblyNameFromFile('notes.txt') === 'notes.txt'
    && assemblyNameFromFile('.json') === ''
    && assemblyNameFromFile('') === ''
    && assemblyNameForLoad({ name: 'Gearbox' }, 'Other.json') === 'Gearbox'
    && assemblyNameForLoad({ name: '   ' }, 'projects/Gearbox.json') === 'Gearbox'
    && assemblyNameForLoad({}, 'notes.txt') === 'notes.txt'
    && assemblyNameForLoad({}, '') === 'Assembly'
    && assemblyNameForLoad({ name: '' }, '.json') === 'Assembly');
  const solidMesh = {
    numProp: 3,
    vertProperties: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1],
    triVerts: [0, 1, 2, 0, 2, 3],
  };
  const previewKey = meshPreviewKey(solidMesh);
  const movedVerts = solidMesh.vertProperties.slice();
  movedVerts[0] = 5;
  check('a part with a solid gets a stable preview key and an empty solid does not',
    partPreviewKind(solidMesh) === 'manifold'
    && typeof previewKey === 'string'
    && previewKey.length > 0
    && meshPreviewKey(solidMesh) === previewKey
    && meshPreviewKey({
      numProp: 3,
      vertProperties: solidMesh.vertProperties.slice(),
      triVerts: solidMesh.triVerts.slice(),
    }) === previewKey
    && meshPreviewKey({
      numProp: 3,
      vertProperties: movedVerts,
      triVerts: solidMesh.triVerts,
    }) !== previewKey
    && partPreviewKind(null) === 'empty'
    && partPreviewKind({}) === 'empty'
    && meshPreviewKey({ vertProperties: [] }) == null
    && feedRows(doc, {
      'local:box': { ok: true, mesh: solidMesh },
    }, scripts).find((row) => row.id === 'local:box').mesh === solidMesh);

  const picked = scriptForRow(doc, scripts, 'local:box');
  check('selecting a row resolves that script from the id, not the document',
    picked.ok === true && picked.script === BOX && picked.script !== WIDE);

  const hidden = setPartVisible(doc, 'local:box', false);
  const hiddenRuns = {
    'local:box': { ok: true, mesh: { vertProperties: [1, 2, 3], triVerts: [0, 0, 0] } },
    'local:wide': { ok: true, mesh: { vertProperties: [4, 5, 6], triVerts: [0, 0, 0] } },
  };
  const hiddenSolids = composeViewportParts(hidden, hiddenRuns);
  check('hiding a row drops it from the composed viewport',
    hiddenSolids.length === 1 && hiddenSolids[0].id === 'local:wide');

  const boxMesh = solidMesh;
  const wideMesh = {
    numProp: 3,
    vertProperties: [2, 0, 0, 3, 0, 0, 2, 1, 0, 2, 0, 1],
    triVerts: [0, 1, 2, 0, 2, 3],
  };
  const thumbRuns = {
    'local:box': { ok: true, mesh: boxMesh, bodyCount: 1 },
    'local:wide': { ok: true, mesh: wideMesh, bodyCount: 1 },
  };
  const activeHidden = setPartVisible(doc, 'local:wide', false);
  const activeRebuilt = {
    'local:box': thumbRuns['local:box'],
    'local:wide': { ok: false, mesh: null, skipped: true, error: null },
  };
  const activeKept = preserveHiddenPartRuns(activeHidden, activeRebuilt, thumbRuns);
  const activeRow = feedRows(activeHidden, activeKept, scripts).find((row) => row.id === 'local:wide');
  const activeSolids = composeViewportParts(activeHidden, activeKept);
  check('hiding the active part keeps its thumbnail and leaves the viewport',
    activeRow.mesh === wideMesh
    && activeRow.visible === false
    && activeRow.error === false
    && partPreviewKind(activeRow.mesh) === 'manifold'
    && activeSolids.length === 1
    && activeSolids[0].id === 'local:box');
  const otherRebuilt = { 'local:wide': thumbRuns['local:wide'] };
  const otherKept = preserveHiddenPartRuns(hidden, otherRebuilt, thumbRuns);
  const otherRow = feedRows(hidden, otherKept, scripts).find((row) => row.id === 'local:box');
  const otherSolids = composeViewportParts(hidden, otherKept);
  check('hiding a part the refresh omitted keeps its thumbnail',
    otherRow.mesh === boxMesh
    && otherRow.visible === false
    && otherRow.error === false
    && partPreviewKind(otherRow.mesh) === 'manifold'
    && otherSolids.length === 1
    && otherSolids[0].id === 'local:wide');
  const neverRan = preserveHiddenPartRuns(hidden, otherRebuilt, {
    'local:wide': thumbRuns['local:wide'],
  });
  check('a hidden part with no successful mesh stays empty',
    feedRows(hidden, neverRan, scripts).find((row) => row.id === 'local:box').mesh == null);
  check('the assembly refresh keeps hidden thumbnail meshes',
    /preserveHiddenPartRuns\(doc, runs, partRunsRef\.current\)/.test(read('src/App.jsx')));

  const poisoned = recordPartRun(hiddenRuns, 'local:box', {
    ok: false,
    error: 'nope',
    mesh: hiddenRuns['local:box'].mesh,
    previousMesh: hiddenRuns['local:box'].mesh,
  });
  const poisonedSolids = composeViewportParts(doc, poisoned);
  check('a failed run contributes no solid and keeps no previous mesh',
    poisoned['local:box'].mesh == null
    && !poisonedSolids.some((solid) => solid.id === 'local:box')
    && poisonedSolids.some((solid) => solid.id === 'local:wide'));
  const flags = feedRows(doc, poisoned, scripts).find((row) => row.id === 'local:box');
  check('a failed script highlights that row',
    flags.error === true && flags.mesh == null && flags.missing === false);

  const git = parseAssemblyDocument(JSON.stringify({
    source: 'git',
    activeId: 'parts/arm.js',
    parts: [{ id: 'parts/arm.js', name: 'Arm', visible: true, order: 0, script: BOX }],
  }));
  check('git id is a repo path and a missing row asks to find the file',
    git.source === 'git'
    && git.parts[0].id === 'parts/arm.js'
    && !JSON.stringify(git).includes('Manifold')
    && resolvePartId('git', 'parts/arm.js', {}).action === 'add-to-repo');
  check('local id is an IndexedDB key and a missing row asks to upload',
    resolvePartId('local', 'local:gone', {}).action === 'upload'
    && feedRows(doc, {}, {})[0].action === 'upload');
  const placed = composeViewportParts(doc, {
    'local:box': { ok: true, mesh: { vertProperties: [0, 0, 0] } },
  });
  check('the viewport uses a stored position',
    placed[0].id === 'local:box' && placed[0].position[0] === 30 && placed[0].position[1] === 0);

  const removed = removePart(doc, 'local:box');
  const removedRows = feedRows(removed, hiddenRuns, scripts);
  const removedSolids = composeViewportParts(removed, hiddenRuns);
  check('deleting a part drops it from the list',
    removed.parts.length === 1
    && removed.parts[0].id === 'local:wide'
    && removed.parts[0].name === 'Wide'
    && removed.activeId === 'local:wide'
    && !removedRows.some((row) => row.id === 'local:box')
    && removedRows.some((row) => row.id === 'local:wide'));
  check('deleting a part drops its solid even when the old run is still around',
    !removedSolids.some((solid) => solid.id === 'local:box')
    && removedSolids.length === 1
    && removedSolids[0].id === 'local:wide');
  const scriptsLeft = dropPartRecord(scripts, 'local:box');
  const runsLeft = dropPartRecord(hiddenRuns, 'local:box');
  check('the deleted part script and run are not kept',
    !Object.prototype.hasOwnProperty.call(scriptsLeft, 'local:box')
    && scriptsLeft['local:wide'] === WIDE
    && !Object.prototype.hasOwnProperty.call(runsLeft, 'local:box')
    && runsLeft['local:wide'].ok === true
    && scriptForRow(removed, scriptsLeft, 'local:box').reason === 'unknown-row');
  const activeGone = removePart(doc, 'local:wide');
  check('deleting the active part leaves the other part active, position included',
    activeGone.activeId === 'local:box'
    && activeGone.parts.length === 1
    && activeGone.parts[0].position[0] === 30
    && !JSON.stringify(activeGone).includes('local:wide'));
  const emptied = removePart(activeGone, 'local:box');
  check('deleting the last part leaves no dangling id and no solid',
    emptied.parts.length === 0
    && emptied.activeId == null
    && composeViewportParts(emptied, hiddenRuns).length === 0
    && feedRows(emptied, hiddenRuns, scripts).length === 0
    && !JSON.stringify(emptied).includes('local:box'));
}

{
  const onA = {
    key: '0-1',
    a: 0,
    b: 1,
    va: [0, 0, 0],
    vb: [12, 0, 0],
    mid: [6, 0, 0],
    faceA: 1,
    faceB: 2,
    boundaryId: 4,
  };
  const onB = {
    key: '0-1',
    a: 0,
    b: 1,
    va: [40, 0, 0],
    vb: [50, 0, 0],
    mid: [45, 0, 0],
    faceA: 9,
    faceB: 8,
    boundaryId: 7,
    pairCount: 1,
  };
  const stamped = stampBoundaryOnSelection([onA], [onB]);
  check('a shared vertex key does not retarget an edge onto the other solid',
    stamped[0].faceA === 1
    && stamped[0].faceB === 2
    && stamped[0].boundaryId === 4
    && stamped[0].va[0] === 0);
  const same = stampBoundaryOnSelection(
    [{ ...onA, faceA: undefined, faceB: undefined, boundaryId: undefined }],
    [{ ...onB, va: [0, 0, 0], vb: [12, 0, 0], mid: [6, 0, 0], faceA: 3, faceB: 5, boundaryId: 1 }],
  );
  check('the same segment still receives its boundary ids',
    same[0].faceA === 3 && same[0].faceB === 5 && same[0].boundaryId === 1);
}

const pending = new Map();
let msgId = 0;
const workerSelf = {
  onmessage: null,
  postMessage(msg) {
    if (msg.type === 'loaded') return;
    const waiter = pending.get(msg.id);
    if (!waiter) return;
    pending.delete(msg.id);
    if (msg.type === 'error') waiter.reject(new Error(msg.payload?.message || 'worker error'));
    else waiter.resolve(msg);
  },
};
globalThis.self = workerSelf;

function send(type, payload = {}) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    Promise.resolve().then(() => {
      if (!workerSelf.onmessage) {
        reject(new Error('sandboxWorker handler missing'));
        return;
      }
      workerSelf.onmessage({ data: { type, payload, id } });
    });
  });
}

register('./manifold-resolve-hook.mjs', import.meta.url);
await import('../../src/workers/sandboxWorker.js');
await send('init');

async function execute(script) {
  const res = await send('execute', { script, importedModels: {}, memoryLimitMB: 512 });
  return res.payload;
}

{
  const doc = serializeAssembly({
    source: 'local',
    activeId: 'local:wide',
    parts: [
      { id: 'local:box', name: 'Box', visible: true, order: 0, position: [30, 0, 0] },
      { id: 'local:wide', name: 'Wide', visible: true, order: 1 },
    ],
  });
  const scripts = { 'local:box': BOX, 'local:wide': WIDE };
  const dropped = await execute(newPartStarterScript());
  check('the auto-dropped box is still a 20 mm cube solid',
    Math.abs(dropped.volume - 8000) < 1e-3
    && dropped.mesh?.vertProperties?.length > 0,
    `vol=${dropped.volume}`);
  const both = await runAssemblyParts({ doc, scripts, execute });
  check('both visible parts become solids',
    both.solids.length === 2
    && both.solids[0].id === 'local:box'
    && both.solids[0].position[0] === 30
    && both.solids[0].mesh.vertProperties.length > 0
    && both.solids[1].id === 'local:wide');
  const liveKey = meshPreviewKey(both.solids[0].mesh);
  check('a manifold solid drives a preview key and a different solid does not share it',
    partPreviewKind(both.solids[0].mesh) === 'manifold'
    && liveKey
    && meshPreviewKey(both.solids[0].mesh) === liveKey
    && partPreviewKind(both.solids[1].mesh) === 'manifold'
    && meshPreviewKey(both.solids[1].mesh) !== liveKey
    && partPreviewKind(null) === 'empty');

  const geomFromMesh = (mesh) => {
    const np = mesh.numProp || 3;
    const src = mesh.vertProperties;
    const nVert = Math.floor(src.length / np);
    const positions = new Float32Array(nVert * 3);
    for (let i = 0; i < nVert; i++) {
      positions[i * 3] = src[i * np];
      positions[i * 3 + 1] = src[i * np + 1];
      positions[i * 3 + 2] = src[i * np + 2];
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    geometry.setIndex(new BufferAttribute(Uint32Array.from(mesh.triVerts), 1));
    return geometry;
  };
  const meshA = both.runs['local:box'].mesh;
  const meshB = both.runs['local:wide'].mesh;
  const geomA = geomFromMesh(meshA);
  const geomB = geomFromMesh(meshB);
  const faceA = warmFaceGraph(geomA, meshA.faceID);
  const faceB = warmFaceGraph(geomB, meshB.faceID);
  const edgesA = buildFeatureEdges(geomA);
  const edgesB = buildFeatureEdges(geomB);
  const contoursA = buildCoherentEdges(edgesA);
  const contoursB = buildCoherentEdges(edgesB);
  const edgeSig = (edges) => edges.map((e) => {
    const a = e.va || [];
    const b = e.vb || [];
    return [a[0], a[1], a[2], b[0], b[1], b[2]].map((n) => Number(n).toFixed(3)).join(',');
  }).sort().join('|');
  const span = (edges) => {
    let max = 0;
    for (const e of edges) {
      for (const v of [e.va, e.vb]) {
        if (!v) continue;
        max = Math.max(max, Math.abs(v[0]), Math.abs(v[1]), Math.abs(v[2]));
      }
    }
    return max;
  };
  const midB = edgesB[0]?.mid;
  const hitB = midB ? pickNearestEdge(edgesB, midB, 0.5) : null;
  const hitA = midB ? pickNearestEdge(edgesA, midB, 0.5) : null;
  const facePick = selectGraphFace(geomB, 0, meshB.faceID);
  const tri = facePick.indices[0];
  const vert = geomB.index.array[tri * 3];
  const faceX = geomB.attributes.position.array[vert * 3];
  check('selecting B rebuilds graphs that pick B, not A',
    faceA && faceB && faceA !== faceB
    && edgesA.length > 0 && edgesB.length > 0
    && contoursA.length > 0 && contoursB.length > 0
    && edgeSig(edgesA) !== edgeSig(edgesB)
    && edgeSig(contoursA) !== edgeSig(contoursB)
    && span(edgesA) > 4 && span(edgesB) <= 2.01
    && span(contoursB) <= 2.01
    && hitB && hitB.key === edgesB[0].key
    && hitA == null
    && Number.isFinite(faceX) && Math.abs(faceX) <= 2.01);

  // Box is the active solid, translated to x=30. Wide sits at the origin.
  // Box-local edges occupy that origin, which is where an unanchored preview
  // paints on the wrong part.
  const activePreview = resolveActivePartOverlay({
    edges: edgesA.map((edge) => ({ ...edge, partId: 'local:box' })),
    sourceId: 'local:box',
    activeId: 'local:box',
    position: [30, 0, 0],
  });
  const unshifted = resolveActivePartOverlay({
    edges: edgesA,
    position: null,
  });
  check('unanchored active edges sit on the part at the origin',
    unshifted.points.length > 0
    && unshifted.points.every((p) => Math.abs(p[0]) <= 6));
  check('active preview resolves to the translated solid, not the origin part',
    activePreview.foreign === false
    && activePreview.partId === 'local:box'
    && activePreview.points.length > 0
    && activePreview.points.every((p) => p[0] > 20));
  const foreignPreview = resolveActivePartOverlay({
    edges: edgesB.map((edge) => ({ ...edge, partId: 'local:wide' })),
    sourceId: 'local:wide',
    activeId: 'local:box',
    position: [30, 0, 0],
  });
  check('the other part graph is not painted while the box is active',
    foreignPreview.foreign === true
    && foreignPreview.points.length === 0
    && foreignPreview.partId == null);
  const mid = edgesA[0].mid;
  const pickedOnActive = pickActivePartEdge(
    [
      { id: 'local:wide', edges: edgesB, position: [0, 0, 0] },
      { id: 'local:box', edges: edgesA, position: [30, 0, 0] },
    ],
    'local:box',
    [mid[0] + 30, mid[1], mid[2]],
    0.5,
  );
  check('a world pick on the active solid resolves to that mesh, not the other',
    pickedOnActive
    && pickedOnActive.partId === 'local:box'
    && Math.abs(pickedOnActive.edge.mid[0] - mid[0]) < 1e-4
    && Math.abs(pickedOnActive.edge.mid[1] - mid[1]) < 1e-4
    && pickedOnActive.points.length >= 2
    && pickedOnActive.points.every((p) => p[0] > 20));

  const hidden = await runAssemblyParts({
    doc: setPartVisible(doc, 'local:box', false),
    scripts,
    execute,
  });
  check('hiding a row removes its solid from the worker compose',
    hidden.solids.length === 1 && hidden.solids[0].id === 'local:wide');

  const broke = await runAssemblyParts({
    doc,
    scripts: { ...scripts, 'local:box': BAD },
    execute,
  });
  check('a failing script adds no solid after a previous success',
    broke.runs['local:box'].ok === false
    && broke.runs['local:box'].mesh == null
    && !broke.solids.some((solid) => solid.id === 'local:box')
    && broke.solids.some((solid) => solid.id === 'local:wide')
    && broke.runs['local:box'].mesh !== both.runs['local:box'].mesh);
  const row = feedRows(doc, broke.runs, { ...scripts, 'local:box': BAD })
    .find((entry) => entry.id === 'local:box');
  check('the failed row is marked and carries no mesh',
    row.error === true && row.mesh == null);

  const removed = removePart(doc, 'local:box');
  const scriptsLeft = dropPartRecord(scripts, 'local:box');
  const listed = feedRows(removed, both.runs, scripts);
  const stillThere = composeViewportParts(removed, both.runs);
  check('a deleted part is not listed after a real run',
    !listed.some((entry) => entry.id === 'local:box')
    && listed.some((entry) => entry.id === 'local:wide')
    && listed.length === 1);
  check('a deleted part is not composed after a real run',
    !stillThere.some((solid) => solid.id === 'local:box')
    && stillThere.some((solid) => solid.id === 'local:wide')
    && stillThere[0].mesh.vertProperties.length > 0);
  const again = await runAssemblyParts({ doc: removed, scripts: scriptsLeft, execute });
  const againRows = feedRows(removed, again.runs, scriptsLeft);
  check('the next compose still omits the deleted part and keeps the other',
    !again.solids.some((solid) => solid.id === 'local:box')
    && again.solids.some((solid) => solid.id === 'local:wide')
    && !againRows.some((entry) => entry.id === 'local:box')
    && againRows.some((entry) => entry.id === 'local:wide'));
}


console.log('\nassembly leave guard');
{
  const blank = {
    source: 'local',
    name: DEFAULT_ASSEMBLY_NAME,
    activeId: 'p1',
    parts: [{ id: 'p1', name: DEFAULT_PART_NAME, visible: true, order: 0 }],
  };
  const starter = 'return Manifold.cube([1,1,1], true);';
  check('blank default is leave-safe',
    isDefaultBlankAssembly(blank, { p1: starter }, { defaultScripts: [starter] }));
  const legacyBlank = {
    ...blank,
    parts: [{ id: 'p1', name: 'Part 1', visible: true, order: 0 }],
  };
  check('a saved Part 1 is still the stock blank',
    isDefaultBlankAssembly(legacyBlank, { p1: starter }, { defaultScripts: [starter] }));
  check('new names use parentheses and skip a taken Part (n)',
    nextNumberedName('Part', []) === 'Part (1)'
    && nextNumberedName('Part', ['Part (1)']) === 'Part (2)'
    && nextNumberedName('Part', ['Part (1)', 'Part (2)']) === 'Part (3)'
    && nextNumberedName('Bracket', ['Bracket'], { bareFirst: true }) === 'Bracket (2)');
  check('blank skips leave guard',
    !needsAssemblyLeaveGuard(blank, {
      source: 'local', scripts: { p1: starter }, defaultScripts: [starter],
    }));
  const renamed = { ...blank, name: 'Gearbox' };
  check('renamed local needs leave guard',
    needsAssemblyLeaveGuard(renamed, {
      source: 'local', scripts: { p1: starter }, defaultScripts: [starter],
    }));
  check('git clean baseline is leave-safe',
    !needsAssemblyLeaveGuard(renamed, {
      source: 'git', sourceDirty: false, hasBaseline: true,
      scripts: { p1: starter }, defaultScripts: [starter],
    }));
  check('git dirty needs leave guard',
    needsAssemblyLeaveGuard(renamed, {
      source: 'git', sourceDirty: true, hasBaseline: true,
      scripts: { p1: starter }, defaultScripts: [starter],
    }));
}

if (failed) {
  console.log(`\n${failed} assembly check(s) failed`);
  process.exit(1);
}
console.log('\nAll assembly checks passed.');

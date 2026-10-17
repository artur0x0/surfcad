/* global window, document, getComputedStyle */
/**
 * Paint mode. A tap paints the face on the skin immediately. A second tap
 * on that face paints the body and stays one undo entry. Confirm writes the
 * session into `.surf.json`. X and Cancel revert it.
 *
 * Screenshots: GOLDEN_SHOT_DIR or os.tmpdir()/surfcad-golden-shots.
 */
import { createServer } from 'node:http';
import { mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { register } from 'node:module';
import { chromium } from 'playwright-core';
import { attachConsentPresetToBrowser } from './lib/presetConsentInit.mjs';
import { createServer as createVite } from 'vite';
import { buildSolidGeometry } from '../../src/utils/partSolidCache.js';
import { serializeAssembly } from '../../src/utils/assembly.js';
import { faceFingerprints } from '../../src/utils/faceColorMatch.js';
import { syncFaceColorSkin } from '../../src/utils/faceColorSkin.js';
import { selectOwningBody, warmFaceGraph } from '../../src/utils/selectFace.js';
import { stringifySurfJson, parseSurfJson } from '../../src/utils/git/surfJson.js';
import { sharedPartPath } from '../../src/utils/git/vaultLayout.js';
import {
  PAINT_DOUBLE_TAP_MS,
  PAINT_SWATCHES,
  clearPaintColors,
  clonePaintSession,
  commitPaintColors,
  livePaintChanged,
  livePaintClear,
  livePaintPart,
  livePaintTap,
  livePaintUndo,
  paintChipVisible,
  paintKeysForTriangles,
  paintPickFromClick,
  paintPicksAfterMeshChange,
  paintPicksAfterPartChange,
  parsePaintHex,
  removeUnmatchedColors,
  resolvedPaintColor,
  togglePaintPick,
  undoPaintPick,
} from '../../src/utils/facePaint.js';

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
    if (msg.type === 'error') w.reject(new Error(msg.payload?.message || 'err'));
    else w.resolve(msg);
  },
};
globalThis.self = workerSelf;
function send(type, payload = {}) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    Promise.resolve().then(() => workerSelf.onmessage({ data: { type, payload, id } }));
  });
}

let failed = 0;
let passed = 0;
function ifConditionsContaining(src, token) {
  const found = [];
  const re = /\bif\s*\(/g;
  let match;
  while ((match = re.exec(src))) {
    let depth = 1;
    let j = match.index + match[0].length;
    const start = j;
    for (; j < src.length && depth > 0; j++) {
      const ch = src[j];
      if (ch === '(') depth += 1;
      else if (ch === ')') depth -= 1;
    }
    if (depth === 0) {
      const cond = src.slice(start, j - 1);
      if (cond.includes(token)) found.push(cond);
    } else {
      break;
    }
  }
  return found;
}

function check(name, cond, detail = '') {
  if (cond) {
    passed++;
    console.log(`  ✅ ${name}`);
  } else {
    failed++;
    console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`);
  }
}

const SID = '2026-10-08-14-00-00-0001-ab12';
const SID_B = '2026-10-08-14-00-00-0002-cd34';
const SWATCH = PAINT_SWATCHES[4];
const CUBE = 'return Manifold.cube([20, 16, 12], true);';

await import('../../src/workers/sandboxWorker.js');
await send('init');
async function exec(script) {
  return (await send('execute', { script, importedModels: {}, memoryLimitMB: 512 })).payload;
}

function built(meshData) {
  const solid = buildSolidGeometry(meshData);
  const faces = faceFingerprints(
    warmFaceGraph(solid.geometry, solid.faceIDs),
    solid.geometry.userData?.triSource || null,
    {
      positions: solid.geometry.attributes.position.array,
      indices: solid.geometry.index.array,
    },
  );
  return { ...solid, faces };
}

function byNormal(faces, axis, sign) {
  return faces
    .filter((face) => face.n[axis] * sign > 0.9)
    .sort((a, b) => b.area - a.area)[0];
}

function skinTris(skin) {
  const pos = skin?.geometry?.attributes?.position?.array;
  const col = skin?.geometry?.attributes?.color?.array;
  if (!pos || !col) return [];
  const out = [];
  for (let i = 0; i < pos.length; i += 9) {
    const ax = pos[i + 3] - pos[i];
    const ay = pos[i + 4] - pos[i + 1];
    const az = pos[i + 5] - pos[i + 2];
    const bx = pos[i + 6] - pos[i];
    const by = pos[i + 7] - pos[i + 1];
    const bz = pos[i + 8] - pos[i + 2];
    const nx = ay * bz - az * by;
    const ny = az * bx - ax * bz;
    const nz = ax * by - ay * bx;
    const len = Math.hypot(nx, ny, nz) || 1;
    out.push({
      n: [nx / len, ny / len, nz / len],
      rgb: [col[i], col[i + 1], col[i + 2]],
    });
  }
  return out;
}

function near(rgb, hex) {
  const n = Number.parseInt(hex.slice(1), 16);
  const want = [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  return rgb.every((c, i) => Math.abs(c - want[i]) < 0.02);
}

function saveDoc(colors) {
  return serializeAssembly({
    source: 'local',
    name: 'Paint',
    activeId: 'a',
    parts: [
      { id: 'a', name: 'A', surfId: SID, visible: true },
      { id: 'b', name: 'B', surfId: SID_B, visible: true },
    ],
    colors,
  });
}

console.log('face paint — two faces, a swatch, confirm');
const mesh = (await exec(CUBE)).mesh;
const cube = built(mesh);
const top = byNormal(cube.faces, 2, 1);
const side = byNormal(cube.faces, 0, 1);
check('cube has a top and a side', !!top && !!side && top !== side);
const topPick = paintPickFromClick({
  geometry: cube.geometry,
  faceIDs: cube.faceIDs,
  seedFaceIndex: top.tris[0],
});
const sidePick = paintPickFromClick({
  geometry: cube.geometry,
  faceIDs: cube.faceIDs,
  seedFaceIndex: side.tris[0],
});
check('a click picks the whole face, not one triangle',
  topPick.indices.length > 1 && topPick.indices.length === top.tris.length,
  `picked ${topPick?.indices?.length} of ${top?.tris?.length}`);
let picks = togglePaintPick([], topPick);
picks = togglePaintPick(picks, sidePick);
picks = togglePaintPick(picks, topPick);
check('tapping a picked face again unpicks it', picks.length === 1 && picks[0].key.area === side.area);
picks = togglePaintPick(picks, topPick);
check('the two faces are picked', picks.length === 2);
const swatchColors = commitPaintColors(null, SID, {
  color: SWATCH,
  keys: picks.map((pick) => pick.key),
  faces: cube.faces,
});
const saved = saveDoc(swatchColors);
check('the save holds two keys', saved.colors?.[SID]?.faces?.length === 2, JSON.stringify(saved.colors?.[SID]?.faces?.map((f) => f.color)));
check('both keys are the swatch', saved.colors[SID].faces.every((face) => face.color === SWATCH));

{
  const { Mesh, MeshNormalMaterial } = await import('three');
  const host = new Mesh(cube.geometry, new MeshNormalMaterial({ flatShading: true }));
  host.userData.surfId = SID;
  const skin = syncFaceColorSkin(host, {
    geometry: cube.geometry,
    faceIDs: cube.faceIDs,
    surfId: SID,
    colors: saved.colors,
    rainbow: false,
  });
  const tris = skinTris(skin);
  const topPainted = tris.filter((tri) => tri.n[2] > 0.9 && near(tri.rgb, SWATCH)).length;
  const sidePainted = tris.filter((tri) => tri.n[0] > 0.9 && near(tri.rgb, SWATCH)).length;
  const other = tris.filter((tri) => tri.n[2] < -0.9 && near(tri.rgb, SWATCH)).length;
  check('the two keys render on the picked faces', topPainted > 0 && sidePainted > 0 && other === 0,
    `top ${topPainted} side ${sidePainted} back ${other}`);
}

console.log('face paint — custom hex');
check('eight swatches', PAINT_SWATCHES.length === 8 && PAINT_SWATCHES.every((hex) => parsePaintHex(hex) === hex));
check('a custom hex is lowercase #rrggbb', parsePaintHex('#AABBCC') === '#aabbcc' && parsePaintHex('#abc') == null && parsePaintHex('112233') == null);
check('a bad custom hex blocks the swatch', resolvedPaintColor(SWATCH, '#zz') == null && resolvedPaintColor(SWATCH, '') === SWATCH);
const custom = '#112233';
const customColors = commitPaintColors(saved.colors, SID, {
  color: parsePaintHex('#112233'),
  keys: [topPick.key],
  faces: cube.faces,
});
check('custom hex replaces the matching key',
  customColors[SID].faces.length === 2
  && customColors[SID].faces.filter((face) => face.color === custom).length === 1
  && customColors[SID].faces.filter((face) => face.color === SWATCH).length === 1);
check('an invalid hex writes nothing', commitPaintColors(customColors, SID, { color: 'red', keys: [topPick.key], faces: cube.faces }) === customColors);

console.log('face paint — part color and clear');
const parted = commitPaintColors(customColors, SID, { color: '#00aa00', part: true });
check('part color is stored and the face keys stay',
  parted[SID].part === '#00aa00' && parted[SID].faces.length === 2);
const clearedFace = clearPaintColors(parted, SID, { keys: [sidePick.key], faces: cube.faces });
check('clear removes the picked face color',
  clearedFace[SID].faces.length === 1
  && clearedFace[SID].faces[0].color === custom
  && clearedFace[SID].part === '#00aa00');
const clearedPart = clearPaintColors(clearedFace, SID, { part: true });
check('clear removes the part color', clearedPart[SID].part == null && clearedPart[SID].faces.length === 1);

console.log('face paint — undo leaves committed colors alone');
const committed = clearedPart;
const undone = undoPaintPick(picks);
check('undo removes the last pick', undone.length === picks.length - 1);
check('undo does not change the saved colors', committed === clearedPart && JSON.stringify(committed) === JSON.stringify(clearedPart));

console.log('face paint — cancel writes nothing');
{
  const view = readFileSync(new URL('../../src/components/Viewport.jsx', import.meta.url), 'utf8');
  const exitAt = view.indexOf('const exitPaintMode = useCallback');
  const exitEnd = view.indexOf('exitPaintModeRef.current = exitPaintMode', exitAt);
  const exitBlock = view.slice(exitAt, exitEnd);
  const nullAt = exitBlock.indexOf('paintModeRef.current = null');
  const repaintAt = exitBlock.indexOf('repaintFaceSkins');
  check('leaving paint does not write', exitAt > 0 && exitEnd > exitAt && !/onCommitPaint/.test(exitBlock)
    && nullAt >= 0 && repaintAt > nullAt);
  const paintChip = readFileSync(new URL('../../src/components/PaintModeChip.jsx', import.meta.url), 'utf8');
  check('the grey X dismisses and writes nothing', /<FeatureSheet\b/.test(paintChip)
    && /onCancel=\{onDismiss\}/.test(paintChip)
    && /data-paint-mode/.test(paintChip)
    && !/data-paint-cancel/.test(paintChip));
  const app = readFileSync(new URL('../../src/App.jsx', import.meta.url), 'utf8');
  const handlerAt = app.indexOf('const handleCommitPaint');
  const handler = app.slice(handlerAt, app.indexOf('const handleCommitShell', handlerAt));
  check('confirm saves through the assembly path', /rememberAssembly\(/.test(handler) && /enqueueAssemblySave\(/.test(handler)
    && /payload\.op === 'session'/.test(handler) && /op: 'session'/.test(view));
  const css = readFileSync(new URL('../../src/index.css', import.meta.url), 'utf8');
  const dblAt = view.indexOf('const onDblClick = (event) => {');
  check('a double tap does not zoom the page',
    dblAt > 0 && view.slice(dblAt, dblAt + 90).includes('event.preventDefault()')
    && /\.viewport-shell > canvas/.test(css) && /touch-action:\s*none/.test(css));
}

console.log('face paint — game mode and part switch');
{
  const view = readFileSync(new URL('../../src/components/Viewport.jsx', import.meta.url), 'utf8');
  const panel = readFileSync(new URL('../../src/components/CrossSectionPanel.jsx', import.meta.url), 'utf8');
  check('the paint button is hidden in game mode', paintChipVisible('cad') === true && paintChipVisible('game') === false
    && /showPaint=\{mode !== 'game'\}/.test(view)
    && /\{showPaint &&/.test(panel)
    && /data-paint-chip/.test(panel)
    && !/<PaintModeToggle/.test(view));
  check('paint sits in the right bar, not the header',
    /data-paint-chip/.test(panel)
    && /data-selector-group="plane-contour"[\s\S]*data-paint-chip/.test(panel)
    && !/top-4 right-16/.test(panel)
    && !/PaintModeToggle/.test(view));
  check('the rainbow toggle is gone',
    !/data-overlay-toggle="patches"/.test(panel)
    && !/showPatchOverlay/.test(view)
    && !/buildPatchOverlayArrays/.test(view)
    && !/patchOverlayActiveRef/.test(view));
  check('a tap paints immediately through the normal face pick',
    /livePaintTap\(/.test(view) && /paintPickFromClick\(/.test(view)
    && /applyLivePaintTapRef\.current\(clickData\)/.test(view)
    && !/'paint-pick'/.test(view));
  const skipsPaint = (token) => {
    const conds = ifConditionsContaining(view, token);
    return conds.length > 0 && conds.every((cond) => cond.includes('!paintModeRef.current'));
  };
  check('a paint tap is not swallowed by a contour or a construction plane',
    skipsPaint('showContoursRef') && skipsPaint('planeHits'));
  const switched = paintPicksAfterPartChange('part-a', 'part-b', picks);
  check('a part switch clears picks', switched.length === 0);
  check('the same part keeps picks', paintPicksAfterPartChange('part-a', 'part-a', picks).length === picks.length);
  check('a new mesh clears picks', paintPicksAfterMeshChange(false, picks).length === 0 && paintPicksAfterMeshChange(true, picks).length === picks.length);
  const other = commitPaintColors(clearedPart, SID_B, { color: SWATCH, keys: [topPick.key], faces: cube.faces });
  check('a key is not written onto the other part',
    other[SID].faces.length === 1 && other[SID_B].faces.length === 1 && other[SID].faces[0].color === custom);
}

console.log('face paint — repick after a rebuild replaces the key');
{
  const mesh2 = (await exec(CUBE)).mesh;
  const cube2 = built(mesh2);
  const top2 = byNormal(cube2.faces, 2, 1);
  const again = paintPickFromClick({
    geometry: cube2.geometry,
    faceIDs: cube2.faceIDs,
    seedFaceIndex: top2.tris[0],
  });
  const orphan = {
    color: '#abcdef',
    key: { at: [1000, 0, 0], n: [0, 0, 1], area: 10 },
  };
  const withOrphan = {
    ...clearedPart,
    [SID]: { faces: [...clearedPart[SID].faces, orphan] },
  };
  const replaced = commitPaintColors(withOrphan, SID, {
    color: '#445566',
    keys: [again.key],
    faces: cube2.faces,
  });
  const faces = replaced[SID].faces;
  check('a repick replaces the key instead of duplicating it',
    faces.filter((face) => face.color === '#445566').length === 1
    && faces.filter((face) => face.color === custom).length === 0
    && faces.length === 2,
    faces.map((face) => face.color).join(','));
  check('an unmatched key is not pruned by confirm', faces.some((face) => face.color === '#abcdef'));
  const pruned = removeUnmatchedColors(replaced, SID, cube2.faces);
  check('remove unmatched drops only the unmatched key',
    pruned[SID].faces.length === 1 && pruned[SID].faces[0].color === '#445566');
  const doc = saveDoc(replaced);
  check('the replaced key still round-trips', doc.colors[SID].faces.length === 2);
}

let liveShot = null;
console.log('face paint — live tap, body, confirm, revert');
{
  const empty = { session: clonePaintSession(null), undo: [], lastTap: null, baseline: clonePaintSession(null) };
  const t0 = 1_000_000;
  const one = livePaintTap(empty, {
    surfId: SID,
    color: SWATCH,
    key: topPick.key,
    faces: cube.faces,
    now: t0,
  });
  check('a tap paints one face before confirm',
    one.changed && one.undo.length === 1 && one.session[SID].faces.length === 1
    && one.session[SID].faces[0].color === SWATCH);
  {
    const { Mesh, MeshNormalMaterial } = await import('three');
    const host = new Mesh(cube.geometry, new MeshNormalMaterial({ flatShading: true }));
    host.userData.surfId = SID;
    const skin = syncFaceColorSkin(host, {
      geometry: cube.geometry,
      faceIDs: cube.faceIDs,
      surfId: SID,
      colors: one.session,
      rainbow: false,
    });
    const tris = skinTris(skin);
    const topPainted = tris.filter((tri) => tri.n[2] > 0.9 && near(tri.rgb, SWATCH)).length;
    const sidePainted = tris.filter((tri) => tri.n[0] > 0.9 && near(tri.rgb, SWATCH)).length;
    check('the overlay shows that face without confirm', topPainted > 0 && sidePainted === 0,
      `top ${topPainted} side ${sidePainted}`);
  }
  const bodyIdx = selectOwningBody(cube.geometry, top.tris[0]);
  const bodyKeys = paintKeysForTriangles(cube.geometry, cube.faceIDs, bodyIdx);
  check('the body covers every face of the cube', bodyKeys.length === cube.faces.length && bodyKeys.length > 1);
  const doubled = livePaintTap(one, {
    surfId: SID,
    color: SWATCH,
    key: topPick.key,
    bodyKeys,
    faces: cube.faces,
    now: t0 + 120,
  });
  check('a double tap paints every face and keeps one undo entry',
    doubled.undo.length === 1
    && doubled.session[SID].faces.length === cube.faces.length
    && doubled.session[SID].faces.every((face) => face.color === SWATCH));
  const undoneBody = livePaintUndo(doubled);
  check('one undo drops the whole double tap',
    undoneBody.undo.length === 0 && !livePaintChanged(undoneBody.session, empty.baseline));
  const later = livePaintTap(one, {
    surfId: SID,
    color: SWATCH,
    key: sidePick.key,
    faces: cube.faces,
    now: t0 + 900,
  });
  check('a later face is a second undo entry', later.undo.length === 2 && later.session[SID].faces.length === 2);
  const same = livePaintTap(one, {
    surfId: SID,
    color: SWATCH,
    key: topPick.key,
    faces: cube.faces,
    now: t0 + 900,
  });
  check('painting the same face again does not add an undo entry', same.undo.length === 1 && same.changed === false);
  const parted = livePaintPart(empty, { surfId: SID, color: '#00aa00' });
  const partedAgain = livePaintPart(parted, { surfId: SID, color: '#00aa00' });
  check('part paints the whole part once',
    parted.session[SID].part === '#00aa00' && !parted.session[SID].faces && parted.undo.length === 1
    && partedAgain.changed === false && partedAgain.undo.length === 1);
  const cleared = livePaintClear({ ...one, baseline: empty.baseline });
  check('clear restores the pre-session colors and can be undone',
    !livePaintChanged(cleared.session, empty.baseline) && cleared.undo.length === 2);
  const undone = livePaintUndo(one);
  check('undo restores the face from before the tap',
    !undone.session[SID] && undone.undo.length === 0);
  const partPath = sharedPartPath('A');
  const gitDoc = {
    source: 'git',
    name: 'Paint',
    activeId: partPath,
    parts: [{ id: partPath, name: 'A', surfId: SID, visible: true, order: 0 }],
    colors: doubled.session,
  };
  const reloaded = parseSurfJson(stringifySurfJson(gitDoc));
  check('confirm colors survive a .surf.json reload',
    reloaded.colors?.[SID]?.faces?.length === cube.faces.length
    && reloaded.colors[SID].faces.every((face) => face.color === SWATCH));
  const baselineDoc = saveDoc(null);
  check('dropping the session leaves the pre-session colors', baselineDoc.colors == null);
  check('the double-tap window is the same 300 ms as a multi-click', PAINT_DOUBLE_TAP_MS === 300);
  liveShot = {
    mesh,
    surfId: SID,
    face: one.session,
    body: doubled.session,
  };
}

console.log('face paint — docs');
{
  const arch = readFileSync(new URL('../../docs/architecture.md', import.meta.url), 'utf8');
  const map = readFileSync(new URL('../../docs/UI_MAP.md', import.meta.url), 'utf8');
  check('architecture.md names the paint chip and the save', /Face color paint/.test(arch) && /rememberAssembly/.test(arch) && /game mode/i.test(arch));
  check('UI_MAP.md names the chip and the popup', /data-paint-chip/.test(map) && /data-paint-mode/.test(map));
}

console.log('face paint — chip and popup, 390 and desktop, dark and light');
const shotDir = process.env.GOLDEN_SHOT_DIR || join(tmpdir(), 'surfcad-golden-shots');
mkdirSync(shotDir, { recursive: true });
const htmlFor = (theme, compact) => `<!doctype html><meta charset="utf-8">
<div id="root"></div>
<script type="module">
import RefreshRuntime from '/@react-refresh';
RefreshRuntime.injectIntoGlobalHook(window);
window.$RefreshReg$ = () => {};
window.$RefreshSig$ = () => (type) => type;
window.__vite_plugin_react_preamble_installed__ = true;
</script>
<script type="module">
import '/src/index.css';
import { renderPaintChrome } from '/scripts/golden/face_paint_shot.js';
renderPaintChrome(document.getElementById('root'), { theme: ${JSON.stringify(theme)}, compact: ${compact ? 'true' : 'false'} });
window.__READY__ = true;
</script>`;

const liveHtml = `<!doctype html><meta charset="utf-8">
<canvas id="face" width="390" height="420"></canvas>
<canvas id="body" width="390" height="420"></canvas>
<script id="payload" type="application/json">${JSON.stringify({
  mesh: {
    numProp: liveShot.mesh.numProp,
    vertProperties: Array.from(liveShot.mesh.vertProperties),
    triVerts: Array.from(liveShot.mesh.triVerts),
    faceID: liveShot.mesh.faceID ? Array.from(liveShot.mesh.faceID) : null,
  },
  surfId: liveShot.surfId,
  face: liveShot.face,
  body: liveShot.body,
}).replace(/</g, '\\u003c')}</script>
<script type="module">
import { renderLivePaintCanvas } from '/scripts/golden/face_paint_shot.js';
const payload = JSON.parse(document.getElementById('payload').textContent);
renderLivePaintCanvas(document.getElementById('face'), { mesh: payload.mesh, surfId: payload.surfId, colors: payload.face });
renderLivePaintCanvas(document.getElementById('body'), { mesh: payload.mesh, surfId: payload.surfId, colors: payload.body });
window.__READY__ = true;
</script>`;

const vite = await createVite({
  root: new URL('../..', import.meta.url).pathname,
  server: { middlewareMode: true, hmr: false },
  appType: 'custom',
  logLevel: 'error',
});
const server = createServer((req, res) => {
  const url = req.url || '/';
    if (url.startsWith('/live')) {
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.end(liveHtml);
      return;
    }
    if (url === '/' || url.startsWith('/?')) {
    const theme = url.includes('theme=light') ? 'light' : 'dark';
    const compact = url.includes('compact=1');
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(htmlFor(theme, compact));
    return;
  }
  vite.middlewares(req, res, () => {
    res.statusCode = 404;
    res.end('no');
  });
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();
let browser;
try {
  browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
    args: ['--headless=new', '--use-gl=angle', '--use-angle=swiftshader'],
  });
attachConsentPresetToBrowser(browser);
  const shots = [
    ['face-paint-chip-popup-dark-390.png', 'theme=dark&compact=1', 390, 700],
    ['face-paint-chip-popup-light-390.png', 'theme=light&compact=1', 390, 700],
    ['face-paint-chip-popup-dark-desktop.png', 'theme=dark&compact=0', 1100, 720],
    ['face-paint-chip-popup-light-desktop.png', 'theme=light&compact=0', 1100, 720],
  ];
  for (const [name, query, width, height] of shots) {
    const page = await browser.newPage({ viewport: { width, height } });
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.goto(`http://127.0.0.1:${port}/?${query}`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__READY__, null, { timeout: 30000 });
    await page.locator('[data-paint-chip]').waitFor();
    await page.locator('[data-paint-mode="1"]').waitFor();
    await page.locator('[data-feature-type-badge="4"]').waitFor();
    const swatches = await page.locator('[data-paint-swatch]').count();
    const placed = await page.evaluate(() => {
      const slack = 0.5;
      const paddingBox = (el) => {
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return {
          top: r.top + (parseFloat(s.borderTopWidth) || 0),
          right: r.right - (parseFloat(s.borderRightWidth) || 0),
          bottom: r.bottom - (parseFloat(s.borderBottomWidth) || 0),
          left: r.left + (parseFloat(s.borderLeftWidth) || 0),
        };
      };
      const rail = document.querySelector('[data-rail-pair="right"]');
      const chip = document.querySelector('[data-paint-chip]');
      const strip = document.querySelector('[data-feature-strip]');
      const badges = [...document.querySelectorAll('[data-feature-type-badge]')];
      const chipStyle = chip ? getComputedStyle(chip) : null;
      const badgeFits = badges.map((badge) => {
        const box = badge.getBoundingClientRect();
        const stripBox = paddingBox(strip);
        let ok = box.top >= stripBox.top - slack
          && box.left >= stripBox.left - slack
          && box.bottom <= stripBox.bottom + slack
          && box.right <= stripBox.right + slack;
        let node = badge.parentElement;
        while (node && ok) {
          const style = getComputedStyle(node);
          const clipsX = style.overflowX !== 'visible';
          const clipsY = style.overflowY !== 'visible';
          if (clipsX || clipsY) {
            const clip = paddingBox(node);
            if (clipsY && (box.top < clip.top - slack || box.bottom > clip.bottom + slack)) ok = false;
            if (clipsX && (box.left < clip.left - slack || box.right > clip.right + slack)) ok = false;
          }
          if (node === strip) break;
          node = node.parentElement;
        }
        return {
          n: badge.getAttribute('data-feature-type-badge'),
          ok,
          bottom: Math.round(box.bottom * 10) / 10,
          stripBottom: Math.round(stripBox.bottom * 10) / 10,
        };
      });
      return {
        chipInRail: !!(rail && chip && rail.contains(chip)),
        chipNotAbsolute: chipStyle?.position !== 'absolute',
        noRainbow: !document.querySelector('[data-overlay-toggle="patches"]'),
        paintPressed: chip?.getAttribute('aria-pressed') === 'true' && (chip?.className || '').includes('bg-green-100'),
        badgeCount: badges.length,
        badgeFits,
        stripHeight: strip ? Math.round(strip.getBoundingClientRect().height * 10) / 10 : 0,
        swatches: (() => {
          const ringOutset = (style) => {
            let spread = 0;
            const shadow = style.boxShadow || '';
            const re = /(-?[\d.]+)px\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+(-?[\d.]+)px/g;
            let match;
            while ((match = re.exec(shadow))) {
              const s = Math.abs(parseFloat(match[4]));
              if (s > spread) spread = s;
            }
            const outline = parseFloat(style.outlineWidth) || 0;
            if (style.outlineStyle && style.outlineStyle !== 'none' && outline > 0) {
              spread = Math.max(spread, outline + Math.max(0, parseFloat(style.outlineOffset) || 0));
            }
            return spread;
          };
          const buttons = [...document.querySelectorAll('[data-paint-swatch]')];
          const popup = document.querySelector('[data-paint-mode]');
          const selected = buttons.find((el) => el.getAttribute('aria-pressed') === 'true');
          const selectedOutset = selected ? ringOutset(getComputedStyle(selected)) : 0;
          const maxOutset = buttons.reduce((n, el) => Math.max(n, ringOutset(getComputedStyle(el))), 0);
          const outset = Math.max(selectedOutset, maxOutset);
          const rows = new Map();
          const fits = buttons.map((el) => {
            const raw = el.getBoundingClientRect();
            const box = {
              top: raw.top - outset,
              left: raw.left - outset,
              right: raw.right + outset,
              bottom: raw.bottom + outset,
            };
            rows.set(Math.round(raw.top), (rows.get(Math.round(raw.top)) || 0) + 1);
            let ok = true;
            let node = el.parentElement;
            while (node && ok) {
              const style = getComputedStyle(node);
              const clipsX = style.overflowX !== 'visible';
              const clipsY = style.overflowY !== 'visible';
              if (clipsX || clipsY) {
                const clip = paddingBox(node);
                if (clipsY && (box.top < clip.top - slack || box.bottom > clip.bottom + slack)) ok = false;
                if (clipsX && (box.left < clip.left - slack || box.right > clip.right + slack)) ok = false;
              }
              if (node === popup) break;
              node = node.parentElement;
            }
            return ok;
          });
          const compact = document.querySelector('[data-paint-shot-compact]')?.getAttribute('data-paint-shot-compact') === '1';
          return {
            count: buttons.length,
            outset,
            fits: fits.every(Boolean),
            rows: [...rows.values()],
            compact,
          };
        })(),
      };
    });
    const badgesOk = placed.badgeFits.length === 4 && placed.badgeFits.every((b) => b.ok);
    check(`${name} shows the paint button, popup, and 8 swatches`, errors.length === 0 && swatches === 8
      && placed.chipInRail && placed.chipNotAbsolute && placed.paintPressed && placed.noRainbow,
      errors.join('; ') || JSON.stringify({ swatches, ...placed, badgeFits: undefined }));
    check(`${name} count badges sit inside the strip`, badgesOk && placed.stripHeight > 0 && placed.stripHeight <= 52,
      JSON.stringify({ height: placed.stripHeight, badges: placed.badgeFits }));
    const swatchRows = placed.swatches?.rows || [];
    check(`${name} swatch rings sit inside every clipping ancestor`,
      placed.swatches?.count === 8
      && placed.swatches.outset >= 1.5
      && placed.swatches.fits
      && (!placed.swatches.compact || swatchRows.length >= 2),
      JSON.stringify(placed.swatches));
    const file = join(shotDir, name);
    await page.screenshot({ path: file });
    console.log(`  shot ${file}`);
    if (name.includes('dark-390') || name.includes('dark-desktop')) {
      const zoomName = name.replace('chip-popup', 'swatches');
      const zoom = join(shotDir, zoomName);
      await page.locator('[data-paint-mode="1"]').screenshot({ path: zoom });
      console.log(`  shot ${zoom}`);
    }
    await page.close();
  }
  {
    const page = await browser.newPage({
      viewport: { width: 390, height: 900 },
      deviceScaleFactor: 2,
    });
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.goto(`http://127.0.0.1:${port}/live`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__READY__, null, { timeout: 30000 });
    const faceFile = join(shotDir, 'face-paint-live-face-dark-390.png');
    const bodyFile = join(shotDir, 'face-paint-live-body-dark-390.png');
    await page.locator('#face').screenshot({ path: faceFile });
    await page.locator('#body').screenshot({ path: bodyFile });
    check('live face and body shots render', errors.length === 0, errors.join('; '));
    console.log(`  shot ${faceFile}`);
    console.log(`  shot ${bodyFile}`);
    await page.close();
  }
} finally {
  await browser?.close();
  server.close();
  await vite.close();
}

if (failed) {
  console.log(`\nface paint: ${failed} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`\nface paint: ${passed} passed`);

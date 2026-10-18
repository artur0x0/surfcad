/* global window */
/**
 * Lit face-color skin. A saved color paints the matched face only.
 * Missing and ambiguous keys draw nothing. The skin does not take picks,
 * and it is disposed with the part. The debug rainbow stays off.
 * A face-on view matches the swatch. A whole-body paint shades.
 *
 * Screenshots: GOLDEN_SHOT_DIR or os.tmpdir()/surfcad-golden-shots.
 */
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { register } from 'node:module';
import { Mesh, MeshNormalMaterial, Raycaster, Vector3 } from 'three';
import { chromium } from 'playwright-core';
import { attachConsentPresetToBrowser } from './lib/presetConsentInit.mjs';
import { createServer as createVite } from 'vite';
import { buildSolidGeometry } from '../../src/utils/partSolidCache.js';
import { faceFingerprints, faceColorKey } from '../../src/utils/faceColorMatch.js';
import { warmFaceGraph } from '../../src/utils/selectFace.js';
import {
  syncFaceColorSkin,
  detachFaceColorSkin,
  readFaceColorDebugFlag,
  colorsAreEmpty,
  FACE_SKIN_RENDER_ORDER,
  FACE_HIGHLIGHT_RENDER_ORDER,
} from '../../src/utils/faceColorSkin.js';

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
function check(name, cond, detail = '') {
  if (cond) {
    passed++;
    console.log(`  ✅ ${name}`);
  } else {
    failed++;
    console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`);
  }
}

await import('../../src/workers/sandboxWorker.js');
await send('init');
async function exec(script) {
  return (await send('execute', { script, importedModels: {}, memoryLimitMB: 512 })).payload;
}

function hostOf(meshData, surfId) {
  const solid = buildSolidGeometry(meshData);
  const host = new Mesh(solid.geometry, new MeshNormalMaterial({ flatShading: true }));
  host.userData.surfId = surfId;
  return { host, faceIDs: solid.faceIDs, geometry: solid.geometry };
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
      at: [
        (pos[i] + pos[i + 3] + pos[i + 6]) / 3,
        (pos[i + 1] + pos[i + 4] + pos[i + 7]) / 3,
        (pos[i + 2] + pos[i + 5] + pos[i + 8]) / 3,
      ],
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

function topKey(meshData) {
  const { geometry, faceIDs } = buildSolidGeometry(meshData);
  const graph = warmFaceGraph(geometry, faceIDs);
  const faces = faceFingerprints(graph, geometry.userData.triSource || null, {
    positions: geometry.attributes.position.array,
    indices: geometry.index.array,
  });
  const top = faces.filter((face) => face.n[2] > 0.99).sort((a, b) => b.at[2] - a.at[2])[0];
  return { key: faceColorKey(top), faces };
}

console.log('face skin — one face');
let shotMesh = null;
let shotKey = null;
{
  const mesh = (await exec('return Manifold.cube([20, 16, 12], true);')).mesh;
  shotMesh = mesh;
  const { key } = topKey(mesh);
  shotKey = key;
  const { host, faceIDs } = hostOf(mesh, 'part-a');
  const colors = { 'part-a': { faces: [{ color: '#ff0000', key }] } };
  const before = JSON.stringify(colors);
  const skin = syncFaceColorSkin(host, { geometry: host.geometry, faceIDs, surfId: 'part-a', colors, rainbow: false });
  check('a saved face color builds a skin', !!skin && skin.name === 'face-color-skin');
  check('the skin is lit and does not write depth',
    skin?.material?.type === 'MeshStandardMaterial'
    && skin.material.vertexColors === true
    && skin.material.toneMapped === false
    && skin.material.depthWrite === false
    && skin.material.depthTest === true
    && skin.material.polygonOffset === true
    && skin.material.polygonOffsetFactor === -1
    && skin.material.polygonOffsetUnits === -2
    && skin.material.metalness === 0
    && skin.material.roughness === 1
    && skin.material.flatShading === true
    && skin.renderOrder === FACE_SKIN_RENDER_ORDER);
  check('the skin does not raycast', skin?.raycast !== Mesh.prototype.raycast);
  const tris = skinTris(skin);
  const reds = tris.filter((tri) => near(tri.rgb, '#ff0000'));
  const others = tris.filter((tri) => !near(tri.rgb, '#ff0000'));
  check('only the matched face is painted', reds.length > 0 && others.length === 0 && reds.every((tri) => tri.n[2] > 0.9),
    `red=${reds.length} other=${others.length}`);
  check('painting does not rewrite the saved keys', JSON.stringify(colors) === before);

  const ray = new Raycaster();
  ray.set(new Vector3(0, 0, 40), new Vector3(0, 0, -1));
  const bareHost = hostOf(mesh, 'part-a').host;
  const bareHits = ray.intersectObject(bareHost, true);
  const deep = ray.intersectObject(host, true);
  const flat = ray.intersectObject(host, false);
  check('a ray hits the same face with the skin on',
    deep.length === bareHits.length
    && deep.every((hit) => hit.object === host)
    && flat[0]?.faceIndex === bareHits[0]?.faceIndex
    && deep[0]?.faceIndex === bareHits[0]?.faceIndex,
    `deep=${deep.length} bare=${bareHits.length} face=${deep[0]?.faceIndex}`);
}

console.log('face skin — part color and a face override');
{
  const mesh = (await exec('return Manifold.cube([20, 16, 12], true);')).mesh;
  const { key } = topKey(mesh);
  const { host, faceIDs } = hostOf(mesh, 'part-a');
  const colors = { 'part-a': { part: '#2244aa', faces: [{ color: '#ff0000', key }] } };
  const skin = syncFaceColorSkin(host, { geometry: host.geometry, faceIDs, surfId: 'part-a', colors, rainbow: false });
  const tris = skinTris(skin);
  const reds = tris.filter((tri) => near(tri.rgb, '#ff0000') && tri.n[2] > 0.9);
  const blues = tris.filter((tri) => near(tri.rgb, '#2244aa'));
  check('the part color fills the other faces', blues.length > 0 && blues.every((tri) => tri.n[2] < 0.5));
  check('the face color sits on the part color', reds.length > 0 && tris.length === reds.length + blues.length);
}

console.log('face skin — missing and ambiguous');
{
  const mesh = (await exec('return Manifold.cube([20, 16, 12], true);')).mesh;
  const { host, faceIDs } = hostOf(mesh, 'part-a');
  const colors = {
    'part-a': { faces: [{ color: '#00ff00', key: { at: [0, 0, 80], n: [0, 0, 1], area: 320 } }] },
  };
  let threw = false;
  let skin = null;
  try {
    skin = syncFaceColorSkin(host, { geometry: host.geometry, faceIDs, surfId: 'part-a', colors, rainbow: false });
  } catch {
    threw = true;
  }
  check('a missing key draws nothing and does not throw', !threw && skin == null && !host.userData.faceColorSkin);

  const { host: ambHost, faceIDs: ambIds, geometry: ambGeom } = hostOf(mesh, 'part-a');
  const ambGraph = warmFaceGraph(ambGeom, ambIds);
  const ambFaces = faceFingerprints(ambGraph, ambGeom.userData.triSource || null, {
    positions: ambGeom.attributes.position.array,
    indices: ambGeom.index.array,
  });
  const side = ambFaces.find((face) => face.n[0] > 0.9);
  const twin = {
    ...side,
    id: side.id + 100,
    at: [side.at[0] - 0.4, side.at[1], side.at[2]],
    tris: side.tris,
  };
  const ambiguous = {
    'part-a': { faces: [{ color: '#ff00ff', key: faceColorKey(side) }] },
  };
  let ambThrew = false;
  let ambSkin = null;
  try {
    ambSkin = syncFaceColorSkin(ambHost, {
      geometry: ambGeom,
      faceIDs: ambIds,
      surfId: 'part-a',
      colors: ambiguous,
      rainbow: false,
      faces: [side, twin],
    });
  } catch {
    ambThrew = true;
  }
  const magentas = skinTris(ambSkin).filter((tri) => near(tri.rgb, '#ff00ff'));
  check('an ambiguous key draws nothing and does not throw', !ambThrew && magentas.length === 0 && ambSkin == null,
    `threw=${ambThrew} magenta=${magentas.length}`);
}

console.log('face skin — a small rebuild keeps the color');
{
  const before = (await exec('return Manifold.cube([20, 16, 12], true);')).mesh;
  const after = (await exec('return Manifold.cube([20.5, 16.5, 12.5], true);')).mesh;
  const { key } = topKey(before);
  const { host, faceIDs } = hostOf(after, 'part-a');
  const skin = syncFaceColorSkin(host, {
    geometry: host.geometry,
    faceIDs,
    surfId: 'part-a',
    colors: { 'part-a': { faces: [{ color: '#ff0000', key }] } },
    rainbow: false,
  });
  const reds = skinTris(skin).filter((tri) => near(tri.rgb, '#ff0000'));
  check('growing the box 0.5 mm keeps the face color', reds.length > 0 && reds.every((tri) => tri.n[2] > 0.9),
    `red=${reds.length}`);
}

console.log('face skin — two parts');
{
  const mesh = (await exec('return Manifold.cube([20, 16, 12], true);')).mesh;
  const { key } = topKey(mesh);
  const a = hostOf(mesh, 'part-a');
  const b = hostOf(mesh, 'part-b');
  const colors = {
    'part-a': { faces: [{ color: '#ff0000', key }] },
    'part-b': { faces: [{ color: '#00ff00', key }] },
  };
  const skinA = syncFaceColorSkin(a.host, { geometry: a.geometry, faceIDs: a.faceIDs, surfId: 'part-a', colors, rainbow: false });
  const skinB = syncFaceColorSkin(b.host, { geometry: b.geometry, faceIDs: b.faceIDs, surfId: 'part-b', colors, rainbow: false });
  const redOnB = skinTris(skinB).filter((tri) => near(tri.rgb, '#ff0000')).length;
  const greenOnA = skinTris(skinA).filter((tri) => near(tri.rgb, '#00ff00')).length;
  check('part A stays red and part B stays green',
    skinTris(skinA).every((tri) => near(tri.rgb, '#ff0000'))
    && skinTris(skinB).every((tri) => near(tri.rgb, '#00ff00'))
    && redOnB === 0 && greenOnA === 0);
}

console.log('face skin — dispose and the debug flag');
{
  const mesh = (await exec('return Manifold.cube([20, 16, 12], true);')).mesh;
  const { key } = topKey(mesh);
  const { host, faceIDs } = hostOf(mesh, 'part-a');
  const skin = syncFaceColorSkin(host, {
    geometry: host.geometry,
    faceIDs,
    surfId: 'part-a',
    colors: { 'part-a': { faces: [{ color: '#ff0000', key }] } },
    rainbow: false,
  });
  let geomDisposed = false;
  let matDisposed = false;
  skin.geometry.addEventListener('dispose', () => { geomDisposed = true; });
  skin.material.addEventListener('dispose', () => { matDisposed = true; });
  detachFaceColorSkin(host);
  check('delete drops the skin geometry and material',
    geomDisposed && matDisposed && !host.userData.faceColorSkin && host.children.length === 0);

  const parked = hostOf(mesh, 'part-a');
  syncFaceColorSkin(parked.host, {
    geometry: parked.geometry,
    faceIDs: parked.faceIDs,
    surfId: 'part-a',
    colors: { 'part-a': { part: '#112233' } },
    rainbow: false,
  });
  check('a parked part has a skin to drop on switch', !!parked.host.userData.faceColorSkin);
  detachFaceColorSkin(parked.host);
  check('switch dispose leaves no skin', !parked.host.userData.faceColorSkin);

  check('rainbow is off with no flag', readFaceColorDebugFlag() === false && readFaceColorDebugFlag({
    location: { search: '' },
    localStorage: { getItem: () => null },
  }) === false);
  check('?debugFaces=1 turns the rainbow on', readFaceColorDebugFlag({
    location: { search: '?debugFaces=1' },
    localStorage: { getItem: () => null },
  }) === true);
  check('localStorage surfcad.debugFaces turns it on', readFaceColorDebugFlag({
    location: { search: '' },
    localStorage: { getItem: (k) => (k === 'surfcad.debugFaces' ? '1' : null) },
  }) === true);
  const plain = hostOf(mesh, 'part-a');
  const quiet = syncFaceColorSkin(plain.host, {
    geometry: plain.geometry,
    faceIDs: plain.faceIDs,
    surfId: 'part-a',
    colors: null,
    rainbow: false,
  });
  check('no colors and no flag draws nothing', quiet == null && colorsAreEmpty(null));
  const rainbowHost = hostOf(mesh, 'part-a');
  const rainbow = syncFaceColorSkin(rainbowHost.host, {
    geometry: rainbowHost.geometry,
    faceIDs: rainbowHost.faceIDs,
    surfId: 'part-a',
    colors: null,
    rainbow: true,
  });
  const hues = new Set(skinTris(rainbow).map((tri) => tri.rgb.map((c) => c.toFixed(3)).join(',')));
  check('the flag paints each patch a different color', hues.size >= 6, `hues=${hues.size}`);
}

console.log('face skin — fillet skin cost, after the face graph');
{
  const mesh = (await exec(`
    const part = Manifold.cube([40, 24, 16], true);
    const vertical = convexEdges(part).filter((e) => Math.abs(e.tangent[2]) > 0.99);
    return filletEdges(part, vertical, 2, { sphericalCorners: false });
  `)).mesh;
  const { host, faceIDs, geometry } = hostOf(mesh, 'fillet');
  warmFaceGraph(geometry, faceIDs);
  const t0 = Date.now();
  const skin = syncFaceColorSkin(host, {
    geometry,
    faceIDs,
    surfId: 'fillet',
    colors: { fillet: { part: '#335577' } },
    rainbow: false,
  });
  const ms = Date.now() - t0;
  const tris = Math.floor((skin?.geometry?.attributes?.position?.count || 0) / 3);
  console.log(`  skin ${ms} ms, ${tris} triangles`);
  check('fillet skin builds', tris > 100);
  check('fillet skin stays under 50 ms once the graph exists', ms < 50, `${ms} ms`);
}

console.log('face skin — wiring');
{
  const view = readFileSync(new URL('../../src/components/Viewport.jsx', import.meta.url), 'utf8');
  const panel = readFileSync(new URL('../../src/components/CrossSectionPanel.jsx', import.meta.url), 'utf8');
  check('viewport paints the skin after a run', /applyFaceSkinRef\.current\(resultRef\.current\)/.test(view));
  check('viewport drops the skin when a part leaves', /detachFaceColorSkin\(mesh\)/.test(view) && /detachFaceColorSkin\(extra\)/.test(view));
  check('highlights render above the skin', new RegExp(`FACE_HIGHLIGHT_RENDER_ORDER`).test(view) && FACE_HIGHLIGHT_RENDER_ORDER > FACE_SKIN_RENDER_ORDER);
  check('the rainbow is not a rail button', !/debugFaces/.test(panel));
  const arch = readFileSync(new URL('../../docs/architecture.md', import.meta.url), 'utf8');
  const map = readFileSync(new URL('../../docs/ui-map.md', import.meta.url), 'utf8');
  check('architecture.md names the skin order', /Face color skin/.test(arch) && /render order 2/.test(arch));
  check('ui-map.md names the debug flag', /debugFaces=1/.test(map) && /surfcad\.debugFaces/.test(map));
}

console.log('face skin — pixels, 390 px, dark and light');
const shotDir = process.env.GOLDEN_SHOT_DIR || join(tmpdir(), 'surfcad-golden-shots');
mkdirSync(shotDir, { recursive: true });
const html = `<!doctype html><meta charset="utf-8">
<canvas id="c" width="390" height="520"></canvas>
<script id="payload" type="application/json">${JSON.stringify({
  mesh: {
    numProp: shotMesh.numProp,
    vertProperties: Array.from(shotMesh.vertProperties),
    triVerts: Array.from(shotMesh.triVerts),
    faceID: shotMesh.faceID ? Array.from(shotMesh.faceID) : null,
  },
  surfId: 'part-a',
  colors: { 'part-a': { faces: [{ color: '#ff0000', key: shotKey }] } },
}).replace(/</g, '\\u003c')}</script>
<script type="module">
import { renderFaceSkinShots } from '/scripts/golden/face_skin_shot.js';
const payload = JSON.parse(document.getElementById('payload').textContent);
window.__RESULT__ = renderFaceSkinShots(document.getElementById('c'), payload);
</script>`;

const vite = await createVite({
  root: new URL('../..', import.meta.url).pathname,
  server: { middlewareMode: true, hmr: false },
  appType: 'custom',
  logLevel: 'error',
});
const server = createServer((req, res) => {
  const url = req.url || '/';
  if (url === '/' || url.startsWith('/?')) {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(html);
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
  const page = await browser.newPage({ viewport: { width: 390, height: 520 } });
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__RESULT__, null, { timeout: 30000 });
  const result = await page.evaluate(() => window.__RESULT__);
  check('page rendered', errors.length === 0, errors.join('; '));
  check('canvas skin is lit and keeps the depth offset',
    result.material?.type === 'MeshStandardMaterial'
    && result.material.toneMapped === false
    && result.material.depthWrite === false
    && result.material.polygonOffset === true
    && result.material.polygonOffsetFactor === -1
    && result.material.polygonOffsetUnits === -2
    && result.material.metalness === 0
    && result.material.roughness === 1,
    JSON.stringify(result.material));
  check('before, dark ground has no red face', result.beforeDark.red < 20, `red=${result.beforeDark.red}`);
  check('before, light ground has no red face', result.beforeLight.red < 20, `red=${result.beforeLight.red}`);
  check('after, dark ground paints the red face', result.afterDark.red > 200, `red=${result.afterDark.red}`);
  check('after, light ground paints the red face', result.afterLight.red > 200, `red=${result.afterLight.red}`);
  const gap = Math.abs(result.afterDark.r - result.afterLight.r)
    + Math.abs(result.afterDark.g - result.afterLight.g)
    + Math.abs(result.afterDark.b - result.afterLight.b);
  check('the red reads the same in both themes', gap < 12 && result.afterDark.r > 160 && result.afterLight.r > 160,
    `dark ${result.afterDark.r.toFixed(0)},${result.afterDark.g.toFixed(0)},${result.afterDark.b.toFixed(0)} light ${result.afterLight.r.toFixed(0)},${result.afterLight.g.toFixed(0)},${result.afterLight.b.toFixed(0)}`);
  const swatchDelta = (sample, hex) => {
    const n = Number.parseInt(hex.slice(1), 16);
    const want = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    return Math.max(
      Math.abs(sample.r - want[0]),
      Math.abs(sample.g - want[1]),
      Math.abs(sample.b - want[2]),
    );
  };
  const redDelta = swatchDelta(result.faceOnRed, '#ff0000');
  const midDelta = swatchDelta(result.faceOnMid, '#2244aa');
  check('a face-on red matches the swatch', redDelta <= 8 && result.faceOnRed.n > 50,
    `delta=${redDelta.toFixed(1)} rgb=${result.faceOnRed.r.toFixed(0)},${result.faceOnRed.g.toFixed(0)},${result.faceOnRed.b.toFixed(0)} n=${result.faceOnRed.n}`);
  check('a face-on midtone matches the swatch', midDelta <= 8 && result.faceOnMid.n > 50,
    `delta=${midDelta.toFixed(1)} rgb=${result.faceOnMid.r.toFixed(0)},${result.faceOnMid.g.toFixed(0)},${result.faceOnMid.b.toFixed(0)} n=${result.faceOnMid.n}`);
  check('a face-on paint is not striped', result.faceOnRed.stripe < 8 && result.faceOnMid.stripe < 8,
    `red=${result.faceOnRed.stripe.toFixed(2)} mid=${result.faceOnMid.stripe.toFixed(2)}`);
  const lum = (sample) => 0.2126 * sample.r + 0.7152 * sample.g + 0.0722 * sample.b;
  const lumGap = Math.abs(lum(result.body.bright) - lum(result.body.dark));
  check('two faces of a whole-body paint differ in luminance', lumGap >= 15 && result.body.bright.n > 20 && result.body.dark.n > 20,
    `gap=${lumGap.toFixed(1)} bright=${result.body.bright.r.toFixed(0)},${result.body.bright.g.toFixed(0)},${result.body.bright.b.toFixed(0)} dark=${result.body.dark.r.toFixed(0)},${result.body.dark.g.toFixed(0)},${result.body.dark.b.toFixed(0)}`);
  console.log(`  face-on red ${result.faceOnRed.r.toFixed(1)},${result.faceOnRed.g.toFixed(1)},${result.faceOnRed.b.toFixed(1)} delta ${redDelta.toFixed(2)} stripe ${result.faceOnRed.stripe.toFixed(2)}`);
  console.log(`  face-on mid ${result.faceOnMid.r.toFixed(1)},${result.faceOnMid.g.toFixed(1)},${result.faceOnMid.b.toFixed(1)} delta ${midDelta.toFixed(2)} stripe ${result.faceOnMid.stripe.toFixed(2)}`);
  console.log(`  body lum gap ${lumGap.toFixed(1)} bright ${result.body.bright.r.toFixed(0)},${result.body.bright.g.toFixed(0)},${result.body.bright.b.toFixed(0)} dark ${result.body.dark.r.toFixed(0)},${result.body.dark.g.toFixed(0)},${result.body.dark.b.toFixed(0)}`);
  const save = (name, row) => {
    if (!row?.png) return;
    const file = join(shotDir, name);
    writeFileSync(file, Buffer.from(row.png.split(',')[1], 'base64'));
    console.log(`  shot ${file}`);
  };
  save('face-skin-before-dark-390.png', result.beforeDark);
  save('face-skin-after-dark-390.png', result.afterDark);
  save('face-skin-before-light-390.png', result.beforeLight);
  save('face-skin-after-light-390.png', result.afterLight);
  save('face-skin-body-dark-390.png', result.body);
  save('face-skin-faceon-red-390.png', result.faceOnRed);
} finally {
  await browser?.close();
  server.close();
  await vite.close();
}

if (failed) {
  console.log(`\nface skin: ${failed} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`\nface skin: ${passed} passed`);

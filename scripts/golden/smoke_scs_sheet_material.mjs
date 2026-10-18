#!/usr/bin/env node
/* global window */
/**
 * Sheet-metal faces are light gray metal, not the near-black Lambert overlay.
 * Samples a real WebGL canvas on a dark and a light ground, and checks the
 * orange bend handles and the face highlight still read.
 * Screenshots: GOLDEN_SHOT_DIR or os.tmpdir()/surfcad-golden-shots.
 */
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { attachConsentPresetToBrowser } from './lib/presetConsentInit.mjs';
import { createServer as createVite } from 'vite';
import { joinScsCatalog, findScsSku } from '../../src/utils/scs/scsCatalog.js';
import { createSheetSpec } from '../../src/utils/sheetMetal/sheetModel.js';
import { sheetMetalBlock } from '../../src/utils/sheetMetal/sheetMetalScript.js';
import {
  makeSheetMetalMaterial,
  SHEET_HEADLIGHT_INTENSITY,
  SHEET_METAL_COLOR,
  SHEET_METAL_METALNESS,
  SHEET_METAL_ROUGHNESS,
} from '../../src/utils/sheetMetal/sheetMaterial.js';
import { DoubleSide } from 'three';
import { loadSandbox } from './scs_sandbox.mjs';

const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');
const fixture = (name) => JSON.parse(read(`scripts/golden/fixtures/scs/${name}.json`));

let failed = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`);
  }
}

function winding(mesh) {
  const np = mesh.numProp || 3;
  const src = mesh.vertProperties;
  const tris = mesh.triVerts;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  let n = 0;
  for (let i = 0; i < src.length; i += np) {
    cx += src[i];
    cy += src[i + 1];
    cz += src[i + 2];
    n++;
  }
  cx /= n;
  cy /= n;
  cz /= n;
  let outward = 0;
  let inward = 0;
  for (let t = 0; t < tris.length; t += 3) {
    const ia = tris[t] * np;
    const ib = tris[t + 1] * np;
    const ic = tris[t + 2] * np;
    const ax = src[ia];
    const ay = src[ia + 1];
    const az = src[ia + 2];
    const bx = src[ib];
    const by = src[ib + 1];
    const bz = src[ib + 2];
    const cx2 = src[ic];
    const cy2 = src[ic + 1];
    const cz2 = src[ic + 2];
    const nx = (by - ay) * (cz2 - az) - (bz - az) * (cy2 - ay);
    const ny = (bz - az) * (cx2 - ax) - (bx - ax) * (cz2 - az);
    const nz = (bx - ax) * (cy2 - ay) - (by - ay) * (cx2 - ax);
    if (Math.hypot(nx, ny, nz) < 1e-8) continue;
    const mx = (ax + bx + cx2) / 3 - cx;
    const my = (ay + by + cy2) / 3 - cy;
    const mz = (az + bz + cz2) / 3 - cz;
    if (nx * mx + ny * my + nz * mz > 0) outward++;
    else inward++;
  }
  return { outward, inward };
}

console.log('sheet material — factory');
{
  const mat = makeSheetMetalMaterial();
  check('MeshStandardMaterial', mat.type === 'MeshStandardMaterial' && mat.userData.sheetMetal === true);
  check('light gray #c8ccd2', mat.color.getHex() === SHEET_METAL_COLOR && SHEET_METAL_COLOR === 0xc8ccd2);
  check('metalness ~0.35, roughness ~0.45', mat.metalness === SHEET_METAL_METALNESS
    && mat.metalness >= 0.3 && mat.metalness <= 0.4
    && mat.roughness === SHEET_METAL_ROUGHNESS && Math.abs(mat.roughness - 0.45) < 1e-6);
  check('both sides, flat', mat.side === DoubleSide && mat.flatShading === true);
  check('camera headlight is in the shader', typeof mat.onBeforeCompile === 'function'
    && /sheetHeadlight/.test(String(mat.onBeforeCompile))
    && typeof mat.customProgramCacheKey === 'function'
    && SHEET_HEADLIGHT_INTENSITY >= 1);
}

console.log('sheet material — wiring');
{
  const view = read('src/components/Viewport.jsx');
  const preview = read('src/utils/partPreview.js');
  const overlay = read('src/utils/sheetMetal/sheetOverlay.js');
  const runtime = read('src/lib/surfcad/runtime.js');
  check('viewport uses the sheet material for sheet meshes', /ensureBodyMaterial\(resultRef\.current, meshData, materialsRef\.current\)/.test(view));
  check('assembly parts use it too', /ensureBodyMaterial\(mesh, meshData\)/.test(view)
    && /ensureBodyMaterial\(mesh, solid\.mesh\)/.test(view));
  check('ordinary bodies use the off-white part material',
    /makeDefaultPartMaterial\(\)/.test(view)
    && /export const DEFAULT_PART_COLOR = 0xeceae4/.test(read('src/utils/partMaterial.js'))
    && !/new MeshNormalMaterial\(\{ flatShading: true \}\)/.test(view));
  check('face highlight stays unlit', /const highlightMesh = new ThreeMesh\(highlightGeometry, new MeshBasicMaterial\(\{/.test(view));
  check('thumbnails share the material path', /ensureBodyMaterial\(body, mesh, normalMaterial\)/.test(preview));
  check('overlay panels use the sheet material, draft stays unlit', /makeSheetMetalMaterial\(\)/.test(overlay)
    && /new MeshBasicMaterial\(\{[\s\S]{0,180}color: COLORS\.draft/.test(overlay)
    && !/MeshLambertMaterial/.test(overlay));
  check('worker tags sheet meshes', /markSheetMesh\(serializeResult\(result\), script\)/.test(runtime));
  const arch = read('docs/architecture.md');
  const map = read('docs/ui-map.md');
  check('architecture.md names the sheet material', /Sheet material/.test(arch) && /#c8ccd2/.test(arch));
  check('ui-map.md names the sheet material', /#c8ccd2/.test(map) && /Sheet-metal parts are the exception/.test(map));
}

console.log('sheet material — mesh flag + outward normals');
const { records } = joinScsCatalog(fixture('catalog'), fixture('specs'));
const alu = findScsSku(records, 'ALU-090');
const flat = createSheetSpec(alu, 'XY', { width: 100, height: 60 });
const bent = {
  ...flat,
  bends: [{ id: 'b1', panel: 'base', edge: 'u+', angle: 90, length: 24 }],
};
const { exec } = await loadSandbox();
const sheetRes = await exec(`${sheetMetalBlock(flat)}\nreturn part;`);
const cubeRes = await exec('let part = Manifold.cube([20, 20, 20], true);\nreturn part;');
check('sheet script tags the mesh', sheetRes.mesh?.sheetMetal === true);
check('a cube is not a sheet', cubeRes.mesh?.sheetMetal !== true);
const wind = winding(sheetRes.mesh);
check('flat sheet triangles wind outward', wind.outward > 0 && wind.inward === 0, JSON.stringify(wind));

console.log('sheet material — pixels (dark + light)');
const shotDir = process.env.GOLDEN_SHOT_DIR || join(tmpdir(), 'surfcad-golden-shots');
mkdirSync(shotDir, { recursive: true });

const html = `<!doctype html><meta charset="utf-8">
<canvas id="c" width="390" height="700"></canvas>
<script id="payload" type="application/json">${JSON.stringify({
  sheet: {
    numProp: sheetRes.mesh.numProp,
    vertProperties: Array.from(sheetRes.mesh.vertProperties),
    triVerts: Array.from(sheetRes.mesh.triVerts),
  },
  cube: {
    numProp: cubeRes.mesh.numProp,
    vertProperties: Array.from(cubeRes.mesh.vertProperties),
    triVerts: Array.from(cubeRes.mesh.triVerts),
  },
  spec: bent,
}).replace(/</g, '\\u003c')}</script>
<script type="module">
import { renderSheetMaterialShots } from '/scripts/golden/sheet_material_shot.js';
const payload = JSON.parse(document.getElementById('payload').textContent);
window.__RESULT__ = renderSheetMaterialShots(document.getElementById('c'), payload);
</script>`;

const vite = await createVite({
  root: new URL('../..', import.meta.url).pathname,
  server: { middlewareMode: true },
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
  const page = await browser.newPage({ viewport: { width: 390, height: 700 } });
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__RESULT__, null, { timeout: 30000 });
  const result = await page.evaluate(() => window.__RESULT__);
  check('page rendered', errors.length === 0, errors.join('; '));
  const mat = result.material;
  check('canvas material is the sheet material', mat.type === 'MeshStandardMaterial'
    && mat.color === 0xc8ccd2 && mat.metalness === 0.35 && mat.roughness === 0.45
    && mat.side === 2 && mat.flatShading === true && mat.sheet === true, JSON.stringify(mat));

  const gray = (row, label) => {
    check(`${label} luminance is gray, not near-black`, row.pixels > 1000 && row.mean > 0.45 && row.mean < 0.92,
      `mean ${row.mean?.toFixed?.(3)} px ${row.pixels}`);
    check(`${label} is unsaturated gray`, row.satFrac < 0.2
      && row.r > 150 && row.r < 235 && row.g > 150 && row.g < 235 && row.b > 150 && row.b < 235
      && Math.abs(row.r - row.g) < 25 && Math.abs(row.g - row.b) < 25,
      `rgb ${row.r?.toFixed?.(0)},${row.g?.toFixed?.(0)},${row.b?.toFixed?.(0)} sat ${row.satFrac?.toFixed?.(2)}`);
  };
  gray(result.faceDark, 'dark theme face');
  gray(result.faceLight, 'light theme face');
  gray(result.underDark, 'underside');
  check('dark overlay is brighter than the old near-black', result.overlayDark.mean > 0.35 && result.overlayDark.pixels > 1000,
    `mean ${result.overlayDark.mean?.toFixed?.(3)}`);
  check('light overlay is brighter than the old near-black', result.overlayLight.mean > 0.35 && result.overlayLight.pixels > 1000,
    `mean ${result.overlayLight.mean?.toFixed?.(3)}`);
  check('orange handles on the dark ground', result.overlayDark.orange > 80, `orange ${result.overlayDark.orange}`);
  check('orange handles on the light ground', result.overlayLight.orange > 80, `orange ${result.overlayLight.orange}`);
  check('face highlight stays visible', result.highlight.yellow > 50, `yellow ${result.highlight.yellow}`);
  // Mean of every lit pixel, including sides the headlight shades. A face
  // aimed at the camera is #ECEAE4; this average sits a bit below that.
  check('a cube stays the default off-white',
    result.cube.satFrac < 0.2
    && result.cube.r > 150 && result.cube.g > 150 && result.cube.b > 140
    && Math.abs(result.cube.r - result.cube.g) < 25
    && Math.abs(result.cube.g - result.cube.b) < 30,
    `rgb ${result.cube.r?.toFixed?.(0)},${result.cube.g?.toFixed?.(0)},${result.cube.b?.toFixed?.(0)} sat ${result.cube.satFrac?.toFixed?.(2)}`);

  const save = (name, row) => {
    if (!row?.png) return;
    const file = join(shotDir, name);
    writeFileSync(file, Buffer.from(row.png.split(',')[1], 'base64'));
    console.log(`  shot ${file}`);
  };
  save('sheet-after-dark-390.png', result.overlayDark);
  save('sheet-after-light-390.png', result.overlayLight);
} finally {
  await browser?.close();
  server.close();
  await vite.close();
}

if (failed) {
  console.log(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nAll sheet material checks passed');
process.exit(0);

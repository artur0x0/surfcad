#!/usr/bin/env node
/**
 * Four UI polish items, at 390px and desktop:
 *   1. Sheet-metal feature badges use the blue bent-plate glyph.
 *   2. Signed-out + and folder menus offer Part and Assembly (local part).
 *   3. Delete-assembly shows a spinner under "Checking parts".
 *   4. Bendable-edge highlights are thin screen-space lines.
 *
 * Screenshots go to GOLDEN_SHOT_DIR or os.tmpdir() only.
 */
/* The evaluate callback runs in the browser, where document exists. */
/* global document, getComputedStyle, window */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
import { chromium } from 'playwright-core';
import { attachConsentPresetToBrowser } from './lib/presetConsentInit.mjs';
import { Raycaster, Vector3 } from 'three';
import { buildSheetOverlay, SHEET_EDGE_LINE, sheetPickFromHits } from '../../src/utils/sheetMetal/sheetOverlay.js';

process.env.BROWSERSLIST_IGNORE_OLD_DATA = '1';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const shotDir = process.env.GOLDEN_SHOT_DIR || join(tmpdir(), 'surfcad-golden-shots');

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].filter(Boolean);

let failed = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`);
  }
}

const SHEET_SCRIPT = `// --- sheet-metal begin ---
const sheetSpec = { v: 1, t: 2, width: 100, height: 60 };
let part = sheetMetalSolid(sheetSpec);
// --- sheet-metal end ---
return part;
`;

const SPEC = {
  v: 1, sku: 'T', t: 2, r: 1, k: 0.4, plane: 'XY', width: 100, height: 60,
  bends: [], tabs: [], holes: [],
};

console.log('ui polish — source');
{
  const strip = read('src/components/FeatureStrip.jsx');
  const sheet = read('src/components/FeatureEditSheet.jsx');
  const icon = read('src/components/icons/SheetMetalPlate.jsx');
  const palette = read('src/components/HelperInsertPalette.jsx');
  const feed = read('src/components/PartFeed.jsx');
  const dialog = read('src/components/DeleteAssemblyDialog.jsx');
  const overlay = read('src/utils/sheetMetal/sheetOverlay.js');
  check('feature badges share the bent-plate icon, not FoldVertical',
    /sheetMetal: SheetMetalPlate/.test(strip)
    && /sheetMetal: SheetMetalPlate/.test(sheet)
    && !/FoldVertical/.test(strip)
    && !/FoldVertical/.test(sheet)
    && /text-blue-400/.test(strip)
    && /text-blue-400/.test(sheet)
    && /M4 10h11l5-4v10l-5 4H4z/.test(icon)
    && /M12 10v10/.test(icon)
    && palette.includes('SheetMetalPlate'));
  const folderPart = feed.slice(feed.indexOf('data-part-open-dropdown'), feed.indexOf('data-part-add-menu'));
  check('signed-out folder menu offers Part via the local name dialog',
    /data-part-open-action="part"/.test(folderPart)
    && /data-part-open-local/.test(folderPart)
    && /else startNewPart\(\)/.test(folderPart)
    && /if \(source === 'git'\) void startOpenPart\(\)/.test(folderPart)
    && /data-part-add-action="part"/.test(feed)
    && /data-part-add-action="assembly"/.test(feed));
  check('checking-parts spinner matches the border ring and sits under the text',
    /Checking parts…/.test(dialog)
    && /data-assembly-delete-checking-spinner/.test(dialog)
    && /animate-spin motion-reduce:animate-none rounded-full border-b-2 border-white/.test(dialog)
    && dialog.indexOf('Checking parts…') < dialog.indexOf('data-assembly-delete-checking-spinner'));
  check('edge highlight is a 2.5px line at lower opacity',
    SHEET_EDGE_LINE.corePx === 2.5
    && SHEET_EDGE_LINE.haloPx === 5
    && SHEET_EDGE_LINE.opacity === 0.65
    && SHEET_EDGE_LINE.hotOpacity === 0.82
    && SHEET_EDGE_LINE.haloOpacity === 0.16
    && /worldUnits: false/.test(overlay)
    && /colorWrite: false/.test(overlay)
    && /syncSheetEdgeLineResolution/.test(read('src/components/Viewport.jsx')));
}

console.log('ui polish — edge line objects still pick');
{
  const g = buildSheetOverlay({ stage: 'edit', tool: 'bend', spec: SPEC, lineResolution: [390, 844] });
  const handles = g.children.filter((c) => c.userData.sm?.kind === 'edge');
  const cores = [];
  const hits = [];
  g.traverse((obj) => {
    if (obj.userData.sheetEdgeLine?.role === 'core') cores.push(obj);
    if (obj.userData.sheetEdgeHit) hits.push(obj);
  });
  check('four bendable edges, each a 2.5px core at 0.65',
    handles.length === 4
    && cores.length === 4
    && cores.every((line) => line.material.linewidth === 2.5 && line.material.opacity === 0.65
      && line.material.resolution.x === 390 && line.material.resolution.y === 844),
    `handles ${handles.length} cores ${cores.length}`);
  check('pick volume is not drawn',
    hits.length === 4 && hits.every((mesh) => mesh.material.colorWrite === false && mesh.material.opacity === 0));
  g.updateMatrixWorld(true);
  const hit = sheetPickFromHits(new Raycaster(new Vector3(50, 0, 100), new Vector3(0, 0, -1)).intersectObject(g, true));
  check('a ray on the +X edge still picks that edge',
    hit?.kind === 'edge' && hit.edge === 'u+' && hit.panel === 'base', JSON.stringify(hit));
  const hot = buildSheetOverlay({
    stage: 'edit', tool: 'bend', spec: SPEC, hotEdge: { panel: 'base', edge: 'u+' },
  });
  let hotOpacity = null;
  hot.traverse((obj) => {
    if (obj.userData.sheetEdgeLine?.role === 'core' && obj.userData.sheetEdgeLine.hot) {
      hotOpacity = obj.material.opacity;
    }
  });
  check('hovered edge is 0.82, still under the old 0.95', hotOpacity === 0.82);
}

const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
check('system Chrome available', !!exe, 'set CHROME_PATH');

if (exe && failed === 0) {
  const cssSrc = read('src/index.css');
  const processed = await postcss([
    tailwindcss({ config: join(ROOT, 'tailwind.config.js') }),
    autoprefixer(),
  ]).process(cssSrc, { from: join(ROOT, 'src/index.css') });

  const uiBundled = await build({
    stdin: {
      contents: `import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import FeatureStrip from './src/components/FeatureStrip.jsx';
import PartFeed from './src/components/PartFeed.jsx';
import DeleteAssemblyDialog from './src/components/DeleteAssemblyDialog.jsx';

const SHEET = ${JSON.stringify(SHEET_SCRIPT)};

function Ribbon() {
  return (
    <div data-polish-ribbon="" style={{ width: '100%', background: '#111827', padding: 12 }}>
      <FeatureStrip orientation="horizontal" script={SHEET} />
    </div>
  );
}

function GuestMenus() {
  const [added, setAdded] = useState('');
  window.__guestAdded = added;
  return (
    <div style={{ width: '100%', height: '100vh', background: '#1e1e1e' }}>
      <PartFeed
        placement={window.innerWidth <= 768 ? 'mobile' : 'desktop'}
        source="local"
        assemblyName="Guest"
        assemblyLeaveSafe
        isMobile={false}
        suggestNewPartPath=""
        onAddPart={(name) => { window.__guestAdded = name || ''; setAdded(name || ''); }}
        onNewAssembly={() => { window.__guestAssembly = (window.__guestAssembly || 0) + 1; }}
      />
    </div>
  );
}

function Checking({ loading }) {
  return (
    <DeleteAssemblyDialog
      assemblyName="Gearbox"
      partCount={2}
      referenced={[]}
      typed=""
      loading={loading}
      onTyped={() => {}}
      onKeep={() => {}}
      onDrop={() => {}}
      onClose={() => {}}
    />
  );
}

const view = window.__POLISH_VIEW__;
const root = createRoot(document.getElementById('root'));
if (view === 'ribbon') root.render(<Ribbon />);
else if (view === 'guest') root.render(<GuestMenus />);
else root.render(<Checking loading={view !== 'checked'} />);
`,
      resolveDir: ROOT,
      loader: 'jsx',
    },
    bundle: true,
    format: 'iife',
    platform: 'browser',
    write: false,
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'error',
  });

  const edgeBundled = await build({
    stdin: {
      contents: `import * as THREE from 'three';
import { buildSheetOverlay } from './src/utils/sheetMetal/sheetOverlay.js';
import { sheetFreeEdges, solveSheet } from './src/utils/sheetMetal/sheetModel.js';

const SPEC = ${JSON.stringify(SPEC)};
const opts = window.__EDGE__ || { which: 'after', cssW: 390, cssH: 390, dpr: 2 };

function legacyFat(spec) {
  const group = new THREE.Group();
  const solved = solveSheet(spec);
  const size = Math.max(4, spec.t * 3, Math.max(spec.width, spec.height) * 0.05);
  for (const e of sheetFreeEdges(spec, solved)) {
    if (!e.bendable || !(e.length > 1e-3)) continue;
    const dir = new THREE.Vector3(...e.b).sub(new THREE.Vector3(...e.a));
    const len = dir.length();
    const geom = new THREE.BoxGeometry(size, len, size);
    const mid = new THREE.Vector3(...e.a).add(new THREE.Vector3(...e.b)).multiplyScalar(0.5);
    const mesh = new THREE.Mesh(geom, new THREE.MeshBasicMaterial({
      color: 0xf97316,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    }));
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    mesh.position.copy(mid);
    group.add(mesh);
  }
  return group;
}

function orangeRun(buf, w, h) {
  const y = Math.floor(h / 2);
  let best = 0;
  let run = 0;
  let total = 0;
  for (let x = 0; x < w; x++) {
    const i = ((h - 1 - y) * w + x) * 4;
    const r = buf[i];
    const g = buf[i + 1];
    const b = buf[i + 2];
    const on = r > 160 && r > g + 20 && b < 170;
    if (on) { run += 1; total += 1; if (run > best) best = run; }
    else run = 0;
  }
  return { devicePx: best, orange: total };
}

const { cssW, cssH, dpr, which } = opts;
const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
renderer.setPixelRatio(dpr);
renderer.setSize(cssW, cssH);
renderer.setClearColor(0x1e1e1e, 1);
const canvas = renderer.domElement;
canvas.dataset.edgeCanvas = which;
canvas.style.width = cssW + 'px';
canvas.style.height = cssH + 'px';
document.getElementById('root').appendChild(canvas);

const scene = new THREE.Scene();
scene.add(new THREE.AmbientLight(0xffffff, 0.85));
const key = new THREE.DirectionalLight(0xffffff, 0.8);
key.position.set(40, 80, 120);
scene.add(key);
const span = 70;
const camera = new THREE.OrthographicCamera(-span, span, span * cssH / cssW, -span * cssH / cssW, 0.1, 800);
camera.position.set(0, 0, 220);
camera.up.set(0, 1, 0);
camera.lookAt(0, 0, 0);
const sheet = buildSheetOverlay({
  stage: 'edit',
  tool: which === 'after' ? 'bend' : 'hole',
  spec: SPEC,
  lineResolution: [cssW, cssH],
});
scene.add(sheet);
if (which === 'before') scene.add(legacyFat(SPEC));
renderer.render(scene, camera);

const gl = renderer.getContext();
const bufW = Math.floor(cssW * dpr);
const bufH = Math.floor(cssH * dpr);
const buf = new Uint8Array(bufW * bufH * 4);
gl.readPixels(0, 0, bufW, bufH, gl.RGBA, gl.UNSIGNED_BYTE, buf);
const run = orangeRun(buf, bufW, bufH);
window.__edgeMeasure = {
  which,
  dpr,
  cssW,
  devicePx: run.devicePx,
  cssPx: run.devicePx / dpr,
  orange: run.orange,
};
window.__edgeReady = true;
`,
      resolveDir: ROOT,
      loader: 'jsx',
    },
    bundle: true,
    format: 'iife',
    platform: 'browser',
    write: false,
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'error',
  });

  const pageHtml = (view) => `<!doctype html>
<html><head><meta charset="utf-8"><style>${processed.css}</style></head>
<body style="margin:0;background:#1e1e1e">
<div id="root"></div>
<script>window.__POLISH_VIEW__ = ${JSON.stringify(view)};</script>
<script>${uiBundled.outputFiles[0].text}</script>
</body></html>`;

  const edgeHtml = (opts) => `<!doctype html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;background:#1e1e1e">
<div id="root"></div>
<script>window.__EDGE__ = ${JSON.stringify(opts)};</script>
<script>${edgeBundled.outputFiles[0].text}</script>
</body></html>`;

  mkdirSync(shotDir, { recursive: true });
  const browser = await chromium.launch({
    executablePath: exe,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader'],
  });
attachConsentPresetToBrowser(browser);
  const views = [
    ['390', 390, 844],
    ['desktop', 1280, 800],
  ];
  try {
    for (const [slug, width, height] of views) {
      const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2 });
      page.on('pageerror', (err) => console.log('  pageerror', err.message));

      await page.setContent(pageHtml('ribbon'), { waitUntil: 'load' });
      await page.waitForSelector('[data-feature-chip="sheetBase"] [data-sheet-metal-icon]', { timeout: 8000 });
      const icon = await page.evaluate(() => {
        const svg = document.querySelector('[data-feature-chip="sheetBase"] [data-sheet-metal-icon]');
        const path = svg?.querySelector('path')?.getAttribute('d') || '';
        const color = svg ? getComputedStyle(svg).color : '';
        return { path, color, count: document.querySelectorAll('[data-feature-chip="sheetBase"]').length };
      });
      check(`${slug}: ribbon sheet badge is the blue bent plate`,
        icon.count === 1
        && icon.path === 'M4 10h11l5-4v10l-5 4H4z'
        && icon.color === 'rgb(96, 165, 250)',
        JSON.stringify(icon));
      const ribbonShot = join(shotDir, `polish-ribbon-sheet-${slug}.png`);
      await page.locator('[data-polish-ribbon]').screenshot({ path: ribbonShot });
      console.log(`  shot ${ribbonShot}`);

      await page.setContent(pageHtml('guest'), { waitUntil: 'load' });
      await page.waitForSelector('[data-part-add]', { timeout: 8000 });
      await page.click('[data-part-add]');
      await page.waitForSelector('[data-part-add-dropdown]', { timeout: 4000 });
      const plus = await page.evaluate(() => {
        const menu = document.querySelector('[data-part-add-dropdown]');
        const items = [...menu.querySelectorAll('[role="menuitem"]')].map((el) => el.textContent.trim());
        return { items, source: document.querySelector('[data-parts-feed]')?.getAttribute('data-parts-source') };
      });
      check(`${slug}: guest + menu is Part and Assembly`,
        plus.source === 'local' && plus.items.join('|') === 'Part|Assembly',
        JSON.stringify(plus));
      const plusShot = join(shotDir, `polish-guest-plus-${slug}.png`);
      await page.locator('[data-parts-feed]').screenshot({ path: plusShot });
      console.log(`  shot ${plusShot}`);
      await page.click('[data-part-add-action="part"]');
      await page.waitForSelector('[data-git-dialog="new-part"]', { timeout: 4000 });
      await page.fill('[data-git-new-part-name]', 'Bracket');
      await page.click('[data-git-new-part-confirm]');
      const added = await page.evaluate(() => window.__guestAdded);
      check(`${slug}: guest Part opens the name dialog and creates a local part`, added === 'Bracket', String(added));

      await page.setContent(pageHtml('guest'), { waitUntil: 'load' });
      await page.waitForSelector('[data-assembly-load]', { timeout: 8000 });
      await page.click('[data-assembly-load]');
      await page.waitForSelector('[data-part-open-dropdown]', { timeout: 4000 });
      const folder = await page.evaluate(() => {
        const menu = document.querySelector('[data-part-open-dropdown]');
        const items = [...menu.querySelectorAll('[role="menuitem"]')].map((el) => ({
          text: el.textContent.trim(),
          local: el.getAttribute('data-part-open-local'),
          action: el.getAttribute('data-part-open-action'),
        }));
        return items;
      });
      check(`${slug}: guest folder menu is Part and Assembly, Part is local-only`,
        folder.length === 2
        && folder[0].text === 'Part' && folder[0].action === 'part' && folder[0].local === 'part'
        && folder[1].text === 'Assembly' && folder[1].action === 'assembly',
        JSON.stringify(folder));
      const folderShot = join(shotDir, `polish-guest-folder-${slug}.png`);
      await page.locator('[data-parts-feed]').screenshot({ path: folderShot });
      console.log(`  shot ${folderShot}`);

      await page.setContent(pageHtml('checking'), { waitUntil: 'load' });
      await page.waitForSelector('[data-assembly-delete-checking-spinner]', { timeout: 8000 });
      const spinning = await page.evaluate(() => {
        const text = document.querySelector('[data-git-dialog-loading]')?.textContent || '';
        const spinner = document.querySelector('[data-assembly-delete-checking-spinner]');
        const textBox = document.querySelector('[data-git-dialog-loading]')?.getBoundingClientRect();
        const spinBox = spinner?.getBoundingClientRect();
        const style = spinner ? getComputedStyle(spinner) : null;
        return {
          text: text.trim(),
          under: !!(textBox && spinBox && spinBox.top >= textBox.bottom - 1),
          w: spinBox ? spinBox.width : 0,
          h: spinBox ? spinBox.height : 0,
          border: style?.borderBottomWidth || '',
          anim: style?.animationName || '',
        };
      });
      check(`${slug}: spinner sits under Checking parts`,
        spinning.text === 'Checking parts…'
        && spinning.under
        && spinning.w >= 14 && spinning.w <= 20
        && spinning.h >= 14 && spinning.h <= 20
        && spinning.border === '2px'
        && spinning.anim.includes('spin'),
        JSON.stringify(spinning));
      const spinShot = join(shotDir, `polish-checking-spinner-${slug}.png`);
      await page.locator('[data-git-dialog="delete-assembly"] > div').screenshot({ path: spinShot });
      console.log(`  shot ${spinShot}`);

      await page.setContent(pageHtml('checked'), { waitUntil: 'load' });
      await page.waitForSelector('[data-assembly-delete-summary]', { timeout: 8000 });
      const gone = await page.evaluate(() => ({
        spinner: !!document.querySelector('[data-assembly-delete-checking-spinner]'),
        loading: !!document.querySelector('[data-git-dialog-loading]'),
        summary: document.querySelector('[data-assembly-delete-name]')?.textContent || '',
      }));
      check(`${slug}: spinner leaves when the check finishes`,
        gone.spinner === false && gone.loading === false && gone.summary === 'Gearbox',
        JSON.stringify(gone));
      await page.close();
    }

    const edgeCases = [
      ['before', '390', 390, 390, 2],
      ['after', '390', 390, 390, 2],
      ['before', 'desktop', 800, 500, 2],
      ['after', 'desktop', 800, 500, 2],
      ['after', '390-dpr3', 390, 390, 3],
    ];
    const measured = {};
    for (const [which, slug, cssW, cssH, dpr] of edgeCases) {
      const page = await browser.newPage({
        viewport: { width: Math.max(cssW, 400), height: Math.max(cssH, 400) },
        deviceScaleFactor: 1,
      });
      page.on('pageerror', (err) => console.log('  edge pageerror', err.message));
      await page.setContent(edgeHtml({ which, cssW, cssH, dpr }), { waitUntil: 'load' });
      await page.waitForFunction(() => window.__edgeReady === true, null, { timeout: 8000 });
      const measure = await page.evaluate(() => window.__edgeMeasure);
      measured[`${which}-${slug}`] = measure;
      const shot = join(shotDir, `polish-edge-${which}-${slug}.png`);
      await page.locator('[data-edge-canvas]').screenshot({ path: shot });
      console.log(`  shot ${shot} ${JSON.stringify(measure)}`);
      await page.close();
    }
    const after390 = measured['after-390'];
    const before390 = measured['before-390'];
    const afterDesk = measured['after-desktop'];
    const beforeDesk = measured['before-desktop'];
    const afterDpr3 = measured['after-390-dpr3'];
    // One scanline crosses two edges, so a 2.5px core is only a handful of pixels.
    const thin = (m) => m && m.orange >= 4 && m.cssPx >= 1.5 && m.cssPx <= 6;
    const fat = (m) => m && m.cssPx >= 10;
    check('390px DPR 2: after line is thin and visible, before is the fat bar',
      thin(after390) && fat(before390) && before390.cssPx > after390.cssPx * 2,
      JSON.stringify({ before: before390, after: after390 }));
    check('desktop DPR 2: after line is thin and visible, before is the fat bar',
      thin(afterDesk) && fat(beforeDesk) && beforeDesk.cssPx > afterDesk.cssPx * 2,
      JSON.stringify({ before: beforeDesk, after: afterDesk }));
    check('390px DPR 3: line stays at least 4 device pixels',
      afterDpr3 && afterDpr3.devicePx >= 4 && afterDpr3.cssPx >= 1.5 && afterDpr3.cssPx <= 6,
      JSON.stringify(afterDpr3));
  } finally {
    await browser.close();
  }
}

if (failed) {
  console.log(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nAll UI polish checks passed');

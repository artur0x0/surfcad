#!/usr/bin/env node
/**
 * Feature card: shared shell, contour pilot, fillet / chamfer / edge card,
 * shell / draft / move face / delete face, cut / boolean / move,
 * helper sheets (cube, round box, cylinder, sphere, tube, hex, hole,
 * mirror, center, align, array, path, refuse), paint, Analyze,
 * keyboard, camera pose.
 *
 * Screenshots go to GOLDEN_SHOT_DIR or os.tmpdir(), never the artifacts dir.
 */
/* The evaluate callbacks run in the browser, where document exists. */
/* global document, window, getComputedStyle, requestAnimationFrame */
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
import { PerspectiveCamera, Vector3 } from 'three';
import { TrackballControls } from 'three/addons/controls/TrackballControls.js';
import { applyTrackballFeel } from '../../src/utils/trackballFeel.js';
import { panViewByNdcY } from '../../src/utils/viewCamera.js';
import {
  FEATURE_SHEET_SLIDE_MAX,
  boxCornerPoints,
  captureViewPose,
  createSheetCameraSession,
  featureSheetCardTopNdc,
  featureSheetClearanceNdc,
  featureSheetSlideNdc,
  posesMatch,
  selectionNdcYs,
} from '../../src/utils/featureSheetCamera.js';

process.env.BROWSERSLIST_IGNORE_OLD_DATA = '1';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const shotDir = process.env.GOLDEN_SHOT_DIR || tmpdir();
const PHONE = { width: 390, height: 664 };

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

console.log('feature sheet card — source');
{
  const shell = read('src/components/FeatureSheet.jsx');
  const chip = read('src/components/ContourModeChip.jsx');
  const css = read('src/index.css');
  const layout = read('src/utils/featureSheetLayout.js');
  const camera = read('src/utils/featureSheetCamera.js');
  const hook = read('src/hooks/useModalViewport.js');
  const view = read('src/components/Viewport.jsx');
  const arch = read('docs/architecture.md');
  const map = read('docs/ui-map.md');

  check('shell props are title, subtitle, onCancel, onConfirm, confirmDisabled, children',
    /title/.test(shell) && /subtitle/.test(shell) && /onCancel/.test(shell)
    && /onConfirm/.test(shell) && /confirmDisabled/.test(shell) && /children/.test(shell));
  check('card is a floating pane child, grey glass, cyan confirm',
    /data-feature-card/.test(shell)
    && /absolute/.test(shell)
    && !/fixed inset-0/.test(shell)
    && /bg-cyan-600/.test(shell)
    && /feature-sheet-card/.test(css)
    && /rgb\(var\(--chrome-surface\) \/ 0\.72\)/.test(css)
    && /--chrome-surface:\s*17 24 39/.test(css)
    && /border-gray-500\/50/.test(shell)
    && /22\.5rem/.test(css));
  check('width reuses the rail gap with a 10px side gap and a 22rem cap',
    /sheetChipBetweenRails/.test(read('src/utils/featureSheetLayout.js'))
    && /FEATURE_SHEET_SIDE_GAP_PX = 10/.test(layout)
    && /FEATURE_SHEET_MAX_REM = 22/.test(layout)
    && /min\(22rem,calc\(100%-9\.5rem\)\)/.test(shell));
  check('phone card docks to the hidden stage switcher; desktop stays 10px',
    /FEATURE_SHEET_BOTTOM_PHONE_DOCKED = '0px'/.test(layout)
    && /compact \? FEATURE_SHEET_BOTTOM_PHONE_DOCKED/.test(layout)
    && /FEATURE_SHEET_BOTTOM_DESKTOP/.test(layout)
    && /\[data-mobile-stage\]:has\(\[data-feature-card\]\) \[data-mobile-stage-home-indicator\]/.test(css)
    && /display:\s*none/.test(css.slice(css.indexOf('[data-mobile-stage]:has([data-feature-card])'))));
  check('body scrolls and keeps an iOS-visible track or hint',
    /data-feature-sheet-body/.test(shell)
    && /overflow-y-auto/.test(shell)
    && /data-feature-sheet-scrollbar/.test(shell)
    && /data-feature-sheet-scroll-hint/.test(shell)
    && /data-feature-sheet-footer/.test(shell));
  check('focused fields inside the card scroll, and inputs stay at 16px',
    /data-feature-card/.test(hook)
    && /\[data-feature-card\] input/.test(css)
    && /font-size: 16px/.test(css));
  check('contour pilot uses the shell; the rail X is the same cancel; game mounts no card',
    /<FeatureSheet\b/.test(chip)
    && /<FeatureSheet\b/.test(read('src/components/FeatureSlotCard.jsx'))
    && /onCancel=\{cancelContourEditor\}/.test(view)
    && /exitContourMode\(back \? 'slot' : undefined\)/.test(view)
    && /onCancel=\{closeFeatureSlots\}/.test(view)
    && /contourMode && contourPlaneOpen && !contourMode.gesture && mode !== 'game'/.test(view));
  const fillet = read('src/components/FilletModeChip.jsx');
  check('fillet and chamfer use the shell; Confirm saves; X cancels; game mounts no card',
    /<FeatureSheet\b/.test(fillet)
    && /onConfirm=\{onAccept\}/.test(fillet)
    && /onCancel=\{onDismiss\}/.test(fillet)
    && /data-edge-blend/.test(fillet)
    && /Tangent \{tangentOn/.test(fillet)
    && !/>\s*Accept\s*</.test(fillet)
    && /filletMode && mode !== 'game'/.test(view));
  const edgeAt = view.indexOf("'data-edge-selector': 'standalone'");
  const edgeSlice = view.slice(Math.max(0, edgeAt - 500), edgeAt + 700);
  check('standalone edge card is the shell, X clears and leaves edge pick, no Confirm',
    edgeAt > 0
    && /<FeatureSheet\b/.test(edgeSlice)
    && !/onConfirm=/.test(edgeSlice)
    && /setPickMode\('face'\)/.test(edgeSlice)
    && /mode !== 'game' && !helperCardOpen && pickMode === 'edge' && !contourMode && !filletMode/.test(view));
  check('fillet, contour, and the edge card share one camera and do not stack',
    /featureCardKind/.test(view)
    && /filletSheetOpen/.test(view)
    && /edgeSheetOpen/.test(view)
    && /if \(!next \|\| next === featureCardKind\)/.test(view));
  check('shell, draft, move face, and delete face use the shell; game mounts no card',
    ['Shell', 'Draft', 'MoveFace', 'DeleteFace'].every((name) => {
      const src = read(`src/components/${name}ModeChip.jsx`);
      return /<FeatureSheet\b/.test(src)
        && /onCancel=\{onDismiss\}/.test(src)
        && /onConfirm=\{onConfirm\}/.test(src);
    })
    && /shellMode && mode !== 'game'/.test(view)
    && /draftMode && mode !== 'game'/.test(view)
    && /moveFaceMode && mode !== 'game'/.test(view)
    && /deleteFaceMode && mode !== 'game'/.test(view)
    && /shellSheetOpen/.test(view)
    && /draftSheetOpen/.test(view)
    && /moveFaceSheetOpen/.test(view)
    && /deleteFaceSheetOpen/.test(view)
    && /!shellMode && !draftMode && !moveFaceMode && !deleteFaceMode/.test(view));
  check('cut, boolean, and move use the shell; game mounts no card; boolean stays under the section rail',
    ['Cut', 'Boolean', 'Move'].every((name) => {
      const src = read(`src/components/${name}ModeChip.jsx`);
      return /<FeatureSheet\b/.test(src)
        && /data-feature-card/.test(read('src/components/FeatureSheet.jsx'))
        && /onCancel=\{onDismiss\}/.test(src)
        && /onConfirm=\{onConfirm\}/.test(src)
        && /compact=\{compact\}/.test(src);
    })
    && /cutMode && mode !== 'game'/.test(view)
    && /booleanMode && mode !== 'game'/.test(view)
    && /moveMode && mode !== 'game'/.test(view)
    && /cutSheetOpen/.test(view)
    && /booleanSheetOpen/.test(view)
    && /moveSheetOpen/.test(view)
    && /!cutMode && !booleanMode && !moveMode/.test(view)
    && /'data-boolean-allow-section': '1'/.test(read('src/components/BooleanModeChip.jsx'))
    && /z-20/.test(read('src/components/FeatureSheet.jsx'))
    && /pointer-events-auto/.test(read('src/components/FeatureSheet.jsx')));
  const helper = read('src/components/HelperParamModal.jsx');
  const palette = read('src/components/HelperInsertPalette.jsx');
  const paint = read('src/components/PaintModeChip.jsx');
  check('paint uses the shell; Confirm saves; X cancels; game mounts no card',
    /<FeatureSheet\b/.test(paint)
    && /onCancel=\{onDismiss\}/.test(paint)
    && /onConfirm=\{onConfirm\}/.test(paint)
    && /data-paint-mode/.test(paint)
    && /paintMode && mode !== 'game'/.test(view)
    && /paintSheetOpen/.test(view)
    && /paintSheetOpen\s*\n\s*\? 'paint'/.test(view)
    && /!paintMode && selectedEdges/.test(view));
  const feaChip = read('src/components/fea/FeaStudyChip.jsx');
  const feaSheet = read('src/components/fea/FeaStudySheet.jsx');
  const feaHost = read('src/components/fea/FeaStudyHost.jsx');
  check('analyze uses the shell on phone and desktop; the footer is Run or Back to Setup; game mounts no card',
    /<FeatureSheet\b/.test(feaChip)
    && /<FeatureSheet\b/.test(feaSheet)
    && /onCancel=\{\(\) => panel\.close/.test(feaChip)
    && /onCancel=\{\(\) => panel\.close/.test(feaSheet)
    && !/onConfirm/.test(feaChip)
    && !/onConfirm/.test(feaSheet)
    && !/top-14/.test(feaSheet)
    && !/top-14/.test(feaChip)
    && /data-fea-sheet/.test(feaChip)
    && /data-fea-sheet/.test(feaSheet)
    && /footer=\{<FeaRunBar/.test(feaChip)
    && /footer=\{<FeaRunBar/.test(feaSheet)
    && /<FeaResultsReadout panel=\{panel\} \/>/.test(feaChip)
    && /<FeaResultsReadout panel=\{panel\} \/>/.test(feaSheet)
    && !/addEventListener\('keydown'/.test(feaHost)
    && /if \(compact\) return <FeaStudySheet/.test(feaHost)
    && /return <FeaStudyChip/.test(feaHost)
    && /enabled=\{mode !== 'game'\}/.test(view)
    && /feaSheetOpen/.test(view)
    && /feaSheetOpen\s*\n\s*\? 'fea'/.test(view)
    && /Analyze uses it too/.test(arch)
    && /fullLeft/.test(feaChip)
    && /fullLeft/.test(feaSheet)
    && /fullLeft = false/.test(shell)
    && /measureFeatureSheetWidth\(pane, rootPx = 16, \{ fullLeft = false \} = \{\}\)/.test(layout)
    && !/data-fea-/.test(shell));
  const fullLeftChips = [
    'src/components/FilletModeChip.jsx',
    'src/components/ShellModeChip.jsx',
    'src/components/DraftModeChip.jsx',
    'src/components/MoveFaceModeChip.jsx',
    'src/components/DeleteFaceModeChip.jsx',
    'src/components/CutModeChip.jsx',
    'src/components/MoveModeChip.jsx',
    'src/components/BooleanModeChip.jsx',
    'src/components/PaintModeChip.jsx',
  ];
  check('fillet, chamfer, shell, draft, move face, delete face, cut, move, boolean, and paint pass fullLeft',
    fullLeftChips.every((rel) => /\bfullLeft\b/.test(read(rel)))
    && /kind === 'chamfer'/.test(read('src/components/FilletModeChip.jsx')));
  check('sheet metal picker, feature edit, contour, and the helper card do not pass fullLeft',
    !/\bfullLeft\b/.test(read('src/components/FeatureEditSheet.jsx'))
    && !/\bfullLeft\b/.test(read('src/components/sheetMetal/SmControls.jsx'))
    && !/\bfullLeft\b/.test(read('src/components/sheetMetal/SheetMetalPicker.jsx'))
    && !/\bfullLeft\b/.test(read('src/components/ContourModeChip.jsx'))
    && !/\bfullLeft\b/.test(read('src/components/FeatureSlotCard.jsx'))
    && !/\bfullLeft\b/.test(read('src/components/HelperParamModal.jsx')));
  check('helper sheets use the card in CAD; game keeps the old sheet and does not slide',
    /<FeatureSheet\b/.test(helper)
    && /useCard/.test(helper)
    && /absolute inset-0 z-50 flex items-end justify-center/.test(helper)
    && /const useCard = layout !== 'game'/.test(palette)
    && /useCard=\{useCard\}/.test(palette)
    && /onHelperCard=\{setHelperCardOpen\}/.test(view)
    && /const helperSheetOpen = mode !== 'game' && helperCardOpen/.test(view)
    && /helperSheetOpen\s*\n\s*\? 'helper'/.test(view)
    && /!helperCardOpen && pickMode === 'edge'/.test(view)
    && /Game keeps the previous helper sheet/.test(arch));
  const sheetPopup = read('src/components/sheetMetal/SmControls.jsx');
  check('sheet metal uses SmPopup on the feature card; game mounts no card',
    /<FeatureSheet\b/.test(sheetPopup)
    && /export const SmPopup/.test(sheetPopup)
    && /<SmPopup/.test(read('src/components/sheetMetal/SheetMetalFlow.jsx'))
    && /<SmPopup/.test(read('src/components/sheetMetal/SheetMetalPicker.jsx'))
    && /<SmPopup/.test(read('src/components/sheetMetal/SheetMetalModeChip.jsx'))
    && /data-sm-unit-toggle/.test(sheetPopup)
    && /min-h-\[44px\]/.test(sheetPopup)
    && /sheetMetalMode && mode !== 'game'/.test(view)
    && /sheetMetalPicker && mode !== 'game'/.test(view)
    && /sheetMetalSheetOpen/.test(view)
    && /SmPopup/.test(arch));
  const editSheet = read('src/components/FeatureEditSheet.jsx');
  check('the feature edit sheet and its picker use the card; X cancels; Confirm saves; game mounts no card',
    /<FeatureSheet\b/.test(editSheet)
    && /data-feature-sheet-picker/.test(editSheet)
    && /data-feature-sheet-edit-script/.test(editSheet)
    && /data-feature-sheet-delete/.test(editSheet)
    && /onConfirm=\{editable/.test(editSheet)
    && /onCancel=\{onCancel\}/.test(editSheet)
    && /editSheetOpen/.test(view)
    && /mode !== 'game'/.test(view)
    && /yieldToFeatureEditCard/.test(view)
    && /FeatureEditSheet/.test(arch)
    && /Game mounts no card/.test(read('docs/ui-style-guide.md')));
  check('camera snapshots the pose, slides up, retargets orbit, and restores it',
    /export function captureViewPose/.test(camera)
    && /export function aimOrbitAtVisibleCenter/.test(camera)
    && /FEATURE_SHEET_SLIDE_MAX = 0\.6/.test(camera)
    && /remountTrackball/.test(camera)
    && /getVisibleFrame/.test(view)
    && /featureSheetCameraOwned/.test(view)
    && /prefers-reduced-motion/.test(view));
  check('docs name the shell, the hidden switcher, and the visible-area orbit',
    /## Feature card/.test(arch) && /FeatureSheet/.test(arch)
    && /stage switcher/.test(arch)
    && /center of the pane above the card/.test(arch)
    && /data-feature-card/.test(map));
}

console.log('feature sheet card — camera');
{
  if (typeof globalThis.window === 'undefined') {
    globalThis.window = {
      pageXOffset: 0,
      pageYOffset: 0,
      addEventListener() {},
      removeEventListener() {},
    };
  }
  const fakeDom = () => ({
    style: {},
    ownerDocument: {
      documentElement: { clientWidth: 800, clientHeight: 600, clientLeft: 0, clientTop: 0 },
    },
    addEventListener() {},
    removeEventListener() {},
    setPointerCapture() {},
    releasePointerCapture() {},
    getBoundingClientRect() {
      return { left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 };
    },
  });
  const camera = new PerspectiveCamera(45, 1, 0.1, 2000);
  camera.position.set(80, -80, 60);
  camera.up.set(0, 0, 1);
  camera.lookAt(0, 0, 10);
  camera.updateMatrixWorld();
  let controls = new TrackballControls(camera, fakeDom());
  applyTrackballFeel(controls);
  controls.target.set(0, 0, 10);
  controls.update();
  const box = { min: [-8, -8, 0], max: [8, 8, 16] };
  const fraction = 0.42;
  const cardTop = featureSheetCardTopNdc(fraction);
  const points = boxCornerPoints(box);
  panViewByNdcY({ camera, controls, ndcY: 0.35 });
  const buried = Math.min(...selectionNdcYs(camera, points));
  check('part can sit under the card before the slide', buried < cardTop, `ndc ${buried} top ${cardTop}`);
  const delta = featureSheetClearanceNdc({ camera, controls, points, cardFraction: fraction });
  check('slide moves content up and stays within 0.6 NDC',
    delta < 0 && delta >= -FEATURE_SHEET_SLIDE_MAX, `delta ${delta}`);
  panViewByNdcY({ camera, controls, ndcY: delta });
  const cleared = Math.min(...selectionNdcYs(camera, points));
  check('projected part box sits above the card',
    cleared + 0.02 >= cardTop,
    `cleared ${cleared} cardTop ${cardTop} delta ${delta}`);

  const session = createSheetCameraSession({
    getCamera: () => camera,
    getControls: () => controls,
    setControls: (next) => { controls = next; },
    reducedMotion: () => true,
  });
  const openPose = captureViewPose(camera, controls);
  session.slideBy(featureSheetSlideNdc(-0.7, 0.4));
  camera.position.applyAxisAngle(new Vector3(0, 0, 1), 0.55);
  camera.up.applyAxisAngle(new Vector3(0, 0, 1), 0.35);
  camera.lookAt(controls.target);
  controls.update();
  check('orbit during the sheet leaves the snapshot pose',
    posesMatch(captureViewPose(camera, controls), openPose, 1e-3) === false);
  session.restore();
  controls.update();
  check('close restores the pre-open pose within epsilon, orbit discarded',
    posesMatch(captureViewPose(camera, controls), openPose, 1e-3),
    JSON.stringify({ open: openPose.position, now: captureViewPose(camera, controls).position }));
}

const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
check('system Chrome available for the feature card render', !!exe, 'set CHROME_PATH');

if (exe && failed === 0) {
  const cssSrc = read('src/index.css');
  const processed = await postcss([
    tailwindcss({ config: join(ROOT, 'tailwind.config.js') }),
    autoprefixer(),
  ]).process(cssSrc, { from: join(ROOT, 'src/index.css') });

  const bundled = await build({
    stdin: {
      contents: `import { createRoot } from 'react-dom/client';
import { useEffect, useRef, useState } from 'react';
import {
  AmbientLight, BoxGeometry, DirectionalLight, Mesh, MeshLambertMaterial,
  PerspectiveCamera, Scene, WebGLRenderer,
} from 'three';
import { TrackballControls } from 'three/addons/controls/TrackballControls.js';
import { applyTrackballFeel } from './src/utils/trackballFeel.js';
import ContourModeChip from './src/components/ContourModeChip.jsx';
import FeatureSlotCard from './src/components/FeatureSlotCard.jsx';
import { emptyFeatureSlotCard } from './src/utils/featureSlotCard.js';
import FilletModeChip from './src/components/FilletModeChip.jsx';
import ShellModeChip from './src/components/ShellModeChip.jsx';
import DraftModeChip from './src/components/DraftModeChip.jsx';
import MoveFaceModeChip from './src/components/MoveFaceModeChip.jsx';
import DeleteFaceModeChip from './src/components/DeleteFaceModeChip.jsx';
import MobileStageToggle from './src/components/MobileStageToggle.jsx';
import CutModeChip from './src/components/CutModeChip.jsx';
import BooleanModeChip from './src/components/BooleanModeChip.jsx';
import MoveModeChip from './src/components/MoveModeChip.jsx';
import { PaintModeChip } from './src/components/PaintModeChip.jsx';
import SheetMetalPicker from './src/components/sheetMetal/SheetMetalPicker.jsx';
import HelperParamModal from './src/components/HelperParamModal.jsx';
import { HELPER_PALETTE_ITEMS } from './src/utils/helperPaletteSnippets.js';
import {
  applyViewPose, boxCornerPoints, captureViewPose, createSheetCameraSession,
  featureSheetClearanceNdc, selectionNdcYs,
} from './src/utils/featureSheetCamera.js';
import { panViewByNdcY } from './src/utils/viewCamera.js';

const PART = { min: [-10, -10, 0], max: [10, 10, 20] };

function Stage() {
  const paneRef = useRef(null);
  const [entry, setEntry] = useState('crossSection');
  const [compact, setCompact] = useState(true);
  const [panel, setPanel] = useState('contour');
  const [cardOpen, setCardOpen] = useState(true);
  const [helperId, setHelperId] = useState('cube');
  const [useCard, setUseCard] = useState(true);
  const api = useRef(null);

  useEffect(() => {
    const pane = paneRef.current;
    const canvas = pane.querySelector('canvas');
    const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
    const scene = new Scene();
    const camera = new PerspectiveCamera(45, 1, 0.1, 2000);
    camera.position.set(70, -90, 55);
    camera.up.set(0, 0, 1);
    camera.lookAt(0, 0, 10);
    let controls = new TrackballControls(camera, canvas);
    applyTrackballFeel(controls);
    controls.target.set(0, 0, 10);
    controls.update();
    const mesh = new Mesh(
      new BoxGeometry(20, 20, 20),
      new MeshLambertMaterial({ color: 0x7ec8e3 }),
    );
    mesh.position.set(0, 0, 10);
    scene.add(mesh);
    scene.add(new AmbientLight(0xffffff, 0.7));
    const key = new DirectionalLight(0xffffff, 0.9);
    key.position.set(30, -40, 80);
    scene.add(key);
    const session = createSheetCameraSession({
      getCamera: () => camera,
      getControls: () => controls,
      setControls: (next) => { controls = next; },
      reducedMotion: () => true,
      getVisibleFrame: () => {
        const host = paneRef.current;
        const card = host?.querySelector('[data-feature-card]');
        if (!host || !card) return null;
        const view = host.querySelector('canvas') || host;
        return {
          paneRect: view.getBoundingClientRect(),
          cardRect: card.getBoundingClientRect(),
        };
      },
    });
    const fit = () => {
      const r = pane.getBoundingClientRect();
      renderer.setSize(Math.max(1, r.width), Math.max(1, r.height), false);
      camera.aspect = r.width / Math.max(1, r.height);
      camera.updateProjectionMatrix();
      renderer.render(scene, camera);
    };
    fit();
    const initial = captureViewPose(camera, controls);
    const render = () => renderer.render(scene, camera);
    const pan = (ndcY) => panViewByNdcY({ camera, controls, ndcY });
    const cardFraction = () => {
      const pane = paneRef.current;
      const card = pane?.querySelector('[data-feature-card]');
      const paneBox = pane?.getBoundingClientRect();
      const cardBox = card?.getBoundingClientRect();
      const ph = paneBox?.height || 1;
      if (!cardBox || !paneBox) return 0;
      return Math.min(0.95, Math.max(0, (paneBox.bottom - cardBox.top) / ph));
    };
    const lowY = () => Math.min(...selectionNdcYs(camera, boxCornerPoints(PART)));
    api.current = {
      fit, render, camera, session,
      controls: () => controls,
      pose: () => captureViewPose(camera, controls),
      partYs: () => selectionNdcYs(camera, boxCornerPoints(PART)),
      reset() {
        applyViewPose(camera, controls, initial);
        controls.update();
        applyViewPose(camera, controls, initial);
      },
      /** Park the part just under the card, then optionally slide it clear. */
      park({ slide }) {
        this.reset();
        fit();
        const topOf = () => -1 + 2 * cardFraction();
        let steps = 0;
        while (lowY() >= topOf() - 0.03 && steps < 8) {
          pan(0.08);
          steps += 1;
        }
        const points = boxCornerPoints(PART);
        let delta = 0;
        if (slide) {
          delta = featureSheetClearanceNdc({
            camera,
            controls,
            points,
            cardFraction: cardFraction(),
          });
          if (Math.abs(delta) > 1e-6) pan(delta);
        }
        const fraction = cardFraction();
        const low = lowY();
        render();
        return { fraction, low, delta, cardTop: -1 + 2 * fraction };
      },
    };
    window.__sheet = api.current;
    const ro = new ResizeObserver(fit);
    ro.observe(pane);
    return () => {
      ro.disconnect();
      renderer.dispose();
    };
  }, []);

  return (
    <div ref={paneRef} className="viewport-shell relative h-full w-full overflow-hidden bg-[#1e1e1e]" data-mobile-stage="cad" data-stage-pane="cad" data-harness-pane="">
      <canvas className="absolute inset-0 block h-full w-full" />
      <div data-rail-pair="left" className="absolute bottom-2.5 left-2 z-10 w-14 rounded-lg bg-white/70" style={{ height: 220 }} />
      <div data-rail-pair="right" className="absolute bottom-2.5 right-2.5 z-10 w-14 rounded-lg bg-white/70" style={{ height: 300 }} />
      {compact ? (
        <div
          className="absolute left-1/2 z-30 -translate-x-1/2"
          style={{ bottom: 0 }}
          data-mobile-stage-home-indicator=""
        >
          <MobileStageToggle stage="cad" onChange={() => {}} />
        </div>
      ) : null}
      {cardOpen && panel === 'fillet' ? (
        <FilletModeChip
          kind="fillet"
          edgeCount={3}
          partCount={1}
          tangentOn
          params={{ radius: 2, _sweepMax: 20 }}
          pathOk
          componentCount={1}
          compact={compact}
          onToggleTangent={() => {}}
          onClear={() => {}}
          onAccept={() => {}}
          onBack={() => {}}
          onDismiss={() => setCardOpen(false)}
          onParamChange={() => {}}
        />
      ) : cardOpen && panel === 'shell' ? (
        <ShellModeChip
          face={{ type: 'planar', center: [0, 0, 10], normal: [0, 0, 1] }}
          params={{ wall: 2.5, openingMode: 'face' }}
          compact={compact}
          onParamChange={() => {}}
          onUndoFace={() => {}}
          onClearFace={() => {}}
          onConfirm={() => {}}
          onDismiss={() => setCardOpen(false)}
        />
      ) : cardOpen && panel === 'draft' ? (
        <DraftModeChip
          neutral={{ center: [0, 0, 10], normal: [0, 0, 1] }}
          drafts={[{ center: [10, 0, 0], normal: [1, 0, 0] }]}
          angle={2}
          flip={false}
          compact={compact}
          onAngle={() => {}}
          onFlip={() => {}}
          onUndo={() => {}}
          onClear={() => {}}
          onConfirm={() => {}}
          onDismiss={() => setCardOpen(false)}
        />
      ) : cardOpen && panel === 'moveFace' ? (
        <MoveFaceModeChip
          faces={[{ center: [0, 0, 10], normal: [0, 0, 1] }]}
          distance={2}
          flip={false}
          compact={compact}
          onDistance={() => {}}
          onFlip={() => {}}
          onUndo={() => {}}
          onClear={() => {}}
          onConfirm={() => {}}
          onDismiss={() => setCardOpen(false)}
        />
      ) : cardOpen && panel === 'deleteFace' ? (
        <DeleteFaceModeChip
          faces={[{ center: [0, 0, 10], normal: [0, 0, 1] }]}
          compact={compact}
          onUndo={() => {}}
          onClear={() => {}}
          onConfirm={() => {}}
          onDismiss={() => setCardOpen(false)}
        />
      ) : cardOpen && panel === 'cut' ? (
        <CutModeChip
          state={{
            planeSource: 'xy',
            originOffset: 4,
            pick: 'bodies',
            bodies: [{ at: [0, 0, 0], center: [0, 0, 0] }],
            drop: [],
          }}
          compact={compact}
          onPlaneSource={() => {}}
          onOffset={() => {}}
          onPickTarget={() => {}}
          onUndo={() => {}}
          onClear={() => {}}
          onConfirm={() => {}}
          onDismiss={() => setCardOpen(false)}
        />
      ) : cardOpen && panel === 'boolean' ? (
        <BooleanModeChip
          state={{
            op: 'difference',
            pick: 'bodies',
            byPart: {
              a: { bodies: [{ at: [0, 0, 0], center: [0, 0, 0], seq: 1 }], drop: [] },
              b: { bodies: [{ at: [20, 0, 0], center: [20, 0, 0], seq: 2 }], drop: [] },
            },
            seq: 2,
          }}
          partId="a"
          partNames={{ a: 'Bracket', b: 'Pin' }}
          compact={compact}
          onOp={() => {}}
          onPickTarget={() => {}}
          onUndo={() => {}}
          onClear={() => {}}
          onConfirm={() => {}}
          onDismiss={() => setCardOpen(false)}
        />
      ) : cardOpen && panel === 'move' ? (
        <MoveModeChip
          target={{ at: [0, 0, 10] }}
          dx={5}
          dy={0}
          dz={0}
          direction="xyz"
          distance={0}
          cutNormal={[0, 0, 1]}
          faceNormal={[0, 1, 0]}
          compact={compact}
          onDelta={() => {}}
          onDirection={() => {}}
          onClear={() => {}}
          onConfirm={() => {}}
          onDismiss={() => setCardOpen(false)}
        />
      ) : cardOpen && panel === 'paint' ? (
        <PaintModeChip
          compact={compact}
          color="#22d3ee"
          canConfirm
          onSwatch={() => {}}
          onCustom={() => {}}
          onPart={() => {}}
          onUndo={() => {}}
          onClear={() => {}}
          onConfirm={() => {}}
          onDismiss={() => setCardOpen(false)}
        />
      ) : cardOpen && panel === 'sheetPicker' ? (
        <SheetMetalPicker
          compact={compact}
          loader={() => Promise.resolve({ records: [], stale: false, error: null, fetchedAt: null })}
          onCancel={() => setCardOpen(false)}
          onStart={() => {}}
        />
      ) : cardOpen && panel === 'helper' ? (
        <HelperParamModal
          useCard={useCard}
          compact={compact}
          item={HELPER_PALETTE_ITEMS.find((entry) => entry.id === helperId)}
          buffer=""
          onCancel={() => setCardOpen(false)}
          onConfirm={() => {}}
        />
      ) : cardOpen && panel === 'refuse' ? (
        <HelperParamModal
          useCard={useCard}
          compact={compact}
          refuseMessage="This face is not planar. Pick a flat face, then try again."
          refuseTitle="Face not supported"
          onCancel={() => setCardOpen(false)}
        />
      ) : cardOpen && (entry === 'makeExtrude' || entry === 'makeLoft' || entry === 'makeRevolve' || entry === 'makeSweep') ? (
        <FeatureSlotCard
          card={emptyFeatureSlotCard(entry)}
          contours={[{ id: 'c1', name: 'c1', tool: 'circle', label: 'c1 · circle r5' }]}
          compact={compact}
          lengthMm={100}
          onCancel={() => setCardOpen(false)}
          onConfirm={() => {}}
          onPick={() => {}}
          onHover={() => {}}
          onNew={() => {}}
          onOffset={() => {}}
          onCombine={() => {}}
          onMerge={() => {}}
        />
      ) : cardOpen ? (
        <ContourModeChip
          tool="circle"
          entry={entry}
          params={{ radius: 5, segments: 64 }}
          extrude={{ distance: 10, direction: 'normal', sense: 'positive' }}
          combine="add"
          merge
          planeLabel="default +Z top"
          compact={compact}
          onCancel={() => setCardOpen(false)}
          onConfirm={() => {}}
        />
      ) : null}
      <div data-harness="" style={{ position: 'absolute', left: 0, top: 0, opacity: 0, pointerEvents: 'none' }}>
        <button type="button" data-harness-entry="crossSection" onClick={() => { setPanel('contour'); setEntry('crossSection'); }}>circle</button>
        <button type="button" data-harness-entry="makeExtrude" onClick={() => { setPanel('contour'); setEntry('makeExtrude'); }}>extrude</button>
        <button type="button" data-harness-entry="makeLoft" onClick={() => { setPanel('contour'); setEntry('makeLoft'); }}>loft</button>
        <button type="button" data-harness-panel="fillet" onClick={() => setPanel('fillet')}>fillet</button>
        <button type="button" data-harness-panel="shell" onClick={() => setPanel('shell')}>shell</button>
        <button type="button" data-harness-panel="draft" onClick={() => setPanel('draft')}>draft</button>
        <button type="button" data-harness-panel="moveFace" onClick={() => setPanel('moveFace')}>moveFace</button>
        <button type="button" data-harness-panel="deleteFace" onClick={() => setPanel('deleteFace')}>deleteFace</button>
        <button type="button" data-harness-panel="cut" onClick={() => setPanel('cut')}>cut</button>
        <button type="button" data-harness-panel="boolean" onClick={() => setPanel('boolean')}>boolean</button>
        <button type="button" data-harness-panel="move" onClick={() => setPanel('move')}>move</button>
        <button type="button" data-harness-panel="paint" onClick={() => setPanel('paint')}>paint</button>
        <button type="button" data-harness-panel="sheetPicker" onClick={() => setPanel('sheetPicker')}>sheet</button>
        <button type="button" data-harness-helper="cube" onClick={() => { setPanel('helper'); setHelperId('cube'); setUseCard(true); }}>cube</button>
        <button type="button" data-harness-helper="roundedBox" onClick={() => { setPanel('helper'); setHelperId('roundedBox'); setUseCard(true); }}>round</button>
        <button type="button" data-harness-helper="cylinder" onClick={() => { setPanel('helper'); setHelperId('cylinder'); setUseCard(true); }}>cylinder</button>
        <button type="button" data-harness-helper="sphere" onClick={() => { setPanel('helper'); setHelperId('sphere'); setUseCard(true); }}>sphere</button>
        <button type="button" data-harness-helper="tube" onClick={() => { setPanel('helper'); setHelperId('tube'); setUseCard(true); }}>tube</button>
        <button type="button" data-harness-helper="hexPrism" onClick={() => { setPanel('helper'); setHelperId('hexPrism'); setUseCard(true); }}>hex</button>
        <button type="button" data-harness-helper="hole" onClick={() => { setPanel('helper'); setHelperId('hole'); setUseCard(true); }}>hole</button>
        <button type="button" data-harness-helper="mirror" onClick={() => { setPanel('helper'); setHelperId('mirror'); setUseCard(true); }}>mirror</button>
        <button type="button" data-harness-helper="center" onClick={() => { setPanel('helper'); setHelperId('center'); setUseCard(true); }}>center</button>
        <button type="button" data-harness-helper="align" onClick={() => { setPanel('helper'); setHelperId('align'); setUseCard(true); }}>align</button>
        <button type="button" data-harness-helper="array3D" onClick={() => { setPanel('helper'); setHelperId('array3D'); setUseCard(true); }}>array</button>
        <button type="button" data-harness-helper="sweepPath" onClick={() => { setPanel('helper'); setHelperId('sweepPath'); setUseCard(true); }}>path</button>
        <button type="button" data-harness-panel="refuse" onClick={() => { setPanel('refuse'); setUseCard(true); }}>refuse</button>
        <button type="button" data-harness-use-card="0" onClick={() => setUseCard(false)}>sheet</button>
        <button type="button" data-harness-compact="1" onClick={() => setCompact(true)}>phone</button>
        <button type="button" data-harness-compact="0" onClick={() => setCompact(false)}>desktop</button>
        <button type="button" data-harness-card="1" onClick={() => setCardOpen(true)}>open</button>
        <button type="button" data-harness-card="0" onClick={() => setCardOpen(false)}>close</button>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<Stage />);
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

  const html = `<!doctype html>
<html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<style>${processed.css}
html, body, #root { margin: 0; height: 100%; background: #111; }
</style></head>
<body>
<div id="root"></div>
<script>
(function () {
  const listeners = { resize: new Set(), scroll: new Set() };
  let height = window.innerHeight;
  let offsetTop = 0;
  const vv = {
    get height() { return height; },
    get offsetTop() { return offsetTop; },
    get width() { return window.innerWidth; },
    get scale() { return 1; },
    addEventListener(type, fn) { (listeners[type] || (listeners[type] = new Set())).add(fn); },
    removeEventListener(type, fn) { listeners[type] && listeners[type].delete(fn); },
  };
  Object.defineProperty(window, 'visualViewport', { configurable: true, get() { return vv; } });
  window.__setVisualViewport = (h, top) => {
    height = h;
    offsetTop = top || 0;
    (listeners.resize || []).forEach((fn) => fn());
  };
})();
</script>
<script>${bundled.outputFiles[0].text}</script>
</body></html>`;

  const browser = await chromium.launch({
    executablePath: exe,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
attachConsentPresetToBrowser(browser);
  const pageErrors = [];
  try {
    mkdirSync(shotDir, { recursive: true });
    const page = await browser.newPage({ viewport: PHONE, deviceScaleFactor: 1 });
    page.on('pageerror', (err) => pageErrors.push(String(err && err.message || err)));
    await page.setContent(html, { waitUntil: 'load' });
    await page.waitForSelector('[data-feature-card]', { timeout: 15000 });
    await page.waitForFunction(() => window.__sheet && window.__sheet.camera);

    const readCard = () => page.evaluate(() => {
      const card = document.querySelector('[data-feature-card]');
      const pane = document.querySelector('[data-harness-pane]');
      const left = document.querySelector('[data-rail-pair="left"]').getBoundingClientRect();
      const right = document.querySelector('[data-rail-pair="right"]').getBoundingClientRect();
      const box = card.getBoundingClientRect();
      const paneBox = pane.getBoundingClientRect();
      const pill = document.querySelector('[data-home-indicator-pill]');
      const pillBox = pill ? pill.getBoundingClientRect() : null;
      const body = card.querySelector('[data-feature-sheet-body]');
      const footer = card.querySelector('[data-feature-sheet-footer]');
      const cs = getComputedStyle(card);
      const root = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      return {
        left: box.left - paneBox.left,
        width: box.width,
        top: box.top - paneBox.top,
        bottomGap: paneBox.bottom - box.bottom,
        height: box.height,
        paneH: paneBox.height,
        paneW: paneBox.width,
        gapLeft: box.left - left.right,
        gapRight: right.left - box.right,
        overlapRight: box.right > right.left - 0.5,
        fullLeft: card.getAttribute('data-feature-card-full-left') || '',
        centerDelta: (box.left + box.width / 2) - ((left.right + right.left) / 2),
        pillGap: pillBox ? pillBox.top - box.bottom : null,
        maxHeight: cs.maxHeight,
        radius: cs.borderRadius,
        compact: card.getAttribute('data-feature-card-compact'),
        cap: 22 * root,
        bodyOverflow: getComputedStyle(body).overflowY,
        footerH: footer.getBoundingClientRect().height,
      };
    });

    const show = async (entry, compact) => {
      await page.evaluate(({ entry: next, compact: phone }) => {
        document.querySelector(`[data-harness-compact="${phone ? '1' : '0'}"]`).click();
        document.querySelector(`[data-harness-entry="${next}"]`).click();
      }, { entry, compact });
      await page.waitForFunction(({ entry: next, compact: phone }) => {
        const card = document.querySelector('[data-feature-card]');
        const title = document.querySelector('[data-feature-card-title]');
        return card
          && card.getAttribute('data-feature-card-compact') === (phone ? '1' : '0')
          && title
          && title.textContent.trim() === ({ makeExtrude: 'Extrude', makeLoft: 'Loft', makeRevolve: 'Revolve', makeSweep: 'Sweep' }[next] || 'Contour');
      }, { entry, compact }, { timeout: 5000 });
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    };

    const parkAndShoot = async (name, { slide }) => {
      const result = await page.evaluate(({ slide: doSlide }) => window.__sheet.park({ slide: doSlide }), { slide });
      await page.screenshot({ path: join(shotDir, name) });
      return result;
    };

    const waitCard = async (pred) => {
      let place = null;
      for (let i = 0; i < 20; i += 1) {
        place = await readCard();
        if (pred(place)) return place;
        await page.waitForTimeout(50);
      }
      return place;
    };
    const fullLeftPhone = (place) => !!(place
      && place.compact === '1'
      && place.fullLeft === '1'
      && Math.abs(place.left - 10) <= 2
      && place.gapRight >= 8
      && place.overlapRight === false);
    const centeredPhone = (place) => !!(place
      && place.compact === '1'
      && place.fullLeft === ''
      && Math.abs(place.centerDelta) <= 2
      && place.gapLeft >= 8
      && place.gapRight >= 8
      && Math.abs(place.left - 10) > 2);

    await show('crossSection', true);
    let card = await readCard();
    check('phone card is at most 22rem and 10px clear of each rail',
      card.width <= card.cap + 1.5
      && card.gapLeft >= 8
      && card.gapRight >= 8
      && card.width > 120,
      JSON.stringify(card));
    check('phone card height is capped and the body scrolls',
      card.height <= 362
      && card.height > 160
      && (card.bodyOverflow === 'auto' || card.bodyOverflow === 'scroll'),
      JSON.stringify({ height: card.height, overflow: card.bodyOverflow, max: card.maxHeight }));

    await page.evaluate(() => document.querySelector('[data-harness-card="0"]').click());
    await page.waitForFunction(() => {
      const el = document.querySelector('[data-mobile-stage-home-indicator]');
      const openCard = document.querySelector('[data-feature-card]');
      if (openCard || !el) return false;
      const box = el.getBoundingClientRect();
      return getComputedStyle(el).display !== 'none' && box.height > 10;
    });
    await page.evaluate(() => {
      window.__sheet.reset();
      window.__sheet.fit();
      window.__sheet.render();
    });
    const switcherWas = await page.evaluate(() => {
      const el = document.querySelector('[data-mobile-stage-home-indicator]');
      const box = el.getBoundingClientRect();
      return {
        bottom: box.bottom,
        height: box.height,
        display: getComputedStyle(el).display,
      };
    });
    check('switcher is visible while the card is closed',
      switcherWas.display !== 'none' && switcherWas.height > 10,
      JSON.stringify(switcherWas));
    const poseBefore = await page.evaluate(() => window.__sheet.pose());
    await page.screenshot({ path: join(shotDir, 'feature-sheet-switcher-390-before.png') });

    await page.evaluate(() => document.querySelector('[data-harness-card="1"]').click());
    await page.waitForSelector('[data-feature-card]');
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const docked = await page.evaluate(() => {
      window.__sheet.session.slideBy(0);
      const ctl = window.__sheet.controls();
      ctl.update();
      window.__sheet.render();
      const el = document.querySelector('[data-mobile-stage-home-indicator]');
      const openCard = document.querySelector('[data-feature-card]');
      const view = document.querySelector('canvas').getBoundingClientRect();
      const cardBox = openCard.getBoundingClientRect();
      const p = ctl.target.clone().project(window.__sheet.camera);
      const sx = (p.x * 0.5 + 0.5) * view.width + view.left;
      const sy = (1 - p.y) * 0.5 * view.height + view.top;
      const visibleH = cardBox.top - view.top;
      const cx = view.left + view.width / 2;
      const cy = view.top + visibleH / 2;
      return {
        display: getComputedStyle(el).display,
        hidden: getComputedStyle(el).display === 'none' || el.getClientRects().length === 0,
        cardBottom: cardBox.bottom,
        dx: sx - cx,
        dy: sy - cy,
      };
    });
    await page.screenshot({ path: join(shotDir, 'feature-sheet-switcher-390-after.png') });
    check('at 390px the switcher is hidden while the card is open',
      docked.hidden,
      JSON.stringify(docked));
    check('at 390px the card bottom matches the switcher bottom within 2px',
      Math.abs(docked.cardBottom - switcherWas.bottom) <= 2,
      JSON.stringify({ cardBottom: docked.cardBottom, switcherBottom: switcherWas.bottom }));
    check('at 390px the orbit target projects to the visible-area center',
      Math.hypot(docked.dx, docked.dy) <= 2,
      JSON.stringify({ dx: docked.dx, dy: docked.dy }));

    const poseAfter = await page.evaluate(() => {
      const sheet = window.__sheet;
      const cam = sheet.camera;
      const ctl = sheet.controls();
      const rot = (v, ang) => {
        const c = Math.cos(ang);
        const s = Math.sin(ang);
        const x = v.x * c - v.y * s;
        const y = v.x * s + v.y * c;
        v.x = x;
        v.y = y;
      };
      rot(cam.position, 0.45);
      rot(cam.up, 0.25);
      cam.lookAt(ctl.target);
      ctl.update();
      sheet.session.restore();
      sheet.controls().update();
      sheet.render();
      return sheet.pose();
    });
    const poseDist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    check('at 390px close restores the pre-open pose after an orbit',
      poseDist(poseAfter.position, poseBefore.position) < 1e-2
      && poseDist(poseAfter.target, poseBefore.target) < 1e-2
      && poseDist(poseAfter.up, poseBefore.up) < 1e-2
      && Math.abs(poseAfter.fov - poseBefore.fov) < 1e-3
      && !(poseAfter.viewOffset && poseAfter.viewOffset.offsetY),
      JSON.stringify({
        position: poseDist(poseAfter.position, poseBefore.position),
        target: poseDist(poseAfter.target, poseBefore.target),
        up: poseDist(poseAfter.up, poseBefore.up),
      }));
    await page.evaluate(() => document.querySelector('[data-harness-card="0"]').click());
    await page.waitForFunction(() => {
      const el = document.querySelector('[data-mobile-stage-home-indicator]');
      return !document.querySelector('[data-feature-card]')
        && el
        && getComputedStyle(el).display !== 'none'
        && el.getBoundingClientRect().height > 10;
    });
    check('at 390px the switcher is back after the card closes', true);

    await page.evaluate(() => document.querySelector('[data-harness-card="1"]').click());
    await page.waitForSelector('[data-feature-card]');
    await page.evaluate(() => {
      window.__sheet.reset();
      window.__sheet.fit();
    });

    const phoneBefore = await parkAndShoot('feature-sheet-circle-390-before.png', { slide: false });
    check('phone before-slide parks the part under the card',
      phoneBefore.low < phoneBefore.cardTop,
      JSON.stringify(phoneBefore));
    const phoneAfter = await parkAndShoot('feature-sheet-circle-390-after.png', { slide: true });
    check('phone: projected part box sits above the card while it is open',
      Number.isFinite(phoneAfter.low) && phoneAfter.low + 0.02 >= phoneAfter.cardTop,
      JSON.stringify(phoneAfter));

    await show('makeExtrude', true);
    const extrudeHeading = await page.evaluate(() => ({
      title: (document.querySelector('[data-feature-card-title]')?.textContent || '').trim(),
      subtitle: (document.querySelector('[data-feature-card-subtitle]')?.textContent || '').trim(),
    }));
    check('extrude card title is Extrude',
      extrudeHeading.title === 'Extrude',
      JSON.stringify(extrudeHeading));
    check('extrude card subtitle names a contour',
      /contour/i.test(extrudeHeading.subtitle) && !/Circle/.test(extrudeHeading.subtitle),
      JSON.stringify(extrudeHeading));
    await parkAndShoot('feature-sheet-extrude-390-before.png', { slide: false });
    await parkAndShoot('feature-sheet-extrude-390-after.png', { slide: true });
    const extrudeCard = await readCard();
    check('extrude card stays inside the same phone cap',
      extrudeCard.height <= 362 && extrudeCard.width <= extrudeCard.cap + 1.5,
      JSON.stringify({ h: extrudeCard.height, w: extrudeCard.width }));

    await page.evaluate(() => {
      const pane = document.querySelector('[data-harness-pane]');
      pane.style.height = '340px';
      window.__setVisualViewport(340, 0);
    });
    await page.waitForFunction(() => {
      const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--modal-vvh'));
      return v > 0 && v <= 340;
    });
    await show('makeLoft', true);
    await page.locator('[data-popup-number="loft-offset"]').first().focus();
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const focused = await page.evaluate(() => {
      const el = document.activeElement;
      const card = document.querySelector('[data-feature-card]');
      const body = card.querySelector('[data-feature-sheet-body]');
      const footer = card.querySelector('[data-feature-sheet-footer]');
      const pane = document.querySelector('[data-harness-pane]');
      const field = el.getBoundingClientRect();
      const bodyBox = body.getBoundingClientRect();
      const footerBox = footer.getBoundingClientRect();
      const paneBox = pane.getBoundingClientRect();
      const vv = window.visualViewport.height;
      return {
        tag: el.tagName,
        font: parseFloat(getComputedStyle(el).fontSize),
        top: field.top,
        bottom: field.bottom,
        bodyTop: bodyBox.top,
        bodyBottom: bodyBox.bottom,
        footerTop: footerBox.top,
        paneBottom: paneBox.bottom,
        vv,
        cardH: card.getBoundingClientRect().height,
      };
    });
    check('a focused number stays inside the shrunk visual viewport, above the footer',
      focused.font >= 16
      && focused.top >= focused.bodyTop - 2
      && focused.bottom <= focused.bodyBottom + 2
      && focused.bottom <= focused.footerTop + 2
      && focused.bottom <= focused.vv + 2
      && focused.bottom <= focused.paneBottom + 2
      && focused.cardH < 360,
      JSON.stringify(focused));
    await page.evaluate(() => {
      document.querySelector('[data-harness-pane]').style.height = '';
      window.__setVisualViewport(window.innerHeight, 0);
    });

    await page.setViewportSize({ width: 1280, height: 800 });
    await show('crossSection', false);
    await page.evaluate(() => window.__sheet.fit());
    card = await readCard();
    check('desktop card stays a card: 22rem cap, 10px off the bottom, clear of the rails',
      card.compact === '0'
      && card.width <= card.cap + 1.5
      && card.width >= card.cap - 4
      && card.bottomGap >= 8
      && card.bottomGap <= 16
      && card.gapLeft >= 8
      && card.gapRight >= 8
      && card.pillGap == null,
      JSON.stringify(card));
    const deskBefore = await parkAndShoot('feature-sheet-circle-desktop-before.png', { slide: false });
    check('desktop before-slide parks the part under the card',
      deskBefore.low < deskBefore.cardTop,
      JSON.stringify(deskBefore));
    const deskAfter = await parkAndShoot('feature-sheet-circle-desktop-after.png', { slide: true });
    check('desktop: projected part box sits above the card while it is open',
      Number.isFinite(deskAfter.low) && deskAfter.low + 0.02 >= deskAfter.cardTop,
      JSON.stringify(deskAfter));

    await show('makeExtrude', false);
    await parkAndShoot('feature-sheet-extrude-desktop-before.png', { slide: false });
    await parkAndShoot('feature-sheet-extrude-desktop-after.png', { slide: true });

    const showFillet = async (phone) => {
      await page.setViewportSize(phone ? PHONE : { width: 1280, height: 800 });
      await page.evaluate((next) => {
        document.querySelector(`[data-harness-compact="${next ? '1' : '0'}"]`).click();
        document.querySelector('[data-harness-card="1"]').click();
        document.querySelector('[data-harness-panel="fillet"]').click();
      }, phone);
      await page.waitForFunction((next) => {
        const card = document.querySelector('[data-feature-card]');
        const title = document.querySelector('[data-feature-card-title]');
        const confirm = document.querySelector('[data-feature-card-confirm]');
        return card
          && card.getAttribute('data-edge-blend') === 'fillet'
          && card.getAttribute('data-feature-card-compact') === (next ? '1' : '0')
          && title
          && title.textContent.includes('Fillet')
          && confirm
          && confirm.textContent.includes('Confirm')
          && !confirm.textContent.includes('Accept');
      }, phone, { timeout: 5000 });
      await page.evaluate(() => window.__sheet.fit());
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    };

    await showFillet(true);
    const filletPhone = await waitCard(fullLeftPhone);
    const filletSwitcher = await page.evaluate(() => {
      const el = document.querySelector('[data-mobile-stage-home-indicator]');
      return {
        hidden: !el || getComputedStyle(el).display === 'none' || el.getClientRects().length === 0,
      };
    });
    check('fillet card on a phone docks and hides the stage switcher',
      fullLeftPhone(filletPhone)
      && filletPhone.width <= filletPhone.cap + 1.5
      && filletSwitcher.hidden
      && Math.abs(filletPhone.bottomGap) <= 2
      && filletPhone.height < 360,
      JSON.stringify({ ...filletPhone, ...filletSwitcher }));
    check('at 390px the fillet card left edge is 10px and it does not overlap the right rail',
      fullLeftPhone(filletPhone),
      JSON.stringify(filletPhone));
    const filletPick = await page.evaluate(() => {
      const pane = document.querySelector('[data-harness-pane]');
      const box = pane.getBoundingClientRect();
      const el = document.elementFromPoint(box.left + box.width / 2, box.top + 36);
      return {
        tag: el && el.tagName,
        onCard: !!(el && el.closest('[data-feature-card]')),
      };
    });
    check('a point above the fillet card is the canvas, so edge picks still land',
      filletPick.tag === 'CANVAS' && filletPick.onCard === false,
      JSON.stringify(filletPick));
    await parkAndShoot('feature-sheet-fillet-390-before.png', { slide: false });
    const filletAfter = await parkAndShoot('feature-sheet-fillet-390-after.png', { slide: true });
    check('phone fillet: projected part box sits above the card',
      Number.isFinite(filletAfter.low) && filletAfter.low + 0.02 >= filletAfter.cardTop,
      JSON.stringify(filletAfter));

    await showFillet(false);
    const filletDesk = await waitCard((place) => place
      && place.compact === '0'
      && place.fullLeft === '1'
      && Math.abs(place.left - 10) <= 2
      && place.gapRight >= 8
      && place.overlapRight === false);
    check('fillet card on desktop pins the left edge and stays clear of the right rail',
      filletDesk.compact === '0'
      && filletDesk.fullLeft === '1'
      && filletDesk.width <= filletDesk.cap + 1.5
      && filletDesk.bottomGap >= 8
      && filletDesk.bottomGap <= 16
      && Math.abs(filletDesk.left - 10) <= 2
      && filletDesk.gapRight >= 8
      && filletDesk.overlapRight === false
      && filletDesk.pillGap == null,
      JSON.stringify(filletDesk));
    await parkAndShoot('feature-sheet-fillet-desktop-before.png', { slide: false });
    const filletDeskAfter = await parkAndShoot('feature-sheet-fillet-desktop-after.png', { slide: true });
    check('desktop fillet: projected part box sits above the card',
      Number.isFinite(filletDeskAfter.low) && filletDeskAfter.low + 0.02 >= filletDeskAfter.cardTop,
      JSON.stringify(filletDeskAfter));

    const orbit = await page.evaluate(() => {
      const sheet = window.__sheet;
      const before = sheet.pose();
      sheet.session.slideBy(-0.25);
      const cam = sheet.camera;
      const ctl = sheet.controls();
      const rot = (v, ang) => {
        const c = Math.cos(ang);
        const s = Math.sin(ang);
        const x = v.x * c - v.y * s;
        const y = v.x * s + v.y * c;
        v.x = x;
        v.y = y;
      };
      rot(cam.position, 0.5);
      rot(cam.up, 0.3);
      cam.lookAt(ctl.target);
      ctl.update();
      const mid = sheet.pose();
      const drifted = Math.hypot(
        mid.position[0] - before.position[0],
        mid.position[1] - before.position[1],
        mid.position[2] - before.position[2],
      ) > 1;
      sheet.session.restore();
      sheet.controls().update();
      const after = sheet.pose();
      const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
      return {
        drifted,
        position: dist(after.position, before.position),
        target: dist(after.target, before.target),
        up: dist(after.up, before.up),
        fov: Math.abs(after.fov - before.fov),
      };
    });
    check('browser: close restores the pre-open pose after an orbit',
      orbit.drifted
      && orbit.position < 1e-2
      && orbit.target < 1e-2
      && orbit.up < 1e-2
      && orbit.fov < 1e-3,
      JSON.stringify(orbit));

    const showFace = async (name, titleText, marker) => {
      await page.setViewportSize(PHONE);
      await page.evaluate((panelName) => {
        document.querySelector('[data-harness-compact="1"]').click();
        document.querySelector('[data-harness-card="1"]').click();
        document.querySelector(`[data-harness-panel="${panelName}"]`).click();
      }, name);
      await page.waitForFunction(({ titleText: want, marker: attr }) => {
        const cards = document.querySelectorAll('[data-feature-card]');
        const card = cards[0];
        const title = document.querySelector('[data-feature-card-title]');
        const confirm = document.querySelector('[data-feature-card-confirm]');
        const cancel = document.querySelector('[data-feature-card-cancel]');
        return cards.length === 1
          && card
          && card.getAttribute(attr) != null
          && card.getAttribute('data-feature-card-compact') === '1'
          && title
          && title.textContent.includes(want)
          && confirm
          && confirm.textContent.includes('Confirm')
          && cancel;
      }, { titleText, marker }, { timeout: 5000 });
      await page.evaluate(() => window.__sheet.fit());
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    };

    await showFace('shell', 'Shell', 'data-shell-mode');
    const shellPick = await page.evaluate(() => {
      const pane = document.querySelector('[data-harness-pane]');
      const box = pane.getBoundingClientRect();
      const el = document.elementFromPoint(box.left + box.width / 2, box.top + 36);
      return {
        tag: el && el.tagName,
        onCard: !!(el && el.closest('[data-feature-card]')),
      };
    });
    check('a point above the shell card is the canvas, so face picks still land',
      shellPick.tag === 'CANVAS' && shellPick.onCard === false,
      JSON.stringify(shellPick));
    const shellPhone = await waitCard(fullLeftPhone);
    const shellSwitcher = await page.evaluate(() => {
      const el = document.querySelector('[data-mobile-stage-home-indicator]');
      return {
        hidden: !el || getComputedStyle(el).display === 'none' || el.getClientRects().length === 0,
      };
    });
    check('shell card on a phone docks and hides the stage switcher',
      fullLeftPhone(shellPhone)
      && shellPhone.width <= shellPhone.cap + 1.5
      && shellSwitcher.hidden
      && Math.abs(shellPhone.bottomGap) <= 2
      && shellPhone.height < 360,
      JSON.stringify({ ...shellPhone, ...shellSwitcher }));
    await parkAndShoot('feature-sheet-shell-390-before.png', { slide: false });
    const shellAfter = await parkAndShoot('feature-sheet-shell-390-after.png', { slide: true });
    check('phone shell: projected part box sits above the card',
      Number.isFinite(shellAfter.low) && shellAfter.low + 0.02 >= shellAfter.cardTop,
      JSON.stringify(shellAfter));

    const phoneDocked = async (label) => {
      const card = await readCard();
      const sw = await page.evaluate(() => {
        const el = document.querySelector('[data-mobile-stage-home-indicator]');
        return {
          hidden: !el || getComputedStyle(el).display === 'none' || el.getClientRects().length === 0,
        };
      });
      check(`${label} docks and hides the stage switcher`,
        card.compact === '1' && sw.hidden && Math.abs(card.bottomGap) <= 2,
        JSON.stringify({ bottomGap: card.bottomGap, compact: card.compact, ...sw }));
    };

    await showFace('draft', 'Draft', 'data-draft-mode');
    await phoneDocked('draft card on a phone');
    await parkAndShoot('feature-sheet-draft-390-before.png', { slide: false });
    await parkAndShoot('feature-sheet-draft-390-after.png', { slide: true });
    await showFace('moveFace', 'Move Face', 'data-move-face-mode');
    await phoneDocked('move-face card on a phone');
    await parkAndShoot('feature-sheet-move-face-390-before.png', { slide: false });
    await parkAndShoot('feature-sheet-move-face-390-after.png', { slide: true });
    await showFace('deleteFace', 'Delete Face', 'data-delete-face-mode');
    await phoneDocked('delete-face card on a phone');
    const deletePick = await page.evaluate(() => {
      const pane = document.querySelector('[data-harness-pane]');
      const box = pane.getBoundingClientRect();
      const el = document.elementFromPoint(box.left + box.width / 2, box.top + 36);
      return {
        tag: el && el.tagName,
        onCard: !!(el && el.closest('[data-feature-card]')),
        cards: document.querySelectorAll('[data-feature-card]').length,
      };
    });
    check('a point above the delete-face card is the canvas',
      deletePick.tag === 'CANVAS' && deletePick.onCard === false && deletePick.cards === 1,
      JSON.stringify(deletePick));
    await parkAndShoot('feature-sheet-delete-face-390-before.png', { slide: false });
    await parkAndShoot('feature-sheet-delete-face-390-after.png', { slide: true });

    await showFace('cut', 'Cut', 'data-cut-mode');
    await phoneDocked('cut card on a phone');
    const cutPick = await page.evaluate(() => {
      const pane = document.querySelector('[data-harness-pane]');
      const box = pane.getBoundingClientRect();
      const el = document.elementFromPoint(box.left + box.width / 2, box.top + 36);
      return {
        tag: el && el.tagName,
        onCard: !!(el && el.closest('[data-feature-card]')),
        cards: document.querySelectorAll('[data-feature-card]').length,
      };
    });
    check('a point above the cut card is the canvas',
      cutPick.tag === 'CANVAS' && cutPick.onCard === false && cutPick.cards === 1,
      JSON.stringify(cutPick));
    await parkAndShoot('feature-sheet-cut-390-before.png', { slide: false });
    const cutAfter = await parkAndShoot('feature-sheet-cut-390-after.png', { slide: true });
    check('phone cut: projected part box sits above the card',
      Number.isFinite(cutAfter.low) && cutAfter.low + 0.02 >= cutAfter.cardTop,
      JSON.stringify(cutAfter));
    const cutPhone = await waitCard(fullLeftPhone);
    check('at 390px the cut card left edge is 10px and it does not overlap the right rail',
      fullLeftPhone(cutPhone),
      JSON.stringify(cutPhone));

    await showFace('boolean', 'Boolean', 'data-boolean-mode');
    await phoneDocked('boolean card on a phone');
    const booleanRail = await page.evaluate(() => {
      const card = document.querySelector('[data-feature-card]');
      const pane = document.querySelector('[data-harness-pane]');
      const box = pane.getBoundingClientRect();
      const el = document.elementFromPoint(box.left + box.width / 2, box.top + 36);
      const z = card ? getComputedStyle(card).zIndex : '';
      return {
        tag: el && el.tagName,
        onCard: !!(el && el.closest('[data-feature-card]')),
        cards: document.querySelectorAll('[data-feature-card]').length,
        z,
        section: card && card.getAttribute('data-boolean-allow-section'),
      };
    });
    check('boolean card is z-20 and a point above it is the canvas',
      booleanRail.tag === 'CANVAS'
      && booleanRail.onCard === false
      && booleanRail.cards === 1
      && booleanRail.z === '20'
      && booleanRail.section === '1',
      JSON.stringify(booleanRail));
    await parkAndShoot('feature-sheet-boolean-390-before.png', { slide: false });
    await parkAndShoot('feature-sheet-boolean-390-after.png', { slide: true });
    const booleanPhone = await waitCard(fullLeftPhone);
    check('at 390px the boolean card left edge is 10px and it does not overlap the right rail',
      fullLeftPhone(booleanPhone) && booleanPhone && booleanRail.z === '20',
      JSON.stringify({ ...booleanPhone, z: booleanRail.z }));

    await showFace('move', 'Move', 'data-move-mode');
    await phoneDocked('move card on a phone');
    await parkAndShoot('feature-sheet-move-390-before.png', { slide: false });
    await parkAndShoot('feature-sheet-move-390-after.png', { slide: true });

    const showHelper = async (id, titleText, marker, confirmText = 'Confirm') => {
      await page.setViewportSize(PHONE);
      await page.evaluate((helper) => {
        document.querySelector('[data-harness-compact="1"]').click();
        document.querySelector('[data-harness-card="1"]').click();
        document.querySelector(`[data-harness-helper="${helper}"]`).click();
      }, id);
      await page.waitForFunction(({ titleText: want, marker: attr, confirmText: confirmWant, id: wantId }) => {
        const cards = document.querySelectorAll('[data-feature-card]');
        const card = cards[0];
        const title = document.querySelector('[data-feature-card-title]');
        const confirm = document.querySelector('[data-feature-card-confirm]');
        const cancel = document.querySelector('[data-feature-card-cancel]');
        return cards.length === 1
          && card
          && card.getAttribute(attr) === wantId
          && card.id === 'helper-param-title'
          && card.getAttribute('data-feature-card-compact') === '1'
          && title
          && title.textContent.includes(want)
          && confirm
          && confirm.textContent.includes(confirmWant)
          && cancel
          && !document.querySelector('.absolute.inset-0.z-50');
      }, { titleText, marker, confirmText, id }, { timeout: 5000 });
      await page.evaluate(() => window.__sheet.fit());
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    };

    const helpers = [
      ['cube', 'Cube'],
      ['roundedBox', 'Round box'],
      ['cylinder', 'Cylinder'],
      ['sphere', 'Sphere'],
      ['tube', 'Tube'],
      ['hexPrism', 'Hex'],
      ['hole', 'Hole'],
      ['mirror', 'Mirror'],
      ['center', 'Center'],
      ['align', 'Align'],
      ['array3D', 'Array'],
      ['sweepPath', 'Path'],
    ];
    for (const [id, titleText] of helpers) {
      await showHelper(id, titleText, 'data-helper-param');
      await phoneDocked(`${titleText} card on a phone`);
      const slug = id === 'roundedBox' ? 'round-box' : id === 'hexPrism' ? 'hex' : id === 'array3D' ? 'array' : id === 'sweepPath' ? 'path' : id;
      await parkAndShoot(`feature-sheet-${slug}-390-before.png`, { slide: false });
      const after = await parkAndShoot(`feature-sheet-${slug}-390-after.png`, { slide: true });
      if (id === 'cube') {
        const above = await page.evaluate(() => {
          const pane = document.querySelector('[data-harness-pane]');
          const box = pane.getBoundingClientRect();
          const el = document.elementFromPoint(box.left + box.width / 2, box.top + 36);
          return {
            tag: el && el.tagName,
            onCard: !!(el && el.closest('[data-feature-card]')),
            cards: document.querySelectorAll('[data-feature-card]').length,
          };
        });
        check('a point above the cube card is the canvas',
          above.tag === 'CANVAS' && above.onCard === false && above.cards === 1,
          JSON.stringify(above));
        check('phone cube: projected part box sits above the card',
          Number.isFinite(after.low) && after.low + 0.02 >= after.cardTop,
          JSON.stringify(after));
      }
    }

    await page.setViewportSize(PHONE);
    await page.evaluate(() => {
      document.querySelector('[data-harness-compact="1"]').click();
      document.querySelector('[data-harness-card="1"]').click();
      document.querySelector('[data-harness-panel="refuse"]').click();
    });
    await page.waitForFunction(() => {
      const cards = document.querySelectorAll('[data-feature-card]');
      const card = cards[0];
      const title = document.querySelector('[data-feature-card-title]');
      const confirm = document.querySelector('[data-feature-card-confirm]');
      return cards.length === 1
        && card
        && card.getAttribute('data-helper-refuse') === '1'
        && card.getAttribute('data-feature-card-compact') === '1'
        && title
        && title.textContent.includes('Face not supported')
        && confirm
        && confirm.textContent.includes('OK');
    }, null, { timeout: 5000 });
    await page.evaluate(() => window.__sheet.fit());
    await phoneDocked('refuse card on a phone');
    await parkAndShoot('feature-sheet-refuse-390-before.png', { slide: false });
    await parkAndShoot('feature-sheet-refuse-390-after.png', { slide: true });

    await page.setViewportSize(PHONE);
    await page.evaluate(() => {
      document.querySelector('[data-harness-compact="1"]').click();
      document.querySelector('[data-harness-card="1"]').click();
      document.querySelector('[data-harness-panel="paint"]').click();
    });
    await page.waitForFunction(() => {
      const card = document.querySelector('[data-feature-card]');
      const title = document.querySelector('[data-feature-card-title]');
      return card
        && card.getAttribute('data-paint-mode') === '1'
        && card.getAttribute('data-feature-card-compact') === '1'
        && title
        && title.textContent.includes('Paint');
    }, null, { timeout: 5000 });
    await page.evaluate(() => window.__sheet.fit());
    const paintPhone = await waitCard(fullLeftPhone);
    check('at 390px the paint card left edge is 10px and it does not overlap the right rail',
      fullLeftPhone(paintPhone),
      JSON.stringify(paintPhone));
    await page.screenshot({ path: join(shotDir, 'feature-sheet-paint-390.png') });

    await page.evaluate(() => {
      document.querySelector('[data-harness-panel="sheetPicker"]').click();
    });
    await page.waitForFunction(() => {
      const card = document.querySelector('[data-feature-card][data-sheet-metal-picker="1"]');
      const title = document.querySelector('[data-feature-card-title]');
      return card
        && card.getAttribute('data-feature-card-compact') === '1'
        && title
        && title.textContent.includes('Sheet Metal');
    }, null, { timeout: 5000 });
    const sheetPickerPhone = await waitCard(centeredPhone);
    check('at 390px the sheet metal picker stays centered',
      centeredPhone(sheetPickerPhone),
      JSON.stringify(sheetPickerPhone));
    await page.screenshot({ path: join(shotDir, 'feature-sheet-sheet-picker-390.png') });

    await page.evaluate(() => {
      document.querySelector('[data-harness-helper="cube"]').click();
      document.querySelector('[data-harness-use-card="0"]').click();
    });
    await page.waitForFunction(() => !document.querySelector('[data-feature-card]')
      && !!document.querySelector('#helper-param-title')
      && !!document.querySelector('.pointer-events-none'));
    check('game helper sheet is the old docked dialog, not a feature card', true);

    const editBundle = await build({
      stdin: {
        contents: `import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import FeatureEditSheet from './src/components/FeatureEditSheet.jsx';
import { parseFeatureMarkers } from './src/utils/featureMarkers.js';

const SCRIPT = \`// --- contour-mode extrude begin ---
let part = placeInFrame(xs.plane, makeExtrude(xs.contours, 12), [0, 0, 0]);
// --- contour-mode extrude end ---
// --- fillet-mode begin ---
part = filletAlongPath(part, path, 2);
// --- fillet-mode end ---
return part;
\`;
const features = parseFeatureMarkers(SCRIPT);

function EditStage() {
  const [mode, setMode] = useState('edit');
  const [compact, setCompact] = useState(true);
  const [log, setLog] = useState('');
  const feature = features.find((item) => item.kind === 'extrude');
  return (
    <div data-mobile-stage="cad" style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div className="viewport-shell relative h-full w-full overflow-hidden" data-harness-pane="" style={{ background: '#1e1e1e' }}>
        <div data-rail-pair="left" className="absolute bottom-2.5 left-2.5 h-48 w-14" />
        <div data-rail-pair="right" className="absolute bottom-2.5 right-2.5 h-48 w-14" />
        {mode === 'picker' ? (
          <FeatureEditSheet
            features={features}
            script={SCRIPT}
            compact={compact}
            onCancel={() => setLog('cancel')}
            onPickFeature={() => setLog('pick')}
          />
        ) : (
          <FeatureEditSheet
            feature={feature}
            script={SCRIPT}
            compact={compact}
            onAccept={() => setLog('confirm')}
            onCancel={() => setLog('cancel')}
            onDelete={() => setLog('delete')}
            onEditScript={() => setLog('script')}
          />
        )}
      </div>
      <div className="absolute bottom-0 left-1/2 z-30 -translate-x-1/2" data-mobile-stage-home-indicator="">
        <div data-home-indicator-pill="" className="h-8 w-24 rounded-full bg-gray-800" />
      </div>
      <button type="button" data-edit-mode="edit" onClick={() => setMode('edit')}>edit</button>
      <button type="button" data-edit-mode="picker" onClick={() => setMode('picker')}>picker</button>
      <button type="button" data-edit-compact="1" onClick={() => setCompact(true)}>phone</button>
      <button type="button" data-edit-compact="0" onClick={() => setCompact(false)}>desk</button>
      <div data-edit-log="">{log}</div>
    </div>
  );
}

createRoot(document.getElementById('edit-root')).render(<EditStage />);
`,
        resolveDir: ROOT,
        loader: 'jsx',
      },
      bundle: true,
      format: 'iife',
      platform: 'browser',
      write: false,
      jsx: 'automatic',
      logLevel: 'error',
      loader: { '.css': 'empty', '.svg': 'text', '.png': 'dataurl' },
    });
    const editHtml = `<!doctype html><html><head><meta charset="utf-8" />
<style>${processed.css}
html, body, #edit-root { margin: 0; height: 100%; background: #111; }
button[data-edit-mode], button[data-edit-compact] { display: none; }
</style></head><body><div id="edit-root"></div><script>${editBundle.outputFiles[0].text}</script></body></html>`;
    await page.setContent(editHtml, { waitUntil: 'load' });
    await page.setViewportSize(PHONE);
    await page.waitForSelector('[data-feature-card][data-feature-sheet-kind="extrude"]');
    const readEditPlace = () => page.evaluate(() => {
      const card = document.querySelector('[data-feature-card]');
      const paneEl = document.querySelector('[data-harness-pane]');
      const pane = paneEl.getBoundingClientRect();
      const box = card.getBoundingClientRect();
      const left = paneEl.querySelector('[data-rail-pair="left"]').getBoundingClientRect();
      const right = paneEl.querySelector('[data-rail-pair="right"]').getBoundingClientRect();
      const pill = document.querySelector('[data-mobile-stage-home-indicator]');
      return {
        cards: document.querySelectorAll('[data-feature-card]').length,
        compact: card.getAttribute('data-feature-card-compact'),
        layout: card.getAttribute('data-feature-sheet-layout'),
        bottom: Math.round(pane.bottom - box.bottom),
        switcher: getComputedStyle(pill).display,
        confirm: document.querySelector('[data-feature-card-confirm]')?.textContent || '',
        editScript: !!document.querySelector('[data-feature-sheet-edit-script]'),
        del: !!document.querySelector('[data-feature-sheet-delete]'),
        fullLeft: card.getAttribute('data-feature-card-full-left') || '',
        left: box.left - pane.left,
        gapLeft: box.left - left.right,
        gapRight: right.left - box.right,
        centerDelta: (box.left + box.width / 2) - ((left.right + right.left) / 2),
      };
    });
    let phoneEdit = null;
    for (let i = 0; i < 20; i += 1) {
      phoneEdit = await readEditPlace();
      if (phoneEdit.fullLeft === '' && Math.abs(phoneEdit.centerDelta) <= 2 && phoneEdit.gapLeft >= 8) break;
      await page.waitForTimeout(50);
    }
    check('phone edit card docks on the pane and hides the switcher',
      phoneEdit.cards === 1
      && phoneEdit.compact === '1'
      && phoneEdit.layout === 'feature-card'
      && phoneEdit.bottom <= 2
      && phoneEdit.switcher === 'none'
      && /Confirm/.test(phoneEdit.confirm)
      && phoneEdit.editScript
      && phoneEdit.del,
      JSON.stringify(phoneEdit));
    check('at 390px the feature edit card stays centered',
      phoneEdit.fullLeft === ''
      && Math.abs(phoneEdit.centerDelta) <= 2
      && phoneEdit.gapLeft >= 8
      && phoneEdit.gapRight >= 8
      && Math.abs(phoneEdit.left - 10) > 2,
      JSON.stringify(phoneEdit));
    await page.screenshot({ path: join(shotDir, 'feature-sheet-edit-390.png') });
    await page.click('[data-feature-card-cancel]');
    const cancelled = await page.evaluate(() => document.querySelector('[data-edit-log]')?.textContent || '');
    check('edit card X cancels and does not confirm', cancelled === 'cancel', cancelled);

    await page.evaluate(() => document.querySelector('[data-edit-mode="edit"]').click());
    await page.waitForSelector('[data-feature-card-confirm]');
    await page.click('[data-feature-card-confirm]');
    const confirmed = await page.evaluate(() => document.querySelector('[data-edit-log]')?.textContent || '');
    check('edit card Confirm saves', confirmed === 'confirm', confirmed);

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.evaluate(() => {
      document.querySelector('[data-edit-compact="0"]').click();
      document.querySelector('[data-edit-mode="edit"]').click();
    });
    await page.waitForFunction(() => {
      const card = document.querySelector('[data-feature-card]');
      return card && card.getAttribute('data-feature-card-compact') === '0';
    });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const desk = await page.evaluate(() => {
      const card = document.querySelector('[data-feature-card]');
      const pane = document.querySelector('[data-harness-pane]').getBoundingClientRect();
      const box = card.getBoundingClientRect();
      return {
        compact: card.getAttribute('data-feature-card-compact'),
        bottom: Math.round(pane.bottom - box.bottom),
        cards: document.querySelectorAll('[data-feature-card]').length,
      };
    });
    check('desktop edit card stays about 10px off the pane',
      desk.compact === '0' && desk.cards === 1 && desk.bottom >= 8 && desk.bottom <= 16,
      JSON.stringify(desk));
    await page.screenshot({ path: join(shotDir, 'feature-sheet-edit-desktop.png') });

    await page.setViewportSize(PHONE);
    await page.evaluate(() => {
      document.querySelector('[data-edit-compact="1"]').click();
      document.querySelector('[data-edit-mode="picker"]').click();
    });
    await page.waitForSelector('[data-feature-sheet-picker]');
    let picker = null;
    for (let i = 0; i < 20; i += 1) {
      picker = await page.evaluate(() => {
        const card = document.querySelector('[data-feature-card]');
        const paneEl = document.querySelector('[data-harness-pane]');
        const pane = paneEl.getBoundingClientRect();
        const box = card.getBoundingClientRect();
        const left = paneEl.querySelector('[data-rail-pair="left"]').getBoundingClientRect();
        const right = paneEl.querySelector('[data-rail-pair="right"]').getBoundingClientRect();
        return {
          layout: card?.getAttribute('data-feature-sheet-layout') || '',
          picks: document.querySelectorAll('[data-feature-sheet-pick]').length,
          confirm: !!document.querySelector('[data-feature-card-confirm]'),
          cards: document.querySelectorAll('[data-feature-card]').length,
          fullLeft: card.getAttribute('data-feature-card-full-left') || '',
          left: box.left - pane.left,
          gapLeft: box.left - left.right,
          gapRight: right.left - box.right,
          centerDelta: (box.left + box.width / 2) - ((left.right + right.left) / 2),
        };
      });
      if (picker.fullLeft === '' && Math.abs(picker.centerDelta) <= 2 && picker.gapLeft >= 8) break;
      await page.waitForTimeout(50);
    }
    check('picker is the same card, with no Confirm',
      picker.layout === 'feature-card' && picker.picks >= 2 && picker.confirm === false && picker.cards === 1,
      JSON.stringify(picker));
    check('at 390px the feature picker stays centered',
      picker.fullLeft === ''
      && Math.abs(picker.centerDelta) <= 2
      && picker.gapLeft >= 8
      && picker.gapRight >= 8
      && Math.abs(picker.left - 10) > 2,
      JSON.stringify(picker));
    await page.screenshot({ path: join(shotDir, 'feature-sheet-picker-390.png') });

    check('the page did not throw', pageErrors.length === 0, pageErrors.join(' | '));
  } finally {
    await browser.close();
  }
}

console.log(failed ? `\n❌ FAIL (${failed} failed)` : `\n✅ PASS`);
process.exit(failed ? 1 : 0);

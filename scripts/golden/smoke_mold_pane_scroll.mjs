#!/usr/bin/env node
/**
 * Phone molding results pane at 390×844, and the same pane at 1280×800.
 * A tool press closes the drawer. The one pane scrolls to its last control.
 * Wheel and drag on the pane leave the TrackballControls camera where it was.
 * The pane stays out of the left and right toolbars at both sizes.
 * Desktop uses the feature-sheet card height cap.
 *
 * Screenshots: GOLDEN_SHOT_DIR or os.tmpdir(). Requires system Chrome.
 */
/* global document, window, WheelEvent, PointerEvent, TouchEvent, getComputedStyle */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
import { chromium } from 'playwright-core';

process.env.BROWSERSLIST_IGNORE_OLD_DATA = '1';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const shotDir = process.env.GOLDEN_SHOT_DIR || tmpdir();

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].filter(Boolean);

const TOOLS = [
  { name: 'wall thickness', button: '[data-wall-heatmap]', pane: '[data-wall-legend]', scroll: false },
  { name: 'core and cavity', button: '[data-mold-parting]', pane: '[data-parting-legend]', scroll: true },
  { name: 'mold draft', button: '[data-mold-draft]', pane: '[data-mold-draft-legend]', scroll: false },
  { name: 'report', button: '[data-mold-dfm]', pane: '[data-mold-report]', scroll: true, shots: true },
];

let failed = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`);
  }
}

function sameCam(a, b) {
  if (!a || !b) return false;
  const close = (x, y) => Math.abs(x - y) < 1e-4;
  return a.pos.every((n, i) => close(n, b.pos[i]))
    && a.target.every((n, i) => close(n, b.target[i]))
    && close(a.zoom, b.zoom)
    && a.up.every((n, i) => close(n, b.up[i]));
}

console.log('mold pane scroll — source');
{
  const drawer = read('src/components/MoldingToolsControl.jsx');
  const press = read('src/components/pressMoldTool.js');
  const css = read('src/index.css');
  check('a tool press closes the drawer then toggles',
    /export function pressMoldTool/.test(press)
    && /setOpen\(false\)/.test(press)
    && /pressMoldTool\(setOpen, onReportToggle\)/.test(drawer));
  check('phone panes cap to dvh, visualViewport, safe area, and the home pill',
    /mold-analysis-pane/.test(css)
    && /100dvh/.test(css)
    && /var\(--modal-vvh, 100dvh\)/.test(css)
    && /--mold-pane-bottom-reserve/.test(css)
    && /touch-action: pan-y/.test(css)
    && /overscroll-behavior: contain/.test(css));
}

const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!exe) {
  console.log('no system Chrome found — set CHROME_PATH');
  process.exit(1);
}

const partingLegend = {
  rows: [
    { role: 'cavity', css: '#60a5fa', label: 'Cavity' },
    { role: 'core', css: '#f87171', label: 'Core' },
    { role: 'parting', css: '#fbbf24', label: 'Parting' },
    { role: 'side', css: '#38bdf8', label: 'Side action' },
  ],
  groups: Array.from({ length: 36 }, (_, i) => ({
    id: `row-${i}`,
    kind: i % 2 ? 'lifter' : 'slide',
    label: i % 2 ? `Lifter ${i + 1}` : `Slide ${i + 1}`,
    pull: '[1, 0, 0]',
    areaLabel: `${12 + i} mm²`,
    css: i % 2 ? '#38bdf8' : '#f59e0b',
    selected: i === 0,
  })),
};

const quoteState = {
  quantity: 1000,
  cavityCount: 1,
  status: 'ready',
  selected: 'North shop',
  quote: { vendors: [{ anonLabel: 'North shop' }] },
  reviewPayable: true,
  reviewFeeUsd: 49,
};

const moldReport = {
  framing: 'Mold report',
  disclaimer: `${'Budgetary, not binding. '.repeat(28)}`,
  grade: 'PC/ABS',
  quantity: 1000,
  geometry: { volumeCm3: 0.8, projectedAreaMm2: 400, sideActionCount: 1 },
  estimates: { pressTons: 2.04 },
  notes: {
    mass: 'The resin library has no density, so part mass is not computed.',
    tooling: 'No tooling rate card was loaded, so the tooling estimate is not computed.',
    price: 'No partner catalog is loaded, so the part price is not computed.',
  },
};

const harness = `import { createRoot } from 'react-dom/client';
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { TrackballControls } from 'three/addons/controls/TrackballControls.js';
import MoldingToolsControl from './src/components/MoldingToolsControl.jsx';
import MoldResultsPane from './src/components/molding/MoldResultsPane.jsx';
import PullReference from './src/components/molding/PullReference.jsx';
import WallLegend from './src/components/molding/WallLegend.jsx';
import PartingLegend from './src/components/molding/PartingLegend.jsx';
import MoldDraftLegend from './src/components/molding/MoldDraftLegend.jsx';
import MoldReportPanel from './src/components/molding/MoldReportPanel.jsx';

const partingLegend = ${JSON.stringify(partingLegend)};
const moldReport = ${JSON.stringify(moldReport)};
const quoteState = ${JSON.stringify(quoteState)};
const resins = [{ grade: 'ABS' }, { grade: 'PC/ABS' }];

function Pane({ children }) {
  const [compact, setCompact] = useState(() => window.matchMedia('(max-width: 768px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)');
    const apply = () => setCompact(mq.matches);
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);
  return <MoldResultsPane compact={compact}>{children}</MoldResultsPane>;
}

function Harness() {
  const canvasRef = useRef(null);
  const [which, setWhich] = useState(null);
  const [on, setOn] = useState({});
  const [pullMode, setPullMode] = useState('auto');
  const [pullPlane, setPullPlane] = useState('top');
  const press = (key) => {
    setOn((prev) => ({ ...prev, [key]: !prev[key] }));
    setWhich(key);
  };
  useEffect(() => {
    window.__moldShow = (key) => setWhich(key);
    return () => { delete window.__moldShow; };
  }, []);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const camera = new THREE.PerspectiveCamera(45, 390 / 844, 0.1, 4000);
    camera.position.set(120, -90, 80);
    camera.up.set(0, 0, 1);
    camera.lookAt(0, 0, 0);
    const controls = new TrackballControls(camera, canvas);
    controls.target.set(0, 0, 0);
    controls.staticMoving = true;
    controls.update();
    const read = () => ({
      pos: camera.position.toArray(),
      target: controls.target.toArray(),
      zoom: camera.zoom,
      up: camera.up.toArray(),
    });
    window.__moldReadCamera = read;
    window.__moldSync = () => { controls.update(); return read(); };
    window.__moldHome = read();
    window.__moldReset = () => {
      camera.position.fromArray(window.__moldHome.pos);
      camera.up.fromArray(window.__moldHome.up);
      controls.target.fromArray(window.__moldHome.target);
      camera.zoom = window.__moldHome.zoom;
      camera.lookAt(controls.target);
      controls.update();
      return read();
    };
    return () => {
      controls.dispose();
      delete window.__moldReadCamera;
      delete window.__moldSync;
      delete window.__moldReset;
    };
  }, []);
  return (
    <div
      className="viewport-shell relative h-dvh w-full overflow-hidden bg-[#1e1e1e]"
      data-mobile-stage=""
      data-mold-harness=""
    >
      <canvas
        ref={canvasRef}
        data-mold-canvas=""
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
      />
      {which === 'wall' && (
        <Pane>
          <WallLegend legend={{ css: 'linear-gradient(#5b21b6, #fde68a)', thinMm: 0.8, nominalMm: 2.4, thickMm: 4.5 }} />
        </Pane>
      )}
      {which === 'parting' && (
        <Pane>
          <PartingLegend legend={partingLegend} />
        </Pane>
      )}
      {which === 'draft' && (
        <Pane>
          <MoldDraftLegend legend={{ minDeg: 1, violations: 14, pins: 8, sleeves: 2, css: '#f97316' }} />
        </Pane>
      )}
      {which === 'report' && (
        <Pane>
          <MoldReportPanel
            report={moldReport}
            resins={resins}
            quoteState={quoteState}
            onGrade={() => {}}
            onQuantity={() => {}}
            onExport={() => {}}
            onFirmQuote={() => {}}
            onHumanReview={() => {}}
            onPayReview={() => {}}
          />
        </Pane>
      )}
      {which === 'results' && (
        <Pane>
          <PullReference
            mode={pullMode}
            plane={pullPlane}
            waiting={pullMode === 'face'}
            onAuto={() => setPullMode('auto')}
            onPlane={() => setPullMode('plane')}
            onFace={() => setPullMode('face')}
            onPickPlane={(id) => { setPullMode('plane'); setPullPlane(id); }}
          />
          <PartingLegend legend={partingLegend} />
        </Pane>
      )}
      <div
        data-rail-pair="left"
        className="absolute left-2 lg:left-4 z-30 w-16 rounded-lg bg-white/60"
        style={{ top: 112, bottom: 10 }}
      />
      <div
        data-rail-pair="right"
        className="absolute right-2.5 z-40 w-16 overflow-visible rounded-lg bg-white/60 p-1"
        style={{ top: 112, bottom: 10 }}
      >
        <MoldingToolsControl
          defaultOpen
          showWall
          showParting
          showMoldDraft
          showReport
          wallActive={!!on.wall}
          partingActive={!!on.parting}
          moldDraftActive={!!on.draft}
          reportActive={!!on.report}
          onWallToggle={() => press('wall')}
          onPartingToggle={() => press('parting')}
          onMoldDraftToggle={() => press('draft')}
          onReportToggle={() => press('report')}
        />
      </div>
      <div
        data-mobile-stage-home-indicator=""
        style={{
          position: 'absolute',
          left: '50%',
          bottom: 0,
          transform: 'translateX(-50%)',
          zIndex: 40,
          paddingBottom: 'max(8px, var(--safe-area-bottom, 0px))',
        }}
      >
        <div
          data-home-indicator-pill=""
          className="surface-glass-chip"
          style={{
            width: 112,
            height: 30,
            borderRadius: 999,
            border: '1px solid rgb(255 255 255 / 0.2)',
            background: 'rgb(var(--chrome-surface) / 0.55)',
          }}
        />
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<Harness />);
`;

function railsClear() {
  const pane = document.querySelector('[data-mold-results-pane]');
  const left = document.querySelector('[data-rail-pair="left"]');
  const right = document.querySelector('[data-rail-pair="right"]');
  if (!pane || !left || !right) return { missing: true };
  const a = pane.getBoundingClientRect();
  const l = left.getBoundingClientRect();
  const r = right.getBoundingClientRect();
  const hit = (b) => a.left < b.right - 0.5 && a.right > b.left + 0.5 && a.top < b.bottom - 0.5 && a.bottom > b.top + 0.5;
  return {
    placed: pane.getAttribute('data-mold-results-placed'),
    hitLeft: hit(l),
    hitRight: hit(r),
    gapLeft: a.left - l.right,
    gapRight: r.left - a.right,
    pane: { left: a.left, right: a.right, top: a.top, bottom: a.bottom, width: a.width, height: a.height },
  };
}

function measureInPage(selector) {
  const section = document.querySelector(selector);
  const pane = (section && section.closest('[data-mold-results-pane]')) || section;
  const end = (section && section.querySelector('[data-mold-pane-end]')) || pane.querySelector('[data-mold-pane-end]');
  const controls = [...pane.querySelectorAll('button, input, select')];
  const last = controls.length ? controls[controls.length - 1] : end;
  const target = last || end || pane;
  target.scrollIntoView({ block: 'end', inline: 'nearest' });
  pane.scrollTop = pane.scrollHeight;
  const paneBox = pane.getBoundingClientRect();
  const endBox = target.getBoundingClientRect();
  const cs = getComputedStyle(pane);
  const rootCs = getComputedStyle(document.documentElement);
  const probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;visibility:hidden;height:100dvh;';
  document.body.appendChild(probe);
  const dvh = probe.getBoundingClientRect().height;
  probe.style.height = 'auto';
  probe.style.top = 'calc(var(--feature-strip-offset-mobile) + var(--feature-strip-height) + var(--joint-row-height) + var(--feature-strip-rail-gap))';
  const anchorTop = parseFloat(getComputedStyle(probe).top) || 0;
  probe.style.top = '0';
  probe.style.height = 'var(--safe-area-top)';
  const safeTop = probe.getBoundingClientRect().height;
  probe.remove();
  const safeBottom = parseFloat(rootCs.getPropertyValue('--safe-area-bottom')) || 0;
  const reserve = 30 + Math.max(8, safeBottom) + 10;
  const modalVvh = parseFloat(rootCs.getPropertyValue('--modal-vvh')) || dvh;
  const modalTop = parseFloat(rootCs.getPropertyValue('--modal-vv-top')) || 0;
  const expected = Math.min(dvh, modalVvh) - modalTop - safeTop - anchorTop - reserve;
  const pill = document.querySelector('[data-home-indicator-pill]');
  const pillTop = pill ? pill.getBoundingClientRect().top : window.innerHeight;
  return {
    overflowY: cs.overflowY,
    touchAction: cs.touchAction,
    overscroll: cs.overscrollBehavior,
    pointerEvents: cs.pointerEvents,
    maxHeight: parseFloat(cs.maxHeight),
    expected,
    scrollTop: pane.scrollTop,
    scrollHeight: pane.scrollHeight,
    clientHeight: pane.clientHeight,
    paneTop: paneBox.top,
    paneBottom: paneBox.bottom,
    endTop: endBox.top,
    endBottom: endBox.bottom,
    innerHeight: window.innerHeight,
    pillTop,
    pageScroll: document.scrollingElement.scrollTop,
    shellHits: window.__shellHits || 0,
  };
}

const bundled = await build({
  stdin: {
    contents: harness,
    resolveDir: ROOT,
    loader: 'jsx',
    sourcefile: 'mold-pane-harness.jsx',
  },
  bundle: true,
  format: 'iife',
  platform: 'browser',
  write: false,
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'error',
});

const processed = await postcss([
  tailwindcss({ config: join(ROOT, 'tailwind.config.js') }),
  autoprefixer(),
]).process(read('src/index.css'), { from: join(ROOT, 'src/index.css') });

const html = `<!doctype html>
<html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<style>${processed.css}</style></head>
<body style="margin:0;background:#1e1e1e">
<div id="root"></div>
<script>${bundled.outputFiles[0].text}</script>
</body></html>`;

const browser = await chromium.launch({
  executablePath: exe,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

const pageErrors = [];
try {
  mkdirSync(shotDir, { recursive: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 1,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });
  const page = await context.newPage();
  page.on('pageerror', (err) => pageErrors.push(String(err && err.message || err)));
  await page.setContent(html, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.__moldReadCamera === 'function');

  const zoomed = await page.evaluate(() => {
    const before = window.__moldReadCamera();
    const canvas = document.querySelector('[data-mold-canvas]');
    canvas.dispatchEvent(new WheelEvent('wheel', {
      deltaY: -800,
      bubbles: true,
      cancelable: true,
      clientX: 12,
      clientY: 12,
    }));
    const after = window.__moldSync();
    window.__moldReset();
    return {
      before: before.pos[0] + before.pos[1] + before.pos[2],
      after: after.pos[0] + after.pos[1] + after.pos[2],
    };
  });
  check('a wheel on the canvas moves the camera', Math.abs(zoomed.after - zoomed.before) > 1,
    JSON.stringify(zoomed));

  await page.waitForSelector('[data-mold-tools-popup]');
  let reopen = false;
  for (const tool of TOOLS) {
    if (reopen) {
      const open = await page.locator('[data-mold-tools-popup]').count();
      if (!open) await page.locator('[data-mold-tools-toggle]').click();
      await page.waitForSelector('[data-mold-tools-popup]');
    }
    reopen = true;
    await page.evaluate(() => { window.__shellHits = 0; });
    await page.locator(tool.button).click();
    await page.waitForSelector(tool.pane);
    await page.waitForFunction(() => (
      getComputedStyle(document.documentElement).getPropertyValue('--modal-vvh').trim() !== ''
    ));
    const popup = await page.locator('[data-mold-tools-popup]').count();
    check(`${tool.name} press closes the drawer`, popup === 0);
    await page.waitForFunction(() => (
      document.querySelector('[data-mold-results-pane]')?.getAttribute('data-mold-results-placed') === '1'
    ));
    const clear = await page.evaluate(railsClear);
    check(`${tool.name} pane misses both toolbars`,
      clear.placed === '1' && !clear.hitLeft && !clear.hitRight && clear.gapLeft >= 9 && clear.gapRight >= 9,
      JSON.stringify(clear));

    const box = await page.locator(tool.pane).boundingBox();
    check(`${tool.name} pane has a box`, !!box && box.height > 20, JSON.stringify(box));
    if (!box) continue;
    const x = box.x + Math.min(28, box.width / 2);
    const y = box.y + Math.min(36, Math.max(8, box.height / 3));
    const hit = await page.evaluate(({ px, py, sel }) => {
      const node = document.elementFromPoint(px, py);
      const pane = document.querySelector(sel);
      const canvas = document.querySelector('[data-mold-canvas]');
      return { inPane: !!(node && pane && (node === pane || pane.contains(node))), onCanvas: node === canvas };
    }, { px: x, py: y, sel: tool.pane });
    check(`${tool.name} hit target is the pane`, hit.inPane && !hit.onCanvas, JSON.stringify(hit));

    if (tool.shots) {
      await page.evaluate((sel) => {
        const section = document.querySelector(sel);
        const scroller = section.closest('[data-mold-results-pane]') || section;
        scroller.scrollTop = 0;
      }, tool.pane);
      await page.screenshot({ path: join(shotDir, 'mold-report-390-top.png') });
    }

    const before = await page.evaluate(() => window.__moldSync());
    await page.mouse.move(x, y);
    await page.mouse.wheel(0, 280);
    await page.mouse.down();
    await page.mouse.move(x + 30, y + 24);
    await page.mouse.up();
    await page.evaluate((sel) => {
      const pane = document.querySelector(sel);
      const shell = document.querySelector('.viewport-shell');
      const count = () => { window.__shellHits = (window.__shellHits || 0) + 1; };
      shell.addEventListener('wheel', count);
      shell.addEventListener('pointerdown', count);
      shell.addEventListener('touchmove', count);
      const rect = pane.getBoundingClientRect();
      const cx = rect.left + 16;
      const cy = rect.top + 16;
      pane.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 120, clientX: cx, clientY: cy }));
      pane.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true, cancelable: true, pointerId: 1, pointerType: 'touch', clientX: cx, clientY: cy,
      }));
      pane.dispatchEvent(new PointerEvent('pointermove', {
        bubbles: true, cancelable: true, pointerId: 1, pointerType: 'touch', clientX: cx + 8, clientY: cy + 20,
      }));
      try {
        pane.dispatchEvent(new TouchEvent('touchmove', { bubbles: true, cancelable: true }));
      } catch { /* older engines */ }
      shell.removeEventListener('wheel', count);
      shell.removeEventListener('pointerdown', count);
      shell.removeEventListener('touchmove', count);
    }, tool.pane);
    const afterGesture = await page.evaluate(() => window.__moldSync());
    check(`${tool.name} scroll does not move the camera`, sameCam(before, afterGesture),
      JSON.stringify({ before, afterGesture }));

    const measured = await page.evaluate(measureInPage, tool.pane);
    check(`${tool.name} scrolls inside the pane`,
      (measured.overflowY === 'auto' || measured.overflowY === 'scroll')
      && measured.touchAction === 'pan-y'
      && String(measured.overscroll).includes('contain')
      && measured.pointerEvents === 'auto'
      && measured.pageScroll === 0,
      JSON.stringify(measured));
    check(`${tool.name} height stays above the home pill`,
      Number.isFinite(measured.maxHeight)
      && Math.abs(measured.maxHeight - measured.expected) < 2
      && measured.paneBottom <= measured.pillTop - 8
      && measured.paneBottom <= measured.innerHeight + 1,
      JSON.stringify(measured));
    const room = measured.scrollHeight - measured.clientHeight;
    check(`${tool.name} reaches its last control`,
      measured.endBottom <= measured.paneBottom + 2
      && measured.endBottom > measured.paneTop
      && measured.scrollTop >= room - 2
      && (!tool.scroll || room > 8),
      JSON.stringify(measured));
    check(`${tool.name} gestures do not bubble to the shell`, measured.shellHits === 0,
      `hits ${measured.shellHits}`);
    const still = await page.evaluate(() => window.__moldSync());
    check(`${tool.name} camera stays put after the scroll`, sameCam(before, still));

    if (tool.shots) {
      await page.screenshot({ path: join(shotDir, 'mold-report-390-bottom.png') });
    }
  }

  await page.evaluate(() => {
    document.documentElement.style.setProperty('--safe-area-top', '47px');
    document.documentElement.style.setProperty('--safe-area-bottom', '34px');
  });
  const inset = await page.evaluate(measureInPage, '[data-mold-report]');
  check('safe areas shrink the report cap',
    Number.isFinite(inset.maxHeight) && Math.abs(inset.maxHeight - inset.expected) < 2
    && inset.maxHeight < 844 - 148,
    JSON.stringify({ maxHeight: inset.maxHeight, expected: inset.expected }));

  await page.evaluate(() => window.__moldShow('results'));
  await page.waitForSelector('[data-mold-pull]');
  await page.waitForSelector('[data-parting-legend]');
  await page.waitForFunction(() => (
    document.querySelector('[data-mold-results-pane]')?.getAttribute('data-mold-results-placed') === '1'
  ));
  await page.locator('[data-mold-pull-choice="plane"]').click();
  const pullMode = await page.locator('[data-mold-pull]').getAttribute('data-mold-pull-mode');
  check('pull Plane still presses inside the pane', pullMode === 'plane', String(pullMode));
  const phoneClear = await page.evaluate(railsClear);
  check('390×844 pull and core/cavity miss both toolbars',
    phoneClear.placed === '1' && !phoneClear.hitLeft && !phoneClear.hitRight
    && phoneClear.gapLeft >= 9 && phoneClear.gapRight >= 9,
    JSON.stringify(phoneClear));
  await page.screenshot({ path: join(shotDir, 'mold-results-390.png') });

  await context.close();

  const desktop = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const desk = await desktop.newPage();
  desk.on('pageerror', (err) => pageErrors.push(String(err && err.message || err)));
  await desk.setContent(html, { waitUntil: 'load' });
  await desk.waitForSelector('[data-mold-tools-popup]');
  await desk.locator('[data-wall-heatmap]').click();
  await desk.waitForSelector('[data-wall-legend]');
  await desk.waitForFunction(() => (
    document.querySelector('[data-mold-results-pane]')?.getAttribute('data-mold-results-placed') === '1'
  ));
  const legend = await desk.evaluate(() => {
    const pane = document.querySelector('[data-mold-results-pane]');
    const probe = document.createElement('div');
    probe.style.maxHeight = 'min(22.5rem, calc(var(--modal-vvh, 100dvh) - var(--modal-vv-top, 0px) - var(--feature-sheet-bottom, 0px) - 5.5rem))';
    document.body.appendChild(probe);
    const expected = parseFloat(getComputedStyle(probe).maxHeight);
    probe.remove();
    const cs = getComputedStyle(pane);
    return {
      pointerEvents: cs.pointerEvents,
      maxHeight: parseFloat(cs.maxHeight),
      expected,
      placed: pane.getAttribute('data-mold-results-placed'),
      popup: document.querySelector('[data-mold-tools-popup]') ? 1 : 0,
    };
  });
  check('desktop results pane uses the feature-sheet cap and the drawer closes',
    legend.popup === 0
    && legend.pointerEvents === 'auto'
    && legend.placed === '1'
    && Math.abs(legend.maxHeight - legend.expected) < 1,
    JSON.stringify(legend));
  const deskWall = await desk.evaluate(railsClear);
  check('1280×800 wall legend misses both toolbars',
    !deskWall.hitLeft && !deskWall.hitRight && deskWall.gapLeft >= 9 && deskWall.gapRight >= 9,
    JSON.stringify(deskWall));
  await desk.evaluate(() => window.__moldShow('results'));
  await desk.waitForSelector('[data-mold-pull]');
  await desk.waitForSelector('[data-parting-legend]');
  await desk.locator('[data-mold-pull-choice="plane"]').click();
  const deskMode = await desk.locator('[data-mold-pull]').getAttribute('data-mold-pull-mode');
  check('desktop pull Plane still presses inside the pane', deskMode === 'plane', String(deskMode));
  const deskClear = await desk.evaluate(railsClear);
  check('1280×800 pull and core/cavity miss both toolbars',
    deskClear.placed === '1' && !deskClear.hitLeft && !deskClear.hitRight
    && deskClear.gapLeft >= 9 && deskClear.gapRight >= 9,
    JSON.stringify(deskClear));
  await desk.screenshot({ path: join(shotDir, 'mold-results-1280.png') });
  await desktop.close();

  check('the page did not throw', pageErrors.length === 0, pageErrors.join(' | '));
} finally {
  await browser.close();
}

if (failed) {
  console.log(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nmold pane scroll golden: ok');

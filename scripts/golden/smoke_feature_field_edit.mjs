#!/usr/bin/env node
/**
 * Touch focused-field edit. 390px. A reduced visualViewport, with offsetTop
 * for Safari's toolbar, stands in for the keyboard. Analyze, Extrude, and
 * Paint (the hex text field).
 *
 * Screenshots go to GOLDEN_SHOT_DIR or os.tmpdir(), never the artifacts dir.
 */
/* The evaluate callbacks run in the browser, where document exists. */
/* global document, navigator, window, getComputedStyle, requestAnimationFrame */
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

process.env.BROWSERSLIST_IGNORE_OLD_DATA = '1';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const shotDir = process.env.GOLDEN_SHOT_DIR || tmpdir();
const PHONE = { width: 390, height: 664 };
const KEYBOARD = { height: 300, offsetTop: 44 };

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
    failed += 1;
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

console.log('feature field edit — source');
{
  const shell = read('src/components/FeatureSheet.jsx');
  const fields = read('src/utils/featureFieldEdit.js');
  const numberField = read('src/components/controls/popupUI.jsx');
  const css = read('src/index.css');
  const view = read('src/components/Viewport.jsx');
  const arch = read('docs/architecture.md');
  check('the shell parks a touch edit view on the visual viewport',
    /data-feature-field-edit/.test(shell)
    && /data-feature-field-done/.test(shell)
    && /visualViewport/.test(shell)
    && /featureSheetEditLift/.test(fields)
    && /offsetTop/.test(fields));
  check('number fields publish a label and a unit for every card',
    /data-field-label/.test(numberField)
    && /data-unit/.test(numberField)
    && /readFieldLabel/.test(shell)
    && /readFieldUnit/.test(shell));
  check('every keyboard field opens it; selects, sliders, checkboxes, and buttons do not',
    /keyboardField/.test(shell)
    && /contenteditable/.test(fields)
    && /textarea/.test(fields)
    && /checkbox/.test(fields)
    && /range/.test(fields)
    && /data-feature-card\]\[data-feature-field-edit/.test(view));
  check('the full-card height cap does not collapse the edit view',
    /feature-sheet-card\[data-feature-field-edit\]/.test(css)
    && /max-height:\s*none/.test(css));
  check('the feature card docs describe the touch edit view',
    /data-feature-field-edit/.test(arch)
    && /visual viewport/.test(arch)
    && /Selects, sliders, checkboxes, and buttons do not open it/.test(arch)
    && /contenteditable/.test(arch));
}

if (String(shotDir).startsWith('/opt/cursor/artifacts')) {
  console.log(`  ❌ screenshots must not use /opt/cursor/artifacts (${shotDir})`);
  process.exit(1);
}

const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!exe) {
  console.log('  ❌ system Chrome is required');
  process.exit(1);
}

const cssSrc = read('src/index.css');
const processed = await postcss([
  tailwindcss({ config: join(ROOT, 'tailwind.config.js') }),
  autoprefixer(),
]).process(cssSrc, { from: join(ROOT, 'src/index.css') });

const bundled = await build({
  stdin: {
    contents: `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { FeaStudySheet } from './src/components/fea/FeaStudySheet.jsx';
import ContourModeChip from './src/components/ContourModeChip.jsx';
import { PaintModeChip } from './src/components/PaintModeChip.jsx';

const FIXTURES = Array.from({ length: 8 }, (_, i) => ({
  faces: [{ at: [i * 4, 0, 10], n: [0, 0, 1], area: 24 }],
}));

function Stage() {
  const [card, setCard] = useState('analyze');
  const [open, setOpen] = useState(true);
  const [magnitude, setMagnitude] = useState(200);
  const [distance, setDistance] = useState(10);
  const [hex, setHex] = useState('');
  const [log, setLog] = useState('');
  const close = () => { setLog('cancel'); setOpen(false); };
  const panel = {
    study: { material: { id: 'al-6061-t6' }, fixtures: FIXTURES, loads: [] },
    draft: {
      target: 'force',
      magnitudeN: magnitude,
      direction: 'normal',
      pressureMPa: 1,
      customMode: false,
      custom: { name: '', E_MPa: '', nu: '', yield_MPa: '' },
    },
    setMaterialId() {},
    setCustomMode() {},
    setCustomField() {},
    setTarget() {},
    setMagnitude,
    setDirection() {},
    setPressure() {},
    removeFixture() {},
    removeLoad() {},
    close,
    preview: { available: false },
    notice: '',
    results: false,
    running: false,
    run() {},
  };
  return (
    <div data-mobile-stage="cad" style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div className="viewport-shell relative h-full w-full overflow-hidden" data-harness-pane="" style={{ background: '#1e1e1e' }}>
        <div data-rail-pair="left" style={{ position: 'absolute', left: 8, bottom: 10, width: 56, height: 220, borderRadius: 8, background: 'rgba(255,255,255,0.7)' }} />
        <div data-rail-pair="right" style={{ position: 'absolute', right: 10, bottom: 10, width: 56, height: 280, borderRadius: 8, background: 'rgba(255,255,255,0.7)' }} />
        {open && card === 'analyze' ? <FeaStudySheet panel={panel} /> : null}
        {open && card === 'extrude' ? (
          <ContourModeChip
            tool="circle"
            entry="makeExtrude"
            params={{ radius: 5, segments: 64 }}
            extrude={{ distance, direction: 'normal', sense: 'positive' }}
            combine="add"
            merge
            planeLabel="default +Z top"
            compact
            onCancel={close}
            onConfirm={() => {}}
            onExtrudeChange={(next) => setDistance(next.distance)}
            onParamChange={() => {}}
          />
        ) : null}
        {open && card === 'paint' ? (
          <PaintModeChip
            compact
            custom={hex}
            canConfirm
            onCustom={setHex}
            onSwatch={() => {}}
            onDismiss={close}
            onConfirm={() => {}}
          />
        ) : null}
        <div data-mobile-stage-home-indicator="" style={{ position: 'absolute', left: '50%', bottom: 0, transform: 'translateX(-50%)' }}>
          <div data-home-indicator-pill="" style={{ width: 120, height: 30, borderRadius: 999, background: '#1f2937' }} />
        </div>
      </div>
      <div id="vv-top" data-vv-blocked="top" style={{ position: 'fixed', left: 0, right: 0, top: 0, height: 0, background: 'rgba(15,23,42,0.72)', zIndex: 10, pointerEvents: 'none' }} />
      <div id="vv-bottom" data-vv-blocked="bottom" style={{ position: 'fixed', left: 0, right: 0, bottom: 0, height: 0, background: '#0b0d12', zIndex: 10, pointerEvents: 'none' }} />
      <button type="button" data-harness-card="analyze" onClick={() => { setCard('analyze'); setOpen(true); setLog(''); }}>analyze</button>
      <button type="button" data-harness-card="extrude" onClick={() => { setCard('extrude'); setOpen(true); setLog(''); }}>extrude</button>
      <button type="button" data-harness-card="paint" onClick={() => { setCard('paint'); setOpen(true); setLog(''); }}>paint</button>
      <div data-edit-log="">{log}</div>
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
button[data-harness-card] { position: absolute; left: -999px; top: 0; }
#vv-bottom { display: flex; align-items: flex-start; justify-content: center; color: #9ca3af; font: 600 12px/1 sans-serif; }
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
    get pageTop() { return offsetTop; },
    get scale() { return 1; },
    addEventListener(type, fn) { (listeners[type] || (listeners[type] = new Set())).add(fn); },
    removeEventListener(type, fn) { listeners[type] && listeners[type].delete(fn); },
  };
  Object.defineProperty(window, 'visualViewport', { configurable: true, get() { return vv; } });
  window.__setVisualViewport = (h, top) => {
    height = h;
    offsetTop = top || 0;
    const topBand = document.getElementById('vv-top');
    const bottomBand = document.getElementById('vv-bottom');
    if (topBand) topBand.style.height = offsetTop + 'px';
    const keyboard = Math.max(0, window.innerHeight - height - offsetTop);
    if (bottomBand) {
      bottomBand.style.height = keyboard + 'px';
      bottomBand.textContent = keyboard > 40 ? 'keyboard' : '';
    }
    (listeners.resize || []).forEach((fn) => fn());
    (listeners.scroll || []).forEach((fn) => fn());
  };
})();
</script>
<script>${bundled.outputFiles[0].text}</script>
</body></html>`;

function shot(name) {
  const path = join(shotDir, name);
  check(`${name} is not an artifacts path`, !path.startsWith('/opt/cursor/artifacts'), path);
  return path;
}

async function show(page, name) {
  await page.evaluate((which) => {
    document.querySelector(`[data-harness-card="${which}"]`).click();
  }, name);
  await page.waitForSelector('[data-feature-card]');
  await page.waitForFunction((which) => {
    if (which === 'analyze') {
      return !!document.querySelector('[data-popup-number="fea-force"]');
    }
    if (which === 'paint') return !!document.querySelector('[data-paint-hex]');
    return !!document.querySelector('[data-popup-number="extrude-distance"]');
  }, name);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function scrollBody(page) {
  return page.evaluate(() => {
    const body = document.querySelector('[data-feature-sheet-body]');
    body.scrollTop = body.scrollHeight;
    return body.scrollTop;
  });
}

async function focusField(page, selector) {
  await page.evaluate((sel) => {
    document.querySelector(sel).focus({ preventScroll: true });
  }, selector);
  await page.waitForSelector('[data-feature-field-edit]', { timeout: 3000 });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function setKeyboard(page, height, offsetTop) {
  await page.evaluate(({ height: h, offsetTop: top }) => {
    window.__setVisualViewport(h, top);
  }, { height, offsetTop });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function readEdit(page) {
  return page.evaluate(() => {
    const vv = window.visualViewport;
    const visibleTop = vv.offsetTop;
    const visibleBottom = vv.offsetTop + vv.height;
    const shown = (el) => {
      if (!el) return false;
      const box = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
      return box.width > 2 && box.height > 2
        && box.top >= visibleTop - 1
        && box.bottom <= visibleBottom + 1;
    };
    const card = document.querySelector('[data-feature-card]');
    const body = document.querySelector('[data-feature-sheet-body]');
    const footer = document.querySelector('[data-feature-sheet-footer]');
    const box = card ? card.getBoundingClientRect() : null;
    const concealed = (el) => {
      for (let node = el; node; node = node.parentElement) {
        if (node.hasAttribute?.('hidden')) return true;
        if (getComputedStyle(node).display === 'none') return true;
      }
      return !el;
    };
    const bodyHidden = concealed(body);
    return {
      editing: !!card?.hasAttribute('data-feature-field-edit'),
      cardH: box ? box.height : 0,
      cardTop: box ? box.top : 0,
      cardBottom: box ? box.bottom : 0,
      visibleTop,
      visibleBottom,
      cardInside: !!box && box.height > 48 && box.top >= visibleTop - 1 && box.bottom <= visibleBottom + 1,
      cardOnViewport: box ? Math.abs(box.bottom - visibleBottom) : 999,
      label: (document.querySelector('[data-feature-field-label]')?.textContent || '').trim(),
      unit: (document.querySelector('[data-feature-field-unit]')?.textContent || '').trim(),
      labelVisible: shown(document.querySelector('[data-feature-field-label]')),
      inputVisible: shown(document.querySelector('[data-feature-field-edit-input]')),
      doneVisible: shown(document.querySelector('[data-feature-field-done]')),
      viewVisible: shown(document.querySelector('[data-feature-field-edit-view]')),
      bodyHidden,
      footerHidden: !footer || getComputedStyle(footer).display === 'none' || !!footer.closest('[hidden]'),
      hint: document.querySelector('[data-feature-sheet-scroll-hint]')
        ? getComputedStyle(document.querySelector('[data-feature-sheet-scroll-hint]')).display
        : 'none',
    };
  });
}

const browser = await chromium.launch({
  executablePath: exe,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
attachConsentPresetToBrowser(browser);

try {
  mkdirSync(shotDir, { recursive: true });
  const context = await browser.newContext({
    viewport: PHONE,
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(String(err && err.message || err)));
  await page.setContent(html, { waitUntil: 'load' });
  await page.waitForSelector('[data-feature-card]');
  const touch = await page.evaluate(() => ({
    points: navigator.maxTouchPoints,
    coarse: window.matchMedia('(pointer: coarse)').matches,
  }));
  check('the phone context is a touch device', touch.points > 0 || touch.coarse, JSON.stringify(touch));

  await page.screenshot({ path: shot('feature-field-edit-analyze-390-before.png') });
  const analyzePrior = await scrollBody(page);
  check('analyze body scrolls before the keyboard opens', analyzePrior > 8, String(analyzePrior));
  await focusField(page, '[data-popup-number="fea-force"]');
  await setKeyboard(page, KEYBOARD.height, KEYBOARD.offsetTop);
  const analyzeEdit = await readEdit(page);
  check('analyze compact view is inside the visual viewport, toolbar included',
    analyzeEdit.editing
    && analyzeEdit.cardInside
    && analyzeEdit.viewVisible
    && analyzeEdit.cardOnViewport <= 2,
    JSON.stringify(analyzeEdit));
  check('analyze shows the label, the input, and Done',
    analyzeEdit.label === 'Force'
    && analyzeEdit.unit === 'N'
    && analyzeEdit.labelVisible
    && analyzeEdit.inputVisible
    && analyzeEdit.doneVisible,
    JSON.stringify(analyzeEdit));
  check('analyze hides the rest of the body and the footer',
    analyzeEdit.bodyHidden && analyzeEdit.footerHidden,
    JSON.stringify(analyzeEdit));
  await page.screenshot({ path: shot('feature-field-edit-analyze-390-after.png') });

  await page.locator('[data-feature-field-edit-input]').fill('250');
  await page.locator('[data-feature-field-done]').click();
  await setKeyboard(page, PHONE.height, 0);
  await page.waitForFunction((prior) => {
    const body = document.querySelector('[data-feature-sheet-body]');
    const input = document.querySelector('[data-popup-number="fea-force"]');
    const card = document.querySelector('[data-feature-card]');
    return body && input && card
      && !card.hasAttribute('data-feature-field-edit')
      && Math.abs(body.scrollTop - prior) <= 1
      && input.value === '250';
  }, analyzePrior);
  const analyzeBack = await page.evaluate(() => {
    const body = document.querySelector('[data-feature-sheet-body]');
    const footer = document.querySelector('[data-feature-sheet-footer]');
    return {
      scroll: body.scrollTop,
      value: document.querySelector('[data-popup-number="fea-force"]').value,
      footer: !!footer && getComputedStyle(footer).display !== 'none',
      body: getComputedStyle(body).display !== 'none',
    };
  });
  check('analyze Done commits 250 and restores the prior scroll',
    analyzeBack.value === '250'
    && analyzeBack.footer
    && analyzeBack.body
    && Math.abs(analyzeBack.scroll - analyzePrior) <= 1,
    JSON.stringify({ ...analyzeBack, prior: analyzePrior }));

  await page.locator('[data-fea-material]').focus();
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const selectEdit = await page.evaluate(() => !!document.querySelector('[data-feature-field-edit]'));
  check('a select does not open the edit view', selectEdit === false);

  await page.locator('[data-popup-slider="fea-force"]').focus();
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const sliderEdit = await page.evaluate(() => !!document.querySelector('[data-feature-field-edit]'));
  check('a slider does not open the edit view', sliderEdit === false);

  await show(page, 'extrude');
  await setKeyboard(page, PHONE.height, 0);
  await page.screenshot({ path: shot('feature-field-edit-extrude-390-before.png') });
  const extrudePrior = await scrollBody(page);
  check('extrude body scrolls before the keyboard opens', extrudePrior > 8, String(extrudePrior));
  await focusField(page, '[data-popup-number="extrude-distance"]');
  await setKeyboard(page, KEYBOARD.height, KEYBOARD.offsetTop);
  const extrudeEdit = await readEdit(page);
  check('extrude compact view is inside the visual viewport',
    extrudeEdit.editing
    && extrudeEdit.cardInside
    && extrudeEdit.viewVisible
    && extrudeEdit.label === 'Distance'
    && extrudeEdit.labelVisible
    && extrudeEdit.inputVisible
    && extrudeEdit.doneVisible
    && extrudeEdit.bodyHidden
    && extrudeEdit.footerHidden
    && extrudeEdit.cardOnViewport <= 2,
    JSON.stringify(extrudeEdit));
  await page.screenshot({ path: shot('feature-field-edit-extrude-390-after.png') });
  await page.locator('[data-feature-field-edit-input]').fill('18');
  await page.locator('[data-feature-field-edit-input]').press('Enter');
  await setKeyboard(page, PHONE.height, 0);
  await page.waitForFunction((prior) => {
    const body = document.querySelector('[data-feature-sheet-body]');
    const input = document.querySelector('[data-popup-number="extrude-distance"]');
    const card = document.querySelector('[data-feature-card]');
    return body && input && card
      && !card.hasAttribute('data-feature-field-edit')
      && Math.abs(body.scrollTop - prior) <= 1
      && input.value === '18';
  }, extrudePrior);
  check('extrude Enter commits 18 and restores the prior scroll', true);

  await focusField(page, '[data-popup-number="extrude-distance"]');
  await page.locator('[data-feature-field-edit-input]').fill('21');
  await page.locator('[data-feature-card-title]').click();
  await page.waitForFunction(() => {
    const card = document.querySelector('[data-feature-card]');
    const input = document.querySelector('[data-popup-number="extrude-distance"]');
    return card && input && !card.hasAttribute('data-feature-field-edit') && input.value === '21';
  });
  check('extrude blur commits 21 and restores the full card', true);

  await focusField(page, '[data-popup-number="extrude-distance"]');
  await page.locator('[data-feature-card-cancel]').click();
  await page.waitForFunction(() => !document.querySelector('[data-feature-card]'));
  const cancelled = await page.evaluate(() => document.querySelector('[data-edit-log]')?.textContent || '');
  check('X during edit cancels the card', cancelled === 'cancel', cancelled);

  await show(page, 'paint');
  await setKeyboard(page, PHONE.height, 0);
  await page.screenshot({ path: shot('feature-field-edit-paint-390-before.png') });
  const paintPrior = await scrollBody(page);
  await focusField(page, '[data-paint-hex]');
  await setKeyboard(page, KEYBOARD.height, KEYBOARD.offsetTop);
  const paintEdit = await readEdit(page);
  check('paint hex compact view is inside the visual viewport',
    paintEdit.editing
    && paintEdit.cardInside
    && paintEdit.viewVisible
    && paintEdit.label === 'Hex'
    && paintEdit.labelVisible
    && paintEdit.inputVisible
    && paintEdit.doneVisible
    && paintEdit.bodyHidden
    && paintEdit.footerHidden
    && paintEdit.cardOnViewport <= 2,
    JSON.stringify(paintEdit));
  await page.screenshot({ path: shot('feature-field-edit-paint-390-after.png') });
  await page.locator('[data-feature-field-edit-input]').fill('#FF00AA');
  await page.locator('[data-feature-field-done]').click();
  await setKeyboard(page, PHONE.height, 0);
  await page.waitForFunction((prior) => {
    const body = document.querySelector('[data-feature-sheet-body]');
    const input = document.querySelector('[data-paint-hex]');
    const card = document.querySelector('[data-feature-card]');
    return body && input && card
      && !card.hasAttribute('data-feature-field-edit')
      && Math.abs(body.scrollTop - prior) <= 1
      && input.value === '#ff00aa';
  }, paintPrior);
  const paintBack = await page.evaluate(() => ({
    value: document.querySelector('[data-paint-hex]').value,
    scroll: document.querySelector('[data-feature-sheet-body]').scrollTop,
    body: getComputedStyle(document.querySelector('[data-feature-sheet-body]')).display !== 'none',
    footer: getComputedStyle(document.querySelector('[data-feature-sheet-footer]')).display !== 'none',
  }));
  check('paint Done commits the hex text and restores the prior scroll',
    paintBack.value === '#ff00aa'
    && paintBack.body
    && paintBack.footer
    && Math.abs(paintBack.scroll - paintPrior) <= 1,
    JSON.stringify({ ...paintBack, prior: paintPrior }));

  await page.locator('[data-paint-swatch="#ef4444"]').focus();
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const swatchEdit = await page.evaluate(() => !!document.querySelector('[data-feature-field-edit]'));
  check('a paint swatch button does not open the edit view', swatchEdit === false);

  await show(page, 'analyze');
  await focusField(page, '[data-popup-number="fea-force"]');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('[data-feature-card]'));
  check('Esc during edit cancels the card', true);

  await context.close();

  const desktop = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    hasTouch: false,
    isMobile: false,
    deviceScaleFactor: 1,
  });
  const desk = await desktop.newPage();
  desk.on('pageerror', (err) => pageErrors.push(String(err && err.message || err)));
  await desk.setContent(html, { waitUntil: 'load' });
  await desk.waitForSelector('[data-popup-number="fea-force"]');
  const deskTouch = await desk.evaluate(() => navigator.maxTouchPoints || 0);
  check('desktop context has no touch points', deskTouch === 0, String(deskTouch));
  await desk.locator('[data-popup-number="fea-force"]').focus();
  await desk.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const deskEdit = await desk.evaluate(() => {
    const card = document.querySelector('[data-feature-card]');
    const footer = document.querySelector('[data-feature-sheet-footer]');
    const body = document.querySelector('[data-feature-sheet-body]');
    return {
      editing: !!card?.hasAttribute('data-feature-field-edit'),
      footer: !!footer && getComputedStyle(footer).display !== 'none',
      body: !!body && getComputedStyle(body).display !== 'none',
    };
  });
  check('desktop focus keeps the full card',
    deskEdit.editing === false && deskEdit.footer && deskEdit.body,
    JSON.stringify(deskEdit));
  await desktop.close();

  check('the page did not throw', pageErrors.length === 0, pageErrors.join(' | '));
} finally {
  await browser.close();
}

console.log(failed ? `\n❌ FAIL (${failed} failed)` : `\n✅ PASS`);
process.exit(failed ? 1 : 0);

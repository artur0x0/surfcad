#!/usr/bin/env node
/**
 * SendCutSend handoff. An eligible sheet part shows DXF, STEP, and the
 * redirect instead of the quote. "Quote with SurfCAD instead" reaches
 * Add to cart. A mixed part shows the normal quote. Check has
 * no download or order button. Checkout of an eligible script stays on
 * the SurfCAD quote.
 *
 * Screenshots go to GOLDEN_SHOT_DIR or os.tmpdir(), never the artifacts dir.
 */
/* The evaluate callback runs in the browser, where document exists. */
/* global document, window */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
import { chromium } from 'playwright-core';
import { CUBE_BEGIN, CUBE_END } from '../../src/utils/helperPaletteSnippets.js';
import { sheetCheckoutRoute } from '../../src/utils/sheetMetal/sheetCheckout.js';
import { sheetMetalBlock } from '../../src/utils/sheetMetal/sheetMetalScript.js';

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

const spec = {
  v: 1,
  sku: 'ALU-090',
  material: 'Aluminum 5052',
  t: 2,
  r: 1,
  k: 0.44,
  limits: {},
  plane: 'XY',
  width: 100,
  height: 60,
  bends: [],
  tabs: [],
  holes: [],
};
const eligible = `${sheetMetalBlock(spec)}\nreturn part;\n`;
const mixed = `${CUBE_BEGIN}\nlet part = cube([20, 20, 20]);\n${CUBE_END}\n${sheetMetalBlock(spec, { union: true })}\nreturn part;\n`;

let failed = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`);
  }
}

console.log('SCS handoff — source');
{
  const flow = read('src/components/sheetMetal/SheetMetalFlow.jsx');
  const handoff = read('src/components/sheetMetal/ScsHandoff.jsx');
  const quote = read('src/components/QuoteModal.jsx');
  const hook = read('src/hooks/useCart.jsx');
  const palette = read('src/components/HelperInsertPalette.jsx');
  const popup = flow.slice(flow.indexOf('const CheckPopup'), flow.indexOf('const TOOL_HINTS'));
  const branchAt = quote.indexOf('{showHandoff ? (');
  const branch = quote.slice(branchAt, quote.indexOf(') : (', branchAt));
  const orderStart = hook.indexOf('const orderPart = useCallback');
  const orderBody = hook.slice(orderStart, hook.indexOf('const closePartQuote'));
  const shapeAt = palette.indexOf("section.section === 'shape' && onOpenSheetMetal");

  check('eligible fixture routes to scs and a mixed part routes to the quote',
    sheetCheckoutRoute(eligible) === 'scs' && sheetCheckoutRoute(mixed) === 'quote');
  check('Check has no download or order button',
    popup.includes('const CheckPopup')
    && !/data-sm-dxf/.test(popup)
    && !/data-sm-order/.test(popup)
    && !/Download DXF/.test(popup)
    && !/Download STEP/.test(popup)
    && !/Order on SendCutSend/.test(popup)
    && /data-sm-dfm-fails/.test(popup)
    && /data-sm-step-source/.test(popup));
  check('ScsHandoff has DXF, STEP, and Order, and does not write a line',
    /data-sm-dxf="1"/.test(handoff)
    && /data-sm-step="1"/.test(handoff)
    && /data-sm-order="1"/.test(handoff)
    && /Download DXF/.test(handoff)
    && /Download STEP/.test(handoff)
    && /Order on SendCutSend/.test(handoff)
    && /window\.open\(SCS_ORDER_URL, '_blank', 'noopener,noreferrer'\)/.test(handoff)
    && /Quote with SurfCAD instead/.test(handoff)
    && /data-scs-surf-quote/.test(handoff)
    && !/addPartLine|requestPartQuote|onAddToCart|gtag|plausible|posthog|analytics/.test(handoff));
  check('QuoteModal renders the handoff and does not add a line on that path',
    branchAt > 0
    && /<ScsHandoff/.test(branch)
    && /sheetCheckoutRoute/.test(quote)
    && /if \(showHandoff\) return/.test(quote)
    && !/addPartLine|requestPartQuote|onAddToCart/.test(branch));
  check('ordering does not remove or rewrite a cart line',
    !/removeCartLine|addPartLine/.test(orderBody));
  check('Sheet Metal stays under Shape',
    shapeAt > 0 && palette.slice(shapeAt, shapeAt + 800).includes('data-sheet-metal-button'));
}

const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
check('system Chrome available for the handoff render', !!exe, 'set CHROME_PATH');

if (exe && failed === 0) {
  const cssSrc = read('src/index.css');
  const processed = await postcss([
    tailwindcss({ config: join(ROOT, 'tailwind.config.js') }),
    autoprefixer(),
  ]).process(cssSrc, { from: join(ROOT, 'src/index.css') });

  const fakeQuote = {
    volume: 12000,
    surfaceArea: 12000,
    costs: { material: 1.25, machine: 0.75, total: 2 },
    materialGrams: 8,
    materialUsage: { grams: 8, meters: 0 },
    printTime: 0.4,
    quantity: 1,
    unitSubtotal: 2,
    boundingBox: { width: 100, height: 60, depth: 2 },
    bounds: { size: [100, 60, 2] },
  };

  const bundled = await build({
    stdin: {
      contents: `import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import QuoteModal from './src/components/QuoteModal.jsx';
import SheetMetalFlow from './src/components/sheetMetal/SheetMetalFlow.jsx';

const eligible = ${JSON.stringify(eligible)};
const mixed = ${JSON.stringify(mixed)};
const spec = ${JSON.stringify(spec)};
const fakeQuote = ${JSON.stringify(fakeQuote)};

function Stage() {
  const [view, setView] = useState('eligible');
  const script = view === 'mixed' ? mixed : eligible;
  const mode = view === 'checkout' ? 'checkout' : 'add';
  return (
    <div data-harness-current={view} style={{ minHeight: '100vh', background: '#111' }}>
      <div data-harness="" style={{ position: 'fixed', left: 0, top: 0, zIndex: 1, opacity: 0, pointerEvents: 'none' }}>
        <button type="button" data-harness-view="eligible" onClick={() => setView('eligible')}>eligible</button>
        <button type="button" data-harness-view="mixed" onClick={() => setView('mixed')}>mixed</button>
        <button type="button" data-harness-view="export" onClick={() => setView('export')}>export</button>
        <button type="button" data-harness-view="checkout" onClick={() => setView('checkout')}>checkout</button>
      </div>
      {view === 'export' ? (
        <div style={{ position: 'relative', width: '100vw', height: '100vh' }}>
          <SheetMetalFlow
            mode={{ stage: 'edit', exportOpen: true, spec, partId: 'sheet-1', draft: null, tool: 'bend', sku: { sku: spec.sku, name: spec.material, thicknessMm: spec.t } }}
            setMode={() => {}}
            onCommit={() => true}
            onExit={() => {}}
            script={eligible}
            partName="Bracket"
          />
        </div>
      ) : (
        <QuoteModal
          key={view + script.length}
          mode={mode}
          onClose={() => {}}
          onGetQuote={async () => {
            window.__quotes = (window.__quotes || 0) + 1;
            return fakeQuote;
          }}
          onAddToCart={async () => {
            window.__added = (window.__added || 0) + 1;
            return { ok: true };
          }}
          onOrder={() => { window.__ordered = (window.__ordered || 0) + 1; }}
          currentScript={script}
          currentFilename="Bracket.js"
          partId="sheet-1"
        />
      )}
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
    plugins: [{
      name: 'worker-stub',
      setup(b) {
        b.onResolve({ filter: /.*/ }, (args) => {
          if (!args.path.includes('?worker')) return null;
          return { path: args.path, namespace: 'worker-stub' };
        });
        b.onLoad({ filter: /.*/, namespace: 'worker-stub' }, () => ({
          contents: `export default class StubWorker {
            constructor() {}
            postMessage() {}
            terminate() {}
            addEventListener() {}
            removeEventListener() {}
          }`,
          loader: 'js',
        }));
      },
    }],
  });

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>${processed.css}</style></head>
<body style="margin:0;background:#111">
<div id="root"></div>
<script>
window.__scsOpen = [];
window.__downloads = [];
window.__quotes = 0;
window.__added = 0;
window.__ordered = 0;
window.open = function (url, target, features) {
  window.__scsOpen.push({ url: String(url), target: String(target), features: String(features) });
  return null;
};
const origClick = HTMLAnchorElement.prototype.click;
HTMLAnchorElement.prototype.click = function () {
  if (this.download) window.__downloads.push(String(this.download));
  return origClick.apply(this, arguments);
};
</script>
<script>${bundled.outputFiles[0].text}</script>
</body></html>`;

  const browser = await chromium.launch({
    executablePath: exe,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const pageErrors = [];
  try {
    mkdirSync(shotDir, { recursive: true });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
    page.on('pageerror', (err) => pageErrors.push(String(err && err.message || err)));
    await page.setContent(html, { waitUntil: 'load' });
    await page.waitForSelector('[data-scs-handoff]', { timeout: 15000 });

    const snap = async (name) => {
      await page.screenshot({ path: join(shotDir, name) });
    };
    const show = (view) => page.evaluate((name) => {
      document.querySelector(`[data-harness-view="${name}"]`).click();
    }, view);
    const counts = () => page.evaluate(() => ({
      quotes: window.__quotes || 0,
      added: window.__added || 0,
      ordered: window.__ordered || 0,
      opens: window.__scsOpen || [],
      downloads: window.__downloads || [],
      handoff: !!document.querySelector('[data-scs-handoff]'),
      dxf: !!document.querySelector('[data-sm-dxf]'),
      step: !!document.querySelector('[data-sm-step]'),
      order: !!document.querySelector('[data-sm-order]'),
      surf: (document.querySelector('[data-scs-surf-quote]')?.textContent || '').trim(),
      add: (document.querySelector('[data-quote-add]')?.textContent || '').trim(),
      checkoutOrder: (document.querySelector('[data-quote-order]')?.textContent || '').trim(),
      exportDx: document.querySelectorAll('[data-sheet-metal-export] [data-sm-dxf], [data-sheet-metal-export] [data-sm-step], [data-sheet-metal-export] [data-sm-order]').length,
      dfmOk: !!document.querySelector('[data-sm-dfm-ok]'),
      flat: !!document.querySelector('[data-sheet-metal-export] [data-sm-flat-size]'),
      checkTitle: (document.querySelector('[data-sheet-metal-export] [data-feature-card-title]')?.textContent || '').trim(),
      stepSource: document.querySelector('[data-sheet-metal-export] [data-sm-step-source]')?.getAttribute('data-sm-step-source') || '',
      title: (document.querySelector('h2')?.textContent || '').trim(),
      view: document.querySelector('[data-harness-current]')?.getAttribute('data-harness-current') || '',
      flatText: (document.querySelector('[data-scs-handoff] [data-sm-flat-size]')?.textContent || '').replace(/\s+/g, ' ').trim(),
    }));

    await page.waitForTimeout(300);
    let ui = await counts();
    const dxf = page.locator('[data-sm-dxf]');
    const stepBtn = page.locator('[data-sm-step]');
    const orderBtn = page.locator('[data-sm-order]');
    check('eligible sheet part shows the handoff and does not quote',
      ui.handoff && ui.quotes === 0 && ui.added === 0 && ui.dxf && ui.step && ui.order
      && ui.surf === 'Quote with SurfCAD instead' && ui.title === 'SendCutSend' && !ui.add
      && /ALU-090/.test(ui.flatText) && /Flat/.test(ui.flatText)
      && !(await dxf.isDisabled()) && !(await stepBtn.isDisabled()) && !(await orderBtn.isDisabled()),
      JSON.stringify(ui));

    await dxf.click();
    await stepBtn.click();
    await orderBtn.click();
    ui = await counts();
    check('DXF and STEP download, and Order opens SendCutSend without an opener',
      ui.downloads.some((name) => name.endsWith('-flat.dxf'))
      && ui.downloads.some((name) => name.endsWith('.step') && !name.includes('flat'))
      && ui.opens.length === 1
      && ui.opens[0].url === 'https://app.sendcutsend.com/'
      && ui.opens[0].target === '_blank'
      && ui.opens[0].features === 'noopener,noreferrer'
      && ui.added === 0 && ui.quotes === 0,
      JSON.stringify(ui));

    await snap('scs-handoff-390.png');
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForSelector('[data-scs-handoff]');
    await snap('scs-handoff-1280.png');

    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('[data-scs-surf-quote]').click();
    await page.waitForSelector('[data-quote-add]', { timeout: 5000 });
    ui = await counts();
    check('Quote with SurfCAD instead reaches Add to cart and still has not written a line',
      !ui.handoff && ui.add === 'Add to cart' && ui.quotes >= 1 && ui.added === 0 && ui.title === 'Manufacturing Quote',
      JSON.stringify(ui));
    await snap('scs-surf-quote-390.png');
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForSelector('[data-quote-add]');
    await snap('scs-surf-quote-1280.png');

    await page.setViewportSize({ width: 390, height: 844 });
    await show('mixed');
    await page.waitForSelector('[data-quote-add]', { timeout: 5000 });
    ui = await counts();
    check('a mixed part shows the normal quote',
      ui.view === 'mixed' && !ui.handoff && !ui.dxf && ui.add === 'Add to cart' && ui.title === 'Manufacturing Quote',
      JSON.stringify(ui));
    await snap('scs-mixed-quote-390.png');
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForSelector('[data-quote-add]');
    await snap('scs-mixed-quote-1280.png');

    await page.setViewportSize({ width: 390, height: 844 });
    await show('export');
    await page.waitForSelector('[data-sheet-metal-export]', { timeout: 5000 });
    ui = await counts();
    check('Check has DFM and no download or order button',
      ui.view === 'export' && ui.exportDx === 0 && ui.dfmOk && ui.flat && !ui.order
      && ui.checkTitle === 'Check' && !!ui.stepSource,
      JSON.stringify(ui));
    await snap('scs-export-390.png');
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForSelector('[data-sheet-metal-export]');
    await snap('scs-export-1280.png');

    await page.setViewportSize({ width: 390, height: 844 });
    await show('checkout');
    await page.waitForSelector('[data-quote-order]', { timeout: 5000 });
    ui = await counts();
    check('checkout of an eligible sheet script stays on the SurfCAD quote',
      ui.view === 'checkout' && !ui.handoff && ui.checkoutOrder === 'Order' && ui.added === 0,
      JSON.stringify(ui));
    check('the page did not throw', pageErrors.length === 0, pageErrors.join(' | '));
  } finally {
    await browser.close();
  }
}

console.log(failed ? `\n❌ FAIL (${failed} failed)` : `\n✅ PASS`);
process.exit(failed ? 1 : 0);

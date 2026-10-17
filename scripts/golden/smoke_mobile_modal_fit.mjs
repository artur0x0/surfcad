#!/usr/bin/env node
/**
 * Order-flow sheets fit a short phone viewport (390×664, iOS toolbar).
 * The quote body already scrolls; this checks the shell is short enough
 * that the panel stays inside the window and the action is on screen
 * without scrolling the page.
 *
 * Screenshots go to GOLDEN_SHOT_DIR or os.tmpdir(), never the artifacts dir.
 */
/* The evaluate callbacks run in the browser, where document exists. */
/* global document, window, getComputedStyle, Event, requestAnimationFrame */
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
import { sheetCheckoutRoute } from '../../src/utils/sheetMetal/sheetCheckout.js';
import { sheetMetalBlock } from '../../src/utils/sheetMetal/sheetMetalScript.js';

process.env.BROWSERSLIST_IGNORE_OLD_DATA = '1';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const shotDir = process.env.GOLDEN_SHOT_DIR || tmpdir();
const VIEW = { width: 390, height: 664 };

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
const cube = 'let part = cube([20, 20, 20]);\nreturn part;\n';

let failed = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`);
  }
}

console.log('mobile modal fit — source');
{
  const css = read('src/index.css');
  const hook = read('src/hooks/useModalViewport.js');
  const quote = read('src/components/QuoteModal.jsx');
  const page = read('src/components/checkout/CheckoutPage.jsx');
  const login = read('src/components/LoginModal.jsx');
  const order = read('src/components/OrderModal.jsx');
  const ui = read('docs/UI_MAP.md');
  const shell = css.slice(css.indexOf('.modal-fit {'));
  const quoteBody = quote.slice(quote.indexOf('flex-1 overflow-y-auto'), quote.lastIndexOf('</ModalFit>'));

  check('the shell caps at 100dvh or visualViewport, minus safe areas',
    /100dvh/.test(shell)
    && /var\(--modal-vvh/.test(shell)
    && /safe-area-inset-top/.test(shell)
    && /safe-area-inset-bottom/.test(shell)
    && /--modal-margin/.test(shell)
    && /--modal-cap/.test(shell));
  check('visualViewport sets the fallback height and locks background scroll',
    /visualViewport/.test(hook)
    && /vv\.height/.test(hook)
    && /offsetTop/.test(hook)
    && /overflow = 'hidden'/.test(hook));
  check('the quote body still scrolls and the action stays inside it',
    quoteBody.includes('data-quote-add')
    && quoteBody.includes('<ScsHandoff')
    && /ModalFit/.test(quote)
    && !/sticky bottom/.test(quoteBody));
  const scrollCss = css.slice(css.indexOf('.quote-scroll'), css.indexOf('.quote-scroll') + 700);
  check('the quote body shows a thin scrollbar',
    /quote-scroll/.test(quote)
    && /::-webkit-scrollbar/.test(scrollCss)
    && /scrollbar-width:\s*thin/.test(scrollCss)
    && /scrollbar-color:/.test(scrollCss));
  check('the quote scroll hint is a chevron outside the scroller',
    /data-quote-scroll-hint/.test(quote)
    && /ChevronDown/.test(quote)
    && !/sticky bottom/.test(quote));
  check('checkout, login, and the address step use the same shell',
    /ModalFit/.test(page)
    && /overflow-y-auto/.test(page)
    && /data-checkout-review/.test(page)
    && /ModalFit/.test(login)
    && /ModalFit/.test(order)
    && /AddressStep/.test(order));
  check('the UI map names the shared shell', /ModalFit/.test(ui) && /100dvh/.test(ui));
  check('fixtures route to the handoff and the quote',
    sheetCheckoutRoute(eligible) === 'scs' && sheetCheckoutRoute(cube) === 'quote');
}

const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
check('system Chrome available for the modal fit render', !!exe, 'set CHROME_PATH');

if (exe && failed === 0) {
  const cssSrc = read('src/index.css');
  const processed = await postcss([
    tailwindcss({ config: join(ROOT, 'tailwind.config.js') }),
    autoprefixer(),
  ]).process(cssSrc, { from: join(ROOT, 'src/index.css') });

  const fakeQuote = {
    volume: 8000,
    surfaceArea: 2400,
    costs: { material: 1.25, machine: 0.75, total: 2 },
    materialGrams: 8,
    materialUsage: { grams: 8, meters: 2.4 },
    printTime: 0.4,
    quantity: 1,
    unitSubtotal: 2,
    boundingBox: { width: 20, height: 20, depth: 20 },
    bounds: { size: [20, 20, 20] },
  };
  const lines = [
    'Bracket', 'Plate', 'Cover', 'Clip', 'Hinge', 'Tray', 'Foot', 'Cap',
  ].map((name, index) => ({
    lineId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    source: 'local',
    assemblyName: 'Phone',
    partId: `part-${index + 1}`,
    partName: name,
    scriptHash: 'abc123',
    qty: 1,
    options: { process: 'FDM', material: 'PLA', infill: 20 },
    quotedUnitPrice: 12.5,
    quoteId: null,
    quotedAt: null,
    addedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }));

  const bundled = await build({
    stdin: {
      contents: `import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import QuoteModal from './src/components/QuoteModal.jsx';
import CheckoutPage from './src/components/checkout/CheckoutPage.jsx';
import { AuthProvider } from './src/hooks/useAuth.jsx';
import { CartChromeProvider } from './src/hooks/useCart.jsx';

const eligible = ${JSON.stringify(eligible)};
const cube = ${JSON.stringify(cube)};
const fakeQuote = ${JSON.stringify(fakeQuote)};
const lines = ${JSON.stringify(lines)};

function Stage() {
  const [view, setView] = useState('quote');
  const script = view === 'scs' ? eligible : cube;
  const cart = {
    lines,
    changeQty() {},
    removeLine() {},
    noteQuote() {},
  };
  return (
    <div data-harness-current={view} style={{ minHeight: '100vh', background: '#111' }}>
      <div data-harness="" style={{ position: 'fixed', left: 0, top: 0, zIndex: 1, opacity: 0, pointerEvents: 'none' }}>
        <button type="button" data-harness-view="quote" onClick={() => setView('quote')}>quote</button>
        <button type="button" data-harness-view="checkout" onClick={() => setView('checkout')}>checkout</button>
        <button type="button" data-harness-view="scs" onClick={() => setView('scs')}>scs</button>
      </div>
      {view === 'checkout' ? (
        <AuthProvider>
          <CartChromeProvider value={cart}>
            <CheckoutPage
              assemblyRef={{ current: null }}
              partScriptsRef={{ current: {} }}
              liveScriptRef={{ current: '' }}
              partRunsRef={{ current: {} }}
              onClose={() => {}}
            />
          </CartChromeProvider>
        </AuthProvider>
      ) : (
        <QuoteModal
          key={view}
          mode="add"
          onClose={() => {}}
          onGetQuote={async () => fakeQuote}
          onAddToCart={async () => ({ ok: true })}
          currentScript={script}
          currentFilename={view === 'scs' ? 'Bracket.js' : 'Cube.js'}
          partId="part-1"
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
<html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<style>${processed.css}</style></head>
<body style="margin:0;background:#111">
<div id="root"></div>
<script>
window.fetch = async (url) => {
  const data = { success: true, authenticated: false, user: null, rates: [], addresses: [] };
  const text = JSON.stringify(data);
  return { ok: true, status: 200, json: async () => data, text: async () => text, url: String(url) };
};
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
    const page = await browser.newPage({ viewport: VIEW, deviceScaleFactor: 1 });
    page.on('pageerror', (err) => pageErrors.push(String(err && err.message || err)));
    await page.setContent(html, { waitUntil: 'load' });

    const show = (view) => page.evaluate((name) => {
      document.querySelector(`[data-harness-view="${name}"]`).click();
    }, view);
    const syncViewport = () => page.evaluate(() => {
      window.dispatchEvent(new Event('resize'));
    });
    const snap = (name) => page.screenshot({ path: join(shotDir, name) });
    const readBox = () => page.evaluate(() => {
      const overlay = document.querySelector('[data-modal-fit]');
      const panel = overlay && overlay.querySelector('.modal-fit-panel');
      const body = panel && panel.querySelector('.overflow-y-auto');
      const box = panel.getBoundingClientRect();
      const ih = window.innerHeight;
      const rootCs = getComputedStyle(document.documentElement);
      return {
        top: box.top,
        bottom: box.bottom,
        height: box.height,
        innerHeight: ih,
        maxHeight: parseFloat(getComputedStyle(panel).maxHeight),
        overflowY: getComputedStyle(body).overflowY,
        scrollHeight: body.scrollHeight,
        clientHeight: body.clientHeight,
        pageScroll: document.scrollingElement.scrollTop,
        bodyLock: document.body.style.overflow,
        vvTop: parseFloat(rootCs.getPropertyValue('--modal-vv-top')) || 0,
        vvH: parseFloat(rootCs.getPropertyValue('--modal-vvh')) || ih,
      };
    });
    const scrollButton = (selector) => page.evaluate((sel) => {
      const overlay = document.querySelector('[data-modal-fit]');
      const panel = overlay.querySelector('.modal-fit-panel');
      const body = panel.querySelector('.overflow-y-auto');
      const button = document.querySelector(sel);
      const before = body.scrollTop;
      body.scrollTop = body.scrollHeight;
      window.scrollTo(0, 800);
      const rect = button.getBoundingClientRect();
      const ih = window.innerHeight;
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const hit = cx >= 0 && cy >= 0 && cx < window.innerWidth && cy < ih
        ? document.elementFromPoint(cx, cy)
        : null;
      const max = Math.max(0, body.scrollHeight - body.clientHeight);
      return {
        contains: body.contains(button),
        scrolled: max <= 1 || body.scrollTop > before + 1,
        atBottom: body.scrollTop >= max - 2,
        pageScroll: document.scrollingElement.scrollTop,
        buttonTop: rect.top,
        buttonBottom: rect.bottom,
        buttonHeight: rect.height,
        hitButton: !!(hit && (hit === button || button.contains(hit))),
        innerHeight: ih,
        scrollHeight: body.scrollHeight,
        clientHeight: body.clientHeight,
      };
    }, selector);

    const assertFit = async (label, selector, { requireScroll }) => {
      const box = await readBox();
      check(`${label} panel is inside the window`,
        box.top >= -1 && box.bottom <= box.innerHeight + 1 && box.height > 40
        && box.top >= box.vvTop - 1 && box.bottom <= box.vvTop + box.vvH + 1,
        JSON.stringify({ top: box.top, bottom: box.bottom, h: box.height, ih: box.innerHeight, vv: box.vvH }));
      check(`${label} body still scrolls internally`,
        box.overflowY === 'auto' || box.overflowY === 'scroll');
      check(`${label} background scroll stays locked`,
        box.bodyLock === 'hidden' && box.pageScroll === 0);
      const long = box.scrollHeight > box.clientHeight + 2;
      if (requireScroll) {
        check(`${label} body content is longer than the panel`, long,
          `scroll ${box.scrollHeight} client ${box.clientHeight}`);
      }
      const moved = await scrollButton(selector);
      check(`${label} scrolling the body reaches the bottom`,
        moved.contains && moved.atBottom && (long ? moved.scrolled : true),
        JSON.stringify(moved));
      check(`${label} action is visible without scrolling the page`,
        moved.buttonHeight > 8
        && moved.buttonTop >= -1
        && moved.buttonBottom <= moved.innerHeight + 1
        && moved.hitButton
        && moved.pageScroll === 0,
        JSON.stringify(moved));
      return box;
    };

    await page.waitForSelector('[data-quote-add]', { timeout: 15000 });
    const hintTop = await page.evaluate(() => {
      const hint = document.querySelector('[data-quote-scroll-hint]');
      const body = document.querySelector('.quote-scroll');
      if (!hint || !body) return null;
      const rect = hint.getBoundingClientRect();
      return {
        w: rect.width,
        h: rect.height,
        chevron: !!hint.querySelector('svg'),
        scrollTop: body.scrollTop,
        overflowY: getComputedStyle(body).overflowY,
      };
    });
    check('quote scroll hint shows at the top',
      !!hintTop && hintTop.h > 8 && hintTop.w > 40 && hintTop.chevron
      && hintTop.scrollTop < 2
      && (hintTop.overflowY === 'auto' || hintTop.overflowY === 'scroll'),
      JSON.stringify(hintTop));
    await snap('modal-fit-quote-390-top.png');
    await assertFit('quote', '[data-quote-add]', { requireScroll: true });
    // Setting scrollTop delivers the scroll event on the next frame in this Chrome.
    await page.evaluate(() => new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    }));
    const hintBottom = await page.evaluate(() => document.querySelector('[data-quote-scroll-hint]'));
    check('quote scroll hint hides at the bottom', hintBottom == null, hintBottom ? 'still shown' : '');
    await snap('modal-fit-quote-390-bottom.png');

    await page.evaluate(() => {
      document.documentElement.style.setProperty('--modal-vvh', '420px');
      document.documentElement.style.setProperty('--modal-vv-top', '40px');
    });
    const shrunk = await readBox();
    check('a shorter visualViewport pulls the quote above the toolbar',
      shrunk.vvH === 420
      && shrunk.top >= 40 - 1
      && shrunk.bottom <= 40 + 420 + 1
      && shrunk.bottom <= shrunk.innerHeight + 1
      && shrunk.height <= 420,
      JSON.stringify(shrunk));
    await syncViewport();
    const restored = await readBox();
    check('a viewport resize reads visualViewport again',
      Math.abs(restored.vvH - restored.innerHeight) < 2 && restored.vvTop === 0,
      JSON.stringify({ vvH: restored.vvH, vvTop: restored.vvTop, ih: restored.innerHeight }));

    await page.setViewportSize({ width: 1440, height: 900 });
    await syncViewport();
    await page.waitForSelector('[data-quote-add]');
    await page.evaluate(() => {
      const body = document.querySelector('[data-modal-fit] .overflow-y-auto');
      if (body) body.scrollTop = 0;
    });
    const desktop = await readBox();
    check('desktop quote keeps the 90vh cap',
      desktop.innerHeight === 900
      && Math.abs(desktop.maxHeight - 0.9 * 900) < 2
      && desktop.top >= -1
      && desktop.bottom <= desktop.innerHeight + 1,
      JSON.stringify({ max: desktop.maxHeight, top: desktop.top, bottom: desktop.bottom }));
    await snap('modal-fit-quote-desktop.png');

    await page.setViewportSize(VIEW);
    await syncViewport();
    await show('checkout');
    await page.waitForSelector('[data-checkout-review]', { timeout: 15000 });
    await page.waitForSelector('[data-address-form]', { timeout: 5000 });
    await snap('modal-fit-checkout-390-top.png');
    await assertFit('checkout', '[data-checkout-review]', { requireScroll: true });
    await snap('modal-fit-checkout-390-bottom.png');
    await page.locator('[data-address-name]').focus();
    const focused = await page.evaluate(() => {
      const el = document.querySelector('[data-address-name]');
      const rect = el.getBoundingClientRect();
      return {
        top: rect.top,
        bottom: rect.bottom,
        pageScroll: document.scrollingElement.scrollTop,
        innerHeight: window.innerHeight,
      };
    });
    check('a focused address field stays inside the window',
      focused.top >= -1 && focused.bottom <= focused.innerHeight + 1 && focused.pageScroll === 0,
      JSON.stringify(focused));

    await show('scs');
    await page.waitForSelector('[data-sm-order]', { timeout: 15000 });
    await page.waitForSelector('[data-scs-handoff]');
    await snap('modal-fit-scs-390-top.png');
    await assertFit('scs handoff', '[data-sm-order]', { requireScroll: false });
    await snap('modal-fit-scs-390-bottom.png');

    check('the page did not throw', pageErrors.length === 0, pageErrors.join(' | '));
  } finally {
    await browser.close();
  }
}

console.log(failed ? `\n❌ FAIL (${failed} failed)` : `\n✅ PASS`);
process.exit(failed ? 1 : 0);

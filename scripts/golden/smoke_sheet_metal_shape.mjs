#!/usr/bin/env node
/**
 * Sheet Metal is a Shape tool on the left rail, on the desktop shell and at
 * 390px (the mobile feature bar). One button, after the other Shape tools,
 * in the same blue as those icons. The glyph is a plate with a bend line and
 * a bent flange. The right-rail inspection group does not carry a second copy.
 *
 * Screenshots go to GOLDEN_SHOT_DIR or os.tmpdir(), never the artifacts dir.
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

let failed = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`);
  }
}

console.log('sheet metal: Shape group on desktop and the 390px feature bar');

{
  const palette = read('src/components/HelperInsertPalette.jsx');
  const panel = read('src/components/CrossSectionPanel.jsx');
  const view = read('src/components/Viewport.jsx');
  const snippets = read('src/utils/helperPaletteSnippets.js');
  const icon = read('src/components/icons/SheetMetalPlate.jsx');
  const shapeAt = palette.indexOf("section.section === 'shape' && onOpenSheetMetal");
  const shapeBlock = shapeAt < 0 ? '' : palette.slice(shapeAt, shapeAt + 1600);
  const railBlue = 'text-blue-700 hover:bg-blue-100 active:bg-blue-200';
  check('rail order stays Block, Build, Shape, Polish, Move',
    /CAD_RAIL_ORDER = \['Primitives', 'Build', 'Shape', 'Features', 'Transforms'\]/.test(snippets)
    && /Primitives: 'Block'/.test(palette)
    && /Build: 'Build'/.test(palette)
    && /Shape: 'Shape'/.test(palette)
    && /Features: 'Polish'/.test(palette)
    && /Transforms: 'Move'/.test(palette));
  check('Sheet Metal is the Shape button, same blue, plate with a bent flange',
    shapeAt > 0
    && shapeBlock.includes(railBlue)
    && shapeBlock.includes('SheetMetalPlate')
    && palette.includes(railBlue)
    && !/orange/.test(shapeBlock)
    && !/FoldVertical/.test(shapeBlock)
    && /data-sheet-metal-button="1"/.test(shapeBlock)
    && /data-sheet-metal-icon/.test(shapeBlock)
    && /M4 10h11l5-4v10l-5 4H4z/.test(icon)
    && /M12 10v10/.test(icon)
    && /stroke="currentColor"/.test(icon)
    && /strokeWidth=\{strokeWidth\}/.test(icon)
    && /strokeWidth=\{2\}/.test(shapeBlock)
    && /aria-label="Sheet Metal: pick SendCutSend material and gauge"/.test(shapeBlock)
    && /onClick=\{\(\) => onOpenSheetMetal\(\)\}/.test(shapeBlock));
  check('Viewport opens the picker from the left rail, hidden in game',
    /onOpenSheetMetal=\{mode !== 'game' && onBindSheetMetal/.test(view)
    && /setSheetMetalPicker\(/.test(view)
    && !/onOpenSheetMetal=/.test(panel));
  check('the right rail has no Sheet Metal copy',
    !/data-sheet-metal-button/.test(panel)
    && !/data-sheet-metal-group="inspection"/.test(panel)
    && !/FoldVertical/.test(panel));
}

const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
check('system Chrome available for the rail render', !!exe, 'set CHROME_PATH');

if (exe && failed === 0) {
  const cssSrc = read('src/index.css');
  const processed = await postcss([
    tailwindcss({ config: join(ROOT, 'tailwind.config.js') }),
    autoprefixer(),
  ]).process(cssSrc, { from: join(ROOT, 'src/index.css') });

  const bundled = await build({
    stdin: {
      contents: `import { createRoot } from 'react-dom/client';
import HelperInsertPalette from './src/components/HelperInsertPalette.jsx';
import CrossSectionPanel from './src/components/CrossSectionPanel.jsx';

function Stage() {
  const compact = window.innerWidth <= 768;
  return (
    <div data-sheet-shape-stage="" data-compact={compact ? '1' : '0'} style={{ position: 'relative', width: '100vw', height: '100vh', background: '#1e1e1e' }}>
      <HelperInsertPalette
        layout="cad"
        compact={compact}
        onInsert={() => {}}
        onOpenSheetMetal={() => { window.__sheetOpened = (window.__sheetOpened || 0) + 1; }}
      />
      <CrossSectionPanel
        verticalRail
        showPaint
        paintActive={false}
        onPaintToggle={() => {}}
        enabled={false}
        onToggle={() => {}}
        onPlaneChange={() => {}}
        onZoomToFit={() => {}}
        onSnapView={() => {}}
      />
    </div>
  );
}
createRoot(document.getElementById('root')).render(<Stage />);
window.__sheetOpened = 0;
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
<html><head><meta charset="utf-8"><style>${processed.css}</style></head>
<body style="margin:0;background:#1e1e1e">
<div id="root"></div>
<script>${bundled.outputFiles[0].text}</script>
</body></html>`;

  const browser = await chromium.launch({
    executablePath: exe,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
attachConsentPresetToBrowser(browser);
  const views = [
    ['390px mobile feature bar', '390', 390, 844],
    ['desktop feature strip', 'desktop', 1280, 800],
  ];
  try {
    mkdirSync(shotDir, { recursive: true });
    for (const [label, slug, width, height] of views) {
      const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
      await page.setContent(html, { waitUntil: 'load' });
      await page.waitForSelector('[data-palette-section="shape"]', { timeout: 8000 });
      const placed = await page.evaluate(() => {
        const sections = [...document.querySelectorAll('[data-palette-section]')];
        const shape = document.querySelector('[data-palette-section="shape"]');
        const buttons = [...document.querySelectorAll('[data-sheet-metal-button]')];
        const right = document.querySelector('[data-rail-pair="right"]');
        const shapeButtons = shape ? [...shape.querySelectorAll('button')] : [];
        const last = shapeButtons[shapeButtons.length - 1] || null;
        return {
          order: sections.map((el) => el.getAttribute('data-palette-section')),
          labels: sections.map((el) => (el.innerText || '').split('\n')[0].trim()),
          count: buttons.length,
          inShape: !!(shape && last && last === buttons[0] && shape.contains(buttons[0])),
          inRight: buttons.some((btn) => right && right.contains(btn)),
          label: last ? last.getAttribute('aria-label') : '',
          compact: document.querySelector('[data-sheet-shape-stage]')?.getAttribute('data-compact'),
        };
      });
      check(`${label}: sections are Block, Build, Shape, Polish, Move`,
        placed.order.join(',') === 'primitives,build,shape,features,transforms'
        && placed.labels.join(',') === 'BLOCK,BUILD,SHAPE,POLISH,MOVE',
        JSON.stringify(placed));
      check(`${label}: Sheet Metal is the last Shape button and not on the right rail`,
        placed.count === 1 && placed.inShape && !placed.inRight
        && placed.label === 'Sheet Metal: pick SendCutSend material and gauge'
        && placed.compact === (width <= 768 ? '1' : '0'),
        JSON.stringify(placed));
      const paintOf = (which) => page.evaluate((target) => {
        const shape = document.querySelector('[data-palette-section="shape"]');
        const shapeButtons = [...shape.querySelectorAll('button')];
        const btn = target === 'sheet'
          ? shapeButtons[shapeButtons.length - 1]
          : shapeButtons[shapeButtons.length - 2];
        const svg = btn.querySelector('svg');
        const style = getComputedStyle(btn);
        return {
          color: style.color,
          bg: style.backgroundColor,
          stroke: svg ? getComputedStyle(svg).stroke : '',
          orange: /orange/.test(btn.className),
          blue: btn.className.includes('text-blue-700')
            && btn.className.includes('hover:bg-blue-100')
            && btn.className.includes('active:bg-blue-200'),
        };
      }, which);
      const sameBlue = (a, b) => !!(a && b && a.color === b.color && a.bg === b.bg
        && a.stroke === b.stroke && a.color === a.stroke
        && a.blue && b.blue && !a.orange && !b.orange
        && a.color !== 'rgb(194, 65, 12)');
      const settle = () => page.waitForTimeout(250);
      await page.mouse.move(0, 0);
      await settle();
      const restSheet = await paintOf('sheet');
      const restSibling = await paintOf('sibling');
      check(`${label}: default icon color matches the sibling blue and is not orange`,
        sameBlue(restSheet, restSibling),
        JSON.stringify({ restSheet, restSibling }));
      const shapeButtons = page.locator('[data-palette-section="shape"] button');
      const shapeCount = await shapeButtons.count();
      const siblingBtn = shapeButtons.nth(shapeCount - 2);
      const sheetBtn = shapeButtons.nth(shapeCount - 1);
      await siblingBtn.hover();
      await settle();
      const hoverSibling = await paintOf('sibling');
      await sheetBtn.hover();
      await settle();
      const hoverSheet = await paintOf('sheet');
      check(`${label}: hover icon color matches the sibling blue and is not orange`,
        sameBlue(hoverSheet, hoverSibling) && hoverSheet.bg !== restSheet.bg,
        JSON.stringify({ hoverSheet, hoverSibling, rest: restSheet.bg }));
      const pressed = async (loc, which) => {
        await loc.hover();
        await page.mouse.down();
        await settle();
        const paint = await paintOf(which);
        await page.mouse.up();
        await settle();
        return paint;
      };
      const activeSibling = await pressed(siblingBtn, 'sibling');
      const activeSheet = await pressed(sheetBtn, 'sheet');
      check(`${label}: active icon color matches the sibling blue and is not orange`,
        sameBlue(activeSheet, activeSibling) && activeSheet.bg !== hoverSheet.bg,
        JSON.stringify({ activeSheet, activeSibling, hover: hoverSheet.bg }));
      await page.evaluate(() => { window.__sheetOpened = 0; });
      await page.click('[data-sheet-metal-button]');
      const opened = await page.evaluate(() => window.__sheetOpened);
      check(`${label}: the button opens sheet metal`, opened === 1, String(opened));
      const file = join(shotDir, `sheet-metal-shape-dark-${slug}.png`);
      await page.locator('[data-palette-section="shape"]').screenshot({ path: file });
      console.log(`  shot ${file}`);
      await page.close();
    }
  } finally {
    await browser.close();
  }
}

if (failed) {
  console.log(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nAll sheet-metal Shape checks passed');

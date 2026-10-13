#!/usr/bin/env node
/**
 * Phone layout: the sheet-metal chip (material, hint, Check, Done) is
 * the shared feature card in the gap between the side rails. At 375 and
 * 390 its box does not intersect either toolbar (10px off each rail).
 * The hint wraps; the material line ellipsizes. Desktop (1280) stays
 * within the 22rem cap and also clears the rails.
 *
 * Screenshots go to GOLDEN_SHOT_DIR or os.tmpdir(), never the artifacts dir.
 */
/* The evaluate callback runs in the browser, where document exists. */
/* global document, getComputedStyle */
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

let failed = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`);
  }
}

function intersects(a, b) {
  if (!a || !b) return true;
  return a.left < b.right - 0.5 && a.right > b.left + 0.5
    && a.top < b.bottom - 0.5 && a.bottom > b.top + 0.5;
}

console.log('sheet chip: between the side rails');

{
  const chip = read('src/components/sheetMetal/SheetMetalModeChip.jsx');
  const layout = read('src/utils/sheetMetal/sheetChipLayout.js');
  const cardLayout = read('src/utils/featureSheetLayout.js');
  const flow = read('src/components/sheetMetal/SheetMetalFlow.jsx');
  const rail = read('src/components/sheetMetal/SheetMetalRail.jsx');
  const palette = read('src/components/HelperInsertPalette.jsx');
  check('chip is the feature card, which measures the rails',
    /<SmPopup/.test(chip)
    && /sheetChipBetweenRails/.test(cardLayout)
    && /data-rail-pair="left"/.test(read('src/utils/featureSheetLayout.js'))
    && /FEATURE_SHEET_SIDE_GAP_PX = 10/.test(cardLayout));
  check('layout uses measured boxes, not a phone-width guess',
    /leftRail\.right/.test(layout) && /rightRail\.left/.test(layout) && !/375|390/.test(layout));
  check('hint wraps and material truncates', /data-sm-hint/.test(flow) && /break-words/.test(flow)
    && /data-sm-material/.test(chip) && /truncate/.test(chip));
  check('sheet tools live under Shape', /data-palette-section="shape"/.test(rail)
    && />\s*Shape\s*</.test(rail) && !/data-palette-section="sheet"/.test(palette));
}

const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
check('system Chrome available for the layout render', !!exe, 'set CHROME_PATH');

if (exe && failed === 0) {
  const cssSrc = read('src/index.css');
  const processed = await postcss([
    tailwindcss({ config: join(ROOT, 'tailwind.config.js') }),
    autoprefixer(),
  ]).process(cssSrc, { from: join(ROOT, 'src/index.css') });

  const bundled = await build({
    stdin: {
      contents: `import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import SheetMetalFlow from './src/components/sheetMetal/SheetMetalFlow.jsx';
import SheetMetalRail from './src/components/sheetMetal/SheetMetalRail.jsx';
import CrossSectionPanel from './src/components/CrossSectionPanel.jsx';
import { sheetToolsFor } from './src/utils/sheetMetal/sheetMetalMode.js';

const sku = {
  sku: 'SST-060',
  name: 'Stainless Steel (304 Series)',
  thicknessIn: 0.06,
  thicknessMm: 1.52,
  gauge: 16,
};
const spec = {
  limits: { services: ['bending', 'tapping'], bendable: true },
  width: 100,
  height: 60,
  t: 1.52,
};

function Stage() {
  const [compact, setCompact] = useState(window.innerWidth <= 768);
  const [mode, setMode] = useState({
    stage: 'edit', sku, tool: 'bend', spec, draft: null, partId: 'sheet-1',
  });
  useEffect(() => {
    const onResize = () => setCompact(window.innerWidth <= 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return (
    <div data-sheet-stage="" style={{ position: 'relative', width: '100vw', height: '100vh', background: '#171717' }}>
      <SheetMetalRail
        tools={sheetToolsFor(spec)}
        tool={mode.tool}
        onSelectTool={(id) => setMode((m) => ({ ...m, tool: id }))}
        onExit={() => {}}
      />
      <CrossSectionPanel
        verticalRail
        enabled={false}
        onToggle={() => {}}
        onPlaneChange={() => {}}
        onZoomToFit={() => {}}
        onSnapView={() => {}}
      />
      <SheetMetalFlow mode={mode} setMode={setMode} onCommit={() => true} onExit={() => {}} compact={compact} />
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
<html><head><meta charset="utf-8"><style>${processed.css}</style></head>
<body style="margin:0;background:#171717">
<div id="root"></div>
<script>${bundled.outputFiles[0].text}</script>
</body></html>`;

  const browser = await chromium.launch({
    executablePath: exe,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    mkdirSync(shotDir, { recursive: true });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: 'load' });
    await page.waitForSelector('[data-sheet-chip-gap="measured"]', { timeout: 5000 });

    const measure = () => page.evaluate(() => {
      const box = (el) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
      };
      const chip = document.querySelector('[data-sheet-metal-mode]');
      const left = document.querySelector('[data-rail-pair="left"]');
      const right = document.querySelector('[data-rail-pair="right"]');
      const material = document.querySelector('[data-sm-material]');
      const hint = document.querySelector('[data-sm-hint]');
      const shape = document.querySelector('[data-palette-section="shape"]');
      const matCs = material ? getComputedStyle(material) : null;
      const hintCs = hint ? getComputedStyle(hint) : null;
      return {
        chip: box(chip),
        left: box(left),
        right: box(right),
        gap: chip?.getAttribute('data-sheet-chip-gap') || '',
        shapeLabel: (shape?.querySelector('div')?.textContent || '').trim(),
        tools: [...document.querySelectorAll('[data-sheet-tool]')].map((el) => el.getAttribute('data-sheet-tool')),
        materialOverflow: !!(material && material.scrollWidth > material.clientWidth + 1),
        materialEllipsis: matCs?.textOverflow || '',
        materialWhiteSpace: matCs?.whiteSpace || '',
        hintWhiteSpace: hintCs?.whiteSpace || '',
        hintOverflow: hintCs?.overflowWrap || hintCs?.wordBreak || '',
        hintFits: !!(hint && hint.scrollWidth <= hint.clientWidth + 1),
        hintLines: hint ? hint.getClientRects().length : 0,
        hintText: (hint?.textContent || '').trim(),
      };
    });

    const waitForGap = () => page.waitForFunction(() => {
      const chip = document.querySelector('[data-sheet-metal-mode]');
      const left = document.querySelector('[data-rail-pair="left"]');
      const right = document.querySelector('[data-rail-pair="right"]');
      if (!chip || !left || !right) return false;
      if (chip.getAttribute('data-sheet-chip-gap') !== 'measured') return false;
      const c = chip.getBoundingClientRect();
      const l = left.getBoundingClientRect();
      const r = right.getBoundingClientRect();
      const available = r.left - l.right - 20;
      return c.width > 0 && Math.abs(c.width - available) < 2
        && c.left >= l.right - 0.5 && c.right <= r.left + 0.5;
    });

    for (const width of [375, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await waitForGap();
      const m = await measure();
      const clear = m.chip && m.left && m.right && !intersects(m.chip, m.left) && !intersects(m.chip, m.right);
      const centered = m.chip && m.left && m.right
        && Math.abs(((m.chip.left + m.chip.right) / 2) - ((m.left.right + m.right.left) / 2)) < 2;
      const inside = m.chip && m.chip.left >= m.left.right - 0.5 && m.chip.right <= m.right.left + 0.5;
      check(
        `${width}px: chip misses both toolbars and sits in the gap`,
        clear && centered && inside && m.gap === 'measured'
          && m.shapeLabel === 'Shape'
          && m.tools.join(',') === 'tab,bend,hole,tapped'
          && m.materialEllipsis === 'ellipsis'
          && m.materialWhiteSpace === 'nowrap'
          && m.materialOverflow
          && m.hintWhiteSpace === 'normal'
          && m.hintFits
          && /break-word|anywhere/.test(m.hintOverflow)
          && /orange edge/.test(m.hintText),
        JSON.stringify({
          chip: m.chip, left: m.left, right: m.right, gap: m.gap,
          shape: m.shapeLabel, tools: m.tools,
          materialOverflow: m.materialOverflow, ellipsis: m.materialEllipsis,
          hintFits: m.hintFits, hintOverflow: m.hintOverflow, hintLines: m.hintLines,
        }),
      );
    }

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForSelector('[data-sheet-chip-gap="measured"]');
    await page.screenshot({ path: join(shotDir, 'sheet-chip-390.png') });
    const rail = page.locator('[data-sheet-metal-rail]');
    if (await rail.count()) {
      await rail.screenshot({ path: join(shotDir, 'sheet-shape-rail-390.png') });
    }

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForFunction(() => {
      const chip = document.querySelector('[data-sheet-metal-mode]');
      const left = document.querySelector('[data-rail-pair="left"]');
      const right = document.querySelector('[data-rail-pair="right"]');
      if (!chip || !left || !right) return false;
      if (chip.getAttribute('data-sheet-chip-gap') !== 'measured') return false;
      const c = chip.getBoundingClientRect();
      const l = left.getBoundingClientRect();
      const r = right.getBoundingClientRect();
      return c.width > 0 && c.width <= 22 * 16 + 1
        && c.right <= r.left + 0.5 && c.left >= l.right - 0.5;
    });
    const desk = await measure();
    const deskClear = desk.chip && !intersects(desk.chip, desk.left) && !intersects(desk.chip, desk.right);
    check(
      '1280px: chip stays within 22rem and misses both toolbars',
      deskClear && desk.gap === 'measured' && desk.chip.width <= 22 * 16 + 1,
      JSON.stringify({ chip: desk.chip, left: desk.left, right: desk.right }),
    );
  } finally {
    await browser.close();
  }
}

console.log(failed ? `\n❌ FAIL (${failed} failed)` : `\n✅ PASS`);
process.exit(failed ? 1 : 0);

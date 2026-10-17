#!/usr/bin/env node
/**
 * Open assembly? — Cancel, Insert parts into current, Open assembly share
 * one right-aligned row at phone width.
 *
 * Every entry uses this one dialog: folder → Assembly opens the assembly
 * list, and that list's git open search filters the same rows. Both call
 * askOpenAssemblyChoice. (+ → Assembly creates a new assembly and does not
 * open this dialog.) Desktop and mobile mount the same PartFeed.
 *
 * Renders the real dialog at 390px (and 375px) and checks the three buttons
 * share one top, stay inside the card, and are at least 40px tall. The blue
 * primary stays the primary.
 */
/* The evaluate callback runs in the browser, where document exists. */
/* global document, window, getComputedStyle */
import { existsSync, readFileSync } from 'node:fs';
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

console.log('open assembly choice: one row at phone width');

{
  const feed = read('src/components/PartFeed.jsx');
  const choice = read('src/components/OpenAssemblyChoiceDialog.jsx');
  const chrome = read('src/utils/partsChrome.js');
  const app = read('src/App.jsx');
  const pkg = read('package.json');

  check(
    'folder Assembly list and git open search share one choice dialog',
    /data-part-open-action="assembly"/.test(feed)
      && /requestAssemblyAction\('existing'\)/.test(feed)
      && /const startOpenAssembly/.test(feed)
      && /loadOpenIndex\('open-assembly'\)/.test(feed)
      && /<AssemblyOpenList\b/.test(feed)
      && /onOpen=\{askOpenAssemblyChoice\}/.test(feed)
      && /data-assembly-delete/.test(read('src/components/DeleteAssemblyDialog.jsx'))
      && /data-git-open-search/.test(feed)
      && /filterVaultOpenIndex/.test(feed)
      && (feed.match(/<OpenAssemblyChoiceDialog\b/g) || []).length === 1
      && (choice.match(/data-git-open-insert=/g) || []).length === 1
      && !/data-git-open-insert/.test(feed),
  );
  check(
    'desktop and mobile share that PartFeed',
    (app.match(/<PartFeed\b/g) || []).length === 1
      && /placement=\{isMobile \? 'mobile' : 'desktop'\}/.test(app),
  );
  const cancelAt = choice.indexOf('data-git-dialog-cancel');
  const insertAt = choice.indexOf('data-git-open-insert');
  const openAt = choice.indexOf('data-git-open-replace');
  check(
    'row is right-aligned, nowrap, tighter gap; labels stay full, in order',
    /flex flex-nowrap items-center justify-end gap-1/.test(choice)
      && /data-git-open-choice-stage/.test(choice)
      && />\s*Cancel\s*</.test(choice)
      && /Insert parts into current/.test(choice)
      && />\s*Open assembly\s*</.test(choice)
      && cancelAt > 0 && insertAt > cancelAt && openAt > insertAt,
  );
  check(
    'buttons reuse the vault dialog ghost / secondary / primary styles, 40px, no wrap',
    /PARTS_DIALOG_BTN_GHOST/.test(choice)
      && /PARTS_DIALOG_BTN_SECONDARY/.test(choice)
      && /PARTS_DIALOG_BTN_PRIMARY/.test(choice)
      && /PARTS_DIALOG_BTN_COMPACT/.test(choice)
      && /bg-blue-600/.test(chrome)
      && /border border-gray-600/.test(chrome)
      && /h-10/.test(chrome)
      && /whitespace-nowrap/.test(chrome)
      && /px-2/.test(chrome),
  );
  check(
    'package.json registers golden:open-assembly-choice-row',
    /"golden:open-assembly-choice-row": "node scripts\/golden\/smoke_open_assembly_choice_row\.mjs"/.test(pkg),
  );
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
import OpenAssemblyChoiceDialog from './src/components/OpenAssemblyChoiceDialog.jsx';
createRoot(document.getElementById('root')).render(
  <OpenAssemblyChoiceDialog
    assemblyName="TestSuite"
    onClose={() => {}}
    onInsert={() => {}}
    onOpen={() => {}}
  />,
);
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
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: 'load' });
    await page.waitForSelector('[data-git-open-choice-stage] button', { timeout: 5000 });

    const measure = () => page.evaluate(() => {
      const dialog = document.querySelector('[data-git-dialog="open-choice"]');
      const card = dialog ? dialog.querySelector(':scope > div') : null;
      const row = document.querySelector('[data-git-open-choice-stage]');
      const buttons = row ? [...row.querySelectorAll('button')] : [];
      const box = (el) => {
        const r = el.getBoundingClientRect();
        return {
          top: r.top, left: r.left, right: r.right, bottom: r.bottom,
          width: r.width, height: r.height,
        };
      };
      return {
        labels: buttons.map((b) => (b.textContent || '').trim()),
        buttons: buttons.map((b) => {
          const cs = getComputedStyle(b);
          return {
            ...box(b),
            bg: cs.backgroundColor,
            borderTop: parseFloat(cs.borderTopWidth) || 0,
            weight: cs.fontWeight,
            whiteSpace: cs.whiteSpace,
          };
        }),
        row: row ? box(row) : null,
        card: card ? box(card) : null,
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
        rowScroll: row ? row.scrollWidth : 0,
        rowClient: row ? row.clientWidth : 0,
      };
    });

    for (const width of [375, 390]) {
      await page.setViewportSize({ width, height: 844 });
      const m = await measure();
      const tops = m.buttons.map((b) => b.top);
      const sameTop = tops.length === 3 && Math.max(...tops) - Math.min(...tops) < 1;
      const tall = m.buttons.every((b) => b.height >= 40);
      const inside = m.card && m.buttons.every((b) => (
        b.left >= m.card.left - 0.5 && b.right <= m.card.right + 0.5
      ));
      const noPageOverflow = m.scrollWidth <= m.innerWidth + 1;
      const noRowOverflow = m.rowScroll <= m.rowClient + 1;
      const rightAligned = m.row && m.buttons.length === 3
        && Math.abs(m.buttons[2].right - m.row.right) <= 1
        && m.buttons[0].left >= m.row.left - 0.5;
      const detail = `labels=${m.labels.join(' | ')} tops=${tops.map((t) => t.toFixed(1)).join(',')} h=${m.buttons.map((b) => b.height.toFixed(1)).join(',')} w=${m.buttons.map((b) => Math.round(b.width)).join('+')} row=${m.rowClient}/${m.rowScroll} page=${m.scrollWidth}/${m.innerWidth}`;
      check(
        `${width}px: three buttons, one row, inside the card, no overflow`,
        m.labels.join('|') === 'Cancel|Insert parts into current|Open assembly'
          && sameTop && tall && inside && noPageOverflow && noRowOverflow && rightAligned,
        detail,
      );
    }

    await page.setViewportSize({ width: 390, height: 844 });
    const at390 = await measure();
    const primary = at390.buttons[2];
    const cancel = at390.buttons[0];
    const insert = at390.buttons[1];
    const blue = primary && /37,\s*99,\s*235/.test(primary.bg);
    check(
      '390px: Open assembly stays the blue primary; others do not',
      !!blue
        && cancel && !/37,\s*99,\s*235/.test(cancel.bg)
        && insert && insert.borderTop >= 1
        && primary.whiteSpace === 'nowrap'
        && (primary.weight === '500' || primary.weight === 500),
      `primary=${primary && primary.bg} weight=${primary && primary.weight} insertBorder=${insert && insert.borderTop}`,
    );

    const shot = process.env.OPEN_ASSEMBLY_CHOICE_SHOT;
    if (shot) await page.screenshot({ path: shot });
    const cardShot = process.env.OPEN_ASSEMBLY_CHOICE_CARD_SHOT;
    if (cardShot) {
      await page.locator('[data-git-dialog="open-choice"] > div').screenshot({ path: cardShot });
    }
  } finally {
    await browser.close();
  }
}

console.log(failed ? `\n❌ FAIL (${failed} failed)` : `\n✅ PASS`);
process.exit(failed ? 1 : 0);

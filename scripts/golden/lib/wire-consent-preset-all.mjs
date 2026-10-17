#!/usr/bin/env node
/**
 * One-off maintainer script: attach consent preset to every Playwright browser launch.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { globSync } from 'node:fs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');

const SKIP = new Set([
  'scripts/golden/lib/wire-consent-preset-all.mjs',
  'scripts/golden/lib/presetConsentInit.mjs',
]);

function importPath(file) {
  const rel = relative(dirname(file), join(ROOT, 'scripts/golden/lib/presetConsentInit.mjs'));
  return rel.startsWith('.') ? rel : `./${rel}`;
}

function patchFile(file) {
  const relPath = relative(ROOT, file).split('\\').join('/');
  if (SKIP.has(relPath)) return false;
  let src = readFileSync(file, 'utf8');
  if (!src.includes('chromium.launch') || src.includes('attachConsentPresetToBrowser')) return false;
  if (!src.includes("from 'playwright-core'") && !src.includes('from "playwright-core"')) return false;

  const importLine = `import { attachConsentPresetToBrowser } from '${importPath(file)}';\n`;
  if (!src.includes('attachConsentPresetToBrowser')) {
    src = src.replace(
      /import \{ chromium \} from 'playwright-core';?\n/,
      `import { chromium } from 'playwright-core';\n${importLine}`,
    );
  }

  const launchRe = /((?:const|let)\s+browser|browser)\s*=\s*await\s+chromium\.launch\(\{[\s\S]*?\}\);/g;
  let changed = false;
  src = src.replace(launchRe, (match) => {
    if (match.includes('attachConsentPresetToBrowser')) return match;
    changed = true;
    return `${match}\nattachConsentPresetToBrowser(browser);`;
  });

  if (!changed) return false;
  writeFileSync(file, src);
  return true;
}

const patterns = [
  join(ROOT, 'scripts/golden/**/*.mjs'),
  join(ROOT, 'scripts/ci/**/*.mjs'),
  join(ROOT, 'scripts/demo/**/*.mjs'),
  join(ROOT, 'scripts/verify/**/*.mjs'),
  join(ROOT, 'test/**/*.mjs'),
];

let count = 0;
for (const pattern of patterns) {
  for (const file of globSync(pattern)) {
    if (patchFile(file)) {
      count += 1;
      console.log('patched', relative(ROOT, file));
    }
  }
}
console.log(`done: ${count} file(s)`);

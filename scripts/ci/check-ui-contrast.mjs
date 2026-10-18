#!/usr/bin/env node
/**
 * Flag black / dark text on a dark brand surface in the same class or style
 * string. Cheap same-element scan — see docs/ui_style_guide.md.
 *
 * Allow a true exception with `ui-contrast-allow` on that line or the one above.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');

const SKIP_DIR = new Set([
  'node_modules', 'dist', 'dist-ssr', 'built', '.git', 'fea', 'surfcad-fea',
]);

/** Pairing panel chrome still uses accent utilities; Allow/Deny is scanned. */
const SKIP_FILE = new Set([
  'src/components/AgentBridgePairing.jsx',
]);

const DARK_SURFACE = /\b(?:surface-dark|surface-panel|surface-splash-dark|surface-glass|bg-chrome-surface|bg-chrome-background|bg-gray-900|bg-gray-950|bg-slate-900|bg-slate-950|bg-blue-900|bg-blue-950|bg-\[#(?:0{3,8}|111|111111|111827|1e1e1e|16171[Dd]|0[Ff]172[Aa])\])\b/i;

const DARK_TEXT = /\b(?:text-black|text-gray-900|text-gray-800|text-gray-700|text-slate-900|text-slate-800|text-chrome-text-secondary|text-\[#(?:0{3,8}|111|111111|16171[Dd]|1e1e1e)\])\b/i;

const DARK_BG_STYLE = /(?:background(?:-color)?)\s*:\s*['"]?#(?:0{3,8}|111|111111|111827|1e1e1e|16171[Dd])\b/i;
const DARK_FG_STYLE = /(?:^|[^\w-])color\s*:\s*['"]?#(?:0{3,8}|111|111111|16171[Dd]|1e1e1e)\b/i;

/** Linear quoted-string walk. A regex over Viewport-sized files can hang. */
export function extractQuotedStrings(source) {
  const out = [];
  const n = source.length;
  let i = 0;
  while (i < n) {
    const c = source[i];
    if (c === '"' || c === "'" || c === '`') {
      const start = i;
      i += 1;
      while (i < n) {
        if (source[i] === '\\') {
          i += 2;
          continue;
        }
        if (source[i] === c) {
          i += 1;
          break;
        }
        i += 1;
      }
      out.push({ text: source.slice(start, i), index: start });
      continue;
    }
    i += 1;
  }
  return out;
}

export function isAllowlisted(source, index) {
  const lineStart = source.lastIndexOf('\n', index - 1) + 1;
  const prevBreak = source.lastIndexOf('\n', lineStart - 2);
  const prevStart = prevBreak === -1 ? 0 : prevBreak + 1;
  const nextBreak = source.indexOf('\n', index);
  const window = source.slice(prevStart, nextBreak === -1 ? source.length : nextBreak);
  return /ui-contrast-allow/.test(window);
}

function lineNumber(source, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    if (source.charCodeAt(i) === 10) line += 1;
  }
  return line;
}

export function findContrastViolations(source, file = 'input') {
  const hits = [];
  for (const { text, index } of extractQuotedStrings(source)) {
    const darkSurf = DARK_SURFACE.test(text) || DARK_BG_STYLE.test(text);
    const darkText = DARK_TEXT.test(text) || DARK_FG_STYLE.test(text);
    if (!darkSurf || !darkText) continue;
    if (isAllowlisted(source, index)) continue;
    hits.push({
      file,
      line: lineNumber(source, index),
      excerpt: text.replace(/\s+/g, ' ').slice(0, 160),
    });
  }
  return hits;
}

function walk(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (SKIP_DIR.has(name)) continue;
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(full, out);
    else if (/\.(jsx?|mjs|cjs)$/.test(name) && !/\.test\./.test(name)) out.push(full);
  }
  return out;
}

export function collectScanFiles(root = ROOT) {
  return walk(join(root, 'src'), []).filter((abs) => {
    const rel = relative(root, abs).split('\\').join('/');
    if (rel.startsWith('src/fea/')) return false;
    if (SKIP_FILE.has(rel)) return false;
    return true;
  });
}

export function scanFiles(files, root = ROOT) {
  const violations = [];
  for (const abs of files) {
    const rel = relative(root, abs).split('\\').join('/');
    const source = readFileSync(abs, 'utf8');
    for (const hit of findContrastViolations(source, rel)) violations.push(hit);
  }
  return violations;
}

function main() {
  const files = collectScanFiles(ROOT);
  const violations = scanFiles(files, ROOT);
  if (violations.length) {
    console.error(`UI contrast: ${violations.length} dark-on-dark hit(s). See docs/ui_style_guide.md`);
    for (const v of violations) {
      console.error(`  ${v.file}:${v.line}: ${v.excerpt}`);
    }
    process.exit(1);
  }
  console.log(`UI contrast OK (${files.length} files).`);
}

const invoked = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invoked) main();

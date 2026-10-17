import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  CONTOUR_DRAFT_COLOR,
  CONTOUR_PICK_COLOR,
  CONTOUR_REPEATED_COLOR,
  CONTOUR_SELECTED_COLOR,
  CONTOUR_STATUS_COLOR,
} from './contourStatus.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');

test('sketch status colour constants stay put', () => {
  assert.deepEqual(CONTOUR_STATUS_COLOR, {
    under: 0x22d3ee,
    full: 0x000000,
    conflict: 0xf87171,
  });
  assert.equal(CONTOUR_DRAFT_COLOR, 0x22d3ee);
  assert.equal(CONTOUR_REPEATED_COLOR, 0xfbbf24);
  assert.equal(CONTOUR_PICK_COLOR, 0xfbbf24);
  // Selected ghost is amber, not brand orange and not the locked black.
  assert.equal(CONTOUR_SELECTED_COLOR, 0xff9900);
});

function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'fea') continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

test('brand orange is not a status or sketch colour', () => {
  const banned = /#ff5a1f|0xff5a1f/i;
  const files = [];
  for (const dir of ['src/utils', 'src/components']) {
    walk(join(ROOT, dir), files);
  }
  const sketchish = files.filter((file) => {
    const base = file.split('/').pop();
    if (/\.test\./i.test(base)) return false;
    return /sketch|contourStatus|ContourStatus|statusColour|statusColor/i.test(base);
  });
  assert.ok(sketchish.some((file) => file.endsWith('contourStatus.js')));
  assert.ok(sketchish.some((file) => file.endsWith('sketchLine.js')));
  for (const file of sketchish) {
    const text = readFileSync(file, 'utf8');
    assert.equal(banned.test(text), false, file);
  }
});

test('chrome tokens keep today\'s colours', () => {
  const css = readFileSync(join(ROOT, 'src/index.css'), 'utf8');
  assert.match(css, /--chrome-background:\s*30 30 30;\s*\/\* #1e1e1e \*\//);
  assert.match(css, /--chrome-surface:\s*17 24 39;\s*\/\* gray-900 #111827 \*\//);
  assert.match(css, /--chrome-text:\s*243 244 246;\s*\/\* gray-100 #f3f4f6 \*\//);
  assert.match(css, /--chrome-text-secondary:\s*156 163 175;\s*\/\* gray-400 #9ca3af \*\//);
  assert.match(css, /--chrome-divider:\s*55 65 81;\s*\/\* gray-700 #374151 \*\//);
  assert.match(css, /--chrome-border:\s*55 65 81;\s*\/\* gray-700 #374151 \*\//);
  assert.match(css, /--brand-paper:\s*250 250 249;\s*\/\* #FAFAF9 \*\//);
  assert.match(css, /--brand-ink:\s*22 23 29;\s*\/\* #16171D \*\//);
  assert.match(css, /--brand-grey:\s*107 110 120;\s*\/\* #6B6E78 \*\//);
  assert.match(css, /--brand-orange:\s*255 90 31;\s*\/\* #FF5A1F \*\//);
  assert.match(css, /\.surface-dark\b/);
  assert.match(css, /\.text-on-dark\b/);
  assert.match(css, /\.font-ui\b/);
});

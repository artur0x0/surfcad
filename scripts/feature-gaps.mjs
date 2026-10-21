#!/usr/bin/env node
/**
 * The feature backlog: every FEATURE-GAP note in a vault's parts.
 *
 *   node scripts/feature-gaps.mjs <vault-dir> [--json]
 *
 * Reads `parts/*.js` (the v2 layout) or any `*.js` under the folder, folds
 * the same gap written in different cases into one row, and prints the
 * rows most-seen first with the parts they came from.
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, extname, basename } from 'node:path';
import { collectFeatureGaps } from '../src/utils/featureGaps.js';

const args = process.argv.slice(2);
const json = args.includes('--json');
const dir = args.find((a) => !a.startsWith('--'));
if (!dir || !existsSync(dir)) {
  console.error('usage: node scripts/feature-gaps.mjs <vault-dir> [--json]');
  process.exit(2);
}

function* jsFiles(root) {
  for (const name of readdirSync(root)) {
    if (name.startsWith('.') || name === 'node_modules') continue;
    const full = join(root, name);
    const st = statSync(full);
    if (st.isDirectory()) yield* jsFiles(full);
    else if (extname(name) === '.js') yield full;
  }
}

const partsDir = existsSync(join(dir, 'parts')) ? join(dir, 'parts') : dir;
const scripts = {};
const names = {};
for (const file of jsFiles(partsDir)) {
  const text = readFileSync(file, 'utf8');
  const id = basename(file, '.js');
  scripts[id] = text;
  const named = /^\/\/ @name (.+)$/m.exec(text);
  names[id] = named ? named[1].trim() : id;
}
const rows = collectFeatureGaps(scripts, names);
if (json) {
  console.log(JSON.stringify({ parts: Object.keys(scripts).length, gaps: rows }, null, 2));
} else {
  console.log(`${Object.keys(scripts).length} part file(s), ${rows.length} distinct gap(s)`);
  for (const row of rows) {
    console.log(`\n${row.count}× ${row.gap}`);
    for (const why of row.whys) console.log(`    why: ${why}`);
    console.log(`    parts: ${row.parts.join(', ')}`);
  }
}

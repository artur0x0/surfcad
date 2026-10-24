#!/usr/bin/env node
/**
 * Runs before `npm pack` / publish. In the monorepo, fails when data/commands.json
 * is stale relative to src/agent/commands.json. Standalone installs skip the source check.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const COPIES = [
  ['data/commands.json', '../../src/agent/commands.json'],
  ['data/helpers.json', '../../src/lib/surfcad/catalog/helpers.json'],
];

function sha(path) {
  return createHash('sha256').update(readFileSync(path, 'utf8')).digest('hex');
}

for (const [copyRel, sourceRel] of COPIES) {
  const copy = join(PKG_ROOT, copyRel);
  const source = join(PKG_ROOT, sourceRel);
  if (!existsSync(copy)) {
    console.error(`prepack: missing ${copyRel} — run npm run export:agent from the repo root`);
    process.exit(1);
  }
  try {
    JSON.parse(readFileSync(copy, 'utf8'));
  } catch (err) {
    console.error(`prepack: ${copyRel} is not valid JSON: ${err.message}`);
    process.exit(1);
  }
  if (existsSync(source) && sha(source) !== sha(copy)) {
    console.error(`prepack: stale ${copyRel} — run npm run export:agent from the repo root`);
    process.exit(1);
  }
}

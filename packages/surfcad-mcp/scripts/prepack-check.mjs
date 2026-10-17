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
const COPY = join(PKG_ROOT, 'data/commands.json');
const SOURCE = join(PKG_ROOT, '../../src/agent/commands.json');

function sha(path) {
  return createHash('sha256').update(readFileSync(path, 'utf8')).digest('hex');
}

if (!existsSync(COPY)) {
  console.error('prepack: missing data/commands.json — run npm run export:agent from the repo root');
  process.exit(1);
}

try {
  JSON.parse(readFileSync(COPY, 'utf8'));
} catch (err) {
  console.error(`prepack: data/commands.json is not valid JSON: ${err.message}`);
  process.exit(1);
}

if (existsSync(SOURCE)) {
  if (sha(SOURCE) !== sha(COPY)) {
    console.error('prepack: stale data/commands.json — run npm run export:agent from the repo root');
    process.exit(1);
  }
}

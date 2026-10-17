import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** @returns {string} Semver from packages/surfcad-mcp/package.json */
export function loadPackageVersion() {
  const raw = readFileSync(join(PKG_ROOT, 'package.json'), 'utf8');
  const doc = JSON.parse(raw);
  const version = doc?.version;
  if (typeof version !== 'string' || !version.trim()) {
    throw new Error('package.json is missing a version field');
  }
  return version.trim();
}

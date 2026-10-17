import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(mjs|js)$/.test(name)) out.push(full);
  }
  return out;
}

test('published sources do not import outside packages/surfcad-mcp', () => {
  const roots = ['bin', 'src'].map((rel) => join(PKG_ROOT, rel));
  const importRe = /(?:from|import)\s+['"]([^'"]+)['"]/g;
  const offenders = [];

  for (const root of roots) {
    for (const file of walk(root)) {
      const text = readFileSync(file, 'utf8');
      let m;
      while ((m = importRe.exec(text))) {
        const spec = m[1];
        if (!spec.startsWith('.') && !spec.startsWith('node:')) {
          continue;
        }
        if (spec.startsWith('node:')) continue;
        const resolved = join(dirname(file), spec);
        const relToPkg = relative(PKG_ROOT, resolved);
        if (relToPkg.startsWith('..') || relToPkg.includes(`/node_modules/`)) {
          offenders.push(`${relative(PKG_ROOT, file)} → ${spec}`);
        }
      }
    }
  }

  assert.deepEqual(offenders, [], offenders.join('\n'));
});

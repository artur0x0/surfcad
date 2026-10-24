/**
 * Copy src/agent/commands.json and src/lib/surfcad/catalog/helpers.json into
 * packages/surfcad-mcp for the MCP server bundle (the bridge tools, and the
 * helper registry behind `guide dialect` / `list_helpers`).
 * Invoked from `npm run export:agent`.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const destDir = join(root, 'packages/surfcad-mcp/data');
mkdirSync(destDir, { recursive: true });

const COPIES = [
  ['src/agent/commands.json', 'commands.json'],
  ['src/lib/surfcad/catalog/helpers.json', 'helpers.json'],
];

for (const [from, name] of COPIES) {
  const text = readFileSync(join(root, from), 'utf8');
  const dest = join(destDir, name);
  let existing = '';
  try {
    existing = readFileSync(dest, 'utf8');
  } catch {
    /* first run */
  }
  if (createHash('sha256').update(text).digest('hex')
    !== createHash('sha256').update(existing).digest('hex')) {
    writeFileSync(dest, text, 'utf8');
    console.log(`Wrote packages/surfcad-mcp/data/${name}`);
  }
}

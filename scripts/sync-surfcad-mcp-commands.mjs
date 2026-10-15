/**
 * Copy src/agent/commands.json into packages/surfcad-mcp for the MCP server bundle.
 * Invoked from `npm run export:agent`.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'src/agent/commands.json');
const destDir = join(root, 'packages/surfcad-mcp/data');
const dest = join(destDir, 'commands.json');

const text = readFileSync(source, 'utf8');
mkdirSync(destDir, { recursive: true });

let existing = '';
try {
  existing = readFileSync(dest, 'utf8');
} catch {
  /* first run */
}

if (createHash('sha256').update(text).digest('hex')
  !== createHash('sha256').update(existing).digest('hex')) {
  writeFileSync(dest, text, 'utf8');
  console.log('Wrote packages/surfcad-mcp/data/commands.json');
}

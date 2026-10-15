import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const SOURCE = join(ROOT, 'src/agent/commands.json');
const COPY = join(ROOT, 'packages/surfcad-mcp/data/commands.json');

test('packages/surfcad-mcp/data/commands.json matches src/agent/commands.json', () => {
  const a = readFileSync(SOURCE, 'utf8');
  const b = readFileSync(COPY, 'utf8');
  assert.equal(
    createHash('sha256').update(a).digest('hex'),
    createHash('sha256').update(b).digest('hex'),
    'stale copy — run npm run export:agent',
  );
});

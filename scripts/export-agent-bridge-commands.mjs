/**
 * Emit src/agent/commands.json from the V1_COMMANDS registry.
 *
 *   node scripts/export-agent-bridge-commands.mjs
 *
 * Also invoked from scripts/export-agent-catalog.mjs (`npm run export:agent`).
 */
import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildCommandsDocument,
  COMMANDS_JSON_PATH,
  serializeCommandsDocument,
} from '../src/agent/export/buildCommandsJson.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outPath = join(root, COMMANDS_JSON_PATH);

const { document, schemaErrors } = buildCommandsDocument();
if (schemaErrors.length) {
  console.error('commands.json export refused — fix arg schemas first:\n');
  for (const line of schemaErrors) console.error(`  - ${line}`);
  process.exit(1);
}

writeFileSync(outPath, serializeCommandsDocument(document), 'utf8');
console.log(`Wrote ${COMMANDS_JSON_PATH} (${document.count} commands)`);

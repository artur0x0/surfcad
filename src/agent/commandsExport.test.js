import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { V1_COMMANDS, v1Registry } from './commands/index.js';
import {
  buildCommandsDocument,
  COMMANDS_JSON_PATH,
  serializeCommandsDocument,
} from './export/buildCommandsJson.js';
import { validateArgsSchema } from './export/schemaPolicy.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const COMMITTED = join(ROOT, COMMANDS_JSON_PATH);

test('commands.json matches export and every command has a strict schema', () => {
  const { document, schemaErrors } = buildCommandsDocument();
  assert.equal(schemaErrors.length, 0, schemaErrors.join('\n'));
  // defineCommands does not copy `catalog`; export skips catalog:false from V1_COMMANDS.
  const catalogNames = V1_COMMANDS
    .filter((command) => command.catalog !== false)
    .map((command) => command.name);
  assert.equal(document.count, catalogNames.length);
  assert.deepEqual(document.commands.map((row) => row.name), catalogNames);
  assert.equal(v1Registry.names.includes('agent_prompt'), true);
  assert.equal(catalogNames.includes('agent_prompt'), true);
  assert.equal(document.commands.some((row) => row.name === 'agent_prompt'), true);

  for (const row of document.commands) {
    assert.equal(typeof row.description, 'string');
    assert.ok(row.description.length > 8, `${row.name} description`);
    assert.equal(row.args.type, 'object');
    assert.equal(row.args.additionalProperties, false);
    assert.ok(Array.isArray(row.errors) && row.errors.length > 0, `${row.name} errors`);
    assert.equal(typeof row.mutates, 'boolean');
    assert.equal(typeof row.destructive, 'boolean');
    assert.equal(typeof row.confirm, 'boolean');
    const policy = validateArgsSchema(row.name, row.args);
    assert.equal(policy.ok, true, `${row.name}: ${policy.reasons?.join('; ')}`);
  }

  const fresh = serializeCommandsDocument(document);
  const onDisk = readFileSync(COMMITTED, 'utf8');
  assert.equal(
    createHash('sha256').update(fresh).digest('hex'),
    createHash('sha256').update(onDisk).digest('hex'),
    `${COMMANDS_JSON_PATH} is stale — run npm run export:agent`,
  );
});

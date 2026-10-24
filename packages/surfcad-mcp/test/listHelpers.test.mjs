/**
 * The helper registry inside the package (MVP-2 step 9): data/helpers.json
 * mirrors the repo catalog, `guide dialect` and `list_helpers` are rendered
 * from it, and every insert_* description quotes the code it writes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import {
  callListHelpersTool,
  HELPER_GROUP_NAMES,
  HELPER_GROUPS,
  helperGroup,
  listHelpersToolDefinition,
  loadHelpersCatalog,
  renderDialectTopic,
  shortDescription,
} from '../src/helpers.mjs';
import { GUIDE_TOPIC_NAMES, GUIDE_TOPICS } from '../src/prompt/guide.mjs';
import { loadCommandsCatalog } from '../src/catalog.mjs';
import { RESERVED_HELPER_NAMES } from '../../../src/agent/state/reservedHelpers.js';

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = join(PKG_ROOT, '../..');
const SERVER_BIN = join(PKG_ROOT, 'bin/surfcad-mcp.js');

test('packages/surfcad-mcp/data/helpers.json matches src/lib/surfcad/catalog/helpers.json', () => {
  const a = readFileSync(join(ROOT, 'src/lib/surfcad/catalog/helpers.json'), 'utf8');
  const b = readFileSync(join(PKG_ROOT, 'data/helpers.json'), 'utf8');
  assert.equal(
    createHash('sha256').update(a).digest('hex'),
    createHash('sha256').update(b).digest('hex'),
    'stale copy — run npm run export:agent',
  );
});

test('every reserved helper name is in the registry, in a group, in guide dialect and in list_helpers', () => {
  const catalog = loadHelpersCatalog();
  const names = new Set(catalog.helpers.map((h) => h.name));
  const missing = RESERVED_HELPER_NAMES.filter((n) => !names.has(n));
  assert.deepEqual(missing, [], `reserved helpers without a registry entry: ${missing.join(', ')}`);
  const ungrouped = catalog.helpers.filter((h) => helperGroup(h.name) === 'other').map((h) => h.name);
  assert.deepEqual(ungrouped, [], `helpers without a group (add them to HELPER_GROUPS): ${ungrouped.join(', ')}`);
  const stale = Object.values(HELPER_GROUPS).flat().filter((n) => !names.has(n));
  assert.deepEqual(stale, [], `HELPER_GROUPS names that left the registry: ${stale.join(', ')}`);

  const dialect = renderDialectTopic(catalog);
  for (const h of catalog.helpers) assert.ok(dialect.includes(`  ${h.signature} — `), `${h.name} in dialect`);
  const words = dialect.trim().split(/\s+/).length;
  assert.ok(words < 1500, `dialect is ${words} words`);
  assert.equal(GUIDE_TOPICS.dialect.text, dialect);
  assert.ok(GUIDE_TOPIC_NAMES.includes('dialect'));

  const all = JSON.parse(callListHelpersTool({}, catalog).content[0].text);
  assert.equal(all.total, catalog.count);
  assert.equal(all.returned, catalog.count);
  assert.deepEqual(all.helpers.map((h) => h.name), catalog.helpers.map((h) => h.name));
  assert.ok(!('doc' in all.helpers[0]), 'compact rows carry no doc');
  assert.equal(Object.values(all.groups).reduce((n, c) => n + c, 0), catalog.count);
});

test('shortDescription drops a repeated signature and keeps one sentence', () => {
  assert.equal(shortDescription({ name: 'facesNamed', description: 'facesNamed(part, pattern) → the faces whose name matches `pattern`. More.' }), 'the faces whose name matches `pattern`');
  assert.equal(shortDescription({ name: 'tube', description: 'Create a tube/pipe shape — round or rectangular. ' }), 'Create a tube/pipe shape — round or rectangular');
  assert.ok(shortDescription({ name: 'x', description: 'a'.repeat(300) }).length <= 110);
});

test('list_helpers filters by names (full rows), group, match, and page, and refuses bad args', () => {
  const catalog = loadHelpersCatalog();
  const byName = JSON.parse(callListHelpersTool({ names: ['tube', 'filletEdges', 'nope'] }, catalog).content[0].text);
  assert.deepEqual(byName.helpers.map((h) => h.name), ['tube', 'filletEdges']);
  assert.deepEqual(byName.missing, ['nope']);
  assert.ok(typeof byName.helpers[0].doc === 'string' && byName.helpers[0].doc.length > 40);
  assert.ok(Array.isArray(byName.helpers[0].examples));
  assert.equal(byName.helpers[0].group, 'blocks');
  assert.match(byName.helpers[0].signature, /^tube\(/);

  const polish = JSON.parse(callListHelpersTool({ group: 'polish' }, catalog).content[0].text);
  assert.ok(polish.helpers.every((h) => h.group === 'polish'));
  assert.ok(polish.helpers.some((h) => h.name === 'filletEdges'));
  assert.equal(polish.group, 'polish');

  const holes = JSON.parse(callListHelpersTool({ match: 'HOLE', page: { offset: 1, limit: 3 } }, catalog).content[0].text);
  assert.ok(holes.total >= 6);
  assert.equal(holes.returned, 3);
  assert.equal(holes.offset, 1);
  assert.equal(holes.limit, 3);
  assert.ok(holes.helpers.every((h) => /hole/i.test(`${h.name} ${h.description}`)));

  for (const args of [{ names: 'tube' }, { group: 'nope' }, { match: 3 }, { page: { limit: 0 } }, { page: { offset: -1 } }]) {
    const out = callListHelpersTool(args, catalog);
    assert.equal(out.isError, true, JSON.stringify(args));
    assert.equal(JSON.parse(out.content[0].text).code, 'bad_args');
  }
  const def = listHelpersToolDefinition();
  assert.equal(def.name, 'list_helpers');
  assert.deepEqual(def.inputSchema.properties.group.enum, [...HELPER_GROUP_NAMES]);
});

test('every insert_* description quotes the code it writes with default arguments', () => {
  const catalog = loadCommandsCatalog();
  // insert_part is a document tool, not a palette helper; every other insert_* is one.
  const inserts = catalog.commands.filter((row) => row.name.startsWith('insert_') && row.name !== 'insert_part');
  assert.ok(inserts.length >= 30);
  for (const row of inserts) assert.match(row.description, / Writes \(defaults\): /, row.name);
  const tube = inserts.find((row) => row.name === 'insert_tube');
  assert.match(tube.description, /Writes \(defaults\): let tube1 = tube\(15, 10, 40, 64\); part = part\.add\(tube1\);/);
  const fillet = inserts.find((row) => row.name === 'insert_fillet_edges');
  assert.match(fillet.description, /filletEdges\(part, convexEdges\(part\), 3/);
  const hole = inserts.find((row) => row.name === 'insert_tap_drill_hole');
  assert.match(hole.description, /workplaneFromFace\(part, topFace\); part = tapDrillHole\(part, fr, 0, 0, 'M3'\);/);
  // Items whose default build needs a pick fall back to the helper signature.
  const sweep = inserts.find((row) => row.name === 'insert_sweep_path');
  assert.match(sweep.description, /Writes \(defaults\): makeSweepPath\(edges\)/);
  const snippet = inserts.find((row) => row.name === 'insert_code_snippet');
  assert.match(snippet.description, /Writes \(defaults\): Script snippet/);
  const setScript = catalog.commands.find((row) => row.name === 'set_script');
  assert.match(setScript.description, /list_helpers/);
});

test('over stdio: list_helpers is listed and answers before pairing; guide dialect is the registry text', async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER_BIN],
    env: { ...process.env, SURFCAD_MCP_START_RELAY: '0', SURFCAD_PAIRING_CODE: '' },
  });
  const client = new Client({ name: 'surfcad-mcp-helpers-test', version: '1.0.0' });
  await client.connect(transport);
  try {
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === 'list_helpers');
    assert.ok(tool, 'list_helpers listed');
    assert.match(tool.description, /guide \{ topic: "dialect" \}/);
    const out = await client.callTool({ name: 'list_helpers', arguments: { names: ['hexPrism'] } });
    assert.equal(out.isError, false);
    const body = JSON.parse(out.content[0].text);
    assert.equal(body.helpers[0].name, 'hexPrism');
    assert.match(body.helpers[0].signature, /^hexPrism\(radius, height\)/);
    const dialect = await client.callTool({ name: 'guide', arguments: { topic: 'dialect' } });
    assert.equal(dialect.isError, false);
    assert.equal(dialect.content[0].text, renderDialectTopic());
    const resources = await client.listResources();
    assert.ok(resources.resources.some((r) => r.uri === 'surfcad://guide/dialect'));
  } finally {
    await client.close().catch(() => {});
  }
});

/**
 * Every example call the catalog and docs/agent/SKILL.md show must pass the
 * tool's own arg schema. Strict MCP clients (Claude Code among them) check
 * calls against the published schema before sending them, so an example
 * that fails here is one an agent cannot make.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { v1Registry } from './commands/index.js';
import { schemaErrors, shorthandJson, shorthandKeys } from './export/schemaCheck.js';

const catalog = v1Registry.catalog();
const byName = new Map(catalog.map((row) => [row.name, row]));

test('every catalog example validates against its own arg schema', () => {
  const failures = [];
  for (const row of catalog) {
    const errors = schemaErrors(row.schema, row.example);
    if (errors.length) failures.push(`${row.name}: ${errors.join('; ')}`);
  }
  assert.deepEqual(failures, []);
});

test('the documented edit_feature and insert_move calls validate', () => {
  assert.deepEqual(schemaErrors(byName.get('edit_feature').schema, { params: { height: 12 } }), []);
  assert.deepEqual(schemaErrors(byName.get('edit_feature').schema, { params: { at: [1, 2, 3] } }), []);
  assert.deepEqual(schemaErrors(byName.get('insert_move').schema, { dx: 5, dy: 0, dz: 0, use_selection: true }), []);
  assert.deepEqual(schemaErrors(byName.get('insert_move').schema, { dx: 5, dy: 0, dz: 0, body_index: 0 }), []);
  assert.deepEqual(schemaErrors(byName.get('sketch_add').schema, { tool: 'circle', radius: 4, params: { segments: 24 } }), []);
});

/**
 * `` `tool` `{ … }` `` pairs in the skill doc. A bold tool name
 * (`**`tool`**`) counts too.
 */
function skillDocCalls() {
  const text = readFileSync(new URL('../../docs/agent/SKILL.md', import.meta.url), 'utf8');
  const calls = [];
  const re = /`([a-z][a-z0-9_]*)`\*{0,2}\s*`\{([^`]*)\}`/g;
  for (const match of text.matchAll(re)) {
    calls.push({ name: match[1], inner: match[2], line: text.slice(0, match.index).split('\n').length });
  }
  return calls;
}

test('every call shape in docs/agent/SKILL.md names only keys its tool schema lists', () => {
  const calls = skillDocCalls().filter((call) => byName.has(call.name));
  assert.ok(calls.length >= 20, `expected the skill doc to show tool calls, found ${calls.length}`);
  const failures = [];
  for (const call of calls) {
    const { schema } = byName.get(call.name);
    const props = schema.properties || {};
    for (const key of shorthandKeys(call.inner)) {
      if (!(key in props) && schema.additionalProperties === false) {
        failures.push(`SKILL.md:${call.line} ${call.name} { ${key} } is not in the schema`);
      }
    }
    const concrete = shorthandJson(call.inner);
    if (concrete) {
      const errors = schemaErrors(schema, concrete);
      if (errors.length) failures.push(`SKILL.md:${call.line} ${call.name}: ${errors.join('; ')}`);
    }
  }
  assert.deepEqual(failures, []);
});

test('invalid calls still fail: unknown tool, missing required id, wrong types', () => {
  assert.equal(byName.has('no_such_tool'), false);
  assert.equal(v1Registry.get('no_such_tool'), null);
  const setActive = byName.get('set_active_part').schema;
  assert.match(schemaErrors(setActive, {})[0], /part_id is required/);
  assert.match(schemaErrors(setActive, { part_id: 42 })[0], /part_id must be string/);
  const move = byName.get('insert_move').schema;
  assert.match(schemaErrors(move, { dx: '5' })[0], /dx must be number/);
  assert.match(schemaErrors(move, { dx: 5, use_selection: 'yes' })[0], /use_selection must be boolean/);
  assert.match(schemaErrors(move, { dx: 5, bogus: 1 })[0], /bogus is not allowed/);
  const edit = byName.get('edit_feature').schema;
  assert.match(schemaErrors(edit, { params: 12 })[0], /params must be object/);
  assert.match(schemaErrors(edit, { id: 'cube1' })[0], /id is not allowed/);
});

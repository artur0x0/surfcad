import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMMAND_GROUPS, COMMAND_GROUP_NAMES, groupForCommand } from './commandGroups.js';
import { v1Registry } from '../commands/index.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const HOST_JSON = join(ROOT, 'src/agent/commands.json');

test('every registered command lands in a named group', () => {
  const missing = v1Registry.names.filter((name) => !COMMAND_GROUP_NAMES.includes(groupForCommand(name)));
  assert.deepEqual(missing, [], 'add the command to OVERRIDES or PREFIXES in commandGroups.js');
  for (const name of COMMAND_GROUP_NAMES) assert.equal(typeof COMMAND_GROUPS[name], 'string');
  assert.equal(groupForCommand('not_a_command'), null);
  assert.equal(groupForCommand(null), null);
});

test('placements agents rely on', () => {
  const expected = {
    get_script: 'core', set_script: 'core', status: 'core', undo: 'core', list_commands: 'core', invoke_helper: 'insert',
    insert_cube: 'insert', insert_hole: 'insert', insert_part: 'document', create_part: 'document', parts: 'document',
    part_set_transform: 'document', list_faces: 'pick', pick_next: 'pick', select_faces: 'pick', sketch_add: 'sketch',
    slot_commit: 'sketch', hole_commit: 'sketch', joint_pick: 'joint', paint_faces: 'paint', measure_pick: 'measure',
    fea_run: 'fea', sheet_commit: 'sheet', git_save: 'git', export_part: 'export', screenshot: 'view', camera_set: 'view',
    cross_section_toggle: 'view', set_part_visible: 'view', agent_prompt: 'agent', confirm_feature: 'feature', rollback_to: 'feature',
  };
  for (const [name, group] of Object.entries(expected)) assert.equal(groupForCommand(name), group, name);
});

test('commands.json rows carry the same group and every group is non-empty', () => {
  const host = JSON.parse(readFileSync(HOST_JSON, 'utf8'));
  const counts = {};
  for (const row of host.commands) {
    assert.equal(row.group, groupForCommand(row.name), row.name);
    counts[row.group] = (counts[row.group] || 0) + 1;
  }
  for (const name of COMMAND_GROUP_NAMES) assert.ok(counts[name] > 0, `${name} is empty`);
  assert.ok(counts.insert >= 30);
});

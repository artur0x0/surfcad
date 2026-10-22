import { COMMAND_GROUPS, COMMAND_GROUP_NAMES, groupForCommand } from '../export/commandGroups.js';

const GROUP_LIST = COMMAND_GROUP_NAMES.map((name) => `${name} (${COMMAND_GROUPS[name]})`).join('; ');

/**
 * Name, schema, example, and group for every registered command, in public
 * order. `names` or `group` returns only those rows; `group: "all"` or no
 * args is the whole catalog (about 130 KB compact). Resolves immediately.
 * It does not read the editor or the undo stack.
 */
export const listCommandsCommand = Object.freeze({
  name: 'list_commands',
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      names: {
        type: 'array',
        items: { type: 'string' },
        description: 'Only these commands, in catalog order. Names that are not commands come back in missing.',
      },
      group: {
        type: 'string',
        enum: [...COMMAND_GROUP_NAMES, 'all'],
        description: `Only the commands in this group: ${GROUP_LIST}. "all" is the whole catalog.`,
      },
    },
  },
  example: {},
  immediate: true,
  checkArgs(args) {
    if (args?.names != null && (!Array.isArray(args.names) || !args.names.every((n) => typeof n === 'string'))) {
      return { code: 'bad_args', message: 'list_commands names must be an array of command names' };
    }
    if (args?.group != null && (typeof args.group !== 'string' || (args.group !== 'all' && !COMMAND_GROUP_NAMES.includes(args.group)))) {
      return { code: 'bad_args', message: `list_commands group must be one of ${COMMAND_GROUP_NAMES.join(', ')}, or all` };
    }
    return null;
  },
  run(ctx, args) {
    const all = ctx.listCommands().map((row) => ({ ...row, group: groupForCommand(row.name) }));
    const groups = {};
    for (const row of all) groups[row.group] = (groups[row.group] || 0) + 1;
    const wanted = Array.isArray(args?.names) ? new Set(args.names) : null;
    const group = typeof args?.group === 'string' && args.group !== 'all' ? args.group : null;
    let commands = all;
    if (wanted) commands = commands.filter((row) => wanted.has(row.name));
    if (group) commands = commands.filter((row) => row.group === group);
    const result = { commands, total: all.length, groups };
    if (wanted) {
      const found = new Set(commands.map((row) => row.name));
      const missing = [...wanted].filter((name) => !found.has(name));
      if (missing.length) result.missing = missing;
    }
    if (group) result.group = group;
    return { result };
  },
});

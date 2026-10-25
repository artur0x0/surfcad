/**
 * MCP-only tools (pair, guide, list_helpers, the prompt tools) are not
 * bridge commands, so the tab's list_commands omits them. Fold the server's
 * registered tool list into that result so an agent that asks list_commands
 * sees every tool this process actually registers.
 */

/** Group on the tab's list_commands rows. Prompt and other MCP-only tools sit with the in-viewer prompt. */
export const MCP_ONLY_GROUP = 'agent';

/**
 * @param {{ name: string, description?: string, inputSchema?: object }} tool
 */
export function mcpOnlyCommandRow(tool) {
  const schema = tool.inputSchema && typeof tool.inputSchema === 'object'
    ? tool.inputSchema
    : { type: 'object', additionalProperties: false, properties: {} };
  return {
    name: tool.name,
    description: typeof tool.description === 'string' ? tool.description : '',
    schema,
    example: {},
    group: MCP_ONLY_GROUP,
  };
}

/**
 * @param {object} pageResult The tab's list_commands result.
 * @param {{ registered: Array<{ name: string, description?: string, inputSchema?: object }>, bridgeNames: Set<string>, args?: { names?: unknown, group?: unknown } }} opts
 */
export function mergeRegisteredIntoListCommands(pageResult, opts) {
  if (!pageResult || typeof pageResult !== 'object' || Array.isArray(pageResult) || !Array.isArray(pageResult.commands)) {
    return pageResult;
  }
  const bridgeNames = opts.bridgeNames instanceof Set ? opts.bridgeNames : new Set();
  const extras = (opts.registered || [])
    .filter((tool) => tool && typeof tool.name === 'string' && !bridgeNames.has(tool.name))
    .map(mcpOnlyCommandRow);
  const args = opts.args && typeof opts.args === 'object' ? opts.args : {};
  const wanted = Array.isArray(args.names) ? new Set(args.names.filter((name) => typeof name === 'string')) : null;
  const group = typeof args.group === 'string' && args.group !== 'all' ? args.group : null;
  let add = extras;
  if (wanted) add = add.filter((row) => wanted.has(row.name));
  if (group) add = add.filter((row) => row.group === group);

  const commands = pageResult.commands.slice();
  const have = new Set(commands.map((row) => row?.name));
  for (const row of add) {
    if (!have.has(row.name)) commands.push(row);
  }
  const groups = { ...(pageResult.groups && typeof pageResult.groups === 'object' ? pageResult.groups : {}) };
  for (const row of extras) groups[row.group] = (groups[row.group] || 0) + 1;
  const total = (typeof pageResult.total === 'number' ? pageResult.total : pageResult.commands.length) + extras.length;
  const result = { ...pageResult, commands, total, groups };
  if (Array.isArray(pageResult.missing)) {
    const found = new Set(add.map((row) => row.name));
    const missing = pageResult.missing.filter((name) => !found.has(name));
    if (missing.length) result.missing = missing;
    else delete result.missing;
  }
  return result;
}

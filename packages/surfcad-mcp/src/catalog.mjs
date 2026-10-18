import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const COMMANDS_JSON_REL = 'data/commands.json';

/**
 * @returns {{ version: number, count: number, commands: Array<{ name: string, description: string, args: object }> }}
 */
export function loadCommandsCatalog(catalogPath = join(PKG_ROOT, COMMANDS_JSON_REL)) {
  const raw = readFileSync(catalogPath, 'utf8');
  const doc = JSON.parse(raw);
  if (!doc || typeof doc !== 'object' || !Array.isArray(doc.commands)) {
    throw new Error('Invalid commands catalog');
  }
  return doc;
}

export function bridgeToolDefinitions(doc) {
  return doc.commands.map((row) => ({
    name: row.name,
    description: row.description,
    inputSchema: row.args,
  }));
}

/** JSON body for GET /tools. Same rows as the MCP bridge tools and commands.json. */
export function toolsCatalogPayload(doc) {
  const tools = bridgeToolDefinitions(doc);
  return {
    version: doc.version,
    count: tools.length,
    tools,
  };
}

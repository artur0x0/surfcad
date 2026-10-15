/**
 * Agent UI action coverage helpers (node-only, no browser).
 */

import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HELPER_PALETTE_ITEMS } from '../utils/helperPaletteSnippets.js';
import { COVERAGE_ALLOWLIST } from './coverageAllowlist.js';
import { AGENT_EXEMPT } from './exempt.js';
import { v1Registry } from './commands/index.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const COMPONENTS = join(ROOT, 'src/components');

/** Contour-rail and sheet-rail tools use dynamic `data-ui-action` values. */
export const EXTRA_ACTION_IDS = Object.freeze([
  'cursor',
  'circle',
  'rectangle',
  'polygon',
  'polyline',
  'arc',
  'dimension',
  'constraints',
  'sheet-tool-tab',
  'sheet-tool-bend',
  'sheet-tool-hole',
  'sheet-tool-countersink',
  'sheet-tool-tapped',
  'data-view-snap-front',
  'data-view-snap-right',
  'data-view-snap-top',
  'data-view-snap-iso',
  'data-view-snap-toggle',
  'data-fillet-mode-chip',
  'data-chamfer-mode-chip',
]);

const UI_ACTION_ATTR_RE = /data-ui-action=(?:"([^"]+)"|'([^']+)'|\{\s*['"]([^'"]+)['"]\s*\})/g;
const UI_ACTION_OBJECT_RE = /['"]data-ui-action['"]\s*:\s*['"]([^'"]+)['"]/g;

export function helperPaletteIds() {
  return HELPER_PALETTE_ITEMS.map((item) => item.id);
}

/** Registry `uiEntry` values and permanent commerce exempt ids. */
export function coveredActionIds() {
  const ids = new Set(AGENT_EXEMPT.map((row) => row.id));
  for (const name of v1Registry.names) {
    const command = v1Registry.get(name);
    const entries = Array.isArray(command?.uiEntry) ? command.uiEntry : [command?.uiEntry];
    for (const entry of entries) if (entry) ids.add(entry);
  }
  return ids;
}

export function scanUiActionLiterals(source) {
  const found = new Set();
  for (const re of [UI_ACTION_ATTR_RE, UI_ACTION_OBJECT_RE]) {
    re.lastIndex = 0;
    let match = re.exec(source);
    while (match) {
      const id = match[1] || match[2] || match[3];
      if (id) found.add(id);
      match = re.exec(source);
    }
  }
  return found;
}

async function walkJsx(dir, out) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return out;
    throw error;
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await walkJsx(full, out);
    else if (entry.name.endsWith('.jsx')) out.push(full);
  }
  return out;
}

export async function collectUiActionLiteralsFromComponents() {
  const files = await walkJsx(COMPONENTS, []);
  const literals = new Set();
  for (const file of files) {
    const text = await readFile(file, 'utf8');
    for (const id of scanUiActionLiterals(text)) literals.add(id);
  }
  return literals;
}

export function referencedActionIds({ helperIds, literals, extraIds = EXTRA_ACTION_IDS }) {
  const ids = new Set();
  for (const id of helperIds) ids.add(id);
  for (const id of literals) ids.add(id);
  for (const id of extraIds) ids.add(id);
  return ids;
}

export function allowlistIds() {
  return COVERAGE_ALLOWLIST.map((row) => row.id);
}

/**
 * @returns {{ ok: true } | { ok: false, errors: string[] }}
 */
export function validateAgentCoverage({
  helperIds,
  literals,
  covered,
  allowlisted,
  referenced,
}) {
  const errors = [];
  const allowSet = new Set(allowlisted);

  for (const id of helperIds) {
    if (!covered.has(id) && !allowSet.has(id)) {
      errors.push(`HELPER_PALETTE_ITEMS id "${id}" has no registry uiEntry and is not allowlisted`);
    }
  }

  for (const id of literals) {
    if (!covered.has(id) && !allowSet.has(id)) {
      errors.push(`data-ui-action "${id}" in src/components has no registry uiEntry and is not allowlisted`);
    }
  }

  for (const id of referenced) {
    if (!covered.has(id) && !allowSet.has(id)) {
      errors.push(`referenced UI action "${id}" is neither covered nor allowlisted`);
    }
  }

  for (const id of allowlisted) {
    if (covered.has(id)) {
      errors.push(`allowlist id "${id}" is now covered by a registry command — remove it from coverageAllowlist.js`);
    }
    if (!referenced.has(id)) {
      errors.push(`allowlist id "${id}" is not referenced by helpers, literals, or EXTRA_ACTION_IDS`);
    }
  }

  for (const name of v1Registry.names) {
    const command = v1Registry.get(name);
    if (!command.schema || command.schema.type !== 'object') {
      errors.push(`registry command ${name} missing object schema`);
    }
    if (command.example == null || typeof command.example !== 'object' || Array.isArray(command.example)) {
      errors.push(`registry command ${name} missing example object`);
    }
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true };
}

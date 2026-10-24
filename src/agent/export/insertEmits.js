/**
 * The code line each insert_* writes with its default arguments, for the
 * tool descriptions and `guide dialect`: an agent reads what the helper
 * call looks like instead of inserting a scratch feature to find out.
 *
 * Rendered from the palette item's own build() (the same code path the
 * insert takes), on a part that already has a body, with
 * `defaultParamsFor(item)`. Items whose build needs a pick or points
 * (sweep path, rotate, pattern on points) return null there and fall back
 * to the item's title, which carries the helper signature.
 */
import { defaultParamsFor, HELPER_PALETTE_ITEMS } from '../../utils/helperPaletteSnippets.js';
import { helperCommandName } from '../helperPaletteAgent.js';

const MARKER_RE = /^\/\/ --- .* (begin|end)( id=[\w-]+)? ---$/;
/** Boilerplate the default workplane adds; the helper call is the line that matters. */
const GUARD_RE = /^if \(.*\) throw new Error\(/;
const MAX_LINE = 320;
const HEAD_LINE = 110;

/**
 * The statements between the block markers, one per entry.
 * @param {string} source
 */
function statementsOf(source) {
  return String(source || '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !MARKER_RE.test(line) && line !== 'return part;' && !GUARD_RE.test(line))
    // A trailing line comment would swallow the next statement on one line.
    .map((line) => line.replace(/\s*\/\/\s*(.*)$/, (m, note) => (note ? ` /* ${note.trim()} */` : '')));
}

/**
 * One line: every statement when short; otherwise the first (cut) and the
 * last in full, which is the helper call that sets part.
 * @param {string[]} statements
 */
function oneLine(statements) {
  const all = statements.join(' ');
  if (all.length <= MAX_LINE) return all;
  const head = statements[0].length > HEAD_LINE ? `${statements[0].slice(0, HEAD_LINE - 1).trimEnd()}…` : statements[0];
  const tail = statements[statements.length - 1];
  const line = `${head} … ${tail}`;
  return line.length > MAX_LINE ? `${line.slice(0, MAX_LINE - 1).trimEnd()}…` : line;
}

/**
 * @param {{ id: string, title?: string, build?: Function }} item
 * @returns {string} the emitted statements with defaults, or the item title
 */
export function emittedCodeFor(item) {
  // The snippet block is the agent's own script; its default body says nothing.
  if (item.id === 'codeSnippet') return item.title ? String(item.title) : '';
  let statements = [];
  try {
    const out = item.build(false, defaultParamsFor(item), new Set(['part']));
    statements = statementsOf(Array.isArray(out) ? out.join('\n') : out);
  } catch {
    statements = [];
  }
  if (!statements.length || (statements.length === 1 && statements[0] === 'null')) {
    return item.title ? String(item.title) : '';
  }
  return oneLine(statements);
}

/** insert_* command name → emitted code line. */
export const INSERT_EMITS = Object.freeze(Object.fromEntries(
  HELPER_PALETTE_ITEMS.map((item) => [helperCommandName(item.id), emittedCodeFor(item)]),
));

/**
 * The description tail for an insert_* tool: what the block it writes
 * looks like with default arguments (helpers listed by list_helpers).
 * @param {string} name insert_* command name
 */
export function emitNote(name) {
  const line = INSERT_EMITS[name];
  return line ? ` Writes (defaults): ${line}` : '';
}

/**
 * A tool the paired tab advertises but this package's catalog does not.
 *
 * `data/commands.json` ships with the npm release, so a tool the app added
 * after that release (`insert_boss` at 0.3.4) is "Unknown tool" from an
 * older `surfcad-mcp` even though the tab's `list_commands` lists it. When a
 * paired session gets a name the catalog lacks, ask the tab once whether it
 * has that command; forward the call when it does. Answers are cached per
 * process. Not paired, or a tab that does not know the name either, stays
 * `unknown_tool`.
 */

/**
 * @param {{ call: (name: string, args: object) => Promise<unknown> }} session
 * @param {string} name
 * @param {Map<string, boolean>} cache
 * @returns {Promise<boolean>}
 */
export async function tabAdvertisesTool(session, name, cache) {
  if (typeof name !== 'string' || !name) return false;
  if (cache.has(name)) return cache.get(name) === true;
  let known = false;
  try {
    const listed = await session.call('list_commands', { names: [name] });
    const rows = listed && typeof listed === 'object' && Array.isArray(listed.commands) ? listed.commands : [];
    known = rows.some((row) => row && row.name === name);
  } catch {
    known = false;
  }
  cache.set(name, known);
  return known;
}

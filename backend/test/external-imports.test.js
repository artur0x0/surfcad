/**
 * What backend/ imports from outside backend/.
 *
 * The prod backend is deployed by `deploy.sh be-deploy` (kept in the prod
 * build folder, not in this repo). It uploads backend/ plus a short list of
 * files outside it, BE_SHARED. Before anything is uploaded it walks every
 * .js and .mjs file under backend/, tests included, follows each relative
 * import that leaves backend/ (and the imports of those files in turn), and
 * refuses to deploy when one is not on the list.
 *
 * So a new import that leaves backend/ blocks the next backend deploy until
 * the list is edited on the deploy machine. PR 887 did that with a test in
 * backend/test that imported the MCP package's listener: four files, found
 * only when the deploy was about to run.
 *
 * This test runs the same walk and compares it with the list as it was on
 * 2026-11-06. When it fails:
 *   - a test that needs code from outside backend/ belongs in the repo's
 *     test/ folder, not in backend/test/;
 *   - backend code that really needs a new shared file: add the path here
 *     and say in the PR that BE_SHARED in deploy.sh needs the same line
 *     before the next be-deploy.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const BACKEND = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(BACKEND, '..');

/** deploy.sh BE_SHARED, 2026-11-06. */
const SHARED = [
  'packages/surfcad-mcp/src/bridge/localAddress.mjs',
  'packages/surfcad-mcp/src/commandProtocol.mjs',
  'packages/surfcad-mcp/src/prompt/promptSession.mjs',
  'packages/surfcad-mcp/src/prompt/promptStall.mjs',
  'packages/surfcad-mcp/src/prompt/webhookPost.mjs',
  'packages/surfcad-mcp/src/prompt/webhookUrl.mjs',
  'packages/surfcad-mcp/src/relayMessages.mjs',
  'src/agent/ws/pairingFlow.js',
  'src/molding/partQuote.js',
  'src/molding/toolingEstimate.js',
  'src/utils/gamePuzzles.js',
  'src/utils/git/vaultNames.js',
  'src/utils/meshMeasure.js',
  'src/utils/packageSize.js',
  'src/utils/partnerForm.js',
  'src/utils/quoteMath.js',
  'src/utils/sessionPolicy.js',
];

/** The script's own pattern: it also sees an import() inside a JSDoc type. */
const IMPORT = /(?:from|import\(|require\()\s*['"](\.\.?\/[^'"]+)['"]/g;

function sourceFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.(js|mjs)$/.test(name)) out.push(full);
  }
  return out;
}

/** @returns {Map<string, string>} repo-relative path → the file that first imports it */
function externalImports() {
  const queue = sourceFiles(BACKEND);
  const seen = new Map();
  while (queue.length) {
    const file = queue.shift();
    let text = '';
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const match of text.matchAll(IMPORT)) {
      const target = resolve(dirname(file), match[1]);
      if (target.startsWith(BACKEND + sep)) continue;
      const rel = relative(REPO, target).split(sep).join('/');
      if (seen.has(rel)) continue;
      seen.set(rel, relative(REPO, file).split(sep).join('/'));
      try {
        if (statSync(target).isFile()) queue.push(target);
      } catch {
        /* a path that does not exist is still reported */
      }
    }
  }
  return seen;
}

test('backend/ imports nothing from outside backend/ that the backend deploy does not ship', () => {
  const found = externalImports();
  const extra = [...found.keys()].filter((rel) => !SHARED.includes(rel)).sort();
  assert.deepEqual(
    extra.map((rel) => `${rel} (imported by ${found.get(rel)})`),
    [],
    'deploy.sh be-deploy would refuse: these are not on its BE_SHARED list. Move a test that needs them to the repo test/ folder, or add the path here and to BE_SHARED.',
  );
});

test('the list has no entry backend/ stopped importing', () => {
  const found = externalImports();
  assert.deepEqual(SHARED.filter((rel) => !found.has(rel)), [], 'drop these here and from BE_SHARED in deploy.sh');
});

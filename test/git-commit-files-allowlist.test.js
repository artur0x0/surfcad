/**
 * save-model v2 PR 5: production commitFiles call-site allowlist.
 * The allowlist may only shrink.
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CALL = /\.commitFiles\s*\(/g;
const FN = /(?:export\s+)?(?:async\s+)?function\s+(\w+)/g;

/**
 * Production writers that still call adapter.commitFiles.
 *
 * Routed through writeVaultCommit in this PR (byte-identical; not listed):
 *   vault.js createAndSeed — PR 7 wires Save and replaces the v1+README seed
 *   gitCommit.js commitPartToRepo, deletePartFromRepo, saveLocalOnNewBranch,
 *     commitWorkspace, forceMergeCommit — PR 9 deletes the dead APIs
 *   syncWorker.js flushSyncQueue — PR 9 deletes the outbox write path
 *   gitMoveToGit.js moveToGit — PR 7 first Save of a local assembly
 *   gitPull.js checkInMineToBranch — PR 7/9 "Save mine to a new branch"
 *
 * Remaining adapter.commitFiles call sites (allowlist may only shrink):
 */
const ALLOWED = Object.freeze([
  // Upgrade (legacyVault/upgrade path) stays until PR 10
  { file: 'src/utils/git/legacyVault/upgrade.js', fn: 'executeUpgrade', count: 2 },
  { file: 'src/utils/git/legacyVault/upgrade.js', fn: 'executeUpgradeConflictChoice', count: 1 },
  { file: 'src/utils/git/legacyVault/upgrade.js', fn: 'executeUpgradeFollowup', count: 1 },
]);

const WRAPPER = 'src/utils/git/writeVaultCommit.js';
const NOT_PRODUCTION = new Set([
  WRAPPER,
  // Test harness records inner.commitFiles; not a vault writer.
  'src/utils/git/spyGithubAdapter.js',
]);

function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === 'fea') continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(js|jsx|mjs)$/.test(name) && !/\.test\./.test(name)) out.push(full);
  }
  return out;
}

function rel(file) {
  return relative(ROOT, file).split('\\').join('/');
}

function enclosingFn(text, index) {
  FN.lastIndex = 0;
  let name = '(top-level)';
  let match;
  while ((match = FN.exec(text)) && match.index < index) {
    name = match[1];
  }
  return name;
}

export function collectCommitFilesSites(files) {
  const sites = [];
  for (const file of files) {
    const path = file.path || rel(file);
    if (NOT_PRODUCTION.has(path)) continue;
    const text = file.text != null ? file.text : readFileSync(file, 'utf8');
    CALL.lastIndex = 0;
    let match;
    while ((match = CALL.exec(text))) {
      sites.push({
        file: path,
        fn: enclosingFn(text, match.index),
      });
    }
  }
  return sites;
}

function summarize(sites) {
  const map = new Map();
  for (const site of sites) {
    const key = `${site.file}\0${site.fn}`;
    const prev = map.get(key) || { file: site.file, fn: site.fn, count: 0 };
    prev.count += 1;
    map.set(key, prev);
  }
  return [...map.values()].sort((a, b) => (
    a.file.localeCompare(b.file) || a.fn.localeCompare(b.fn)
  ));
}

function productionFiles() {
  return walk(join(ROOT, 'src'), []);
}

test('production commitFiles call sites match the shrinking allowlist', () => {
  const found = summarize(collectCommitFilesSites(productionFiles()));
  assert.deepEqual(found, [...ALLOWED]);
});

test('writeVaultCommit is the production wrapper around commitFiles', () => {
  const text = readFileSync(join(ROOT, WRAPPER), 'utf8');
  assert.match(text, /adapter\.commitFiles\s*\(/);
  assert.match(text, /export async function writeVaultCommit/);
  assert.match(text, /function vaultV2SeedFiles/);
  assert.equal(/path:\s*['"]README\.md['"]/.test(text), false);
});

test('scanner fails when a new production call site is added', () => {
  const sneak = {
    path: 'src/utils/git/sneakWrite.js',
    text: [
      'export async function sneakWrite(adapter, repo) {',
      "  return adapter.commitFiles(repo, { branch: 'main', message: 'nope', files: [] });",
      '}',
      '',
    ].join('\n'),
  };
  const found = summarize(collectCommitFilesSites([...productionFiles(), sneak]));
  const extra = found.filter((row) => row.file === sneak.path);
  assert.deepEqual(extra, [{ file: sneak.path, fn: 'sneakWrite', count: 1 }]);
  assert.equal(
    JSON.stringify(found) === JSON.stringify(ALLOWED),
    false,
    'a new call site must not match the allowlist',
  );
});

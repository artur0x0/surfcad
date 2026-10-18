/**
 * PR 2: v1 tree parse lives only in src/utils/git/legacyVault/.
 * PR 10 deletes that folder and these tests.
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LEGACY_DIR = join(ROOT, 'src/utils/git/legacyVault');
const BANNER = '// TEMPORARY: remove after Artur\'s vault is upgraded';
const DEFINED = /export (?:async )?function (parseLegacyVaultPath|detectVaultLayout|openLegacyAssembly|isLegacyVaultTree|assemblyMetaCandidates|listLegacyAssemblies|listLegacyAssemblyNames|parseLegacySurfJson)\b/;
const INTERNAL_IMPORT = /from ['"][^'"]*legacyVault\/(detect|reader)(?:\.js)?['"]/;
const WRITE_API = /\b(commitFiles|createRepo)\b/;
const V1_PARSE_HELPERS = /\b(parseLegacyVaultPath|parseLegacySurfJson|assemblyMetaCandidates)\b/;

function walk(dir, out, skip = new Set()) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === 'fea' || skip.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out, skip);
    else if (/\.(js|jsx|mjs)$/.test(name)) out.push(full);
  }
  return out;
}

function rel(file) {
  return relative(ROOT, file).split('\\').join('/');
}

function inLegacy(file) {
  return rel(file).startsWith('src/utils/git/legacyVault/');
}

test('every legacyVault file starts with the TEMPORARY banner', () => {
  const files = walk(LEGACY_DIR, []);
  assert.ok(files.length >= 3, 'legacyVault/ should contain the isolated module');
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    assert.equal(text.startsWith(BANNER), true, `${rel(file)} must start with the TEMPORARY banner`);
  }
});

test('v1 parse helpers are defined only inside legacyVault/', () => {
  const files = walk(join(ROOT, 'src'), []);
  const offenders = [];
  for (const file of files) {
    if (inLegacy(file)) continue;
    const text = readFileSync(file, 'utf8');
    if (DEFINED.test(text)) offenders.push(rel(file));
  }
  assert.deepEqual(offenders, []);
});

test('callers import only the legacyVault entry point', () => {
  const files = [
    ...walk(join(ROOT, 'src'), []),
    ...walk(join(ROOT, 'test'), []),
  ];
  const offenders = [];
  for (const file of files) {
    if (inLegacy(file)) continue;
    const text = readFileSync(file, 'utf8');
    if (INTERNAL_IMPORT.test(text)) offenders.push(rel(file));
  }
  assert.deepEqual(offenders, []);
});

test('legacyVault never calls commitFiles or createRepo', () => {
  const files = walk(LEGACY_DIR, []);
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    assert.equal(WRITE_API.test(text), false, `${rel(file)} must not write git`);
  }
});

test('v1 path parse helpers are not used outside legacyVault/', () => {
  const files = walk(join(ROOT, 'src'), []);
  const offenders = [];
  for (const file of files) {
    const path = rel(file);
    if (inLegacy(file) || /\.test\./.test(path)) continue;
    const text = readFileSync(file, 'utf8');
    if (V1_PARSE_HELPERS.test(text)) offenders.push(path);
  }
  assert.deepEqual(offenders, []);
});

test('App.jsx is the production call site for detect/open', () => {
  const app = readFileSync(join(ROOT, 'src/App.jsx'), 'utf8');
  assert.match(app, /from '\.\/utils\/git\/legacyVault'/);
  assert.match(app, /detectVaultLayout/);
  assert.match(app, /openLegacyAssembly/);
  assert.match(app, /vaultLayout: doc\.vaultLayout/);
  assert.match(app, /openAssembly: openNamedVaultAssembly/);
});

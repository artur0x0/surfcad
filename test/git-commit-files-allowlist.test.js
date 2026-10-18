/**
 * save-model v2 PR 5: production commitFiles / createRepo / create:true allowlist.
 * Syntax-tree scan (espree). The allowlist may only shrink.
 */
import assert from 'node:assert/strict';
import { parse } from 'espree';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

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
const ALLOWED_COMMIT_FILES = Object.freeze([
  // Upgrade (legacyVault/upgrade path) stays until PR 10
  { file: 'src/utils/git/legacyVault/upgrade.js', fn: 'executeUpgrade', count: 2 },
  { file: 'src/utils/git/legacyVault/upgrade.js', fn: 'executeUpgradeConflictChoice', count: 1 },
  { file: 'src/utils/git/legacyVault/upgrade.js', fn: 'executeUpgradeFollowup', count: 1 },
]);

const ALLOWED_CREATE_REPO = Object.freeze([
  { file: 'src/utils/git/vault.js', fn: 'createAndSeed', count: 1 },
  { file: 'src/utils/git/writeVaultCommit.js', fn: 'prepareCreateAndSeed', count: 1 },
]);

const ALLOWED_CREATE_TRUE = Object.freeze([]);

const ADAPTER_IMPLS = new Set([
  'src/utils/git/githubAdapter.js',
  'src/utils/git/mockGithubAdapter.js',
  'src/utils/git/spyGithubAdapter.js',
]);

const PARSE = {
  ecmaVersion: 'latest',
  sourceType: 'module',
  loc: true,
  range: true,
  ecmaFeatures: { jsx: true },
};

function rel(file) {
  return relative(ROOT, file).split('\\').join('/');
}

function skipDir(path) {
  return path === 'src/fea' || path.startsWith('src/fea/');
}

function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue;
    const full = join(dir, name);
    const path = rel(full);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (skipDir(path)) continue;
      walk(full, out);
    } else if (/\.(js|jsx|mjs)$/.test(name) && !/\.test\./.test(name)) {
      out.push(full);
    }
  }
  return out;
}

function keyName(node) {
  if (!node) return null;
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value;
  return null;
}

function isName(node, name) {
  return keyName(node) === name;
}

function enclosingFn(ancestors) {
  for (let i = ancestors.length - 1; i >= 0; i -= 1) {
    const node = ancestors[i];
    if (node.type === 'FunctionDeclaration' && node.id?.name) return node.id.name;
    if (node.type === 'FunctionExpression' && node.id?.name) return node.id.name;
    if (node.type === 'MethodDefinition') {
      const name = keyName(node.key);
      if (name) return name;
    }
    if (
      node.type === 'Property'
      && (
        node.method
        || node.value?.type === 'FunctionExpression'
        || node.value?.type === 'ArrowFunctionExpression'
      )
    ) {
      const name = keyName(node.key);
      if (name) return name;
    }
    if (
      node.type === 'VariableDeclarator'
      && node.id?.type === 'Identifier'
      && node.init
      && (
        node.init.type === 'FunctionExpression'
        || node.init.type === 'ArrowFunctionExpression'
        || node.init.type === 'FunctionDeclaration'
      )
    ) {
      return node.id.name;
    }
  }
  return '(top-level)';
}

function walkAst(node, visit, ancestors = []) {
  if (!node || typeof node !== 'object') return;
  visit(node, ancestors);
  const next = [...ancestors, node];
  for (const key of Object.keys(node)) {
    if (key === 'parent' || key === 'leadingComments' || key === 'trailingComments') continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const child of value) {
        if (child && typeof child === 'object' && child.type) walkAst(child, visit, next);
      }
    } else if (value && typeof value === 'object' && value.type) {
      walkAst(value, visit, next);
    }
  }
}

function parseSource(text, path) {
  try {
    return parse(text, PARSE);
  } catch (err) {
    err.message = `${path}: ${err.message}`;
    throw err;
  }
}

function collectNamedSites(files, name, { exclude = new Set() } = {}) {
  const sites = [];
  for (const file of files) {
    const path = file.path || rel(file);
    if (exclude.has(path)) continue;
    const text = file.text != null ? file.text : readFileSync(file, 'utf8');
    const ast = parseSource(text, path);
    walkAst(ast, (node, ancestors) => {
      const parent = ancestors[ancestors.length - 1];
      let hit = false;
      if (node.type === 'MemberExpression' && isName(node.property, name)) {
        hit = true;
      } else if (
        (node.type === 'Property' || node.type === 'MethodDefinition' || node.type === 'PropertyDefinition')
        && isName(node.key, name)
      ) {
        hit = true;
      } else if (node.type === 'Identifier' && node.name === name) {
        if (parent?.type === 'MemberExpression' && parent.property === node && !parent.computed) return;
        if (
          (parent?.type === 'Property' || parent?.type === 'MethodDefinition' || parent?.type === 'PropertyDefinition')
          && parent.key === node
        ) return;
        hit = true;
      }
      if (!hit) return;
      sites.push({ file: path, fn: enclosingFn(ancestors) });
    });
  }
  return sites;
}

function isWriteVaultCommitCallee(node) {
  if (!node) return false;
  if (node.type === 'Identifier') return node.name === 'writeVaultCommit';
  if (node.type === 'MemberExpression') return isName(node.property, 'writeVaultCommit');
  return false;
}

function objectHasCreateTrue(node) {
  if (!node || node.type !== 'ObjectExpression') return false;
  return node.properties.some((prop) => (
    prop.type === 'Property'
    && isName(prop.key, 'create')
    && prop.value?.type === 'Literal'
    && prop.value.value === true
  ));
}

function collectCreateTrueSites(files) {
  const sites = [];
  for (const file of files) {
    const path = file.path || rel(file);
    const text = file.text != null ? file.text : readFileSync(file, 'utf8');
    const ast = parseSource(text, path);
    walkAst(ast, (node, ancestors) => {
      if (node.type !== 'CallExpression' || !isWriteVaultCommitCallee(node.callee)) return;
      if (!node.arguments.some((arg) => objectHasCreateTrue(arg))) return;
      sites.push({ file: path, fn: enclosingFn(ancestors) });
    });
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

const SNEAK = {
  destructure: {
    path: 'src/utils/git/sneakDestructure.js',
    text: [
      'export async function sneakDestructure(adapter, repo) {',
      '  const { commitFiles } = adapter;',
      '  return commitFiles(repo, { files: [] });',
      '}',
      '',
    ].join('\n'),
  },
  bracket: {
    path: 'src/utils/git/sneakBracket.js',
    text: [
      'export async function sneakBracket(adapter, repo) {',
      "  return adapter['commitFiles'](repo, { files: [] });",
      '}',
      '',
    ].join('\n'),
  },
  alias: {
    path: 'src/utils/git/sneakAlias.js',
    text: [
      'export async function sneakAlias(adapter, repo) {',
      '  const write = adapter.commitFiles;',
      '  return write(repo, { files: [] });',
      '}',
      '',
    ].join('\n'),
  },
  arrow: {
    path: 'src/utils/git/sneakArrow.js',
    text: [
      'export async function sneakArrow(adapter, repo) {',
      '  return Promise.resolve().then(() => adapter.commitFiles(repo, { files: [] }));',
      '}',
      '',
    ].join('\n'),
  },
};

test('production commitFiles call sites match the shrinking allowlist', () => {
  const found = summarize(collectNamedSites(productionFiles(), 'commitFiles', {
    exclude: new Set(['src/utils/git/writeVaultCommit.js', ...ADAPTER_IMPLS]),
  }));
  assert.deepEqual(found, [...ALLOWED_COMMIT_FILES]);
});

test('production createRepo call sites match the shrinking allowlist', () => {
  const found = summarize(collectNamedSites(productionFiles(), 'createRepo', {
    exclude: ADAPTER_IMPLS,
  }));
  assert.deepEqual(found, [...ALLOWED_CREATE_REPO]);
});

test('production writeVaultCommit({ create: true }) call sites are none yet', () => {
  const found = summarize(collectCreateTrueSites(productionFiles()));
  assert.deepEqual(found, [...ALLOWED_CREATE_TRUE]);
});

test('writeVaultCommit is the production wrapper around commitFiles', () => {
  const text = readFileSync(join(ROOT, 'src/utils/git/writeVaultCommit.js'), 'utf8');
  assert.match(text, /adapter\.commitFiles\s*\(/);
  assert.match(text, /export async function writeVaultCommit/);
  assert.match(text, /function vaultV2SeedFiles/);
  assert.equal(/path:\s*['"]README\.md['"]/.test(text), false);
});

test('scanner fails for destructuring, bracket, alias, and arrow call sites', () => {
  const extras = Object.values(SNEAK);
  const found = summarize(collectNamedSites([...productionFiles(), ...extras], 'commitFiles', {
    exclude: new Set(['src/utils/git/writeVaultCommit.js', ...ADAPTER_IMPLS]),
  }));
  assert.deepEqual(found.filter((row) => row.file === SNEAK.destructure.path), [
    { file: SNEAK.destructure.path, fn: 'sneakDestructure', count: 3 },
  ]);
  assert.deepEqual(found.filter((row) => row.file === SNEAK.bracket.path), [
    { file: SNEAK.bracket.path, fn: 'sneakBracket', count: 1 },
  ]);
  assert.deepEqual(found.filter((row) => row.file === SNEAK.alias.path), [
    { file: SNEAK.alias.path, fn: 'sneakAlias', count: 1 },
  ]);
  assert.deepEqual(found.filter((row) => row.file === SNEAK.arrow.path), [
    { file: SNEAK.arrow.path, fn: 'sneakArrow', count: 1 },
  ]);
  assert.equal(
    JSON.stringify(found) === JSON.stringify(ALLOWED_COMMIT_FILES),
    false,
    'a new call site must not match the allowlist',
  );
});

test('scanner does not skip a non-src/fea folder named fea', () => {
  const sneak = {
    path: 'src/utils/fea/sneakFea.js',
    text: 'export async function sneakFea(adapter, repo) { return adapter.commitFiles(repo, {}); }\n',
  };
  const found = summarize(collectNamedSites([sneak], 'commitFiles'));
  assert.deepEqual(found, [{ file: sneak.path, fn: 'sneakFea', count: 1 }]);
});

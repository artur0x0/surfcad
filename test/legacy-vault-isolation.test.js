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
const INTERNAL_IMPORT = /from ['"][^'"]*legacyVault\/(detect|reader|upgrade|knownReadmeSeeds)(?:\.js)?['"]/;
const COMMIT_FILES = /\bcommitFiles\s*\(/;
const CREATE_REPO = /\bcreateRepo\s*\(/;
const V1_PARSE_HELPERS = /\b(parseLegacyVaultPath|parseLegacySurfJson|assemblyMetaCandidates)\b/;
const PARSE_SURF_JSON = /\bparseSurfJson\b/;
const PARSE_SURF_JSON_ALLOWED = new Set([
  'src/utils/git/surfJson.js',
  // Writers parse committed v1 they themselves wrote — not vault OPEN.
  'src/utils/git/gitCommit.js',
  'src/utils/git/gitDeleteAssembly.js',
  'src/utils/git/layoutMigration.js',
]);

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
  const flag = join(ROOT, 'src/utils/git/upgradeVaultEnabled.js');
  assert.equal(readFileSync(flag, 'utf8').startsWith(BANNER), true, 'upgradeVaultEnabled.js must start with the TEMPORARY banner');
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
    const path = rel(file);
    const text = readFileSync(file, 'utf8');
    // lastCommit imports reader.js directly to break lastCommit → index → upgrade.
    if (path === 'src/utils/git/lastCommit.js') {
      if (/legacyVault\/(detect|upgrade|knownReadmeSeeds)/.test(text)) offenders.push(path);
      continue;
    }
    if (INTERNAL_IMPORT.test(text)) offenders.push(path);
  }
  assert.deepEqual(offenders, []);
});

test('legacyVault createRepo is forbidden; commitFiles lives only in upgrade.js', () => {
  const files = walk(LEGACY_DIR, []);
  for (const file of files) {
    const path = rel(file);
    const text = readFileSync(file, 'utf8');
    assert.equal(CREATE_REPO.test(text), false, `${path} must not call createRepo`);
    if (path === 'src/utils/git/legacyVault/upgrade.js') {
      assert.equal(COMMIT_FILES.test(text), true, 'upgrade.js is the Upgrade writer');
      continue;
    }
    assert.equal(COMMIT_FILES.test(text), false, `${path} must not call commitFiles`);
  }
});

test('git/index.js does not barrel-export upgrade', () => {
  const text = readFileSync(join(ROOT, 'src/utils/git/index.js'), 'utf8');
  assert.equal(/legacyVault/.test(text), false);
  assert.equal(/\bplanUpgrade\b/.test(text), false);
  assert.equal(/\bexecuteUpgrade\b/.test(text), false);
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

test('App.jsx is the production call site for detect/open/upgrade', () => {
  const app = readFileSync(join(ROOT, 'src/App.jsx'), 'utf8');
  assert.match(app, /from '\.\/utils\/git\/legacyVault'/);
  assert.match(app, /detectVaultLayout/);
  assert.match(app, /openLegacyAssembly/);
  assert.match(app, /executeUpgrade/);
  assert.match(app, /vaultLayout: doc\.vaultLayout/);
  assert.match(app, /openAssembly: openNamedVaultAssembly/);
  const upgrade = (() => {
    const start = app.indexOf('const handleUpgradeVault');
    assert.ok(start >= 0, 'missing handleUpgradeVault');
    const end = app.indexOf('const handleUpgradeConflict', start);
    assert.ok(end > start, 'missing handleUpgradeConflict');
    return app.slice(start, end);
  })();
  assert.match(upgrade, /ensureGitVault\(\{\s*create:\s*false\s*\}\)/);
  assert.equal(/\bensureGitVault\(\s*\)/.test(upgrade), false);
  assert.equal(/flushGitOps|enqueueGit/.test(upgrade), false);
  const conflict = (() => {
    const start = app.indexOf('const handleUpgradeConflict');
    const end = app.indexOf('const absorbOverwriteFiles', start);
    assert.ok(end > start, 'missing absorbOverwriteFiles after handleUpgradeConflict');
    return app.slice(start, end);
  })();
  assert.match(conflict, /ensureGitVault\(\{\s*create:\s*false\s*\}\)/);
});

test('parseSurfJson is not used to open a vault outside legacyVault/', () => {
  const files = walk(join(ROOT, 'src'), []);
  const offenders = [];
  for (const file of files) {
    const path = rel(file);
    if (inLegacy(file) || /\.test\./.test(path) || PARSE_SURF_JSON_ALLOWED.has(path)) continue;
    const text = readFileSync(file, 'utf8');
    if (PARSE_SURF_JSON.test(text)) offenders.push(path);
  }
  assert.deepEqual(offenders, []);
});

test('openVaultAssembly dispatches to the legacy reader and refuses v2', () => {
  const text = readFileSync(join(ROOT, 'src/utils/git/gitWorkspace.js'), 'utf8');
  assert.equal(PARSE_SURF_JSON.test(text), false, 'gitWorkspace must not parse v1 trees');
  assert.match(text, /openLegacyAssembly/);
  assert.match(text, /UnsupportedVaultLayoutError/);
  assert.match(text, /listLegacyAssemblies/);
});

test('gitPull Get-latest reopens through the vault opener, not parseSurfJson', () => {
  const text = readFileSync(join(ROOT, 'src/utils/git/gitPull.js'), 'utf8');
  assert.equal(PARSE_SURF_JSON.test(text), false);
  assert.match(text, /openVaultAssembly/);
});

test('gitBranch switch/list do not parse v1 trees themselves', () => {
  const text = readFileSync(join(ROOT, 'src/utils/git/gitBranch.js'), 'utf8');
  assert.equal(PARSE_SURF_JSON.test(text), false);
  assert.match(text, /openVaultAssembly|openAssembly/);
  assert.match(text, /listVaultAssemblies/);
});

test('App open/list/reload pass create:false so they never POST /user/repos', () => {
  const app = readFileSync(join(ROOT, 'src/App.jsx'), 'utf8');
  const slice = (startNeedle, endNeedle) => {
    const start = app.indexOf(startNeedle);
    assert.ok(start >= 0, `missing ${startNeedle}`);
    const end = app.indexOf(endNeedle, start + startNeedle.length);
    assert.ok(end > start, `missing end ${endNeedle} after ${startNeedle}`);
    return app.slice(start, end);
  };
  const open = slice('const handleOpenVaultAssembly', 'openVaultAssemblyRef.current');
  assert.match(open, /ensureGitVault\(\{\s*create:\s*false\s*\}\)/);
  assert.equal(/\bensureGitVault\(\s*\)/.test(open), false);
  const list = slice('const handleListVaultAssemblies', 'const adoptVaultOpening');
  assert.match(list, /ensureGitVault\(\{\s*create:\s*false\s*\}\)/);
  const browse = slice('const handleListVaultBrowse', 'const vaultEntriesForDelete');
  assert.match(browse, /ensureGitVault\(\{\s*create:\s*false\s*\}\)/);
  const switchBranch = slice('const handleSwitchBranch', 'const handleListVaultBrowse');
  assert.match(switchBranch, /ensureGitVault\(\{\s*create:\s*false\s*\}\)/);
  assert.equal(/\bensureGitVault\(\s*\)/.test(switchBranch), false);
  assert.match(app, /ensureGitVaultRef\.current\(\{\s*create:\s*false\s*\}\)/);
  const behind = slice('const handleBehindChoice', '// G4: re-check remote');
  assert.match(behind, /action === 'reload'/);
  assert.match(behind, /ensureGitVault\(\{\s*create:\s*false\s*\}\)/);
  assert.equal(/\bensureGitVault\(\s*\)/.test(behind), false);
  assert.match(behind, /scripts\[part\.id\]\s*\?\?\s*reloaded\.scripts\[part\.id\]/);
});

test('reauth/read-only boot passes readOnly so collapse does not mint', () => {
  const app = readFileSync(join(ROOT, 'src/App.jsx'), 'utf8');
  const start = app.indexOf('const localIds = migrateLocalPartIds({');
  assert.ok(start >= 0, 'missing boot migrateLocalPartIds');
  const end = app.indexOf('const idsChanged = migrated.changed || localIds.changed || collapsed.changed', start);
  assert.ok(end > start, 'missing boot idsChanged');
  const boot = app.slice(start, end);
  assert.match(boot, /const readOnly = plan\.readOnly === true \|\| bootReadOnlyRef\.current/);
  assert.match(boot, /collapseWorkingCopyIds\(doc, scripts, \{[\s\S]*?readOnly,/);
  assert.match(boot, /reusePairs: reusePairsFromJournal\(rekeyJournal, persistSource\.doc\)/);
});

test('identity collapse does not import src/fea or surfcad-fea', () => {
  const FEA_IMPORT = /from ['"][^'"]*(?:\/fea\/|surfcad-fea)/;
  for (const file of ['src/utils/git/wcIdentity.js', 'src/utils/git/feaStudyIds.js']) {
    const text = readFileSync(join(ROOT, file), 'utf8');
    assert.equal(FEA_IMPORT.test(text), false, `${file} must read the study shape without importing src/fea`);
  }
});

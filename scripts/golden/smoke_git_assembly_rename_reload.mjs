#!/usr/bin/env node
/**
 * Rename assembly, reload (zero writes), then Save is one commit that writes
 * the new folder and deletes the old `.surf.json` and part files.
 * Mock adapter only — no network, no tokens.
 */
import { createMockGithubAdapter } from '../../src/utils/git/mockGithubAdapter.js';
import { findOrCreateVault } from '../../src/utils/git/vault.js';
import { mintSurfId } from '../../src/utils/git/surfId.js';
import { assembleCommitFiles, commitWorkspace, firstCommitBaseline } from '../../src/utils/git/gitCommit.js';
import { openVaultAssembly } from '../../src/utils/git/gitWorkspace.js';
import { assemblyFilePath, assemblyPartPath } from '../../src/utils/git/vaultLayout.js';
import { emptyWorkingSidecar, recordRenameFrom } from '../../src/utils/git/workingSidecar.js';

let failed = 0;
let passed = 0;
function ok(name, cond, extra = '') {
  if (cond) { passed += 1; console.log(`  ✅ ${name}`); }
  else { failed += 1; console.log(`  ❌ ${name}${extra ? ` — ${extra}` : ''}`); }
}

const A = mintSurfId({ now: new Date('2026-10-18T00:00:00Z'), rand: 'aaaa' });
const gh = createMockGithubAdapter({ login: 'golden' });
const vault = await findOrCreateVault(gh);
const first = await commitWorkspace(gh, vault.repo, {
  doc: {
    source: 'git',
    name: 'Asm',
    activeId: A,
    parts: [{ id: A, surfId: A, name: 'Keep', visible: true, order: 0, isSynced: false }],
  },
  scripts: { [A]: 'return 1;\n' },
  baseline: firstCommitBaseline({ headSha: vault.headSha }),
  message: 'Save 1',
});
ok('first save committed', first.status === 'committed', first.error);
const writesAfterSave = gh._log.filter((row) => row.op === 'commitFiles').length;
const renamed = { ...first.doc, name: 'Asm2' };
const sidecar = recordRenameFrom(emptyWorkingSidecar(), first.baseline.assemblyName);
ok('sidecar keeps the old vault name', sidecar.renameFrom === 'Asm');

let reseed = 'ok';
try {
  await openVaultAssembly(gh, vault.repo, 'Asm2', { branch: 'main' });
} catch (err) {
  reseed = err.message;
}
ok('reload by the new name misses the tip', /Assembly not found/.test(reseed), reseed);
const opened = await openVaultAssembly(gh, vault.repo, sidecar.renameFrom, { branch: 'main' });
ok('reload by renameFrom finds the tip', opened.baseline.assemblyName === 'Asm');
ok('reload writes nothing', gh._log.filter((row) => row.op === 'commitFiles').length === writesAfterSave);

const planned = await assembleCommitFiles(gh, vault.repo, {
  doc: renamed,
  scripts: first.scripts,
  baseline: opened.baseline,
  message: 'Save 2',
});
ok('save is ready', planned.status === 'ready');
const kinds = planned.files.map((file) => [file.path, file.delete ? 'DEL' : 'W']).sort((a, b) => a[0].localeCompare(b[0]));
const want = [
  [assemblyFilePath('Asm'), 'DEL'],
  [assemblyPartPath('Asm', 'Keep'), 'DEL'],
  [assemblyFilePath('Asm2'), 'W'],
  [assemblyPartPath('Asm2', 'Keep'), 'W'],
].sort((a, b) => a[0].localeCompare(b[0]));
ok('one save writes the new folder and deletes the old files', JSON.stringify(kinds) === JSON.stringify(want), JSON.stringify(kinds));

const second = await commitWorkspace(gh, vault.repo, {
  doc: renamed,
  scripts: first.scripts,
  baseline: opened.baseline,
  message: 'Save 2',
});
ok('second save is one commit', second.status === 'committed');
ok(
  'exactly one commit after reload',
  gh._log.filter((row) => row.op === 'commitFiles').length === writesAfterSave + 1,
);
ok('new assembly exists', !!(await gh.readFile(vault.repo, assemblyFilePath('Asm2'), 'main')));
ok('old assembly deleted', !(await gh.readFile(vault.repo, assemblyFilePath('Asm'), 'main')));
ok('old part deleted', !(await gh.readFile(vault.repo, assemblyPartPath('Asm', 'Keep'), 'main')));

console.log(failed ? `\n❌ FAIL (${failed} failed, ${passed} passed)` : `\n✅ PASS (${passed})`);
process.exit(failed ? 1 : 0);

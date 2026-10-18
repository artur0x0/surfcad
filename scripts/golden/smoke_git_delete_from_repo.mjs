#!/usr/bin/env node
/**
 * Delete from assembly & repo writes nothing. The next Save is one commit:
 * `.surf.json` plus the part script and mesh deletes.
 * Mock adapter only — no network, no tokens.
 */
import { createMockGithubAdapter } from '../../src/utils/git/mockGithubAdapter.js';
import { findOrCreateVault } from '../../src/utils/git/vault.js';
import { mintSurfId } from '../../src/utils/git/surfId.js';
import { assembleCommitFiles, commitWorkspace, firstCommitBaseline } from '../../src/utils/git/gitCommit.js';
import { removePart } from '../../src/utils/assembly.js';
import { partRepoPath } from '../../src/utils/git/partIdentity.js';
import { assemblyFilePath, assetPathForScript } from '../../src/utils/git/vaultLayout.js';
import {
  deletePathsForCommit,
  emptyWorkingSidecar,
  recordPendingDeletes,
  repoDeletePathsFor,
} from '../../src/utils/git/workingSidecar.js';

let failed = 0;
let passed = 0;
function ok(name, cond, extra = '') {
  if (cond) { passed += 1; console.log(`  ✅ ${name}`); }
  else { failed += 1; console.log(`  ❌ ${name}${extra ? ` — ${extra}` : ''}`); }
}

const A = mintSurfId({ now: new Date('2026-10-18T00:00:00Z'), rand: 'aaaa' });
const B = mintSurfId({ now: new Date('2026-10-18T00:00:00Z'), rand: 'bbbb' });

const gh = createMockGithubAdapter({ login: 'golden' });
const vault = await findOrCreateVault(gh);
const doc = {
  source: 'git',
  name: 'Asm',
  activeId: A,
  parts: [
    { id: A, surfId: A, name: 'Keep', visible: true, order: 0, isSynced: false },
    { id: B, surfId: B, name: 'Gone', visible: true, order: 1, isSynced: false },
  ],
};
const first = await commitWorkspace(gh, vault.repo, {
  doc,
  scripts: { [A]: 'return 1;\n', [B]: 'return 2;\n' },
  baseline: firstCommitBaseline({ headSha: vault.headSha }),
  message: 'Save 1',
});
ok('first save committed', first.status === 'committed', first.error);
const gone = first.doc.parts.find((part) => part.name === 'Gone');
const gonePath = partRepoPath(gone);
const meshPath = assetPathForScript(gonePath);
const meshCommit = await gh.commitFiles(vault.repo, {
  branch: 'main',
  message: 'mesh',
  baseSha: first.sha,
  files: [{ path: meshPath, content: new Uint8Array([9, 8, 7, 6]) }],
});
const baseline = { ...first.baseline, headSha: meshCommit.sha };
const writesBeforeDelete = gh._log.filter((row) => row.op === 'commitFiles').length;

const after = removePart(first.doc, gone.id);
const scripts = { ...first.scripts };
delete scripts[gone.id];
const sidecar = recordPendingDeletes(emptyWorkingSidecar(), repoDeletePathsFor(gonePath));
ok('delete-from-repo makes zero writes', gh._log.filter((row) => row.op === 'commitFiles').length === writesBeforeDelete);

const planned = await assembleCommitFiles(gh, vault.repo, {
  doc: after,
  scripts,
  baseline,
  message: 'Save 2',
  deletePaths: deletePathsForCommit(sidecar, after),
});
ok('save is ready', planned.status === 'ready');
const kinds = planned.files.map((file) => [file.path, file.delete ? 'DEL' : 'W']).sort((a, b) => a[0].localeCompare(b[0]));
ok(
  'one save: .surf.json write plus part and mesh deletes',
  JSON.stringify(kinds) === JSON.stringify([
    [assemblyFilePath('Asm'), 'W'],
    [gonePath, 'DEL'],
    [meshPath, 'DEL'],
  ]),
  JSON.stringify(kinds),
);

const second = await commitWorkspace(gh, vault.repo, {
  doc: after,
  scripts,
  baseline,
  message: 'Save 2',
  deletePaths: deletePathsForCommit(sidecar, after),
});
ok('second save is one commit', second.status === 'committed');
ok(
  'exactly one commit after delete',
  gh._log.filter((row) => row.op === 'commitFiles').length === writesBeforeDelete + 1,
);
ok('part blob gone', !(await gh.readFile(vault.repo, gonePath, 'main')));
ok('mesh blob gone', !(await gh.readFile(vault.repo, meshPath, 'main')));
ok('assembly remains', !!(await gh.readFile(vault.repo, assemblyFilePath('Asm'), 'main')));

console.log(failed ? `\n❌ FAIL (${failed} failed, ${passed} passed)` : `\n✅ PASS (${passed})`);
process.exit(failed ? 1 : 0);

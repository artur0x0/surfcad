/**
 * Agent-made parts without vault paths (surfcad-mcp "Kettle-MCP" report):
 * per-part Add to Repo, path-aware rename, and the rename_part bridge gate.
 * Mock adapter only — no network, no real repo.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMockGithubAdapter } from '../src/utils/git/mockGithubAdapter.js';
import { findOrCreateVault } from '../src/utils/git/vault.js';
import { assemblyFilePath, assemblyPartPath, sharedPartPath } from '../src/utils/git/vaultLayout.js';
import { parseSurfJson, validateSurfJson } from '../src/utils/git/surfJson.js';
import {
  assembleCommitFiles,
  commitPartToRepo,
  commitWorkspace,
  firstCommitBaseline,
  VAULT_TREE_UNAVAILABLE,
} from '../src/utils/git/gitCommit.js';
import { planRenameVaultPartPath } from '../src/utils/git/partVaultPath.js';
import { renamePartCommand } from '../src/agent/commands/document.js';

const ASM = 'Kettle-MCP';
const NAMES = ['Kettle Body', 'Kettle Lid', 'Kettle Handle'];
const IDS = [
  '5f0c3c1e-0000-4000-8000-000000000001',
  '5f0c3c1e-0000-4000-8000-000000000002',
  '5f0c3c1e-0000-4000-8000-000000000003',
];

function kettle() {
  const doc = {
    source: 'git',
    name: ASM,
    activeId: IDS[0],
    parts: IDS.map((id, order) => ({ id, name: NAMES[order], visible: true, order, isSynced: false })),
  };
  const scripts = Object.fromEntries(IDS.map((id, i) => [id, `// ${NAMES[i]}\nreturn Manifold.cube([${i + 1}, 1, 1], true);\n`]));
  return { doc, scripts };
}

test('git_add_to_repo core: one path-less part commits every path-less sibling in one commit', async () => {
  const gh = createMockGithubAdapter({ login: 'agent' });
  const vault = await findOrCreateVault(gh);
  const { doc, scripts } = kettle();
  const out = await commitPartToRepo(gh, vault.repo, {
    doc,
    scripts,
    baseline: firstCommitBaseline({ headSha: vault.headSha }),
    partId: IDS[0],
  });
  assert.equal(out.status, 'committed', out.error);
  const body = assemblyPartPath(ASM, 'Kettle Body');
  const lid = assemblyPartPath(ASM, 'Kettle Lid');
  const handle = assemblyPartPath(ASM, 'Kettle Handle');
  assert.equal(out.partId, IDS[0]);
  assert.equal(out.path, body);
  assert.deepEqual(out.siblings.map((row) => ({ from: row.from, to: row.to })), [
    { from: IDS[1], to: lid },
    { from: IDS[2], to: handle },
  ]);
  assert.deepEqual([...out.files].sort(), [
    assemblyFilePath(ASM),
    body,
    handle,
    lid,
  ].sort());

  const surf = await gh.readFile(vault.repo, assemblyFilePath(ASM), 'main');
  const raw = JSON.parse(surf.content);
  assert.equal(validateSurfJson(raw).ok, true);
  for (const row of raw.parts) {
    const file = await gh.readFile(vault.repo, row.path, 'main');
    assert.ok(file, `.surf.json references ${row.path}, which the commit wrote`);
  }
  assert.equal((await gh.readFile(vault.repo, lid, 'main')).content, scripts[IDS[1]]);
  assert.deepEqual(out.doc.parts.map((p) => p.id), IDS);
  assert.deepEqual(out.doc.parts.map((p) => p.path), [body, lid, handle]);
  for (const id of IDS) {
    assert.ok(Object.prototype.hasOwnProperty.call(out.baseline.scripts, id), `${id} is clean after the commit`);
  }
});

test('git_add_to_repo core: second call per part is clean, not a validation loop', async () => {
  const gh = createMockGithubAdapter({ login: 'agent' });
  const vault = await findOrCreateVault(gh);
  const { doc, scripts } = kettle();
  const first = await commitPartToRepo(gh, vault.repo, {
    doc,
    scripts,
    baseline: firstCommitBaseline({ headSha: vault.headSha }),
    partId: IDS[0],
  });
  assert.equal(first.status, 'committed');
  const second = await commitPartToRepo(gh, vault.repo, {
    doc: first.doc,
    scripts: first.scripts,
    baseline: first.baseline,
    partId: first.siblings[0].id || first.siblings[0].from,
  });
  assert.equal(second.status, 'clean', JSON.stringify(second));
});

test('planRenameVaultPartPath stays in its folder and uses -2 on collision', () => {
  const lid = assemblyPartPath(ASM, 'Kettle Lid');
  const handle = assemblyPartPath(ASM, 'Kettle Handle');
  assert.equal(planRenameVaultPartPath(lid, 'Cap', [lid, handle]), assemblyPartPath(ASM, 'Cap'));
  assert.equal(
    planRenameVaultPartPath(lid, 'Kettle Handle', [lid, handle]),
    assemblyPartPath(ASM, 'Kettle Handle-2'),
  );
  assert.equal(
    planRenameVaultPartPath(lid, 'Kettle Handle', [lid, handle, assemblyPartPath(ASM, 'Kettle Handle-2')]),
    assemblyPartPath(ASM, 'Kettle Handle-3'),
  );
  assert.equal(planRenameVaultPartPath(lid, 'Kettle Lid', [lid, handle]), lid, 'own path is not a collision');
  const shared = sharedPartPath('Bracket');
  assert.equal(
    planRenameVaultPartPath(shared, 'Mount', [shared, sharedPartPath('Mount')]),
    sharedPartPath('Mount-2'),
  );
  assert.equal(planRenameVaultPartPath(IDS[0], 'Mount', []), null, 'path-less part has no file to move');
});

test('rename_part refuses an unknown id cleanly', async () => {
  let called = false;
  const ctx = {
    agentRenamePart: async () => {
      called = true;
      return { error: { code: 'unknown_part', message: 'Unknown part id: nope' } };
    },
  };
  const out = await renamePartCommand.run(ctx, { part_id: 'nope', name: 'X' });
  assert.equal(out.error?.code, 'unknown_part');
  assert.equal(called, true);
  assert.equal(renamePartCommand.checkArgs({ part_id: 'a', name: '  ' })?.code, 'bad_args');
  assert.equal(renamePartCommand.checkArgs({ name: 'X' })?.code, 'bad_args');
});

test('rename_part is working-copy only; a vault path is unknown_part', async () => {
  const renamed = [];
  const ctx = {
    agentRenamePart: async (args) => {
      renamed.push(args);
      return { result: { partId: args.partId, name: args.name, moved: false } };
    },
  };
  assert.equal(renamePartCommand.checkArgs({ part_id: 'parts/Bracket.js', name: 'Mount' })?.code, 'unknown_part');
  const local = await renamePartCommand.run(ctx, { part_id: IDS[0], name: 'Kettle Body' });
  assert.equal(local.result?.moved, false);
  assert.deepEqual(renamed, [{ partId: IDS[0], name: 'Kettle Body' }]);
});

test('parseSurfJson round-trips the sibling commit', async () => {
  const gh = createMockGithubAdapter({ login: 'agent' });
  const vault = await findOrCreateVault(gh);
  const { doc, scripts } = kettle();
  const out = await commitPartToRepo(gh, vault.repo, {
    doc,
    scripts,
    baseline: firstCommitBaseline({ headSha: vault.headSha }),
    partId: IDS[2],
  });
  const surf = await gh.readFile(vault.repo, assemblyFilePath(ASM), 'main');
  const reopened = parseSurfJson(surf.content);
  assert.deepEqual(reopened.parts.map((p) => p.id), out.doc.parts.map((p) => p.id));
  assert.deepEqual(reopened.parts.map((p) => p.path), out.doc.parts.map((p) => p.path));
});

test('assembly save twice after adopting the first result does not mint -2 copies', async () => {
  const gh = createMockGithubAdapter({ login: 'agent' });
  const vault = await findOrCreateVault(gh);
  const { doc, scripts } = kettle();
  const first = await commitWorkspace(gh, vault.repo, {
    doc,
    scripts,
    baseline: firstCommitBaseline({ headSha: vault.headSha }),
    message: 'Save Kettle',
  });
  assert.equal(first.status, 'committed');
  assert.equal(first.files.length, 4);
  assert.equal(first.moved.length, 3);
  assert.equal(first.files.some((path) => /-2\.js$/.test(path)), false);
  const second = await commitWorkspace(gh, vault.repo, {
    doc: first.doc,
    scripts: first.scripts,
    baseline: first.baseline,
    message: 'Save Kettle again',
  });
  assert.equal(second.status, 'clean', JSON.stringify(second));
});

test('saving the original path-less doc again would mint -2 — callers must adopt', async () => {
  const gh = createMockGithubAdapter({ login: 'agent' });
  const vault = await findOrCreateVault(gh);
  const { doc, scripts } = kettle();
  const first = await commitWorkspace(gh, vault.repo, {
    doc,
    scripts,
    baseline: firstCommitBaseline({ headSha: vault.headSha }),
    message: 'Save Kettle',
  });
  assert.equal(first.status, 'committed');
  const again = await assembleCommitFiles(gh, vault.repo, {
    doc,
    scripts,
    baseline: first.baseline,
    message: 'Save Kettle again',
  });
  assert.equal(again.status, 'ready');
  const planned = again.doc.parts.map((part) => part.path);
  assert.equal(planned.filter((path) => /-2\.js$/.test(path)).length, 3, JSON.stringify(planned));
});

test('assembleCommitFiles aborts when listTree fails instead of occupying nothing', async () => {
  const gh = createMockGithubAdapter({ login: 'agent' });
  const vault = await findOrCreateVault(gh);
  const { doc, scripts } = kettle();
  gh.listTree = async () => {
    throw new Error('network down');
  };
  await assert.rejects(
    () => assembleCommitFiles(gh, vault.repo, {
      doc,
      scripts,
      baseline: firstCommitBaseline({ headSha: vault.headSha }),
      message: 'Save Kettle',
    }),
    (err) => err.code === VAULT_TREE_UNAVAILABLE && /not overwritten/.test(err.message),
  );
});

test('commitPartToRepo aborts when listTree fails instead of occupying nothing', async () => {
  const gh = createMockGithubAdapter({ login: 'agent' });
  const vault = await findOrCreateVault(gh);
  const { doc, scripts } = kettle();
  gh.listTree = async () => {
    throw new Error('network down');
  };
  const out = await commitPartToRepo(gh, vault.repo, {
    doc,
    scripts,
    baseline: firstCommitBaseline({ headSha: vault.headSha }),
    partId: IDS[0],
  });
  assert.equal(out.status, 'error');
  assert.equal(out.code, VAULT_TREE_UNAVAILABLE);
  assert.match(out.error, /not overwritten/);
});

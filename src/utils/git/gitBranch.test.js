/**
 * Create+switch vault branch. Mock adapter only — no network, no tokens.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { fileWrite } from './githubAdapterInterface.js';
import { createMockGithubAdapter } from './mockGithubAdapter.js';
import { findOrCreateVault } from './vault.js';
import { assemblyIdPath, partIdPath } from './idPaths.js';
import { openVaultAssembly } from './gitWorkspace.js';
import { partRepoPath } from './partIdentity.js';
import {
  createVaultBranch,
  listVaultBranches,
  shouldSwitchToCreatedBranch,
  switchVaultBranch,
} from './gitBranch.js';

const ASM_ID = '2026-10-18-02-50-00-0001-aa01';
const PART_ID = '2026-10-18-02-50-00-0002-bb02';
const SEED_SCRIPT = `// @surf-id ${PART_ID}\n// @name Bracket\nreturn Manifold.cube([10,10,10], true);\n`;

async function seedVault() {
  const gh = createMockGithubAdapter({ login: 'artur' });
  const vault = await findOrCreateVault(gh);
  const doc = {
    format: 'surfcad.assembly',
    version: 2,
    id: ASM_ID,
    name: 'Gearbox',
    activeId: PART_ID,
    parts: [{ id: PART_ID, name: 'Bracket', visible: true, order: 0 }],
  };
  const seed = await gh.commitFiles(vault.repo, {
    branch: 'main',
    message: 'seed',
    baseSha: vault.headSha,
    files: [
      fileWrite('surfcad.json', `${JSON.stringify({ kind: 'surfcad-vault', version: 2 }, null, 2)}\n`),
      fileWrite(assemblyIdPath(ASM_ID), `${JSON.stringify(doc, null, 2)}\n`),
      fileWrite(partIdPath(PART_ID), SEED_SCRIPT),
    ],
  });
  return { gh, repo: vault.repo, seedSha: seed.sha };
}

describe('shouldSwitchToCreatedBranch', () => {
  test('clean working copy checks out the new branch', () => {
    assert.equal(shouldSwitchToCreatedBranch({ dirty: false }), true);
    assert.equal(shouldSwitchToCreatedBranch({}), true);
  });

  test('dirty working copy stays on the current branch', () => {
    assert.equal(shouldSwitchToCreatedBranch({ dirty: true }), false);
  });

  test('path-less parts are first-commit dirty (stable ids, no vault path)', () => {
    const pathLess = { id: '2026-10-07-20-56-31-0423-a3f9', name: 'Seed' };
    const pathed = { id: '2026-10-07-20-56-31-0423-b4e0', name: 'Bracket', path: 'assemblies/Gearbox/Bracket.js' };
    assert.equal(partRepoPath(pathLess), null);
    assert.equal(partRepoPath(pathed), 'assemblies/Gearbox/Bracket.js');
    const dirty = [pathLess, pathed].some((p) => !partRepoPath(p));
    assert.equal(dirty, true);
    assert.equal(shouldSwitchToCreatedBranch({ dirty }), false);
  });
});

describe('create then switch (mock adapter)', () => {
  test('creates and checks out the new branch when clean', async () => {
    const { gh, repo } = await seedVault();
    const created = await createVaultBranch(gh, repo, 'feature/agent-create', {
      fromBranch: 'main',
    });
    assert.equal(created.name, 'feature/agent-create');
    assert.equal(shouldSwitchToCreatedBranch({ dirty: false }), true);
    const opened = await switchVaultBranch(gh, repo, ASM_ID, created.name);
    assert.equal(opened.baseline?.branch, 'feature/agent-create');
    const bracket = (opened.doc?.parts || []).find((p) => p.id === PART_ID);
    assert.ok(bracket, 'opened assembly has the bracket part');
    assert.equal(opened.scripts[bracket.id], SEED_SCRIPT);

    const listed = await listVaultBranches(gh, repo, { current: opened.baseline.branch });
    assert.equal(listed.find((b) => b.name === 'feature/agent-create')?.current, true);
    assert.equal(listed.find((b) => b.name === 'main')?.current, false);
  });

  test('creates without checkout when the working copy is dirty', async () => {
    const { gh, repo, seedSha } = await seedVault();
    const created = await createVaultBranch(gh, repo, 'feature/keep-dirty', {
      fromBranch: 'main',
      fromSha: seedSha,
    });
    assert.equal(created.name, 'feature/keep-dirty');
    assert.equal(shouldSwitchToCreatedBranch({ dirty: true }), false);

    const listed = await listVaultBranches(gh, repo, { current: 'main' });
    assert.ok(listed.some((b) => b.name === 'feature/keep-dirty'));
    assert.equal(listed.find((b) => b.name === 'main')?.current, true);
    assert.equal(listed.find((b) => b.name === 'feature/keep-dirty')?.current, false);

    const stillMain = await openVaultAssembly(gh, repo, ASM_ID, {
      branch: 'main',
      headSha: seedSha,
    });
    assert.equal(stillMain.baseline.branch, 'main');
  });

  test('createVaultBranch alone does not change the current branch', async () => {
    const { gh, repo, seedSha } = await seedVault();
    const created = await createVaultBranch(gh, repo, 'feature/no-switch', { fromSha: seedSha });
    assert.equal(created.name, 'feature/no-switch');
    const listed = await listVaultBranches(gh, repo, { current: 'main' });
    assert.equal(listed.find((b) => b.name === 'feature/no-switch')?.current, false);
    assert.equal(listed.find((b) => b.name === 'main')?.current, true);
  });
});

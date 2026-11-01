/**
 * Generic vault version check and upgrade hook. No production step is
 * registered. A fake step is registered only inside this file.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createMockGithubAdapter } from './mockGithubAdapter.js';
import { assemblyIdPath, partIdPath } from './idPaths.js';
import { openVaultAssembly } from './gitWorkspace.js';
import { VAULT_MARKER_KIND } from './vaultNames.js';
import {
  CURRENT_VAULT_VERSION,
  UNSUPPORTED_VAULT_CODE,
  UNSUPPORTED_VAULT_COPY,
  alreadyUpgradedResult,
  registerVaultUpgrade,
  runVaultUpgrade,
  vaultUpgrades,
} from './vaultUpgrade.js';

const ASM = '2026-10-22-05-00-00-0001-aa01';
const PART = '2026-10-22-05-00-00-0002-bb02';

function marker(version) {
  return `${JSON.stringify({ kind: VAULT_MARKER_KIND, version }, null, 2)}\n`;
}

function assemblyFile() {
  return `${JSON.stringify({
    format: 'surfcad.assembly',
    version: 2,
    id: ASM,
    name: 'Widget',
    activeId: PART,
    parts: [{ id: PART, name: 'Pin', visible: true, order: 0 }],
  })}\n`;
}

function seed(version, extra = {}) {
  const gh = createMockGithubAdapter({ login: 'artur' });
  const repo = gh._seedRepo({
    name: 'surfcad-vault',
    files: {
      'surfcad.json': marker(version),
      [assemblyIdPath(ASM)]: assemblyFile(),
      [partIdPath(PART)]: `// @surf-id ${PART}\n// @name Pin\nreturn 1;\n`,
      ...extra,
    },
  });
  return { gh, repo: { owner: repo.owner, name: repo.name } };
}

describe('vault upgrade hook', { concurrency: false }, () => {
test('the upgrade registry ships empty', () => {
  assert.equal(vaultUpgrades.size, 0);
  assert.equal(CURRENT_VAULT_VERSION, 2);
});

test('a v2 vault opens and git_upgrade_vault returns already_upgraded', async () => {
  const { gh, repo } = seed(2);
  const writes = gh._log.filter((row) => row.op === 'commitFiles').length;
  const opened = await openVaultAssembly(gh, repo, ASM, { branch: 'main' });
  assert.equal(opened.doc.name, 'Widget');
  assert.equal(opened.vaultLayout, 'v2');
  assert.equal(opened.doc.parts[0].id, PART);
  assert.equal(gh._log.filter((row) => row.op === 'commitFiles').length, writes);
  const upgraded = await runVaultUpgrade({ adapter: gh, repo, ref: 'main' });
  assert.deepEqual(upgraded, alreadyUpgradedResult());
  assert.equal(upgraded.status, 'already_upgraded');
  assert.equal(gh._log.filter((row) => row.op === 'commitFiles').length, writes);
});

test('an unknown version is not opened and the tool returns unsupported_vault_version', async () => {
  const { gh, repo } = seed(7);
  const writes = gh._log.filter((row) => row.op === 'commitFiles').length;
  await assert.rejects(
    () => openVaultAssembly(gh, repo, ASM, { branch: 'main' }),
    (err) => {
      assert.equal(err.code, UNSUPPORTED_VAULT_CODE);
      assert.equal(err.message, UNSUPPORTED_VAULT_COPY);
      assert.equal(err.version, 7);
      return true;
    },
  );
  const out = await runVaultUpgrade({ adapter: gh, repo, ref: 'main', confirm: true });
  assert.equal(out.status, 'error');
  assert.equal(out.code, UNSUPPORTED_VAULT_CODE);
  assert.equal(out.error, UNSUPPORTED_VAULT_COPY);
  assert.equal(out.message, UNSUPPORTED_VAULT_COPY);
  assert.equal(gh._log.filter((row) => row.op === 'commitFiles').length, writes);
});

test('a fake registered step runs only through the hook, and only with confirm', async () => {
  const { gh, repo } = seed(1);
  let calls = 0;
  const unregister = registerVaultUpgrade(1, async (ctx) => {
    calls += 1;
    assert.equal(ctx.fromVersion, 1);
    assert.equal(ctx.confirm, true);
    assert.equal(ctx.repo.name, repo.name);
    return { status: 'upgraded', fromVersion: ctx.fromVersion };
  });
  try {
    assert.equal(vaultUpgrades.size, 1);
    const refused = await runVaultUpgrade({ adapter: gh, repo, ref: 'main', confirm: false });
    assert.equal(calls, 0);
    assert.equal(refused.code, 'confirm_required');
    const ran = await runVaultUpgrade({ adapter: gh, repo, ref: 'main', confirm: true });
    assert.equal(calls, 1);
    assert.equal(ran.status, 'upgraded');
    assert.equal(ran.fromVersion, 1);
    const current = await runVaultUpgrade({
      adapter: seed(2).gh,
      repo: seed(2).repo,
      ref: 'main',
      confirm: true,
    });
    assert.equal(current.status, 'already_upgraded');
    assert.equal(calls, 1);
    await assert.rejects(
      () => openVaultAssembly(gh, repo, ASM, { branch: 'main' }),
      (err) => err?.code === UNSUPPORTED_VAULT_CODE && err?.message === UNSUPPORTED_VAULT_COPY,
    );
    assert.equal(calls, 1);
  } finally {
    unregister();
  }
  assert.equal(vaultUpgrades.size, 0);
  const after = await runVaultUpgrade({ adapter: gh, repo, ref: 'main', confirm: true });
  assert.equal(after.code, UNSUPPORTED_VAULT_CODE);
  assert.equal(calls, 1);
});
});

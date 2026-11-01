/**
 * App.jsx host wiring: every git document carries `vaultLayout`
 * (docs/git-integration.md §7). Without it Save mis-routed to the v1 writer
 * and the Save button read "Nothing to save".
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const APP = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');

function sliceFn(startNeedle, endNeedle) {
  const start = APP.indexOf(startNeedle);
  const end = APP.indexOf(endNeedle, start + startNeedle.length);
  assert.ok(start >= 0 && end > start, `missing ${startNeedle}`);
  return APP.slice(start, end);
}

test('every seed stamps the layout through the shared helper', () => {
  for (const [start, end] of [
    ['const handleNewAssembly = async', 'const applySeededAssembly = async'],
    ['const seedOpenAssembly = async', 'refreshGenRef.current += 1;'],
    ['const seedAgentAssembly = async', 'const agentGitReadContext'],
  ]) {
    const seed = sliceFn(start, end);
    assert.match(seed, /newAssemblyVaultLayout\(source, assemblyRef\.current\)/, start);
    assert.match(seed, /vaultLayout/, start);
  }
});

test('handleGitCommit resolves a missing layout before routing and never guesses the v1 writer', () => {
  const fn = sliceFn('const handleGitCommit = async', 'if (isV2PlanSaveDoc(doc)) return handleV2PlanSave(message);');
  assert.match(fn, /docNeedsVaultLayout\(doc\)/);
  assert.match(fn, /await ensureDocVaultLayout\(\)/);
  assert.match(fn, /gitOpCatchResult\(err, 'Could not read the vault layout'\)/);
});

test('ensureDocVaultLayout reads the vault and writes nothing', () => {
  const fn = sliceFn('const ensureDocVaultLayout = async', 'const handleGitCommit = async');
  assert.match(fn, /ensureGitVault\(\{ create: false \}\)/);
  assert.match(fn, /checkVaultVersion\(/);
  assert.match(fn, /NO_REPO_YET_COPY/);
  assert.match(fn, /vaultLayoutFromDetection\(detected\)/);
  assert.doesNotMatch(fn, /flushGitOps|enqueueGit|commitFiles|writeVaultCommit|executePlanSave|ensureGitVault\(\{\s*create:\s*true/);
  // The heal runs on connect, keyed like the other vault effects.
  assert.match(fn, /useEffect\(/);
  assert.match(fn, /\[githubConnected, assemblyDoc, authLoading, bootEpoch, bootResume\]/);
});

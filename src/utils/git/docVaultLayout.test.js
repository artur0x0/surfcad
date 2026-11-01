import assert from 'node:assert/strict';
import test from 'node:test';
import {
  docNeedsVaultLayout,
  newAssemblyVaultLayout,
  vaultLayoutFromDetection,
} from './docVaultLayout.js';
import { isV2PlanSaveDoc } from './executePlanSave.js';

const ID = '2026-10-22-05-00-00-0001-aa01';

test('a new git document is born v2 unless the open document is legacy', () => {
  assert.equal(newAssemblyVaultLayout('git', null), 'v2');
  assert.equal(newAssemblyVaultLayout('git', { vaultLayout: 'v2' }), 'v2');
  assert.equal(newAssemblyVaultLayout('git', { source: 'git' }), 'v2');
  assert.equal(newAssemblyVaultLayout('git', { vaultLayout: 'legacy' }), 'legacy');
  assert.equal(newAssemblyVaultLayout('local', { vaultLayout: 'legacy' }), undefined);
  assert.equal(newAssemblyVaultLayout('local', null), undefined);
});

test('a stamped new document is a plan-save document from birth', () => {
  const doc = { id: ID, source: 'git', vaultLayout: newAssemblyVaultLayout('git', null) };
  assert.equal(isV2PlanSaveDoc(doc), true);
  assert.equal(docNeedsVaultLayout(doc), false);
});

test('docNeedsVaultLayout names only unstamped git documents', () => {
  assert.equal(docNeedsVaultLayout({ id: ID, source: 'git' }), true);
  assert.equal(docNeedsVaultLayout({ id: ID, source: 'git', vaultLayout: null }), true);
  assert.equal(docNeedsVaultLayout({ id: ID, source: 'git', vaultLayout: 'v1' }), true);
  assert.equal(docNeedsVaultLayout({ id: ID, source: 'git', vaultLayout: 'v2' }), false);
  assert.equal(docNeedsVaultLayout({ id: ID, source: 'git', vaultLayout: 'legacy' }), false);
  assert.equal(docNeedsVaultLayout({ id: ID, source: 'local' }), false);
  assert.equal(docNeedsVaultLayout(null), false);
  assert.equal(docNeedsVaultLayout(undefined), false);
});

test('an unstamped git document is not a plan-save document (the bug this guards)', () => {
  assert.equal(isV2PlanSaveDoc({ id: ID, source: 'git' }), false);
});

test('detection maps to the two layouts; no repo yet is v2', () => {
  assert.equal(vaultLayoutFromDetection({ state: 'current', version: 2 }), 'v2');
  assert.equal(vaultLayoutFromDetection({ state: 'unmarked', version: null }), 'v2');
  assert.equal(vaultLayoutFromDetection({ state: 'unsupported', version: 1 }), 'legacy');
  assert.equal(vaultLayoutFromDetection({ state: 'upgrade', version: 1 }), 'legacy');
  assert.equal(vaultLayoutFromDetection({ layout: 'v2', markerVersion: 2 }), 'v2');
  assert.equal(vaultLayoutFromDetection({ layout: 'legacy', markerVersion: 1 }), 'legacy');
  assert.equal(vaultLayoutFromDetection(null), 'v2');
  assert.equal(vaultLayoutFromDetection(undefined), 'v2');
  assert.equal(vaultLayoutFromDetection({}), 'v2');
});

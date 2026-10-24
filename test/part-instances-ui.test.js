import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { partDeleteDialogCopy, partInstanceInfo } from '../src/utils/assembly.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

test('partInstanceInfo: the primary counts its placements, an instance names its definition', () => {
  const rows = [
    { id: 'r1', name: 'Roller', order: 0 },
    { id: 'r2', name: 'Roller (2)', order: 1, instanceOf: 'r1' },
    { id: 'r3', name: 'Roller (3)', order: 2, instanceOf: 'r1' },
    { id: 'f1', name: 'Frame', order: 3 },
  ];
  const info = partInstanceInfo(rows);
  assert.deepEqual(info.get('r1'), { isInstance: false, count: 3, definitionName: 'Roller' });
  assert.deepEqual(info.get('r2'), { isInstance: true, count: 3, definitionName: 'Roller' });
  assert.deepEqual(info.get('f1'), { isInstance: false, count: 1, definitionName: 'Frame' });
});

test('partInstanceInfo: without a primary row the lowest-order sibling names the definition', () => {
  const rows = [
    { id: 'r3', name: 'Roller (3)', order: 5, instanceOf: 'r1' },
    { id: 'r2', name: 'Roller (2)', order: 1, instanceOf: 'r1' },
  ];
  const info = partInstanceInfo(rows);
  assert.equal(info.get('r2').definitionName, 'Roller (3)');
  assert.equal(info.get('r3').definitionName, 'Roller (2)');
  assert.equal(info.get('r2').count, 2);
  assert.equal(info.get('r2').isInstance, true);
});

test('partDeleteDialogCopy: other instances make it a placement removal with no repo option', () => {
  const one = partDeleteDialogCopy({ name: 'Roller', canDeleteRepo: true, otherInstances: 1 });
  assert.equal(one.offerRepo, false);
  assert.match(one.message, /Remove this placement of Roller\?/);
  assert.match(one.message, /1 other instance,/);
  assert.match(one.message, /script is kept/);
  const two = partDeleteDialogCopy({ name: 'Roller', canDeleteRepo: false, otherInstances: 2 });
  assert.match(two.message, /2 other instances/);
});

test('partDeleteDialogCopy: the last row keeps the existing copy and the repo option', () => {
  const repo = partDeleteDialogCopy({ name: 'Roller', canDeleteRepo: true, otherInstances: 0 });
  assert.equal(repo.offerRepo, true);
  assert.equal(repo.message, 'Remove Roller from this assembly only, or also delete its file from the repo.');
  const local = partDeleteDialogCopy({ name: 'Roller', canDeleteRepo: false });
  assert.equal(local.offerRepo, false);
  assert.equal(local.message, 'Remove Roller from this assembly?');
});

test('Parts row has Add instance, the instance caption and the placement count', () => {
  const feed = read('src/components/PartFeed.jsx');
  assert.match(feed, /onAddInstance = null/);
  assert.match(feed, /data-ui-action="data-part-add-instance"/);
  assert.match(feed, /data-part-add-instance=\{row\.id\}/);
  assert.match(feed, /onAddInstance\(row\.id\)/);
  assert.match(feed, /<CopyPlus size=\{16\} \/>/);
  assert.match(feed, /data-part-instance-of=\{row\.instanceOf \|\| ''\}/);
  assert.match(feed, /`instance of \$\{/);
  assert.match(feed, /data-part-instance-count=/);
  assert.match(feed, /const instanceInfo = partInstanceInfo\(rows\)/);
});

test('delete dialog reads partDeleteDialogCopy and hides the repo button while other instances remain', () => {
  const feed = read('src/components/PartFeed.jsx');
  assert.match(feed, /data-part-delete-message=""/);
  assert.match(feed, /\{deleteCopy\.message\}/);
  assert.match(feed, /\{deleteCopy\.offerRepo && \(/);
  assert.match(feed, /otherInstances: pendingDelete\.otherInstances \|\| 0/);
  assert.match(feed, /\(pending\.otherInstances \|\| 0\) > 0\)\) return;/);
  assert.doesNotMatch(feed, /from this assembly only, or also delete its file from the repo\.`\s*:\s*`Remove/);
});

test('App wires the button to the same minting path as insert_part instance:true', () => {
  const app = read('src/App.jsx');
  assert.match(app, /onAddInstance=\{\(partId\) => \{ agentInsertInstance\(\{ partId \}\); \}\}/);
  assert.match(app, /if \(instance === true\) return agentInsertInstance\(\{ partId, position \}\);/);
  const document = read('src/agent/commands/document.js');
  assert.match(document, /uiEntry: \['data-git-open-insert', 'data-part-add-instance'\]/);
});

test('ui-map names the control, the caption and the count', () => {
  const map = read('docs/ui-map.md');
  assert.match(map, /data-part-add-instance/);
  assert.match(map, /data-part-instance-of/);
  assert.match(map, /data-part-instance-count/);
  assert.match(map, /data-part-delete-message/);
});

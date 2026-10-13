import assert from 'node:assert/strict';
import test from 'node:test';
import { deletePartScript } from '../src/utils/assemblyStore.js';
import {
  partThumbnailKey,
  planPartThumbnails,
} from '../src/utils/partThumbnailPlan.js';
import {
  clearPartThumbnails,
  forgetPartThumbnails,
  getPartThumbnail,
  putPartThumbnail,
} from '../src/utils/partThumbnailStore.js';

const SHEET = 'let part = Manifold.cube([40, 28, 2], true);\nreturn part;\n';
const LOFT = 'let part = Manifold.cube([14, 14, 36], true);\nreturn part;\n';
const MESH = { vertProperties: [0, 0, 0, 1, 0, 0, 0, 1, 0], triVerts: [0, 1, 2] };
const PNG = 'data:image/png;base64,abc';

test.beforeEach(async () => {
  await clearPartThumbnails();
});

test('the cache key is the part id plus a hash of the script', () => {
  const sheet = partThumbnailKey('sheet', SHEET);
  const loft = partThumbnailKey('loft', SHEET);
  const edited = partThumbnailKey('sheet', LOFT);
  assert.ok(sheet);
  assert.notEqual(sheet, loft);
  assert.notEqual(sheet, edited);
  assert.equal(partThumbnailKey('sheet', SHEET), sheet);
  assert.equal(partThumbnailKey('', SHEET), '');
});

test('a stored thumbnail is not rebuilt, and a script change is', () => {
  const hidden = [{ id: 'sheet', visible: false }, { id: 'loft', visible: false }];
  const scripts = { sheet: SHEET, loft: LOFT };
  const cached = new Set([partThumbnailKey('sheet', SHEET)]);
  const kept = planPartThumbnails({
    parts: hidden,
    scripts,
    cachedKeys: cached,
    runs: {},
  });
  assert.deepEqual(kept.map((job) => job.id), ['loft']);
  assert.equal(kept[0].mode, 'execute');
  const edited = planPartThumbnails({
    parts: [{ id: 'sheet', visible: false }],
    scripts: { sheet: LOFT },
    cachedKeys: cached,
    runs: {},
  });
  assert.equal(edited.length, 1);
  assert.equal(edited[0].mode, 'execute');
  assert.equal(edited[0].script, LOFT);
});

test('a hidden part is executed off the view even when an old mesh is still around', () => {
  const jobs = planPartThumbnails({
    parts: [{ id: 'sheet', visible: false }],
    scripts: { sheet: SHEET },
    cachedKeys: new Set(),
    runs: { sheet: { ok: true, mesh: MESH } },
  });
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].mode, 'execute');
  assert.equal(jobs[0].mesh, undefined);
});

test('a visible part snapshots its mesh and waits when the mesh is not ready', () => {
  const ready = planPartThumbnails({
    parts: [{ id: 'bracket', visible: true }],
    scripts: { bracket: SHEET },
    cachedKeys: new Set(),
    runs: { bracket: { ok: true, mesh: MESH } },
  });
  assert.equal(ready.length, 1);
  assert.equal(ready[0].mode, 'snapshot');
  assert.equal(ready[0].mesh, MESH);
  const waiting = planPartThumbnails({
    parts: [{ id: 'bracket', visible: true }],
    scripts: { bracket: SHEET },
    cachedKeys: new Set(),
    runs: {},
  });
  assert.deepEqual(waiting, []);
});

test('a blank script is not a thumbnail job', () => {
  const jobs = planPartThumbnails({
    parts: [{ id: 'sheet', visible: false }],
    scripts: { sheet: '// empty\n' },
    cachedKeys: new Set(),
    runs: {},
  });
  assert.deepEqual(jobs, []);
});

test('put keeps one hash per part, and delete drops that part only', async () => {
  assert.equal(await putPartThumbnail('sheet', SHEET, PNG), true);
  assert.equal(await putPartThumbnail('loft', LOFT, PNG), true);
  assert.equal(await getPartThumbnail('sheet', SHEET), PNG);
  assert.equal(await putPartThumbnail('sheet', LOFT, 'data:image/png;base64,next'), true);
  assert.equal(await getPartThumbnail('sheet', SHEET), null);
  assert.equal(await getPartThumbnail('sheet', LOFT), 'data:image/png;base64,next');
  assert.equal(await getPartThumbnail('loft', LOFT), PNG);
  assert.equal(await putPartThumbnail('sheet', SHEET, 'nope'), false);
  await forgetPartThumbnails('sheet');
  assert.equal(await getPartThumbnail('sheet', LOFT), null);
  assert.equal(await getPartThumbnail('loft', LOFT), PNG);
});

test('deleting a part script drops its thumbnails', async () => {
  await putPartThumbnail('gone', SHEET, PNG);
  await putPartThumbnail('kept', LOFT, PNG);
  await deletePartScript('gone');
  assert.equal(await getPartThumbnail('gone', SHEET), null);
  assert.equal(await getPartThumbnail('kept', LOFT), PNG);
});

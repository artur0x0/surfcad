import assert from 'node:assert/strict';
import { test } from 'node:test';
import { partListSubtitles, partRowSubtitles } from '../src/utils/git/partListSubtitle.js';

// ui-bug-triage #4: a v2 vault stores parts by id, so the Parts strip shows no
// name-derived path under a row; the real path is a tooltip instead.
const synced = { id: 'parts/2026-10-22-02-44-00-0818-dd67.js', name: 'Frame', isSynced: true };
const unsynced = { id: '2026-10-22-02-44-00-0818-aaaa', name: 'Rear Wheel', isSynced: false };
const withPath = { id: '2026-10-22-02-44-00-0818-bbbb', name: 'Fork', path: 'parts/2026-10-22-02-44-00-0818-bbbb.js' };

test('v2: no subtitle under any row, the real id-based path on the name', () => {
  const { subtitles, paths } = partRowSubtitles([synced, unsynced, withPath], 'v2');
  assert.equal(subtitles.size, 0);
  assert.equal(paths.get(synced.id), synced.id);
  assert.equal(paths.get(withPath.id), withPath.path);
  assert.equal(paths.get(unsynced.id), '', 'an unsynced v2 part has no file yet, so no fictional parts/<Name>.js');
});

test('legacy and local documents keep the Add to Repo preview subtitle', () => {
  for (const layout of ['legacy', null, undefined]) {
    const { subtitles, paths } = partRowSubtitles([unsynced], layout);
    assert.deepEqual(subtitles, partListSubtitles([unsynced]), String(layout));
    assert.equal(subtitles.get(unsynced.id), 'parts/Rear Wheel.js');
    assert.equal(paths.size, 0);
  }
});

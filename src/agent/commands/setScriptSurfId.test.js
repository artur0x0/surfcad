import assert from 'node:assert/strict';
import test from 'node:test';
import { createSurfcadBridge } from '../../utils/agentBridge.js';
import { withSurfId } from '../../utils/git/surfId.js';

const SURF_ID = '2026-01-01-00-00-00-0000-abcd';
const HEADERED = withSurfId('return Manifold.cube([1,1,1], true);', SURF_ID);
const BODY = 'return Manifold.cube([2, 2, 2], true);';

test('set_script keeps the surf-id header for the active part', async () => {
  let buffer = HEADERED;
  const api = createSurfcadBridge({
    resolve: () => ({
      getScript: () => buffer,
      setEditor(src) {
        buffer = src;
      },
      readHistory: () => ({ commits: [], head: -1 }),
      writeHistory() {},
      readActivePartSurfId: () => SURF_ID,
      async execute() {
        return {
          ok: true,
          errors: [],
          volume: 8,
          bbox: null,
          partName: 'Part',
        };
      },
      screenshot: () => 'data:image/png;base64,',
    }),
  });

  await api.call('set_script', { source: BODY });
  const read = await api.call('get_script', {});
  assert.equal(read.ok, true);
  assert.match(read.result.source, /^\/\/ @surf-id /);
  assert.ok(read.result.source.includes(SURF_ID));
  assert.ok(read.result.source.includes('cube([2, 2, 2]'));
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSurfcadBridge } from '../../utils/agentBridge.js';
import { withSurfId } from '../../utils/git/surfId.js';
import { CODE_BEGIN, CODE_END, wrapRawScript } from '../../utils/wrapRawScript.js';

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

test('set_script injects a non-timestamp surf id without requiring the mint regex', async () => {
  const uuid = '550e8400-e29b-41d4-a716-446655440000';
  let buffer = BODY;
  const api = createSurfcadBridge({
    resolve: () => ({
      getScript: () => buffer,
      setEditor(src) {
        buffer = src;
      },
      readHistory: () => ({ commits: [], head: -1 }),
      writeHistory() {},
      readActivePartSurfId: () => uuid,
      async execute() {
        return { ok: true, errors: [], volume: 8, bbox: null, partName: 'Part' };
      },
      screenshot: () => 'data:image/png;base64,',
    }),
  });
  await api.call('set_script', { source: BODY });
  const read = await api.call('get_script', {});
  assert.match(read.result.source, new RegExp(`^// @surf-id ${uuid}`));
});

test('set_script wrap keeps @surf-id first, outside Code, and is idempotent', async () => {
  const uuid = '550e8400-e29b-41d4-a716-446655440000';
  const raw = 'let part = Manifold.cube([8, 8, 8], true);\nreturn part;\n';
  let buffer = '';
  const api = createSurfcadBridge({
    resolve: () => ({
      getScript: () => buffer,
      setEditor(src) {
        buffer = wrapRawScript(src);
      },
      readHistory: () => ({ commits: [], head: -1 }),
      writeHistory() {},
      readActivePartSurfId: () => uuid,
      async execute() {
        return { ok: true, errors: [], volume: 512, bbox: null, partName: 'Part' };
      },
      screenshot: () => 'data:image/png;base64,',
    }),
  });
  await api.call('set_script', { source: raw });
  const first = (await api.call('get_script', {})).result.source;
  assert.match(first, new RegExp(`^// @surf-id ${uuid}\\n`));
  assert.ok(first.indexOf('// @surf-id') < first.indexOf(CODE_BEGIN));
  assert.ok(first.includes(CODE_BEGIN));
  assert.ok(first.includes(CODE_END));
  assert.equal(first.slice(first.indexOf(CODE_BEGIN)).includes('@surf-id'), false);
  await api.call('set_script', { source: first });
  assert.equal((await api.call('get_script', {})).result.source, first);
  await api.call('set_script', { source: raw });
  assert.equal((await api.call('get_script', {})).result.source, first);
});

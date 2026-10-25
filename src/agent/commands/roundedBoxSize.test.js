/**
 * insert_rounded_box used to drop width, depth and height: those names are
 * not sheet fields, and coerceHelperParams kept only sx, sy, sz. The box
 * was always the 50×30×20 default.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSurfcadBridge } from '../../utils/agentBridge.js';
import { composeHelperInsert, HELPER_PALETTE_ITEMS } from '../../utils/helperPaletteSnippets.js';
import { coerceHelperParams, validateHelperParams } from '../helperPaletteAgent.js';
import { runScript } from '../../lib/surfcad/index.js';

const item = HELPER_PALETTE_ITEMS.find((row) => row.id === 'roundedBox');

function host() {
  let wrote = '';
  return {
    wrote: () => wrote,
    getScript: () => '',
    setEditor(src) { wrote = src; },
    readHistory: () => ({ commits: [], head: -1 }),
    writeHistory: () => {},
    execute: async () => ({ ok: true, errors: [], volume: 1, bbox: null, partName: '' }),
    prepareHelperInsert({ helperId, params }) {
      const source = composeHelperInsert('', helperId, null, params);
      return source ? { source } : { error: { code: 'insert_failed', message: 'empty' } };
    },
  };
}

test('width, depth and height size the rounded box, and sx, sy, sz still do', async () => {
  const h = host();
  const api = createSurfcadBridge({ resolve: () => h });
  const sized = await api.call('insert_rounded_box', {
    width: 80, depth: 10, height: 6, edgeRadius: 1, segments: 8,
  });
  assert.equal(sized.ok, true, JSON.stringify(sized.error));
  assert.match(h.wrote(), /roundedBox\(\[80, 10, 6\], 1, 8\)/);

  const named = await api.call('insert_rounded_box', { sx: 12, sy: 14, sz: 16, edgeRadius: 2, segments: 4 });
  assert.equal(named.ok, true);
  assert.match(h.wrote(), /roundedBox\(\[12, 14, 16\], 2, 4\)/);

  const both = await api.call('insert_rounded_box', {
    width: 80, sx: 12, depth: 10, sy: 14, height: 6, sz: 16, edgeRadius: 1, segments: 4,
  });
  assert.equal(both.ok, true);
  assert.match(h.wrote(), /roundedBox\(\[80, 10, 6\], 1, 4\)/);
});

test('a rounded box built from width, depth and height has that size', async () => {
  const script = composeHelperInsert('', 'roundedBox', null, {
    width: 80, depth: 10, height: 6, edgeRadius: 1, segments: 8,
  });
  const ran = await runScript(script);
  assert.equal(ran.status, 'NoError', ran.status);
  const box = ran.boundingBox;
  assert.ok(Math.abs(box.max[0] - 40) < 0.05 && Math.abs(box.min[0] + 40) < 0.05, JSON.stringify(box));
  assert.ok(Math.abs(box.max[1] - 5) < 0.05 && Math.abs(box.min[1] + 5) < 0.05, JSON.stringify(box));
  assert.ok(Math.abs(box.max[2] - 3) < 0.05 && Math.abs(box.min[2] + 3) < 0.05, JSON.stringify(box));
  ran.manifold?.delete?.();
});

test('a rounded box size below 0.1 mm is bad_args', () => {
  const params = coerceHelperParams(item, { width: 0, depth: 10, height: 6 });
  const bad = validateHelperParams(item, params);
  assert.equal(bad?.code, 'bad_args');
  assert.match(bad.message, /Size X/);
});

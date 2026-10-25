/**
 * insert_hole and insert_tap_drill_hole used to cut through-all only.
 * The hole sheet had no depth, and a call with no picked face forced
 * through: true. A depth now cuts a blind hole. Omitting it stays through.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSurfcadBridge } from '../../utils/agentBridge.js';
import { composeHelperInsert, starterCubeScript, HELPER_PALETTE_ITEMS } from '../../utils/helperPaletteSnippets.js';
import { getManifoldModule, runScript } from '../../lib/surfcad/index.js';
import { coerceHelperParams, validateHelperParams } from '../helperPaletteAgent.js';

const hole = HELPER_PALETTE_ITEMS.find((row) => row.id === 'hole');
const tap = HELPER_PALETTE_ITEMS.find((row) => row.id === 'tapDrillHole');

function plate() {
  return composeHelperInsert('', 'cube', null, { width: 40, depth: 30, height: 20, center: true });
}

function host() {
  let wrote = '';
  let buffer = plate();
  return {
    wrote: () => wrote,
    getScript: () => buffer,
    setEditor(src) { wrote = src; buffer = src; },
    readHistory: () => ({ commits: [], head: -1 }),
    writeHistory: () => {},
    execute: async () => ({ ok: true, errors: [], volume: 1, bbox: null, partName: '' }),
    prepareHelperInsert({ helperId, params }) {
      const source = composeHelperInsert(buffer, helperId, null, params);
      return source ? { source } : { error: { code: 'insert_failed', message: 'empty' } };
    },
  };
}

function volumeNear(solid, at, size = 0.4) {
  const { Manifold } = getManifoldModule();
  const box = Manifold.cube([size, size, size], true).translate(at);
  const hit = Manifold.intersection(solid, box);
  const volume = hit.volume();
  hit.delete();
  box.delete();
  return volume;
}

async function insert(name, args) {
  const h = host();
  const api = createSurfcadBridge({ resolve: () => h });
  const env = await api.call(name, args);
  assert.equal(env.ok, true, JSON.stringify(env.error));
  return h.wrote();
}

test('insert_hole and insert_tap_drill_hole default to through and honour a blind depth', async () => {
  const through = await insert('insert_hole', { size: 'M6' });
  assert.match(through, /holeSpan\(/);
  assert.match(through, /clearanceHole\(part, \w+, 0, 0, 'M6', \w+, 'normal'\)/);

  const blind = await insert('insert_hole', { size: 'M6', depth: 6 });
  assert.match(blind, /clearanceHole\(part, \w+, 0, 0, 'M6', 6, 'normal'\)/);
  assert.doesNotMatch(blind, /holeSpan\(/);

  const tapThrough = await insert('insert_tap_drill_hole', { size: 'M5' });
  assert.match(tapThrough, /tapDrillHole\(part, \w+, 0, 0, 'M5'\);/);

  const tapBlind = await insert('insert_tap_drill_hole', { size: 'M5', depth: 6 });
  assert.match(tapBlind, /tapDrillHole\(part, \w+, 0, 0, 'M5', 6\)/);
});

test('insert_hole depth on a tap drill writes that span', async () => {
  const script = composeHelperInsert(plate(), 'hole', null, {
    holeType: 'tapDrill', size: 'M5', depth: 8, through: false,
  });
  assert.match(script, /tapDrillHole\(part, \w+, 0, 0, 'M5', 8\)/);
});

test('a blind hole stops short of the far face and a through hole does not', async () => {
  const blindSrc = composeHelperInsert(plate(), 'hole', null, { size: 'M6', depth: 6, through: false });
  const throughSrc = composeHelperInsert(plate(), 'tapDrillHole', null, { size: 'M6' });
  const blind = await runScript(blindSrc);
  const through = await runScript(throughSrc);
  assert.equal(blind.status, 'NoError', blind.status);
  assert.equal(through.status, 'NoError', through.status);
  // Cube is 20 mm tall, centered. Depth 6 enters from the top (z = 10)
  // and stops about 5 mm in. z = 7 is in the hole; z = 0 is still solid.
  assert.ok(volumeNear(blind.manifold, [0, 0, 7]) < 1e-4, 'blind hole near the face');
  assert.ok(volumeNear(blind.manifold, [0, 0, 0]) > 0.02, 'blind hole leaves the far side');
  assert.ok(volumeNear(through.manifold, [0, 0, 0]) < 1e-4, 'through hole reaches the middle');
  assert.ok(volumeNear(through.manifold, [0, 0, -8]) < 1e-4, 'through hole reaches the far side');
  blind.manifold?.delete?.();
  through.manifold?.delete?.();
});

test('a hole depth below 0.1 mm is bad_args and an omitted depth is not', () => {
  assert.equal(validateHelperParams(hole, coerceHelperParams(hole, { size: 'M6' })), null);
  assert.equal(validateHelperParams(tap, coerceHelperParams(tap, { size: 'M5' })), null);
  const shallow = validateHelperParams(hole, coerceHelperParams(hole, { depth: 0 }));
  assert.equal(shallow?.code, 'bad_args');
  assert.match(shallow.message, /Depth/);
  const badTap = validateHelperParams(tap, coerceHelperParams(tap, { depth: -2 }));
  assert.equal(badTap?.code, 'bad_args');
});

test('starter cube plus a blind tap drill is the same script the tool writes', () => {
  const script = composeHelperInsert(starterCubeScript(), 'tapDrillHole', null, { size: 'M3', depth: 4, through: false });
  assert.match(script, /tapDrillHole\(part, \w+, 0, 0, 'M3', 4\)/);
});

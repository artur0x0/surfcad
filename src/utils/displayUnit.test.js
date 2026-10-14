import assert from 'node:assert/strict';
import test from 'node:test';
import { confirmFeatureEdit, openFeatureEdit } from './featureEdit.js';
import { parseFeatureMarkers } from './featureMarkers.js';
import {
  DISPLAY_UNIT_KEY,
  commitDisplayLength,
  commitDisplayNumber,
  displayToMm,
  formatDisplayAngle,
  formatDisplayDelta,
  formatDisplayLength,
  formatDisplayNumber,
  getDisplayUnit,
  lengthCaption,
  lengthToDisplay,
  loadDisplayUnit,
  saveDisplayUnit,
  setDisplayUnit,
  subscribeDisplayUnit,
} from './displayUnit.js';

function memoryStorage(initial) {
  const map = new Map(Object.entries(initial || {}));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
  };
}

test('display unit defaults to mm and persists in the given storage', () => {
  const mem = memoryStorage();
  assert.equal(loadDisplayUnit(mem), 'mm');
  assert.equal(saveDisplayUnit('in', mem), 'in');
  assert.equal(mem.getItem(DISPLAY_UNIT_KEY), 'in');
  assert.equal(loadDisplayUnit(mem), 'in');
  assert.equal(loadDisplayUnit(memoryStorage({ [DISPLAY_UNIT_KEY]: 'nope' })), 'mm');
});

test('lengths convert and angles do not', () => {
  assert.equal(formatDisplayLength(30, 'mm'), '30 mm');
  assert.equal(formatDisplayLength(30, 'in'), '1.1811 in');
  assert.equal(formatDisplayLength(12, 'in'), '0.4724 in');
  assert.equal(formatDisplayLength(24, 'in'), '0.9449 in');
  assert.equal(formatDisplayDelta(-30, 'mm'), '-30 mm');
  assert.equal(formatDisplayDelta(0, 'mm'), '0 mm');
  assert.equal(formatDisplayDelta(25.4, 'in'), '+1 in');
  assert.equal(formatDisplayAngle(90), '90°');
  assert.equal(formatDisplayAngle(0), '0°');
  assert.equal(formatDisplayAngle(90.125), '90.125°');
  assert.equal(formatDisplayAngle(90).includes('mm'), false);
  assert.equal(formatDisplayAngle(90).includes('in'), false);
});

test('formatDisplayNumber keeps at most 4 decimals and trims trailing zeros', () => {
  assert.equal(formatDisplayNumber(0.1 / 25.4), '0.0039');
  assert.equal(formatDisplayNumber(Number('0.003937007874015749')), '0.0039');
  assert.equal(formatDisplayNumber(30), '30');
  assert.equal(formatDisplayNumber(1.5), '1.5');
  assert.equal(formatDisplayNumber(12.34), '12.34');
  assert.equal(formatDisplayNumber(1.2300), '1.23');
  assert.equal(formatDisplayNumber(0.0001), '0.0001');
  assert.equal(formatDisplayNumber(0.00001), '0');
  assert.equal(formatDisplayNumber(-0.00004), '0');
  assert.equal(formatDisplayNumber(-1.5), '-1.5');
  assert.equal(formatDisplayNumber(12345.678912), '12345.6789');
  assert.equal(formatDisplayNumber(Number.NaN), '');
  assert.equal(formatDisplayNumber(''), '');
  assert.equal(formatDisplayNumber(30 / 25.4).includes('e'), false);
});

test('echoing a formatted length keeps the stored millimetres', () => {
  const stored = 0.1;
  const shown = formatDisplayNumber(lengthToDisplay(stored, 'in'));
  assert.equal(shown, '0.0039');
  assert.equal(commitDisplayLength(shown, stored, 'in'), stored);
  assert.equal(commitDisplayLength('0.00390', stored, 'in') === stored, false);
  assert.equal(commitDisplayLength('0.01', stored, 'in'), 0.254);
  assert.equal(commitDisplayLength('', stored, 'in'), '');
  assert.equal(commitDisplayNumber('90', 90.0000000001), 90.0000000001);
  assert.equal(commitDisplayNumber('90.5', 90.0000000001), 90.5);
});

test('typed display numbers convert back to millimetres', () => {
  assert.equal(displayToMm(30, 'mm'), 30);
  assert.equal(displayToMm(1, 'in'), 25.4);
  assert.equal(displayToMm(-0.5, 'in'), -12.7);
  assert.equal(Number.isFinite(displayToMm('', 'in')), false);
  assert.equal(displayToMm(lengthToDisplay(25.4, 'in'), 'in'), 25.4);
});

test('length captions carry the unit suffix', () => {
  assert.equal(lengthCaption('Distance', 'mm'), 'Distance mm');
  assert.equal(lengthCaption('Radius', 'in'), 'Radius in');
  assert.equal(lengthCaption('ΔX', 'in'), 'ΔX in');
  assert.equal(lengthCaption('Distance mm', 'mm'), 'Distance mm');
  assert.equal(lengthCaption('', 'in'), 'in');
});

const CHAMFER_SCRIPT = `let part = Manifold.cube([40, 30, 20], true);
// --- chamfer-mode begin ---
const selEdges = edgesBetween(part, 0, 2); // boundary edge 1
const path1 = makeSweepPath(selEdges); // edge→sweep path
part = filletAlongPath(part, path1, 0.1, { profile: 'chamfer' });
// --- chamfer-mode end ---
return part;
`;

test('an untouched converted field does not rewrite the script', () => {
  const feature = parseFeatureMarkers(CHAMFER_SCRIPT).find((item) => item.kind === 'chamfer');
  assert.ok(feature);
  const opened = openFeatureEdit(CHAMFER_SCRIPT, feature);
  assert.equal(opened.ok, true);
  const stored = opened.fields.chamfer;
  assert.equal(stored, 0.1);
  const shown = formatDisplayNumber(lengthToDisplay(stored, 'in'));
  assert.equal(shown, '0.0039');
  const kept = commitDisplayLength(shown, stored, 'in');
  assert.equal(kept, stored);
  const untouched = confirmFeatureEdit(CHAMFER_SCRIPT, feature, {
    fields: { ...opened.fields, chamfer: kept },
  });
  assert.equal(untouched.ok, true);
  assert.equal(untouched.changed, false);
  assert.equal(untouched.buffer, CHAMFER_SCRIPT);
  assert.match(untouched.buffer, /filletAlongPath\(part, path1, 0\.1,/);

  const typed = commitDisplayLength('0.01', stored, 'in');
  assert.equal(typed, 0.254);
  const edited = confirmFeatureEdit(CHAMFER_SCRIPT, feature, {
    fields: { ...opened.fields, chamfer: typed },
  });
  assert.equal(edited.ok, true);
  assert.equal(edited.changed, true);
  assert.match(edited.buffer, /filletAlongPath\(part, path1, 0\.254,/);
  assert.equal(edited.buffer.includes('0.0039'), false);
});

test('the store notifies subscribers and is the global cache', () => {
  const mem = memoryStorage();
  const seen = [];
  const stop = subscribeDisplayUnit((unit) => seen.push(unit));
  assert.equal(setDisplayUnit('in', mem), 'in');
  assert.equal(getDisplayUnit(), 'in');
  assert.equal(setDisplayUnit('mm', mem), 'mm');
  stop();
  setDisplayUnit('in', mem);
  assert.deepEqual(seen, ['in', 'mm']);
  setDisplayUnit('mm', mem);
});

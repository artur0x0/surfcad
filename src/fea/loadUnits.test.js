import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MPA_PER_PSI,
  N_PER_LBF,
  formatLoadDisplay,
  fromDisplayLoad,
  loadUnitForSystem,
  toDisplayLoad,
} from './loadUnits.js';

test('imperial display uses pounds and psi', () => {
  assert.equal(N_PER_LBF, 4.4482216);
  assert.equal(MPA_PER_PSI, 0.00689476);
  assert.equal(loadUnitForSystem('force', 'mm'), 'N');
  assert.equal(loadUnitForSystem('force', 'in'), 'lb');
  assert.equal(loadUnitForSystem('pressure', 'mm'), 'MPa');
  assert.equal(loadUnitForSystem('pressure', 'in'), 'psi');
  assert.equal(loadUnitForSystem('force', undefined), 'N');
  assert.equal(toDisplayLoad(N_PER_LBF, 'lb'), 1);
  assert.equal(toDisplayLoad(MPA_PER_PSI, 'psi'), 1);
  assert.equal(fromDisplayLoad(1, 'lb'), N_PER_LBF);
  assert.equal(fromDisplayLoad(1, 'psi'), MPA_PER_PSI);
});

test('formatting a load does not walk on a repeated round trip', () => {
  const samples = [
    [200, 'N'],
    [200, 'lb'],
    [1, 'lb'],
    [10000, 'lb'],
    [2, 'MPa'],
    [1, 'psi'],
    [0.1, 'psi'],
    [-3, 'psi'],
    [50, 'psi'],
  ];
  for (const [si, unit] of samples) {
    const shown = formatLoadDisplay(si, unit);
    assert.equal(formatLoadDisplay(si, unit), shown, `${si} ${unit} stable`);
    const once = fromDisplayLoad(shown, unit);
    assert.equal(formatLoadDisplay(once, unit), shown, `${si} ${unit} once`);
    const twice = fromDisplayLoad(formatLoadDisplay(once, unit), unit);
    assert.equal(formatLoadDisplay(twice, unit), shown, `${si} ${unit} twice`);
    assert.ok(Math.abs(twice - once) <= Math.abs(once) * 1e-9 + 1e-9);
  }
  assert.equal(formatLoadDisplay(200, 'N'), '200');
  assert.notEqual(formatLoadDisplay(200, 'lb'), '200');
});

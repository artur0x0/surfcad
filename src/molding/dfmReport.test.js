import assert from 'node:assert/strict';
import test from 'node:test';
import { runScript } from '../lib/surfcad/index.js';
import { buildSolidGeometry } from '../utils/partSolidCache.js';
import { moldFitFromGeometry } from './fromGeometry.js';
import { DFM_NAME_PREVIEW, dfmReport } from './dfmReport.js';

function analysis(patch = {}) {
  return {
    kind: 'mold-analysis',
    fit: 'fixable',
    undercutCount: 2,
    pull: [0, 0, 1],
    pullSource: 'search',
    wall: {
      nominal: 2,
      nominalMethod: 'mode',
      thinCount: 1,
      thickCount: 0,
      max: 8,
    },
    moldDraft: {
      minDeg: 1,
      violationCount: 4,
      minDraftDeg: 0,
      ejectors: { pinCount: 2, sleeveCount: 0, pins: [{ id: 0 }], sleeves: [] },
    },
    sideActions: {
      slideCount: 1,
      lifterCount: 1,
      groups: [
        { kind: 'slide', pull: [1, 0, 0], triangles: [1, 2], regionIds: [0] },
        { kind: 'lifter', pull: [0, 0, 1], triangles: [3] },
      ],
    },
    parting: { lines: [] },
    ...patch,
  };
}

test('dfmReport lists the mold-analysis counts and no prices', () => {
  const report = dfmReport(analysis());
  assert.equal(report.framing, 'Budgetary analysis');
  assert.equal(report.binding, false);
  assert.match(report.disclaimer, /not a binding supplier DFM/i);
  assert.equal(report.fit, 'fixable');
  assert.equal(report.fitLabel, 'Fixable');
  assert.equal(report.undercutCount, 2);
  assert.deepEqual(report.pull, [0, 0, 1]);
  assert.equal(report.pullSource, 'search');
  assert.equal(report.wall.nominal, 2);
  assert.equal(report.wall.nominalMethod, 'mode');
  assert.equal(report.wall.thinCount, 1);
  assert.equal(report.wall.thickCount, 0);
  assert.equal(report.wall.max, 8);
  assert.equal(report.draft.violationCount, 4);
  assert.equal(report.draft.minDeg, 1);
  assert.equal(report.draft.minDraftDeg, 0);
  assert.equal(report.draft.heuristic, true);
  assert.equal(report.sideActions.slideCount, 1);
  assert.equal(report.sideActions.lifterCount, 1);
  assert.deepEqual(report.sideActions.groups, [
    { kind: 'slide', pull: [1, 0, 0] },
    { kind: 'lifter', pull: [0, 0, 1] },
  ]);
  assert.equal(report.ejectors.pinCount, 2);
  assert.equal(report.ejectors.sleeveCount, 0);
  assert.equal(report.ejectors.pins, undefined);
  const text = JSON.stringify(report);
  assert.doesNotMatch(text, /usd|dollar|\$|price|quote/i);
});

test('a missing nominal stays unknown and an override pull is kept', () => {
  const report = dfmReport(analysis({
    fit: 'good',
    undercutCount: 0,
    pull: [1, 0, 0],
    pullSource: 'override',
    wall: { nominal: null, nominalMethod: null, thinCount: 0, thickCount: 0, max: null },
  }));
  assert.equal(report.fitLabel, 'Good');
  assert.equal(report.pullSource, 'override');
  assert.equal(report.wall.nominalKnown, false);
  assert.equal(report.wall.nominal, null);
  assert.equal(report.wall.nominalMethod, null);
  assert.equal(report.wall.max, null);
});

test('unstamped parting lines say face names are not available', () => {
  const report = dfmReport(analysis({
    parting: { lines: [{ name: null }, { name: null }] },
  }));
  assert.equal(report.naming.stamped, false);
  assert.equal(report.naming.note, 'Face names are not available.');
  assert.deepEqual(report.naming.names, []);
});

test('stamped parting lines keep a short name list', () => {
  const lines = ['a.top~a.front', 'a.top~a.back', 'a.top~a.left', 'a.top~a.right', 'a.bottom~a.front', 'a.bottom~a.front'];
  const report = dfmReport(analysis({
    parting: { lines: lines.map((name) => ({ name })) },
  }));
  assert.equal(report.naming.stamped, true);
  assert.equal(report.naming.note, null);
  assert.equal(report.naming.names.length, DFM_NAME_PREVIEW);
  assert.deepEqual(report.naming.names, lines.slice(0, DFM_NAME_PREVIEW));
  assert.equal(report.naming.extra, 1);
});

test('anything other than a mold-analysis is not a report', () => {
  assert.equal(dfmReport(null), null);
  assert.equal(dfmReport({ kind: 'wall' }), null);
});

test('a stamped cube report names faces and stays a good fit', { timeout: 60_000 }, async () => {
  const ran = await runScript('let part = Manifold.cube([20, 10, 5], true); return part;');
  assert.equal(ran.status, 'NoError', ran.status);
  const { geometry, faceIDs } = buildSolidGeometry(ran.mesh);
  ran.manifold?.delete?.();
  const result = moldFitFromGeometry(geometry, faceIDs);
  const report = dfmReport(result);
  assert.equal(report.fit, 'good');
  assert.deepEqual(report.pull, [0, 0, 1]);
  assert.equal(report.pullSource, 'search');
  assert.equal(report.wall.nominalKnown, true);
  assert.ok(Math.abs(report.wall.nominal - 5) < 1e-2);
  assert.equal(report.naming.stamped, true);
  assert.ok(report.naming.names.some((name) => name.includes('.top') || name.includes('.bottom')));
  assert.equal(report.ejectors.pinCount, result.moldDraft.ejectors.pinCount);
  assert.equal(report.sideActions.slideCount, result.sideActions.slideCount);
  assert.doesNotMatch(JSON.stringify(report), /usd|dollar|\$/i);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  featureGapLine,
  parseFeatureGaps,
  collectFeatureGaps,
  reportFeatureGaps,
  resetFeatureGapReports,
} from './featureGaps.js';

const SCRIPT = [
  '// --- cube begin id=c1 ---',
  'let part = Manifold.cube([40, 30, 20], true);',
  '// --- cube end ---',
  '// --- code begin id=s1 ---',
  '// FEATURE-GAP: sweep along 3D path | the frame tube follows a curve and extrude only goes straight',
  'part = part.add(sweep(profileCircle(5), path));',
  '// --- code end ---',
  '// --- code begin id=s2 ---',
  '//   FEATURE-GAP:   Thread   |   no thread feature  ',
  'part = part;',
  '// --- code end ---',
  'return part;',
].join('\n');

test('featureGapLine emits a long gap and why in full', () => {
  const gap = `flange lip ${'along the rim '.repeat(20)}`.trim();
  const why = `the shell helper ${'does not add a lip '.repeat(20)}`.trim();
  assert.ok(gap.length > 200);
  assert.ok(why.length > 200);
  const line = featureGapLine(gap, why);
  assert.equal(line, `// FEATURE-GAP: ${gap} | ${why}`);
  assert.equal(line.includes('\n'), false);
  const rows = parseFeatureGaps(`${line}\nreturn part;`);
  assert.equal(rows[0].gap, gap);
  assert.equal(rows[0].why, why);
});

test('featureGapLine writes the fixed format and keeps it on one line', () => {
  assert.equal(featureGapLine('sweep along 3D path', 'extrude only goes straight'), '// FEATURE-GAP: sweep along 3D path | extrude only goes straight');
  assert.equal(featureGapLine('', ''), '// FEATURE-GAP: unspecified | not stated');
  assert.equal(featureGapLine('a | b\nc', 'why\r\nnot'), '// FEATURE-GAP: a / b c | why not');
});

test('parseFeatureGaps reads every gap with its code block', () => {
  const rows = parseFeatureGaps(SCRIPT);
  assert.deepEqual(rows.map((r) => [r.gap, r.why, r.featureId, r.line]), [
    ['sweep along 3D path', 'the frame tube follows a curve and extrude only goes straight', 's1', 5],
    ['Thread', 'no thread feature', 's2', 9],
  ]);
  assert.deepEqual(parseFeatureGaps('let part = Manifold.cube([1,1,1]);\nreturn part;'), []);
  assert.deepEqual(parseFeatureGaps('// FEATURE-GAP: loose | outside any block').map((r) => r.featureId), [null]);
});

test('collectFeatureGaps makes the backlog: unique by gap, counted, with the parts', () => {
  const rows = collectFeatureGaps({ p1: SCRIPT, p2: '// FEATURE-GAP: thread | different words\nreturn part;' }, { p1: 'Frame', p2: 'Bolt' });
  assert.deepEqual(rows, [
    { gap: 'Thread', count: 2, whys: ['no thread feature', 'different words'], parts: ['Frame', 'Bolt'] },
    { gap: 'sweep along 3D path', count: 1, whys: ['the frame tube follows a curve and extrude only goes straight'], parts: ['Frame'] },
  ]);
});

test('reportFeatureGaps sends each gap once per page load, only with consent, with no script text', () => {
  resetFeatureGapReports();
  const captured = [];
  const capture = (error, context) => captured.push({ message: error.message, name: error.name, context });
  assert.deepEqual(reportFeatureGaps(SCRIPT, { consent: false, capture }), []);
  assert.equal(captured.length, 0);
  const sent = reportFeatureGaps({ p1: SCRIPT }, { consent: true, capture });
  assert.equal(sent.length, 2);
  assert.equal(captured.length, 2);
  assert.equal(captured[0].name, 'FeatureGap');
  assert.equal(captured[0].message, 'FEATURE-GAP: sweep along 3D path | the frame tube follows a curve and extrude only goes straight');
  assert.equal(captured[0].context.level, 'info');
  assert.equal(captured[0].context.tags.category, 'feature_gap');
  assert.deepEqual(captured[0].context.fingerprint, ['feature-gap', 'sweep along 3d path']);
  assert.doesNotMatch(JSON.stringify(captured), /Manifold\.cube|profileCircle|part = part/);
  // The same gaps again, and the same gap from another part, are not repeated.
  assert.deepEqual(reportFeatureGaps({ p1: SCRIPT, p3: '// FEATURE-GAP: THREAD | again' }, { consent: true, capture }), []);
  assert.equal(captured.length, 2);
  // A capture that throws never breaks the caller.
  resetFeatureGapReports();
  assert.equal(reportFeatureGaps(SCRIPT, { consent: true, capture: () => { throw new Error('no sentry'); } }).length, 2);
});

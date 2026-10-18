import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  normalizeWebVital,
  webVitalsComplete,
  webVitalsHasSample,
} from './webVitalsAnalytics.js';

describe('web vitals analytics', () => {
  test('CLS stays unrounded including 0', () => {
    assert.equal(normalizeWebVital('cls', 0), 0);
    assert.equal(normalizeWebVital('cls', 0.0412), 0.0412);
    assert.equal(normalizeWebVital('lcp', 1234.6), 1235);
  });

  test('zero CLS does not delay a complete sample', () => {
    const metrics = {
      lcp: 1200,
      inp: 40,
      cls: 0,
      fcp: 800,
      ttfb: 90,
    };
    assert.equal(webVitalsComplete(metrics), true);
    assert.equal(webVitalsHasSample(metrics), true);
  });

  test('missing CLS is incomplete even if other vitals are set', () => {
    assert.equal(webVitalsComplete({ lcp: 1, inp: 1, fcp: 1, ttfb: 1 }), false);
    assert.equal(webVitalsHasSample({ cls: 0 }), true);
    assert.equal(webVitalsHasSample({}), false);
  });
});

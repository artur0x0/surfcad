import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

describe('product analytics call sites', () => {
  test('export_done is tracked once in downloadMeshExport, not in FromMesh', () => {
    const src = read('../src/utils/exportModel.js');
    const tracks = src.match(/track\('export_done'/g) || [];
    assert.equal(tracks.length, 2);
    assert.match(src, /downloadModelFromMesh[\s\S]*downloadMeshExport\(meshData, '3mf'/);
    assert.match(src, /track\('export_done', \{ format: pack\.format \}\)/);
  });

  test('quote_requested fires after a successful add-to-cart or order with process props', () => {
    const src = read('../src/components/QuoteModal.jsx');
    const tracks = src.match(/track\('quote_requested'/g) || [];
    assert.equal(tracks.length, 2);
    assert.match(src, /process: selectedProcess/);
    assert.match(src, /material: selectedMaterial/);
    assert.match(src, /onAddToCart[\s\S]*track\('quote_requested'/);
  });

  test('checkout_started fires once when the cart checkout page opens', () => {
    const src = read('../src/App.jsx');
    const tracks = src.match(/track\('checkout_started'/g) || [];
    assert.equal(tracks.length, 1);
    assert.match(src, /line_count/);
  });

  test('partners_form_submitted fires once on success with partner_type', () => {
    const src = read('../src/pages/PartnersPage.jsx');
    const tracks = src.match(/track\('partners_form_submitted'/g) || [];
    assert.equal(tracks.length, 1);
    assert.match(src, /partner_type:/);
  });

  test('client auth hook does not capture signed_up or logged_in', () => {
    const src = read('../src/hooks/useAuth.jsx');
    assert.equal(/track\('signed_up'\)/.test(src), false);
    assert.equal(/track\('logged_in'\)/.test(src), false);
    assert.match(src, /resetAnalyticsIdentity\(\)/);
  });

  test('posthog.reset runs only from resetAnalyticsIdentity (sign-out)', () => {
    const src = read('../src/utils/analytics.js');
    const resets = [...src.matchAll(/posthogModule\.reset\(/g)];
    assert.equal(resets.length, 2);
    assert.match(src, /function teardownPosthog\(\{ reset = false \}/);
    assert.match(src, /Sign-out only[\s\S]*posthogModule\.reset\(\)/);
    assert.match(src, /opt-out does \*\*not\*\* call `reset\(\)`|Consent opt-out must not reset/);
  });
});

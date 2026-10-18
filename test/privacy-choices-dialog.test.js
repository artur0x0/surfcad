import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import {
  privacyChoicesAnalyticsAttr,
  privacyChoicesEffective,
} from '../src/components/privacyChoicesMarkup.js';

describe('Privacy choices dialog UI', () => {
  test('toggle reflects allowed state when GPC is off', () => {
    assert.equal(privacyChoicesEffective(true, false), true);
    assert.equal(privacyChoicesAnalyticsAttr(true, false), 'on');
    assert.equal(privacyChoicesEffective(false, false), false);
    assert.equal(privacyChoicesAnalyticsAttr(false, false), 'off');
  });

  test('GPC forces analytics off in the dialog model', () => {
    assert.equal(privacyChoicesEffective(true, true), false);
    assert.equal(privacyChoicesAnalyticsAttr(true, true), 'off');
  });

  test('shell wires footer link and dialog markers', () => {
    const panel = readFileSync(new URL('../src/components/PrivacyChoicesDialogPanel.jsx', import.meta.url), 'utf8');
    const footer = readFileSync(new URL('../src/components/SiteFooter.jsx', import.meta.url), 'utf8');
    const controller = readFileSync(new URL('../src/components/PrivacyChoicesController.jsx', import.meta.url), 'utf8');
    const profile = readFileSync(new URL('../src/components/ProfilePanel.jsx', import.meta.url), 'utf8');
    const dialog = readFileSync(new URL('../src/components/PrivacyChoicesDialog.jsx', import.meta.url), 'utf8');
    assert.match(panel, /data-privacy-choices-toggle/);
    assert.match(panel, /data-privacy-choices-gpc/);
    assert.match(panel, /Allow usage analytics/);
    assert.match(footer, /data-site-footer/);
    assert.match(controller, /data-privacy-choices-link/);
    assert.match(controller, /Privacy choices/);
    assert.match(controller, /data-profile-privacy-choices/);
    assert.match(profile, /variant="profileMenu"/);
    assert.match(dialog, /dataAttr="privacy-choices"/);
    assert.match(dialog, /data-privacy-choices-done/);
    const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
    const loading = app.slice(
      app.indexOf('if (!manifoldReady || editorInitialScript === null)'),
      app.indexOf('Phone shell:'),
    );
    assert.match(loading, /data-app-loading/);
    assert.equal(/SiteFooter/.test(loading), false);
    assert.equal(/Privacy choices/.test(loading), false);
    assert.match(app, /<SiteFooter \/>/);
  });
});

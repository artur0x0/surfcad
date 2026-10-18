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

  test('shell wires footer link, profile row, and openPrivacyChoices', () => {
    const footer = readFileSync(new URL('../src/components/SiteFooter.jsx', import.meta.url), 'utf8');
    const controller = readFileSync(new URL('../src/components/PrivacyChoicesController.jsx', import.meta.url), 'utf8');
    const profile = readFileSync(new URL('../src/components/ProfilePanel.jsx', import.meta.url), 'utf8');
    const popup = readFileSync(new URL('../src/components/PrivacyConsentPopup.jsx', import.meta.url), 'utf8');
    const opener = readFileSync(new URL('../src/utils/privacyChoicesUi.js', import.meta.url), 'utf8');
    const privacyPage = readFileSync(new URL('../src/pages/PrivacyPage.jsx', import.meta.url), 'utf8');
    const main = readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');
    const loading = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
    assert.match(footer, /data-site-footer/);
    assert.match(controller, /data-privacy-choices-link/);
    assert.match(controller, /Privacy choices/);
    assert.match(controller, /data-profile-privacy-choices/);
    assert.match(controller, /openPrivacyChoices/);
    assert.match(profile, /variant="profileMenu"/);
    assert.match(opener, /export function openPrivacyChoices/);
    assert.match(popup, /Accept all/);
    assert.match(popup, /Required only/);
    assert.match(popup, /href="\/privacy"/);
    assert.match(privacyPage, /Change privacy choices/);
    assert.match(privacyPage, /Your browser(?:'s|&apos;s) Global Privacy Control signal is honored/);
    assert.match(main, /pathIsPrivacy/);
    assert.match(main, /PrivacyConsentController/);
    assert.doesNotMatch(loading, /data-app-loading[\s\S]{0,800}data-privacy-choices-link/);
    assert.doesNotMatch(popup, /\bEdge\b/);
    assert.doesNotMatch(privacyPage, /\bEdge\b/);
  });
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  privacyChoicesAnalyticsAttr,
  privacyChoicesEffective,
} from '../src/components/privacyChoicesMarkup.js';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { importJsxSource } from './jsxTestModule.js';

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
    const account = readFileSync(new URL('../src/components/AccountPane.jsx', import.meta.url), 'utf8');
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
    assert.match(account, /variant="profileMenu"/);
    assert.match(opener, /export function openPrivacyChoices/);
    assert.match(popup, /Accept all/);
    assert.match(popup, /Required only/);
    assert.match(popup, /href="\/privacy"/);
    assert.match(popup, /SurfCAD uses required cookies to sign you in and save your work\./);
    assert.match(popup, /Optional cookies help us improve the app, so please consider allowing all\./);
    assert.doesNotMatch(popup, /Optional analytics start only if you accept/);
    assert.match(privacyPage, /Change privacy choices/);
    assert.match(privacyPage, /Your browser(?:'s|&apos;s) Global Privacy Control signal is honored/);
    assert.match(main, /pathIsPrivacy/);
    assert.match(main, /PrivacyConsentController/);
    const loadingSlice = loading.slice(
      loading.indexOf('if (!manifoldReady || editorInitialScript === null)'),
      loading.indexOf('Phone shell:'),
    );
    assert.match(loadingSlice, /data-app-loading/);
    assert.equal(/SiteFooter/.test(loadingSlice), false);
    assert.equal(/Privacy choices/.test(loadingSlice), false);
    assert.match(loading, /<SiteFooter \/>/);
    assert.match(footer, /variant !== 'light'/);
    assert.doesNotMatch(popup, /\bEdge\b/);
    assert.doesNotMatch(privacyPage, /\bEdge\b/);
    assert.doesNotMatch(profile, /\bEdge\b/);
    assert.doesNotMatch(account, /\bEdge\b/);
  });

  test('the CAD viewer footer has no Privacy choices link and /privacy still does', async () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), '..');
    const { SiteFooter, PrivacyPage, AuthProvider } = await importJsxSource(`
      import SiteFooter from './src/components/SiteFooter.jsx';
      import PrivacyPage from './src/pages/PrivacyPage.jsx';
      import { AuthProvider } from './src/hooks/useAuth.jsx';
      export { SiteFooter, PrivacyPage, AuthProvider };
    `, root);

    const viewer = renderToStaticMarkup(React.createElement(SiteFooter));
    assert.equal(viewer, '');
    assert.equal(viewer.includes('Privacy choices'), false);
    assert.equal(viewer.includes('data-privacy-choices-link'), false);

    const mobile = renderToStaticMarkup(React.createElement(SiteFooter, { variant: 'dark' }));
    assert.equal(mobile.includes('data-privacy-choices-link'), false);

    const page = renderToStaticMarkup(
      React.createElement(AuthProvider, null, React.createElement(PrivacyPage)),
    );
    assert.match(page, /data-privacy-page/);
    assert.match(page, /Change privacy choices/);
    assert.match(page, /data-privacy-change-choices/);
    assert.match(page, /data-privacy-choices-link/);
    assert.match(page, /Privacy choices/);
  });
});

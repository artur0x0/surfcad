import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { adminPageAccess, profileAdminVisible } from './adminAccess.js';

describe('admin page gating', () => {
  test('signed-out and non-admin users see the 404 page, not the dashboard', () => {
    assert.equal(adminPageAccess({ isLoading: false, isAdmin: false }), 'not_found');
    assert.equal(adminPageAccess({ isLoading: false, isAdmin: undefined }), 'not_found');
    assert.equal(adminPageAccess({}), 'not_found');
  });

  test('admins see the dashboard after auth settles', () => {
    assert.equal(adminPageAccess({ isLoading: true, isAdmin: true }), 'pending');
    assert.equal(adminPageAccess({ isLoading: false, isAdmin: true }), 'allow');
  });

  test('profile Admin row is only for isAdmin', () => {
    assert.equal(profileAdminVisible({ isAdmin: true }), true);
    assert.equal(profileAdminVisible({ isAdmin: false }), false);
    assert.equal(profileAdminVisible(null), false);
  });

  test('AdminPage and ProfilePanel use the gate', () => {
    const page = readFileSync(new URL('../pages/AdminPage.jsx', import.meta.url), 'utf8');
    const panel = readFileSync(new URL('../components/ProfilePanel.jsx', import.meta.url), 'utf8');
    const main = readFileSync(new URL('../main.jsx', import.meta.url), 'utf8');
    assert.match(page, /adminPageAccess/);
    assert.match(page, /NotFoundPage/);
    assert.match(page, /data-admin-page/);
    assert.match(page, /MoldingCatalog/);
    assert.match(page, /MoldingResinLibrary/);
    assert.match(page, /MoldingLeads/);
    const catalog = readFileSync(new URL('../pages/admin/MoldingCatalog.jsx', import.meta.url), 'utf8');
    assert.match(catalog, /data-admin-mold-catalog/);
    assert.doesNotMatch(catalog, /stripe/i);
    const library = readFileSync(new URL('../pages/admin/MoldingResinLibrary.jsx', import.meta.url), 'utf8');
    assert.match(library, /data-admin-mold-library/);
    assert.doesNotMatch(library, /usdPerKg|stripe|partnerId/i);
    const leads = readFileSync(new URL('../pages/admin/MoldingLeads.jsx', import.meta.url), 'utf8');
    assert.match(leads, /data-admin-mold-leads/);
    assert.doesNotMatch(leads, /stripe|userId|email/i);
    assert.match(panel, /profileAdminVisible/);
    assert.match(panel, /data-profile-admin/);
    assert.match(main, /lazy\(\(\) => import\('\.\/pages\/AdminPage\.jsx'\)\)/);
  });
});

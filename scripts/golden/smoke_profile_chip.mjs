#!/usr/bin/env node
/**
 * G9: circular profile chip at top-right of the CAD viewport.
 *
 * - profileInitials helper (name / email / guest / signed-out)
 * - ProfileChip mounted in Viewport (not game), top-right absolute
 * - Toolbar CAD strip no longer has Account / User icon
 * - Signed out → onAccount (Login); signed in → ProfilePanel (Account / Sign out)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { profileInitials } from '../../src/utils/profileInitials.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

let failed = 0;
let passed = 0;
function ok(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${extra ? ` — ${extra}` : ''}`); }
}
function eq(name, got, want) {
  const g = JSON.stringify(got); const w = JSON.stringify(want);
  ok(name, g === w, `got ${g}, want ${w}`);
}

console.log('G9 — profileInitials');
eq('signed out', profileInitials({}), '');
eq('guest object', profileInitials({ guest: { email: 'g@x.com' } }), 'G');
eq('guest true', profileInitials({ guest: true }), 'G');
eq('first+last', profileInitials({
  isAuthenticated: true,
  user: { firstName: 'Ada', lastName: 'Lovelace' },
}), 'AL');
eq('first only', profileInitials({
  isAuthenticated: true,
  user: { firstName: 'Neo' },
}), 'NE');
eq('name two words', profileInitials({
  isAuthenticated: true,
  user: { name: 'Grace Hopper' },
}), 'GH');
eq('name one word', profileInitials({
  isAuthenticated: true,
  user: { name: 'Prince' },
}), 'PR');
eq('email local', profileInitials({
  isAuthenticated: true,
  user: { email: 'artur@example.com' },
}), 'AR');
eq('email dotted', profileInitials({
  isAuthenticated: true,
  user: { email: 'ada.lovelace@example.com' },
}), 'AL');
eq('email only one char local', profileInitials({
  isAuthenticated: true,
  user: { email: 'a@example.com' },
}), 'A');
eq('auth but empty user fields', profileInitials({
  isAuthenticated: true,
  user: {},
}), '');
eq('prefers name over email', profileInitials({
  isAuthenticated: true,
  user: { firstName: 'Tom', lastName: 'Bombadil', email: 'x@y.com' },
}), 'TB');

console.log('\nG9 — UI wiring (source)');
{
  const chip = readFileSync(join(root, 'src/components/ProfileChip.jsx'), 'utf8');
  const view = readFileSync(join(root, 'src/components/Viewport.jsx'), 'utf8');
  const toolbar = readFileSync(join(root, 'src/components/Toolbar.jsx'), 'utf8');
  const app = readFileSync(join(root, 'src/App.jsx'), 'utf8');
  const arch = readFileSync(join(root, 'docs/architecture.md'), 'utf8');
  const ui = readFileSync(join(root, 'docs/UI_MAP.md'), 'utf8');
  const pkg = readFileSync(join(root, 'package.json'), 'utf8');

  ok('chip data attrs', /data-profile-chip/.test(chip)
    && /data-profile-initials/.test(chip)
    && /data-profile-auth/.test(chip));
  ok('chip is circular absolute top-right',
    /rounded-full/.test(chip)
    && /absolute top-4 right-4/.test(chip));
  // Viewport wrap must sit above CAD feature strip (z-20) so ProfilePanel is clickable.
  ok('viewport chip z above feature strip',
    /absolute top-4 right-4 z-50/.test(chip)
    && /z-\[60\]/.test(readFileSync(join(root, 'src/components/ProfilePanel.jsx'), 'utf8')));
  ok('chip uses surface-glass-chip', /surface-glass-chip/.test(chip));
  ok('chip calls onAccount', /onAccount\?\.|onAccount\(/.test(chip));
  ok('chip uses profileInitials + useAuth',
    /profileInitials/.test(chip) && /useAuth/.test(chip));

  ok('Viewport mounts ProfileChip in CAD only',
    /mode !== 'game' && \(\s*<ProfileChip/.test(view)
    || /mode !== 'game' && \(\n\s*<ProfileChip/.test(view));
  ok('Viewport imports ProfileChip', /import ProfileChip from '\.\/ProfileChip'/.test(view));
  ok('Viewport still receives onAccount for the chip',
    /onAccount/.test(view)
    && (/<ProfileChip[^>]*onAccount=\{onAccount\}/.test(view)
      || /<ProfileChip variant="viewport" onAccount=\{onAccount\}/.test(view)));
  ok('chip green signed-in / grey signed-out',
    /border-green-500/.test(chip) && /border-gray-500/.test(chip));
  ok('Parts mounts inline ProfileChip',
    /data-parts-profile-chip/.test(readFileSync(join(root, 'src/components/PartFeed.jsx'), 'utf8'))
    && /variant="inline"/.test(readFileSync(join(root, 'src/components/PartFeed.jsx'), 'utf8')));
  ok('Script toolbar mounts inline ProfileChip',
    /data-script-profile-chip/.test(readFileSync(join(root, 'src/components/CodeEditor.jsx'), 'utf8'))
    && /<ProfileChip[\s\S]*?variant="inline"/.test(readFileSync(join(root, 'src/components/CodeEditor.jsx'), 'utf8'))
    && /onAccount=\{handleAccount\}/.test(app));
  ok('chip falls back to User icon when no initials',
    /from 'lucide-react'/.test(chip) && /<User /.test(chip));
  ok('chip uses the shared session phase for reauth vs connected',
    /useAuthState/.test(chip) && /data-profile-badge="reauth"/.test(chip)
    && /data-profile-reconnect/.test(chip));
  ok('Toolbar portal no longer gets onAccount',
    !/createPortal\(\s*<Toolbar[\s\S]*?onAccount=\{onAccount\}/.test(view));

  const strip = toolbar.slice(toolbar.indexOf('data-toolbar-variant="strip"'));
  ok('Toolbar strip has no Account button',
    !/title="Account"/.test(strip) && !/onClick=\{onAccount\}/.test(strip));
  ok('Toolbar does not import User icon', !/\bUser\b/.test(toolbar.split('from \'lucide-react\'')[0]));
  ok('Toolbar does not use useAuth', !/useAuth/.test(toolbar));
  ok('App still wires handleAccount into Viewport',
    /onAccount=\{handleAccount\}/.test(app)
    && /setShowLoginModal\(true\)/.test(app)
    && /setShowAccountModal\(true\)/.test(app));

  {
    const panel = readFileSync(join(root, 'src/components/ProfilePanel.jsx'), 'utf8');
    const account = readFileSync(join(root, 'src/components/AccountPane.jsx'), 'utf8');
    ok('signed-in chip opens ProfilePanel', /ProfilePanel/.test(chip)
      && /data-profile-panel/.test(panel)
      && /data-profile-sign-out/.test(panel)
      && /data-profile-account/.test(panel)
      && /AccountPane/.test(chip));
    ok('Account pane holds danger zone, delete confirm, and clear cache',
      /data-profile-danger-zone/.test(account)
      && /data-profile-delete-account/.test(account)
      && /data-profile-delete-confirm/.test(account)
      && /data-clear-cache/.test(account)
      && /data-profile-privacy-divider/.test(account));
    ok('signed-in dropdown drops email, GitHub linked, and the old danger block',
      !/data-profile-panel-email/.test(panel)
      && !/GitHub linked/.test(panel)
      && !/data-profile-delete-account/.test(panel)
      && !/data-profile-danger-zone/.test(panel));
  }
  // Green chip (session OR GitHub token) must open the panel — never Login.
  ok('green chip click uses signedIn (not only isAuthenticated)',
    /if \(signedIn\)/.test(chip)
    && /setPanelOpen/.test(chip)
    && (/signedIn && \(/.test(chip) || /showPanel && \(/.test(chip) || /signedIn \|\| localMenu/.test(chip))
    && /<ProfilePanel/.test(chip)
    && !/if \(isAuthenticated\) \{[\s\S]*?setPanelOpen/.test(chip));
  ok('delete confirm warns account + GitHub repo',
    /SurfCAD account/.test(readFileSync(join(root, 'src/components/AccountPane.jsx'), 'utf8'))
    && /GitHub repo/.test(readFileSync(join(root, 'src/components/AccountPane.jsx'), 'utf8')));
  ok('signed-in profile menu shows Mongo user id + copy',
    /ProfileUserIdRow/.test(readFileSync(join(root, 'src/components/ProfilePanel.jsx'), 'utf8'))
    && /ProfileUserIdRow/.test(readFileSync(join(root, 'src/components/AccountPane.jsx'), 'utf8'))
    && /data-profile-user-id/.test(readFileSync(join(root, 'src/components/ProfileUserIdRow.jsx'), 'utf8'))
    && /data-profile-user-id-copy/.test(readFileSync(join(root, 'src/components/ProfileUserIdRow.jsx'), 'utf8'))
    && /Copy user id/.test(readFileSync(join(root, 'src/components/ProfileUserIdRow.jsx'), 'utf8')));
  ok('DELETE /api/auth/account wired',
    /router\.delete\('\/account'/.test(readFileSync(join(root, 'backend/routes/auth.js'), 'utf8'))
    && /deleteResolvedGithubVault/.test(readFileSync(join(root, 'backend/routes/auth.js'), 'utf8')));
  ok('App clears vault state on profile sign-out',
    /handleProfileSignedOut/.test(app) && /setGithubConnected\(false\)/.test(app));
  ok('architecture documents G9', /Profile chip \(G9\)/.test(arch)
    && /top-right of the CAD viewport/.test(arch));
  ok('UI_MAP mentions profile chip', /profile chip/i.test(ui));
  ok('package.json has golden:profile-chip', /golden:profile-chip/.test(pkg));
}

console.log(failed ? `\n❌ FAIL (${failed} failed, ${passed} passed)` : `\n✅ PASS (${passed})`);
process.exit(failed ? 1 : 0);

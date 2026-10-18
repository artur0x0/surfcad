import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import {
  isProfileNoreplyEmail,
  profileCreatedDateLabel,
  profileDisplayName,
  profileGithubLinked,
  profilePublicEmail,
  profileSignInProvider,
} from '../src/components/profileAccount.js';
import { shouldShowAgentBridgeDisconnect } from '../src/agent/ws/pairingFlow.js';

describe('profile Account pane', () => {
  test('hides GitHub noreply addresses and keeps a real email', () => {
    assert.equal(isProfileNoreplyEmail('artur0x0@users.noreply.github.com'), true);
    assert.equal(profilePublicEmail('artur0x0@users.noreply.github.com'), '');
    assert.equal(profilePublicEmail('artur@surfcad.com'), 'artur@surfcad.com');
    assert.equal(profilePublicEmail(''), '');
  });

  test('reads username, provider, GitHub link, and created date', () => {
    const user = {
      name: 'artur0x0',
      authProvider: 'github',
      githubId: '99',
      createdAt: '2025-01-15T00:00:00.000Z',
    };
    assert.equal(profileDisplayName(user), 'artur0x0');
    assert.equal(profileDisplayName({ email: 'x@users.noreply.github.com' }), '');
    assert.equal(profileDisplayName({ email: 'ada@surfcad.com' }), 'ada@surfcad.com');
    assert.equal(profileSignInProvider(user), 'GitHub');
    assert.equal(profileGithubLinked(user), true);
    assert.equal(profileGithubLinked({}), false);
    assert.match(profileCreatedDateLabel(user.createdAt), /2025/);
    assert.equal(profileCreatedDateLabel('not-a-date'), '');
  });

  test('Disconnect is the local agent relay and stays hidden until paired', () => {
    assert.equal(shouldShowAgentBridgeDisconnect({ paired: false }), false);
    assert.equal(shouldShowAgentBridgeDisconnect({ paired: true }), true);
  });

  test('Account pane and signed-in menu wire the moved rows', () => {
    const pane = readFileSync(new URL('../src/components/AccountPane.jsx', import.meta.url), 'utf8');
    const panel = readFileSync(new URL('../src/components/ProfilePanel.jsx', import.meta.url), 'utf8');
    const pairing = readFileSync(new URL('../src/components/AgentBridgePairing.jsx', import.meta.url), 'utf8');
    assert.match(pane, /data-profile-account-pane/);
    assert.match(pane, /data-profile-clear-local/);
    assert.match(pane, /data-clear-cache/);
    assert.match(pane, /data-profile-danger-zone/);
    assert.match(pane, /data-profile-delete-account/);
    assert.match(pane, /data-profile-delete-confirm/);
    assert.match(pane, /variant="profileMenu"/);
    assert.match(pane, /max-h-\[calc\(100dvh-7rem\)\]/);
    assert.match(pane, /overflow-y-auto rail-scroll/);
    assert.match(pane, /'Linked'/);
    assert.doesNotMatch(pane, /GitHub linked/);
    assert.doesNotMatch(pane, /\bEdge\b/);
    const privacyIdx = pane.indexOf('variant="profileMenu"');
    const clearIdx = pane.indexOf('data-profile-clear-local');
    const dangerIdx = pane.indexOf('data-profile-danger-zone');
    assert.ok(privacyIdx > 0 && privacyIdx < clearIdx && clearIdx < dangerIdx);
    assert.match(panel, /data-profile-account/);
    assert.match(panel, /PROFILE_MENU_ITEM_CLASS/);
    assert.doesNotMatch(panel, /data-profile-panel-email/);
    assert.doesNotMatch(panel, /GitHub linked/);
    assert.match(pairing, /<Plug /);
    assert.match(pairing, /Connect agent/);
    assert.match(pairing, /shouldShowAgentBridgeDisconnect/);
  });
});

/**
 * Read-only account-pane fields. No editing.
 */

export function profileDisplayName(user) {
  if (!user) return '';
  if (user.firstName && user.lastName) return `${user.firstName} ${user.lastName}`;
  if (user.firstName || user.lastName) return user.firstName || user.lastName;
  if (user.name) return user.name;
  return profilePublicEmail(user.email);
}

/** Hide GitHub's placeholder noreply address from the profile dropdown and Account pane. */
export function isProfileNoreplyEmail(email) {
  return /@users\.noreply\.github\.com$/i.test(String(email || ''));
}

export function profilePublicEmail(email) {
  const value = String(email || '').trim();
  if (!value || isProfileNoreplyEmail(value)) return '';
  return value;
}

export function profileSignInProvider(user) {
  const provider = String(user?.authProvider || '').toLowerCase();
  if (provider === 'github') return 'GitHub';
  if (provider === 'google') return 'Google';
  if (provider === 'apple') return 'Apple';
  if (provider === 'local') return 'Email';
  return '';
}

export function profileGithubLinked(user) {
  return Boolean(user?.githubId);
}

export function profileCreatedDateLabel(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

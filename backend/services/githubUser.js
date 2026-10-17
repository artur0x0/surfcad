/**
 * Fetch a GitHub user profile from a user-to-server access token.
 * Used only to upsert the app User (githubId) — never stores the token.
 * No Express / mongoose imports — safe for goldens.
 */
export const GITHUB_API_USER = 'https://api.github.com/user';
export const GITHUB_API_USER_EMAILS = 'https://api.github.com/user/emails';

/**
 * Split GitHub `user.name` into first/last. No name → first = login, last empty.
 * Multi-word: first token = firstName, remainder = lastName.
 */
export function splitGithubDisplayName(name, login = '') {
  const loginStr = String(login || '').trim();
  const display = (typeof name === 'string' && name.trim()) ? name.trim() : '';
  if (!display) {
    return { displayName: loginStr || null, givenName: loginStr || null, familyName: null };
  }
  const parts = display.split(/\s+/).filter(Boolean);
  return {
    displayName: display,
    givenName: parts[0] || loginStr || null,
    familyName: parts.length > 1 ? parts.slice(1).join(' ') : null,
  };
}

/**
 * @returns {{ ok: true, profile: object } | { ok: false, status: number, error: string }}
 */
export async function fetchGithubUserProfile({
  accessToken,
  fetchImpl = globalThis.fetch,
  userUrl = GITHUB_API_USER,
  emailsUrl = GITHUB_API_USER_EMAILS,
} = {}) {
  const token = typeof accessToken === 'string' ? accessToken.trim() : '';
  if (!token) {
    return { ok: false, status: 400, error: 'access_token is required' };
  }

  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
  };

  let userRes;
  try {
    userRes = await fetchImpl(userUrl, { headers });
  } catch {
    return { ok: false, status: 502, error: 'GitHub user lookup unreachable' };
  }

  let user;
  try {
    user = await userRes.json();
  } catch {
    return { ok: false, status: 502, error: 'GitHub user lookup failed' };
  }

  if (!userRes.ok || !user?.id) {
    const msg = user?.message || `GitHub user lookup failed (${userRes.status})`;
    return {
      ok: false,
      status: userRes.status === 401 || userRes.status === 403 ? 401 : 502,
      error: msg,
    };
  }

  const login = String(user.login || '').trim();

  // user.email is public and may be unverified. Only /user/emails entries
  // with verified:true are safe to treat as identity.
  let email = null;
  let emailVerified = false;
  try {
    const emRes = await fetchImpl(emailsUrl, { headers });
    if (emRes.ok) {
      const emails = await emRes.json();
      if (Array.isArray(emails)) {
        const primary = emails.find((e) => e.primary && e.verified && e.email)
          || emails.find((e) => e.verified && e.email);
        if (primary?.email) {
          email = String(primary.email).trim();
          emailVerified = true;
        }
      }
    }
  } catch {
    // fall through to noreply
  }

  if (!email) {
    if (!login) {
      return { ok: false, status: 400, error: 'GitHub account has no email or login' };
    }
    email = `${login}@users.noreply.github.com`;
  }

  const { displayName, givenName, familyName } = splitGithubDisplayName(user.name, login);

  return {
    ok: true,
    profile: {
      id: String(user.id),
      login,
      email,
      displayName,
      name: {
        givenName,
        familyName,
      },
      emails: emailVerified ? [{ value: email, verified: true }] : [{ value: email }],
    },
  };
}

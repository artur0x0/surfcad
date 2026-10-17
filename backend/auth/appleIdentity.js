/**
 * Apple identity from the id_token claims.
 *
 * The string we decode is only the `id_token` field from Apple's token
 * endpoint (`POST https://appleid.apple.com/auth/token`), which
 * passport-apple obtains server-to-server with our client_secret. We never
 * read `req.body.id_token` from the form_post. `req.body.user` may supply a
 * display name only — never the email.
 *
 * Because the token is not taken from the browser, we decode claims and do
 * not re-verify the JWT signature against Apple's JWKS here.
 */

export function decodeAppleIdToken(idToken) {
  if (idToken && typeof idToken === 'object') return idToken;
  if (typeof idToken !== 'string' || !idToken.includes('.')) return null;
  try {
    const payload = idToken.split('.')[1];
    return JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

export function appleEmailVerified(claims) {
  const value = claims?.email_verified;
  return value === true || value === 'true';
}

export function parseAppleBodyUser(bodyUser) {
  if (!bodyUser) return null;
  if (typeof bodyUser === 'object' && !Array.isArray(bodyUser)) return bodyUser;
  if (typeof bodyUser !== 'string') return null;
  try {
    const parsed = JSON.parse(bodyUser);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * @returns {{ appleId: string|null, email: string|null, emailVerified: boolean, firstName: string, lastName: string, displayName: string|null }}
 */
export function resolveAppleIdentity({ idToken, bodyUser, profile } = {}) {
  const claims = decodeAppleIdToken(idToken);
  const appleId = claims?.sub || profile?.id || null;
  const rawEmail = typeof claims?.email === 'string' ? claims.email.trim() : '';
  const userData = parseAppleBodyUser(bodyUser);
  const firstName = typeof userData?.name?.firstName === 'string' ? userData.name.firstName : '';
  const lastName = typeof userData?.name?.lastName === 'string' ? userData.name.lastName : '';
  const displayName = [firstName, lastName].filter(Boolean).join(' ').trim() || null;
  return {
    appleId,
    email: rawEmail || null,
    emailVerified: appleEmailVerified(claims),
    firstName,
    lastName,
    displayName,
  };
}

export function appleOAuthUnavailable() {
  return { error: 'Apple sign-in is not available' };
}

/**
 * Signing in to the SurfCAD GitHub App is not the same as installing it.
 * `POST /user/repos` needs the app installed on the signed-in user's account.
 * The install page is built from the public app slug. No client id.
 */

/** Public slug of the SurfCAD GitHub App (`github.com/apps/<slug>`). */
export const GITHUB_APP_SLUG = 'surfcad';

export const GITHUB_INSTALL_ACTION_LABEL = 'Install SurfCAD on GitHub';

/**
 * Already installed, but the user-to-server token still lacks the grant.
 * `POST /user/repos` needs Administration read and write; the first seed
 * also needs Contents read and write. Approving the install does not
 * refresh a token that was issued before that grant.
 */
export const GITHUB_PERMISSIONS_GUIDANCE =
  'GitHub App needs Administration R/W (and Contents R/W to seed). Approve the updated permissions on Installed GitHub Apps, then disconnect and connect again in SurfCAD.';

const SLUG_RE = /^[A-Za-z0-9-]+$/;
const INSTALL_URL_RE = /^https:\/\/github\.com\/apps\/[A-Za-z0-9-]+\/installations\/new$/;

export function githubAppInstallUrl(slug = GITHUB_APP_SLUG) {
  const safe = String(slug || '').trim();
  if (!SLUG_RE.test(safe)) return null;
  return `https://github.com/apps/${safe}/installations/new`;
}

/** Only the app install page. Anything else is not offered as a link. */
export function safeGithubAppInstallUrl(url) {
  const value = String(url || '').trim();
  return INSTALL_URL_RE.test(value) ? value : null;
}

/**
 * Plain Save-dialog sentence. The same user token can create the repo
 * after the install; a new OAuth grant is only needed when the token
 * itself is missing Administration (see GITHUB_PERMISSIONS_GUIDANCE).
 */
export function githubInstallGuidance(installUrl = githubAppInstallUrl()) {
  const url = safeGithubAppInstallUrl(installUrl) || githubAppInstallUrl();
  return `SurfCAD is not installed on your GitHub account. Signing in does not install the app, and creating a repo needs that install. Install SurfCAD on GitHub (${url}), then come back to this tab and save again.`;
}

export function integrationAccessDenied(status, githubMessage) {
  return status === 403
    && /not accessible by integration|Resource not accessible/i.test(githubMessage || '');
}

/**
 * `GET /user/installations` lists installations of this app that the
 * user token can access. Creating a repo under the signed-in user needs
 * one whose account is that user. An org install does not.
 * A suspended install is still an install (the fix is not "install again").
 */
export function surfCadInstalledOnSignedInUser(installations) {
  if (!Array.isArray(installations)) return false;
  return installations.some((row) => {
    if (!row || typeof row !== 'object') return false;
    const slug = row.app_slug;
    if (typeof slug === 'string' && slug && slug !== GITHUB_APP_SLUG) return false;
    const type = row.account?.type || row.target_type;
    return type === 'User';
  });
}

/** Fields the Save dialog reads off a GitAdapterError. Empty for other errors. */
export function githubSaveErrorFields(err) {
  if (err?.githubAccess !== 'install' && err?.githubAccess !== 'permissions') return {};
  const fields = { githubAccess: err.githubAccess };
  if (err.githubAccess === 'install') {
    const installUrl = safeGithubAppInstallUrl(err.installUrl);
    if (installUrl) fields.installUrl = installUrl;
  }
  return fields;
}

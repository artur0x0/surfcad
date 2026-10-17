/**
 * GitHub App user-to-server OAuth — stateless code → token exchange.
 *
 * POST /api/github/oauth/token  { code, redirect_uri }
 * Stores nothing. Never logs the token or client secret.
 */
import { Router } from 'express';
import config from '../config/index.js';
import { exchangeGithubOAuthToken, refreshGithubOAuthToken } from '../services/githubOAuth.js';

const router = Router();

export { exchangeGithubOAuthToken, refreshGithubOAuthToken } from '../services/githubOAuth.js';

/**
 * POST /oauth/token
 * Body: { code: string, redirect_uri?: string }
 */
router.post('/oauth/token', async (req, res) => {
  const code = typeof req.body?.code === 'string' ? req.body.code : '';
  const redirectUri = typeof req.body?.redirect_uri === 'string'
    ? req.body.redirect_uri.trim()
    : '';

  const result = await exchangeGithubOAuthToken({
    code,
    redirectUri,
    clientId: config.githubApp?.clientId,
    clientSecret: config.githubApp?.clientSecret,
  });

  if (!result.ok) {
    if (result.status >= 500) {
      console.error('[github-oauth] exchange failed:', result.status, result.body?.error);
    } else if (result.body?.error && result.body.error !== 'code is required') {
      console.error('[github-oauth] exchange rejected:', result.body.error);
    }
  }

  return res.status(result.status).json(result.body);
});

/**
 * POST /oauth/refresh
 * Body: { refresh_token: string }
 * Quiet renewal of an expiring GitHub App user token. Stores nothing.
 * Does not record a SurfCAD login event (no new express session).
 */
router.post('/oauth/refresh', async (req, res) => {
  const refreshToken = typeof req.body?.refresh_token === 'string'
    ? req.body.refresh_token
    : '';
  const result = await refreshGithubOAuthToken({
    refreshToken,
    clientId: config.githubApp?.clientId,
    clientSecret: config.githubApp?.clientSecret,
  });
  if (!result.ok && result.status >= 500) {
    console.error('[github-oauth] refresh failed:', result.status, result.body?.error);
  }
  return res.status(result.status).json(result.body);
});

export default router;

# Applying nginx security headers on surfcad.com (Hostinger)

Artur applies this on the production box. See [README.md](./README.md) for the config file map.

## What changed

- Security headers live in `/etc/nginx/snippets/surfcad-security.conf` and are **included inside** `location /` and `location /assets/`, because those blocks define their own `Cache-Control` and nginx would otherwise drop server-level `add_header` directives (that was why the static site sent almost no security headers).
- `/api/` is proxied to Node; **helmet** on the backend sets HSTS, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, and related headers. The nginx `/api/` block intentionally adds **no** duplicate security headers.
- **COOP / COEP** were removed from nginx. The FEA wasm worker is single-threaded and does not need `crossOriginIsolated` or `SharedArrayBuffer` in the page (`src/workers/feaWorker.js`). Keeping `COEP: require-corp` would block third-party iframes (Cloudflare Turnstile, Stripe Elements) unless every embed sent `Cross-Origin-Resource-Policy`, which they do not.
- **`connect-src` includes `data:`** so Cloudflare Turnstile on `/partners` can complete its challenge without CSP console errors. Managed/invisible behaviour is configured in the Turnstile dashboard, not via the widget `size` option.
- **`connect-src` includes `ws://127.0.0.1:17341` and `ws://localhost:17341`** so the production **Local agent** panel can reach the loopback relay started by `npx surfcad-mcp` (see [../nginx-snippets/surfcad-security.conf](../nginx-snippets/surfcad-security.conf)).
- **`location /` no longer sets `expires 0`** alongside `Cache-Control`, so `index.html` is not sent with two conflicting `Cache-Control` values.

### CSP (PostHog, Sentry, local agent)

The live snippet in [../nginx-snippets/surfcad-security.conf](../nginx-snippets/surfcad-security.conf) should match [../monitoring.md](../monitoring.md) slice E (combined PostHog + Sentry + agent-bridge `connect-src` / `script-src`). When analytics or error reporting env vars change on spark, update the snippet, reinstall on prod, and reload nginx.

## Backup

```bash
sudo cp -a /etc/nginx/sites-enabled/surfcad.com \
  "/etc/nginx/sites-enabled/surfcad.com.bak.$(date -u +%Y%m%dT%H%M%SZ)"
sudo cp -a /etc/nginx/snippets/surfcad-security.conf \
  "/etc/nginx/snippets/surfcad-security.conf.bak.$(date -u +%Y%m%dT%H%M%SZ)" 2>/dev/null || true
```

## Install files from the repo

From a checkout of the branch that contains the updated configs:

```bash
sudo install -m 644 docs/nginx-snippets/surfcad-security.conf /etc/nginx/snippets/surfcad-security.conf
sudo install -m 644 docs/nginx-surfcad.com.conf /etc/nginx/sites-enabled/surfcad.com
```

## Test and reload

```bash
sudo nginx -t && sudo systemctl reload nginx
```

## Verify headers on the static site

```bash
curl -sI https://surfcad.com/ | grep -iE '^(strict-transport-security|x-frame-options|x-content-type-options|referrer-policy|permissions-policy|content-security-policy):'
```

Expected (values may wrap in the terminal; the CSP is one long line in the snippet):

| Header | Expected value (prefix) |
|--------|-------------------------|
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` |
| `X-Frame-Options` | `SAMEORIGIN` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `accelerometer=(), camera=(), ...` |
| `Content-Security-Policy` | starts with `default-src 'self';` and includes `challenges.cloudflare.com`, `js.stripe.com`, `api.github.com`, `wasm-unsafe-eval`, `worker-src 'self' blob:`, `https://*.ingest.us.sentry.io`, `https://us.i.posthog.com`, and the local agent `ws://127.0.0.1:17341` entries |

`/api/` responses should **not** gain a second copy of these from nginx; check one API route if unsure:

```bash
curl -sI https://surfcad.com/api/config | grep -iE '^(strict-transport-security|content-security-policy):'
```

You should see helmet’s headers once (from Node), not doubled.

## Rollback

```bash
sudo cp -a "/etc/nginx/sites-enabled/surfcad.com.bak.<timestamp>" /etc/nginx/sites-enabled/surfcad.com
sudo rm -f /etc/nginx/snippets/surfcad-security.conf   # or restore the .bak snippet
sudo nginx -t && sudo systemctl reload nginx
```

Replace `<timestamp>` with the UTC stamp from your backup filenames.

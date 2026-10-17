# Monitoring and privacy

SurfCAD’s US launch uses an **opt-out** model for product analytics: usage analytics are **on by default**, there is **no cookie banner**, and people can change their mind any time from **Privacy choices** in the site footer.

## Consent module (`src/utils/consent.js`)

| API | Purpose |
| --- | --- |
| `getAnalyticsConsent()` | `true` when anonymous usage analytics may run in this browser tab. |
| `setAnalyticsConsent(boolean)` | Saves preference to `localStorage` (`surfcad.consent.v1`: `{ analytics, updatedAt }`). |
| `onConsentChange(cb)` | Fires when the effective consent value changes. |
| `isGpcActive()` | `true` when `navigator.globalPrivacyControl === true`. |

**Defaults:** analytics allowed unless the stored record says otherwise. **Global Privacy Control (GPC)** always counts as opt-out: `getAnalyticsConsent()` is `false` while GPC is set, and `setAnalyticsConsent(true)` cannot override that.

**Not gated by this toggle:** error and crash reporting (e.g. Sentry) — treated as essential operational telemetry so production issues can be diagnosed. PostHog (slice C) and any other usage analytics must call `getAnalyticsConsent()` before sending events.

## Signed-in sync

- `User.consent` in MongoDB: `{ analytics: Boolean, updatedAt: Date }`, default analytics `true`.
- `PUT /api/auth/consent` (authenticated) persists changes from the Privacy choices dialog.
- On sign-in, `/api/auth/me` returns `user.consent`. If the server `updatedAt` is newer than `localStorage`, the client applies the server value (server wins).

Works with **no API keys** and **no network**: preferences live in `localStorage`; API calls fail quietly when the backend is unreachable.

## UI

**Privacy choices** opens a small dialog (footer on the CAD app, loading gate, and `/partners`):

- Toggle: **Allow usage analytics**
- Plain-language summary: anonymous usage events and page performance; no session recording; no ads
- When GPC is detected, a note explains that SurfCAD honours it and the toggle is disabled

Later monitoring slices (PostHog, Sentry) should import this module only — do not add parallel consent state.

## Slice D — Sentry (errors + performance, US region)

Org: **surfcad** (Sentry US). Error reporting is **not** gated by `getAnalyticsConsent()` — it is essential operational telemetry.

### Frontend (`@sentry/react`, lazy-loaded)

| Env (Vite) | Default | Notes |
| --- | --- | --- |
| `VITE_SENTRY_DSN` | *(empty)* | When unset, the client is a total no-op (dev, staging, CI). |
| `VITE_SENTRY_ENVIRONMENT` | `production` in prod builds | From `import.meta.env.PROD`. |
| `VITE_SENTRY_TRACES_SAMPLE_RATE` | `0.2` | Browser tracing for initial load + `history` navigations. |

- Entry: `src/utils/sentryClient.js` (`bootstrapSentry()` from `src/main.jsx`).
- `SentryErrorBoundary` wraps the app shell; `SentryUserSync` sets `user: { id: sha256(userId) }` only (no email/IP).
- `sendDefaultPii: false`. `beforeSend` / `beforeBreadcrumb` scrub query strings, request bodies, part/file names, and auth headers via `src/utils/sentryPii.js`.
- No session replay, no feedback widget.
- **Deploy:** set `VITE_*` only in spark `~/surfcad-prod-build/.env.production` (see `docs/staging.md`). Never commit DSNs; `.env.example` uses empty placeholders.

### Backend (`@sentry/node`, Express)

| Env | Default | Notes |
| --- | --- | --- |
| `SENTRY_DSN` | *(empty)* | When unset, no-op. |
| `SENTRY_ENVIRONMENT` | `production` | |
| `SENTRY_TRACES_SAMPLE_RATE` | `0.2` | HTTP route tracing. |

- Init lives in `backend/monitoring/sentry.js` (imported only from `backend/server.js` so root `npm ci` unit tests never load `@sentry/node`).
- Scrubbing: `backend/monitoring/sentryScrub.js` (same rules as the browser).
- **Deploy:** set vars only in prod `/home/ubuntu/backend/.env.production`.

### nginx CSP (slice D)

`docs/nginx-snippets/surfcad-security.conf` adds Sentry ingest to **`connect-src`**:

`https://*.ingest.us.sentry.io`

### Source maps (follow-up)

Readable stack traces in Sentry need uploaded source maps (`SENTRY_AUTH_TOKEN`, CI secret, and a Vite/Sentry plugin). Not in slice D — add when ops is ready.

---

## Slice E — combined CSP (Sentry + PostHog + local agent bridge)

When PostHog (slice C) ships, update the same nginx snippet. Starting from `docs/nginx-snippets/surfcad-security.conf` on `main` after slice D, the proposed directive fragments are:

**`connect-src`** (add to the existing list):

`https://*.ingest.us.sentry.io https://us.i.posthog.com ws://127.0.0.1:17341 ws://localhost:17341`

The `ws://127.0.0.1:17341` / `ws://localhost:17341` entries are for the loopback agent-bridge relay (`scripts/vite-agent-bridge-ws.mjs`). If [PR #525](https://github.com/artur0x0/surfcad/pull/525) is merged, nginx may already include them — do not duplicate.

**`script-src`** (add to the existing list):

`https://us-assets.i.posthog.com`

Full proposed lines (single-line CSP values as in the snippet file):

```
script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval' https://challenges.cloudflare.com https://js.stripe.com https://cdn.jsdelivr.net https://us-assets.i.posthog.com
```

```
connect-src 'self' data: https://api.github.com https://cdn.sendcutsend.com https://api.stripe.com https://challenges.cloudflare.com https://*.stripe.com https://cdn.jsdelivr.net https://*.ingest.us.sentry.io https://us.i.posthog.com ws://127.0.0.1:17341 ws://localhost:17341
```

Install the updated `surfcad-security.conf` on the Hostinger box and reload nginx after each CSP change.

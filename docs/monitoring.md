# Monitoring and privacy

SurfCAD asks for analytics consent on first visit. Optional tracking (PostHog) stays off until **Accept all**. **Required only** stores an opt-out. People can change their mind from **Change privacy choices** on `/privacy`, **Privacy choices** in the profile menu, the Account pane, or the site footer.

Operational sign-up and login metrics for the US launch are sourced from **our MongoDB data** (slice A below) — no third-party analytics SDK in that slice.

## Consent module (`src/utils/consent.js`)

| API | Purpose |
| --- | --- |
| `getAnalyticsConsent()` | `true` when anonymous usage analytics may run in this browser tab. |
| `hasStoredConsentChoice()` | `true` when `surfcad.consent.v1` already has an analytics boolean. |
| `setAnalyticsConsent(boolean)` | Saves preference to `localStorage` (`surfcad.consent.v1`: `{ analytics, updatedAt, source? }`). |
| `shouldShowPrivacyConsentPopup()` | `true` on a first visit with no stored choice and GPC off. |
| `openPrivacyChoices()` | Re-opens the Accept all / Required only popup (`src/utils/privacyChoicesUi.js`). |
| `onConsentChange(cb)` | Fires when the effective consent value changes. |
| `isGpcActive()` | `true` when `navigator.globalPrivacyControl === true`. |

**Defaults:** analytics off until the user stores a choice. **Global Privacy Control (GPC)** is Required only: the popup is not shown, `{ analytics: false, source: 'gpc' }` is stored, `getAnalyticsConsent()` is `false` while GPC is set, and `setAnalyticsConsent(true)` cannot override that.

**Not gated by this toggle:** error and crash reporting (e.g. Sentry) — treated as essential operational telemetry so production issues can be diagnosed. PostHog and any other usage analytics must call `getAnalyticsConsent()` before sending events.

## Signed-in consent sync

- `User.consent` in MongoDB: `{ analytics: Boolean, updatedAt: Date }`, default analytics `true`.
- `PUT /api/auth/consent` (authenticated) persists changes from the Privacy choices dialog.
- On sign-in, `/api/auth/me` returns `user.consent`. If the server `updatedAt` is newer than `localStorage`, the client applies the server value (server wins).

Works with **no API keys** and **no network**: preferences live in `localStorage`; API calls fail quietly when the backend is unreachable.

## UI

A small non-blocking popup (`data-privacy-consent-popup`, bottom of the screen, above the CAD toolbar and the mobile home pill) asks on first visit:

- **Accept all** (green primary) — optional analytics may load
- **Required only** (grey secondary) — analytics stay off
- One line of copy plus a link to `/privacy`

`/privacy` (`src/pages/PrivacyPage.jsx`) always shows “Your browser's Global Privacy Control signal is honored” and **Change privacy choices**, which calls `openPrivacyChoices()`. The profile menu and Account pane **Privacy choices** rows use the same handler.

Later monitoring slices (PostHog, Sentry) should import `src/utils/consent.js` only — do not add parallel consent state. If gitleaks flags the storage key name `surfcad.consent.v1`, PR #566 handles the allowlist.

---

## Slice A: sign-ups and logins (MongoDB)

### User document (`users`)

| Field | Meaning |
| --- | --- |
| `createdAt` | Sign-up time (mongoose `timestamps`) |
| `consent` | Analytics preference when signed in (see above) |
| `lastLoginAt` | Last successful **app session** sign-in |
| `loginCount` | Number of recorded sign-ins |

Existing users are **not** backfilled for login fields; `lastLoginAt` stays unset until the next login.

### Login event log (`login_events`)

Minimal audit rows: `userId`, `at`, `method` (`password`, `verify`, `guest_convert`, `github`, `google`, `apple`).

No IP, user agent, or other PII. A TTL index on `at` expires documents after **400 days**.

### When a login is recorded

We append an event and bump `lastLoginAt` / `loginCount` only when Passport establishes a **new signed-in session** (`req.login`):

- Email/password (`POST /api/auth/login`)
- Email verification first sign-in (`POST /api/auth/verify`)
- Guest conversion (`POST /api/auth/guest/convert`)
- GitHub app sign-in (`POST /api/auth/github`)
- Google OAuth callback
- Apple OAuth callback

**Not** recorded:

- `GET /api/auth/me` or other authenticated reads
- `POST /api/github/oauth/refresh` (GitHub token renewal; browser session unchanged)
- Guest checkout sessions

### Active users

The admin report’s `activeUsers` total is distinct `login_events.userId` values in the requested window. Daily `series.activeUsers` is distinct users who logged in that UTC day. This is not a live socket count.

Assemblies and parts live in GitHub, and STEP conversions are files on disk — they are not Mongo collections, so they are omitted.

Quotes older than seven days may already have been TTL-deleted; the report counts whatever is still in `quotes`.

### Admin HTTP API

`GET /api/admin/stats?days=7|30|120` — JSON report of **counts only** (no emails, addresses, or other personal data):

- Daily UTC buckets for the window, zero-filled
- Totals for the window: sign-ups (`User.createdAt`), logins (`login_events`), active users (distinct login user ids), quotes (`quotedAt`), orders (`created-at`), partner form submissions (`partners.createdAt`)

Any other `days` value (including missing) returns **400**.

**Auth:** `isAdmin(user)` is true when the signed-in user’s `githubLogin` appears in `ADMIN_GITHUB_LOGINS` (comma-separated GitHub logins, case-insensitive). The list defaults to empty, so nobody is an admin until it is set in the production env file. If the allowlist is empty or the caller is not listed — including signed-out users — the route returns **404** (not 403), so it is not discoverable. The handler is rate-limited like other authenticated routes.

`GET /api/auth/me` includes `isAdmin: boolean` and `isInternal: boolean` (also on `user`).

Example (browser session cookie):

```bash
curl -sS -b cookies.txt 'https://api.surfcad.com/api/admin/stats?days=7' | jq .
```

The in-app view is `/admin` (lazily loaded). Non-admins see the 404 page.

### CLI script (production)

From the backend deploy directory (same env as the API):

```bash
cd /home/ubuntu/backend
sudo -u ubuntu NODE_ENV=production node scripts/stats.js --days 30
```

Table output:

```bash
sudo -u ubuntu NODE_ENV=production node scripts/stats.js --format table --days 7
```

Requires `MONGODB_URI` (loaded via `backend/config/index.js` and `.env.production`).

### Environment

```env
# Comma-separated GitHub logins for GET /api/admin/stats and /admin
# Empty means no admins. Set only in the server env file, not in git.
ADMIN_GITHUB_LOGINS=
```

---

## PostHog (slice C — US cloud)

**Client:** `src/utils/analytics.js` — lazy-loads `posthog-js` only when `VITE_POSTHOG_KEY` is set **and** `getAnalyticsConsent()` is true. If the key is unset (dev, staging, CI, tests), the SDK is never imported and no analytics network calls are made.

**Server:** `backend/services/posthog.js` — captures `signed_up` / `logged_in` from every auth path via the capture API when `POSTHOG_KEY` is set **and** the request’s consent allows it. Unset key → no-op.

| Env var | Default | Notes |
| --- | --- | --- |
| `VITE_POSTHOG_KEY` | *(unset)* | **Production browser build only**. |
| `VITE_POSTHOG_HOST` | `https://us.i.posthog.com` | US ingestion host (browser). |
| `POSTHOG_KEY` | *(unset)* | **Production API host only** (`~/backend/.env.production`). |
| `POSTHOG_HOST` | `https://us.i.posthog.com` | US ingestion host (server). |
| `POSTHOG_INTERNAL_USERS` | *(empty)* | Comma-separated GitHub logins and/or emails. Default empty; do not commit a real list. |

**Production keys:** set `VITE_POSTHOG_KEY` only in `~/surfcad-prod-build/.env.production` on spark, and `POSTHOG_KEY` only in the production API env. Do **not** add these to dev/staging env files or the repo.

**PostHog project settings (owner):** enable **Discard client IP data** in the PostHog project so IPs are not stored server-side (the client also sets `ip: false` and denies `$ip` properties).

### Behaviour

- Autocapture **off**, session recording **off** (`disable_session_recording: true`), surveys **off**.
- Page views: **manual** (`$pageview` after identity sync, then `popstate` for SPA navigations). `user_type` is `register`ed and set as a person property before the first `$pageview`.
- Persistence: **`localStorage` only** (no PostHog cookies).
- Consent: `opt_in_capturing()` / `opt_out_capturing()` when the user toggles analytics or GPC applies. Opt-out does **not** call `reset()`.
- Identity: anonymous by default; on sign-in, `identify(SHA-256(userId))` (hex via Web Crypto). Never email, name, or raw ids. Super property `user_type`: `guest` \| `signed_in`. `reset()` **only on sign-out**.
- Internal traffic: `GET /api/auth/me` returns `user.isInternal` from `POSTHOG_INTERNAL_USERS` (server-side). The client also registers `is_internal: true` on localhost / Vite dev.
- Web Vitals: one `web_vitals` event per page load (LCP, INP, CLS, FCP, TTFB) via the `web-vitals` package. CLS is the unrounded value (including `0`).
- Product events: `track(name, props)` with an allowlisted name set; props must not include user content (part names, filenames, code).
- Auth conversions: `signed_up` and `logged_in` are captured **server-side** (distinct id = SHA-256 of the user id). The client passes `analyticsConsent` from `getAnalyticsConsent()` only when `hasStoredConsentChoice()` is true; unknown (no stored choice) omits the field and the server skips unless Mongo already has a choice.

### Explicit events (`track`)

| Event | Properties | Answers |
| --- | --- | --- |
| `app_loaded` | `load_ms` | Time to interactive / boot. |
| `signed_up` | `method` | Registration conversions (server: email verify, guest convert, new OAuth). |
| `logged_in` | `method` | Login conversions (server: every new session). |
| `part_created` | — | New part rows in an assembly. |
| `assembly_created` | — | New assemblies started. |
| `feature_used` | `feature` (kind id, e.g. `fillet`, `extrude`) | Feature adoption; compare counts to the full feature kind list for **never-used** features. |
| `export_done` | `format` (`3mf`, `stl`, `step`) | Export usage. |
| `quote_requested` | `process`, `material`, `infill` | User proceeds with a quote (order or add-to-cart). |
| `checkout_started` | `line_count` | Cart checkout page opened. |
| `git_saved` | — | Successful git commit (or queued offline save). |
| `local_agent_paired` | — | Local MCP / agent bridge paired. |
| `partners_form_submitted` | `partner_type` | Partners lead form success. |

Additional automatic event: **`web_vitals`** (not via `track` allowlist) with `lcp`, `inp`, `cls`, `fcp`, `ttfb`. PostHog also attaches default browser/device properties on every capture.

`feature_used` is emitted on palette Confirm (`trackPaletteFeature` with the registry kind), when a new feature marker appears (`trackFeatureCommits` via `commitFeatureBuffer`), and on agent `confirm_feature` / helper insert. A unit test iterates `HELPER_PALETTE_ITEMS` so new features cannot be missed.

### Suggested PostHog insights

1. **Signups / logins** — trends on `signed_up` and `logged_in`.
2. **DAU guest vs signed-in** — unique users broken down by `user_type` (super property).
3. **Web vitals** — trends / distributions on `web_vitals` (LCP, INP, CLS, FCP, TTFB).
4. **Browser / device** — breakdown using PostHog’s default `$browser`, `$device_type`, OS properties.
5. **Feature usage** — `feature_used` counts by `feature`; join against the known feature kind list in product docs to highlight **zero-use** features.

### CSP (production nginx)

Add to `connect-src`:

```text
https://us.i.posthog.com
```

`posthog-js` is bundled via dynamic import; with session recording and surveys disabled, extra scripts from `https://us-assets.i.posthog.com` are **not** required for slice C. If a future PostHog version loads assets from that host, add to `script-src`:

```text
https://us-assets.i.posthog.com
```

Update `docs/nginx-snippets/surfcad-security.conf` when deploying analytics to production.

Regenerate `public/THIRD_PARTY_NOTICES.txt` with `node scripts/ci/generate-third-party-notices.mjs` whenever production npm dependencies change.

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

With slices C and D in the bundle, `docs/nginx-snippets/surfcad-security.conf` should include the combined directives. Reference fragments:

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

Install the updated `surfcad-security.conf` on the Hostinger box and reload nginx after each CSP change (`docs/ops/nginx-headers.md`).

**Bootstrap order:** `src/main.jsx` calls `bootstrapSentry()` before React render (consent-independent). PostHog starts from `bootAnalytics()` inside `AuthProvider` (`src/hooks/useAuth.jsx`), which listens to `onConsentChange` from `src/utils/consent.js`. Sentry and PostHog both hash user ids for identity; neither sends email or raw Mongo ids.

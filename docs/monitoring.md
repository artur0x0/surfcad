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

**Not gated by this toggle:** error and crash reporting (e.g. Sentry) — treated as essential operational telemetry so production issues can be diagnosed. PostHog and any other usage analytics must call `getAnalyticsConsent()` before sending events.

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

Later monitoring slices should import `src/utils/consent.js` only — do not add parallel consent state.

---

## PostHog (slice C — US cloud)

**Client:** `src/utils/analytics.js` — lazy-loads `posthog-js` only when `VITE_POSTHOG_KEY` is set **and** `getAnalyticsConsent()` is true. If the key is unset (dev, staging, CI, tests), the SDK is never imported and no analytics network calls are made.

| Env var | Default | Notes |
| --- | --- | --- |
| `VITE_POSTHOG_KEY` | *(unset)* | **Production only** — see below. |
| `VITE_POSTHOG_HOST` | `https://us.i.posthog.com` | US ingestion host. |

**Production keys:** set only in `~/surfcad-prod-build/.env.production` on spark (`VITE_POSTHOG_KEY`, optional `VITE_POSTHOG_HOST`). Do **not** add these to dev/staging env files or the repo.

**PostHog project settings (owner):** enable **Discard client IP data** in the PostHog project so IPs are not stored server-side (the client also sets `ip: false` and denies `$ip` properties).

### Behaviour

- Autocapture **off**, session recording **off** (`disable_session_recording: true`), surveys **off**.
- Page views: **manual** (`$pageview` on load and `popstate` for SPA navigations).
- Persistence: **`localStorage` only** (no PostHog cookies).
- Consent: `opt_in_capturing()` / `opt_out_capturing()` when the user toggles analytics or GPC applies.
- Identity: anonymous by default; on sign-in, `identify(SHA-256(userId))` (hex via Web Crypto). Never email, name, or raw ids. Super property `user_type`: `guest` \| `signed_in`. `reset()` on sign-out.
- Web Vitals: one `web_vitals` event per page load (LCP, INP, CLS, FCP, TTFB) via the `web-vitals` package.
- Product events: `track(name, props)` with an allowlisted name set; props must not include user content (part names, filenames, code).

### Explicit events (`track`)

| Event | Properties | Answers |
| --- | --- | --- |
| `app_loaded` | `load_ms` | Time to interactive / boot. |
| `signed_up` | — | Registration conversions. |
| `logged_in` | — | Login conversions. |
| `part_created` | — | New part rows in an assembly. |
| `assembly_created` | — | New assemblies started. |
| `feature_used` | `feature` (kind id, e.g. `fillet`, `extrude`) | Feature adoption; compare counts to the full feature kind list for **never-used** features. |
| `export_done` | `format` (`3mf`, `stl`, `step`) | Export usage. |
| `quote_requested` | — | Manufacturing quote intent. |
| `checkout_started` | — | Cart checkout opened. |
| `git_saved` | — | Successful git commit (or queued offline save). |
| `local_agent_paired` | — | Local MCP / agent bridge paired. |
| `partners_form_submitted` | — | Partners lead form success. |

Additional automatic event: **`web_vitals`** (not via `track` allowlist) with `lcp`, `inp`, `cls`, `fcp`, `ttfb`. PostHog also attaches default browser/device properties on every capture.

`feature_used` is emitted from `trackFeatureCommits` when a new feature marker appears in the part script (wired through `commitFeatureBuffer` and palette insert).

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

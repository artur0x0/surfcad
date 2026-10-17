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

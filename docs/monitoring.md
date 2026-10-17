# Monitoring and privacy

SurfCAD’s US launch uses an **opt-out** model for product analytics: usage analytics are **on by default**, there is **no cookie banner**, and people can change their mind any time from **Privacy choices** in the site footer.

Operational sign-up and login metrics for the US launch are sourced from **our MongoDB data** (slice A below) — no third-party analytics SDK in that slice.

## Consent module (`src/utils/consent.js`)

| API | Purpose |
| --- | --- |
| `getAnalyticsConsent()` | `true` when anonymous usage analytics may run in this browser tab. |
| `setAnalyticsConsent(boolean)` | Saves preference to `localStorage` (`surfcad.consent.v1`: `{ analytics, updatedAt }`). |
| `onConsentChange(cb)` | Fires when the effective consent value changes. |
| `isGpcActive()` | `true` when `navigator.globalPrivacyControl === true`. |

**Defaults:** analytics allowed unless the stored record says otherwise. **Global Privacy Control (GPC)** always counts as opt-out: `getAnalyticsConsent()` is `false` while GPC is set, and `setAnalyticsConsent(true)` cannot override that.

**Not gated by this toggle:** error and crash reporting (e.g. Sentry) — treated as essential operational telemetry so production issues can be diagnosed. PostHog (slice C) and any other usage analytics must call `getAnalyticsConsent()` before sending events.

## Signed-in consent sync

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

### Active signed-in users

`activeSignedInUsers` counts users whose `lastLoginAt` falls within the rolling session window (`SESSION_MAX_AGE_MS`, 30 days in `src/utils/sessionPolicy.js`). This approximates users who could still have a valid server session, not live socket counts.

### Admin HTTP API

`GET /api/admin/stats` — JSON report:

- Sign-ups per day (last 30), week (last 12), month (last 12) from `User.createdAt`
- Logins and distinct logging-in users per day/week/month from `login_events`
- `totalUsers`, `activeSignedInUsers`, `generatedAt`

**Auth:** caller must be signed in and their Mongo `_id` must appear in `ADMIN_USER_IDS` (comma-separated in `.env.production`). If the allowlist is empty or the user is not listed, the route returns **404** (not 401).

Example (browser session cookie):

```bash
curl -sS -b cookies.txt https://api.surfcad.com/api/admin/stats | jq .
```

### CLI script (production)

From the backend deploy directory (same env as the API):

```bash
cd /home/ubuntu/backend
sudo -u ubuntu NODE_ENV=production node scripts/stats.js
```

Table output:

```bash
sudo -u ubuntu NODE_ENV=production node scripts/stats.js --format table
```

Requires `MONGODB_URI` (loaded via `backend/config/index.js` and `.env.production`).

### Environment

```env
# Comma-separated Mongo User _id values for GET /api/admin/stats
ADMIN_USER_IDS=507f1f77bcf86cd799439011,507f191e810c19729de860ea
```

Find your `_id` in MongoDB or from an admin session’s `/api/auth/me` response.

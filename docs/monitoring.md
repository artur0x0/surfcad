# Monitoring (slice A)

US-only launch metrics are sourced from our MongoDB data — no third-party analytics SDK.

## What we store

### User document (`users`)

| Field | Meaning |
| --- | --- |
| `createdAt` | Sign-up time (mongoose `timestamps`) |
| `lastLoginAt` | Last successful **app session** sign-in |
| `loginCount` | Number of recorded sign-ins |

Existing users are **not** backfilled; `lastLoginAt` stays unset until the next login.

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

## Active signed-in users

`activeSignedInUsers` counts users whose `lastLoginAt` falls within the rolling session window (`SESSION_MAX_AGE_MS`, 30 days in `src/utils/sessionPolicy.js`). This approximates users who could still have a valid server session, not live socket counts.

## Admin HTTP API

`GET /api/admin/stats` — JSON report:

- Sign-ups per day (last 30), week (last 12), month (last 12) from `User.createdAt`
- Logins and distinct logging-in users per day/week/month from `login_events`
- `totalUsers`, `activeSignedInUsers`, `generatedAt`

**Auth:** caller must be signed in and their Mongo `_id` must appear in `ADMIN_USER_IDS` (comma-separated in `.env.production`). If the allowlist is empty or the user is not listed, the route returns **404** (not 401).

Example (browser session cookie):

```bash
curl -sS -b cookies.txt https://api.surfcad.com/api/admin/stats | jq .
```

## CLI script (production)

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

## Environment

```env
# Comma-separated Mongo User _id values for GET /api/admin/stats
ADMIN_USER_IDS=507f1f77bcf86cd799439011,507f191e810c19729de860ea
```

Find your `_id` in MongoDB or from an admin session’s `/api/auth/me` response.

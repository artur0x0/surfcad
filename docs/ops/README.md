# Production operations

Runbooks for the Hostinger production box. The Cloud Agent ships files under `docs/`; it does not SSH or reload prod.

| Topic | Doc |
| --- | --- |
| nginx site + security headers (CSP, HSTS, local agent relay) | [nginx-headers.md](./nginx-headers.md) |
| Upload folder prune timer + `User.dob` migration | [upload-prune.md](./upload-prune.md) |
| PostHog, Sentry, consent, admin stats | [../monitoring.md](../monitoring.md) |
| Staging host layout | [../staging.md](../staging.md) |

**Repo config sources**

| File | Install path on prod |
| --- | --- |
| [../nginx-surfcad.com.conf](../nginx-surfcad.com.conf) | `/etc/nginx/sites-enabled/surfcad.com` |
| [../nginx-snippets/surfcad-security.conf](../nginx-snippets/surfcad-security.conf) | `/etc/nginx/snippets/surfcad-security.conf` |
| `deploy/systemd/surfcad-upload-prune.{service,timer}` | `/etc/systemd/system/` |

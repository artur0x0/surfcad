# Upload folder prune (production)

`POST /api/convert/step` writes multer uploads and OBJ output under `UPLOAD_FOLDER` (`config.uploadFolder`). The convert route deletes each request's input and output in a `finally` block on success and on error. The systemd timer below is a **safety net** for leftovers when the Node process dies without running that cleanup (kill -9, OOM, host crash).

**Status:** timer units are in the repo; Artur has not enabled them on prod yet.

## What runs

- **Script:** `backend/scripts/prune-uploads.js` (shipped with the backend rsync; no extra npm deps).
- **Schedule:** `surfcad-upload-prune.timer` — hourly, `Persistent=true`.
- **Service:** `surfcad-upload-prune.service` — oneshot, `User=ubuntu`, `WorkingDirectory=/home/ubuntu/backend`, `NODE_ENV=production`.

The script reads `UPLOAD_FOLDER` from the same config loader as the API (`backend/config/index.js`, `.env.production` on the server). It deletes **regular files** (not directories) whose mtime is older than 24 hours by default. It refuses to run against `/`, the home directory, or an empty path.

## Install on prod (Artur)

From a machine with this repo checked out:

```bash
sudo cp deploy/systemd/surfcad-upload-prune.service /etc/systemd/system/
sudo cp deploy/systemd/surfcad-upload-prune.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now surfcad-upload-prune.timer
```

Dry-run (lists candidates, deletes nothing):

```bash
cd /home/ubuntu/backend
sudo -u ubuntu NODE_ENV=production node scripts/prune-uploads.js --dry-run
```

Real run (same as the timer):

```bash
sudo -u ubuntu NODE_ENV=production node scripts/prune-uploads.js
```

Verify the timer and recent runs:

```bash
systemctl list-timers surfcad-upload-prune.timer
journalctl -u surfcad-upload-prune.service -n 50 --no-pager
```

Manual one-shot (same as the timer):

```bash
sudo systemctl start surfcad-upload-prune.service
```

## One-off: remove `User.dob` from Mongo

The `dob` field was removed from `backend/db/models/User.js` (nothing in the app read or wrote it). Existing documents may still have the key.

Run **once** on production after deploying the schema change:

```bash
cd /home/ubuntu/backend
sudo -u ubuntu NODE_ENV=production node scripts/unset-user-dob.js --dry-run
sudo -u ubuntu NODE_ENV=production node scripts/unset-user-dob.js
```

The migration is idempotent: a second run matches zero users.

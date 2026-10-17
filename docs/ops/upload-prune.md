# Upload folder prune (production)

`POST /api/convert/step` writes multer uploads and OBJ output under `UPLOAD_FOLDER` (`config.uploadFolder`). The convert route deletes each request's input and output in a `finally` block on success and on error. The systemd timer below is a **safety net** for leftovers when the Node process dies without running that cleanup (kill -9, OOM, host crash).

**Status:** timer units are in the repo; they are **not enabled on prod** until Artur runs the steps below.

## Guards (read before enabling)

- **`UPLOAD_FOLDER` is required in production.** The API refuses to start, and the prune script refuses to run, if it is unset or the literal string `undefined` (that is what Node interpolates when the env var is missing). Never prune a folder named `undefined`.
- **Refuse if `UPLOAD_FOLDER` is `WORKING_FOLDER` or a parent of it.** That path holds `obj_converter`. The prune script exits 1 with a clear message.
- **Name filter.** Only regular files matching a known leftover name are deleted:
  - multer dest: 32 lowercase hex chars (no extension)
  - converter output: `conv_<sanitized-name>_<timestamp>.obj`
- Directories, symlinks, `obj_converter`, and anything else are left alone.

Confirm both paths on the box before the first dry-run:

```bash
# on the prod backend host, as ubuntu
cd /home/ubuntu/backend
sudo -u ubuntu bash -lc 'set -a; source .env.production; set +a; echo UPLOAD_FOLDER="$UPLOAD_FOLDER"; echo WORKING_FOLDER="$WORKING_FOLDER"'
```

`UPLOAD_FOLDER` must be a dedicated directory (for example `/tmp/surfcad-uploads`). It must not be the converter directory.

## Enable the timer (Artur)

Do these in order. Dry-run first. Do not enable the timer until the dry-run looks right.

### 1. Install the units (once per host)

From a checkout that contains `deploy/systemd/`:

```bash
sudo cp deploy/systemd/surfcad-upload-prune.service /etc/systemd/system/
sudo cp deploy/systemd/surfcad-upload-prune.timer /etc/systemd/system/
sudo systemctl daemon-reload
```

### 2. Dry-run first (deletes nothing)

```bash
cd /home/ubuntu/backend
sudo -u ubuntu NODE_ENV=production node scripts/prune-uploads.js --dry-run
```

Expected:

- Lines like `would delete: /path/to/UPLOAD_FOLDER/<32-hex>` or `conv_….obj`
- A summary: `dry-run: N file(s) would be removed from <UPLOAD_FOLDER>`
- Exit 0

Refuse (exit 1) — fix env and retry the dry-run; do not enable the timer:

- `UPLOAD_FOLDER is required in production…`
- `UPLOAD_FOLDER is the literal string "undefined"…`
- `Refusing to prune: UPLOAD_FOLDER is the same path as WORKING_FOLDER`
- `Refusing to prune: UPLOAD_FOLDER is a parent of WORKING_FOLDER`

### 3. One real run (same as the timer)

Only after the dry-run listed the right files:

```bash
cd /home/ubuntu/backend
sudo -u ubuntu NODE_ENV=production node scripts/prune-uploads.js
```

Expected: `pruned N file(s), freed M byte(s) from <UPLOAD_FOLDER>`

### 4. Enable the hourly timer

```bash
sudo systemctl enable --now surfcad-upload-prune.timer
```

### 5. Verify

```bash
systemctl is-enabled surfcad-upload-prune.timer
systemctl list-timers surfcad-upload-prune.timer
sudo systemctl start surfcad-upload-prune.service
journalctl -u surfcad-upload-prune.service -n 50 --no-pager
```

`is-enabled` should print `enabled`. `list-timers` should show a next run within an hour. The journal should show the same `pruned N file(s)…` line (or `dry-run` if you still passed `--dry-run` by mistake — the unit file does not).

## What the units run

- **Script:** `backend/scripts/prune-uploads.js` (shipped with the backend rsync; no extra npm deps).
- **Schedule:** `surfcad-upload-prune.timer` — hourly, `Persistent=true`.
- **Service:** `surfcad-upload-prune.service` — oneshot, `User=ubuntu`, `WorkingDirectory=/home/ubuntu/backend`, `NODE_ENV=production`.

The script reads `UPLOAD_FOLDER` and `WORKING_FOLDER` from the same config loader as the API (`backend/config/index.js`, `.env.production` on the server). Default max age is 24 hours (`--max-age-hours`).

## One-off: remove `User.dob` from Mongo

The `dob` field was removed from `backend/db/models/User.js` (nothing in the app read or wrote it). Existing documents may still have the key.

Run **once** on production after deploying the schema change:

```bash
cd /home/ubuntu/backend
sudo -u ubuntu NODE_ENV=production node scripts/unset-user-dob.js --dry-run
sudo -u ubuntu NODE_ENV=production node scripts/unset-user-dob.js
```

The migration is idempotent: a second run matches zero users.

# Spark staging

Staging runs on the **spark** host under `~/3dculos` (SurfCAD frontend + Express backend). Public URLs point here for pre-production checks.

## What runs

| Process | Port | Working tree | Config |
|--------|------|--------------|--------|
| **Backend** (`3dculos` Express) | **3000** | `~/3dculos/backend` | `backend/.env.development` (read at startup; no auto-reload) |
| **Frontend** (Vite dev server) | **5173** | `~/3dculos` (repo root) | Repo-root `.env*` files (`VITE_*` only) |

Vite proxies `/api` to the backend on port 3000 (same as local `npm run dev`).

## Do not start the backend by hand

The staging backend is managed by a **systemd user unit**. Do not run `node server.js`, `npm run dev` in `backend/`, or other one-off starts for staging—the unit owns the process and logging.

After editing `backend/.env.development`, restart the unit so the backend picks up changes.

## Backend: systemd user unit

Unit file on spark: `~/.config/systemd/user/surfcad-staging-backend.service` (user linger enabled so it survives logout).

```ini
[Unit]
Description=SurfCAD staging backend (3dculos :3000)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=%h/3dculos/backend
Environment=NODE_ENV=development
Environment=UPLOAD_FOLDER=/tmp/surfcad-uploads
Environment=WORKING_FOLDER=/home/artur/3dculos/backend/converter
ExecStart=/home/artur/.hermes/node/bin/node server.js
Restart=on-failure
RestartSec=3
StandardOutput=append:/tmp/3dculos-backend.log
StandardError=append:/tmp/3dculos-backend.log

[Install]
WantedBy=default.target
```

**Keeps it alive:** systemd restarts the service on failure (`Restart=on-failure`).

**Hermes Node:** `ExecStart` uses the Node binary installed by Hermes (`~/.hermes/node`). If Hermes upgrades or moves that install, update `ExecStart` in the unit file and run `systemctl --user daemon-reload`.

### Backend commands

```bash
systemctl --user start surfcad-staging-backend
systemctl --user stop surfcad-staging-backend
systemctl --user restart surfcad-staging-backend
systemctl --user status surfcad-staging-backend
journalctl --user -u surfcad-staging-backend
tail -f /tmp/3dculos-backend.log
```

## Frontend

Started manually as a detached process:

```bash
cd ~/3dculos
setsid nohup npm run dev &
```

**Keeps it alive:** nothing—there is no supervisor. A reboot or crash does not bring Vite back; start it again when needed.

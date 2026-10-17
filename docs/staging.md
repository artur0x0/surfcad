# Spark staging

Staging runs on the **spark** host under `~/3dculos` (SurfCAD frontend + Express backend). Public URLs point here for pre-production checks.

## What runs

| Process | Port | Working tree | Config |
|--------|------|--------------|--------|
| **Backend** (`3dculos` Express) | **3000** | `~/3dculos/backend` | `backend/.env.development` (read at startup; no auto-reload) |
| **Frontend** (Vite dev server) | **5173** | `~/3dculos` (repo root) | Repo-root `.env*` files (`VITE_*` only; no auto-reload) |

Vite proxies `/api` to the backend on port 3000 (same as local `npm run dev`).

Both processes are managed by **systemd user units** (`linger` enabled on spark so they survive logout and reboot).

## Do not start staging by hand

The units own the processes and logs. Do not:

- run `node server.js` or `npm run dev` in `backend/` for staging
- run `npm run dev` in `~/3dculos` — it conflicts with `surfcad-staging-frontend` on port **5173**

After editing `backend/.env.development` or repo-root `.env*` (`VITE_*`), restart the matching unit so the process picks up changes.

## Systemd user units

Unit files on spark:

- `~/.config/systemd/user/surfcad-staging-backend.service`
- `~/.config/systemd/user/surfcad-staging-frontend.service`

### Backend (`surfcad-staging-backend`)

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

**Keeps it alive:** systemd (`Restart=on-failure`).

```bash
systemctl --user start surfcad-staging-backend
systemctl --user stop surfcad-staging-backend
systemctl --user restart surfcad-staging-backend
systemctl --user status surfcad-staging-backend
journalctl --user -u surfcad-staging-backend
tail -f /tmp/3dculos-backend.log
```

### Frontend (`surfcad-staging-frontend`)

```ini
[Unit]
Description=SurfCAD staging frontend (3dculos Vite :5173)
After=network-online.target surfcad-staging-backend.service
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=%h/3dculos
Environment=NODE_ENV=development
Environment=PATH=/home/artur/.hermes/node/bin:/home/artur/3dculos/node_modules/.bin:/home/artur/.local/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=/home/artur/.hermes/node/bin/node /home/artur/3dculos/node_modules/vite/bin/vite.js --host
Restart=on-failure
RestartSec=3
StandardOutput=append:/tmp/3dculos-vite.log
StandardError=append:/tmp/3dculos-vite.log

[Install]
WantedBy=default.target
```

**Keeps it alive:** systemd (`Restart=on-failure`). Starts after the backend unit.

```bash
systemctl --user start surfcad-staging-frontend
systemctl --user stop surfcad-staging-frontend
systemctl --user restart surfcad-staging-frontend
systemctl --user status surfcad-staging-frontend
journalctl --user -u surfcad-staging-frontend
tail -f /tmp/3dculos-vite.log
```

### Hermes Node

Both units use Node from Hermes (`~/.hermes/node`). If Hermes upgrades or moves that install, update `ExecStart` (and the frontend `PATH` if needed), then `systemctl --user daemon-reload`.

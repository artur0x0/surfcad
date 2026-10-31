# Agent relay pre-deploy checklist

The relay code is in the app. These steps are still manual. This file does not install them, and it does not change nginx or any env file.

## nginx `/agent`

Paste the location block from [agent-relay-nginx.md](./agent-relay-nginx.md) into the surfcad.com server block. It is not in [../nginx-surfcad.com.conf](../nginx-surfcad.com.conf). Do not set `Cross-Origin-Opener-Policy: same-origin`.

That block sets `X-Forwarded-For` to `$proxy_add_x_forwarded_for` and `X-Real-IP` to `$remote_addr`. Leave those lines in. The app reads the client address from `X-Forwarded-For` using the hop count below.

## City lookup

Leave `AGENT_CITY_LOOKUP` unset. The approval sentence then has no city and the server makes no geo request. Set it to `1`, `true`, or `on` only when that line is wanted. See [agent-city-lookup.md](./agent-city-lookup.md). Do not add the flag to a tracked env file.

## Trust proxy

`TRUST_PROXY_HOPS` defaults to `1`, which matches one nginx hop in front of Node. Express uses that for `req.ip` on `/agent` HTTP routes (pairing limits and city lookup). WebSocket upgrades are not Express requests, so they use the same hop count separately.

With one hop, the client address is the rightmost `X-Forwarded-For` value, the one nginx appended. A prefix the browser sent is ignored. Raising the hop count trusts more of that prefix and lets a client spoof its address. Set the value to the number of proxies that append the header. Do not put it in a tracked env file.

## One Node process

Pairing codes, in-flight commands, tab presence, and live sockets live in memory in the Node process that serves `/agent`. Run that process alone. Cluster mode, a pm2 cluster, and `WEB_CONCURRENCY` above 1 split that state, so a command accepted on one worker never reaches the tab on another. Startup logs a warning when it detects a worker, `NODE_APP_INSTANCE`, or `WEB_CONCURRENCY` greater than 1. The process still boots. This does not change nginx or any env file. Leave the process count at one.

## `ws` install

The relay's WebSocket server is the `ws` package declared in `backend/package.json`. Production runs the backend process, so install it with `npm ci --prefix backend` (the repo root `npm ci` installs the root copy used by the local relay). An install that skips that step fails when a browser or an agent upgrades `/agent`.

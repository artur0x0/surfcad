# nginx location for the agent relay

This is **documentation only**. It is not part of [../nginx-surfcad.com.conf](../nginx-surfcad.com.conf) and nothing in this repo installs it. Artur pastes it on the box when the server relay should go live. Do not add `Cross-Origin-Opener-Policy: same-origin`.

`/api/` stays as it is. `/agent` is a separate location because WebSocket, long-poll, and SSE need a long read timeout and buffering off. The approval page, device-code routes, and command fallback all live under `/agent` so this one block covers them.

`map` is valid in the `http` context, not inside `server`. Add it once if the http block does not already define `$connection_upgrade`.

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}
```

Inside the `surfcad.com` / `www.surfcad.com` `server` block:

```nginx
location /agent {
    proxy_pass http://localhost:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
    proxy_buffering off;
    proxy_cache off;
}
```

`proxy_read_timeout` is one hour, which is the minimum for a tab socket that stays open. `proxy_buffering off` is what lets SSE flush. The app also sends `X-Accel-Buffering: no` on the event stream.

Vite dev (`vite.config.js` `server.proxy`) proxies the same path to `http://localhost:3000` with `ws: true`. The key is the regex `^/agent(/|\?|$)`, so `/agent`, `/agent/`, and `/agent?…` reach the backend and `/agentx` stays on the SPA. Without that proxy the tab socket and the approval page hit `index.html`. `preview.proxy` is only `/api`. Preview would otherwise inherit the dev proxy, and a playtest page opening `ws://127.0.0.1:<port>/agent` with no backend would fail the handshake.

The approval page can name a city. That lookup is off unless `AGENT_CITY_LOOKUP` is set on the server. See [agent-city-lookup.md](./agent-city-lookup.md).

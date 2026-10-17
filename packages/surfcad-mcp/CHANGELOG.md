# Changelog

## Unreleased

- Fixed: when the SurfCAD tab's socket dropped mid-session, the next tool call hung until the MCP client timed out (`-32001`), and later calls failed with `pair_failed` ("No SurfCAD tab is advertising this pairing code"). Tool calls now return `pairing_lost` within about a second while the link is down, with the hint "Open SurfCAD in Chrome and keep the tab open; it will reconnect." A call already in flight is rejected the same way.
- The connection now recovers by itself. The tab reconnects with backoff (and right away when it becomes visible or goes back online), and the server re-pairs with the same code in the background. The tab re-approves its own earlier pairing without a new Allow prompt. A different client with the same code still has to be allowed in SurfCAD. If the process that owned the relay exits, another running `surfcad-mcp` takes over the port. Closing the account panel does not drop the pairing: the tab connection stays mounted on the profile chip.
- The relay pings every socket every 5 s and drops any socket that misses a ping (`SURFCAD_AGENT_BRIDGE_HEARTBEAT_MS` to tune it). Drops, heartbeat timeouts and pairing ends are logged on stderr with a timestamp and reason. Pairing codes are redacted and secrets are never logged. Relay logging no longer writes to stdout, where verbose mode used to corrupt the MCP stdio stream.
- `unknown_token` is now reported as `unknown_token` (it used to come back as `pair_failed`). A bridge call that has to pair first waits at most about a second for Allow, then returns `pair_pending`. The `pair` tool returns `pair_pending` after 30 s instead of running into the client timeout.

## 0.2.0

- `npx surfcad-mcp` starts (or reuses) the loopback agent-bridge relay on `127.0.0.1:17341` so production https://surfcad.com tabs can pair without the Vite dev server.
- Safari is not supported yet: it blocks `ws://127.0.0.1` connections from https pages.

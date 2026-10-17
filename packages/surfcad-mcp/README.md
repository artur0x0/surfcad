# surfcad-mcp

Stdio [Model Context Protocol](https://modelcontextprotocol.io/) server for the SurfCAD browser agent bridge. Each tool maps to one `window.surfcad` command from the shipped command catalog (`data/commands.json`). The server pairs to your open SurfCAD tab through the **M1** loopback WebSocket relay (`ws://127.0.0.1:17341` by default).

## Install and run

```bash
npx surfcad-mcp
```

The process speaks MCP over **stdio** and **starts the local relay** on `127.0.0.1:17341` (loopback only). If another process is already listening there (a second MCP client or the SurfCAD dev server), it reuses that relay instead of failing.

Pair it to a running SurfCAD tab (see below), then your MCP client can call bridge tools (`status`, `set_script`, `run`, …) plus a `pair` helper.

Environment variables:

| Variable | Purpose |
| --- | --- |
| `SURFCAD_PAIRING_CODE` | 6-character code from the SurfCAD **Local agent** panel (optional if you use the `pair` tool). |
| `SURFCAD_AGENT_BRIDGE_WS_URL` | Relay URL (default `ws://127.0.0.1:17341`). |
| `SURFCAD_MCP_START_RELAY` | Set to `0` to skip starting the relay (tests only). |

## Pair with SurfCAD (Local agent)

1. Open [https://surfcad.com](https://surfcad.com) (or local dev).
2. Open the **profile** menu → **Local agent** → **Show pairing code** and leave the tab open.
3. Add `surfcad-mcp` to your MCP client (`npx surfcad-mcp`), set `SURFCAD_PAIRING_CODE` to that code, or call the MCP **`pair`** tool with `{ "code": "ABCDEF" }`.
4. Click **Allow connection** in SurfCAD when prompted.

Nothing pairs silently — you must show the code and approve the connection.

## MCP client config (Cursor / Claude Desktop)

```json
{
  "mcpServers": {
    "surfcad": {
      "command": "npx",
      "args": ["-y", "surfcad-mcp"],
      "env": {
        "SURFCAD_PAIRING_CODE": "ABCDEF"
      }
    }
  }
}
```

In Cursor, add the same block under **Settings → MCP** or your project `.cursor/mcp.json`.

## Safety and consent

- **Commerce:** Agents cannot place orders or drive checkout. Quote/cart/checkout controls are not exposed as MCP tools.
- **Git on real repos:** Writes may return `real_repo_blocked` until the user consents in the app.
- **Destructive git operations:** Need explicit approval; the bridge returns `confirm_required` unless args include `confirm: true` after the user has confirmed in SurfCAD.

Bridge refusals (`real_repo_blocked`, `confirm_required`, `not_paired`, user deny, etc.) are returned as structured JSON in MCP tool errors.

## Connection drops

If the SurfCAD tab or the relay goes away mid-session, tool calls return `pairing_lost` right away (with a `hint`) instead of waiting for the MCP client timeout. The server keeps re-pairing in the background with the same code. The tab reconnects by itself, so calls start working again once SurfCAD is back in Chrome, with no new code and no reload. A call made while you still need to click Allow returns `pair_pending`. The relay pings every socket every 5 s (`SURFCAD_AGENT_BRIDGE_HEARTBEAT_MS`) and logs each drop on stderr with a timestamp and reason. Pairing codes are redacted in the log. Set `SURFCAD_AGENT_BRIDGE_WS_VERBOSE=1` to also log routine pairing events.

## Monorepo maintenance

In the [SurfCAD monorepo](https://github.com/artur0x0/surfcad), `npm run export:agent` regenerates `data/commands.json` from `src/agent/commands.json`. CI fails if that copy is stale (`test/commandsFreshness.test.mjs`). Before publishing, run `export:agent` and `npm run smoke:pack` in this package.

Agent-oriented guide: [`docs/agent/SKILL.md`](https://github.com/artur0x0/surfcad/blob/main/docs/agent/SKILL.md). Scripted demo from a full checkout: `npm run demo:mcp` at the repo root.

## Releasing to npm

The [`surfcad-mcp`](https://www.npmjs.com/package/surfcad-mcp) package is published from GitHub Actions (workflow [`.github/workflows/publish-mcp.yml`](../../.github/workflows/publish-mcp.yml)) using [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers) (OIDC). The trusted publisher is configured on npm for this repository and workflow file — no `NPM_TOKEN` is stored in GitHub.

Ways to release a new version:

1. **Version bump on `main`** — In a PR, bump `version` in `packages/surfcad-mcp/package.json`. After merge, when the **CI** workflow completes successfully on `main` and the version differs from the parent commit, publish runs automatically (skipped if that version is already on npm).
2. **Git tag** — Push a tag `surfcad-mcp-vX.Y.Z` that exactly matches the `version` field at that commit (for example `surfcad-mcp-v0.2.0` for `"version": "0.2.0"`).
3. **Manual** — In GitHub → Actions → **Publish surfcad-mcp** → **Run workflow** on branch `main`.

Before bumping, run `npm run export:agent` at the repo root if the command catalog changed, and `npm test` plus `npm run smoke:pack` in this package.

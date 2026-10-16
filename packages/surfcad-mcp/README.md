# surfcad-mcp

Stdio [Model Context Protocol](https://modelcontextprotocol.io/) server for the SurfCAD browser agent bridge. Each tool maps to one `window.surfcad` command from `src/agent/commands.json` (generated at build/export time). The server pairs to your open SurfCAD tab through the **M1** loopback WebSocket relay (`ws://127.0.0.1:17341` by default).

Agent-oriented guide (pairing, loop, stable ids, errors): [`docs/agent/SKILL.md`](../../docs/agent/SKILL.md). Scripted demo: `npm run demo:mcp` from the repo root.

## Prerequisites

1. Run SurfCAD with the agent bridge on (`npm run dev`, or `?agent=1` / `localStorage surfcadAgent=1`).
2. In the app, open **Local agent** → **Show pairing code** and keep the tab open.
3. Ensure the relay is running (started automatically with `vite` dev / `vite preview`).

## Pairing

- Set **`SURFCAD_PAIRING_CODE`** to the 6-character code, or call the MCP **`pair`** tool with `{ "code": "ABCDEF" }`.
- Click **Allow connection** in SurfCAD when prompted.
- Optional: **`SURFCAD_AGENT_BRIDGE_WS_URL`** (default `ws://127.0.0.1:17341`) if the relay uses a non-default port.

Bridge refusals such as **`real_repo_blocked`** and **`confirm_required`** are returned unchanged in the tool error JSON.

## Run locally

From the repository root (after `npm ci`):

```bash
SURFCAD_PAIRING_CODE=ABCDEF node packages/surfcad-mcp/bin/surfcad-mcp.js
```

## Claude Desktop / Cursor MCP config

Use the absolute path to this repo on your machine:

```json
{
  "mcpServers": {
    "surfcad": {
      "command": "node",
      "args": ["/path/to/surfcad/packages/surfcad-mcp/bin/surfcad-mcp.js"],
      "env": {
        "SURFCAD_PAIRING_CODE": "ABCDEF"
      }
    }
  }
}
```

In Cursor, add the same block under **Settings → MCP** (or your project's `.cursor/mcp.json`).

## Catalog sync

`npm run export:agent` refreshes `data/commands.json` from the live command registry. CI fails if that copy is stale (`packages/surfcad-mcp/test/commandsFreshness.test.mjs`).

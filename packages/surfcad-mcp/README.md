# surfcad-mcp

Stdio [Model Context Protocol](https://modelcontextprotocol.io/) server for the SurfCAD browser agent bridge. Each tool maps to one `window.surfcad` command from the shipped command catalog (`data/commands.json`). The server pairs to your open SurfCAD tab through the **M1** loopback WebSocket relay (`ws://127.0.0.1:17341` by default).

## Install and run

```bash
npx surfcad-mcp
```

The process speaks MCP over **stdio**. Pair it to a running SurfCAD tab (see below), then your MCP client can call bridge tools (`status`, `set_script`, `run`, …) plus a `pair` helper.

Environment variables:

| Variable | Purpose |
| --- | --- |
| `SURFCAD_PAIRING_CODE` | 6-character code from the SurfCAD **Local agent** panel (optional if you use the `pair` tool). |
| `SURFCAD_AGENT_BRIDGE_WS_URL` | Relay URL (default `ws://127.0.0.1:17341`). |

## Pair with SurfCAD (Local agent)

1. Run SurfCAD with the agent bridge on (`npm run dev` in the [SurfCAD repo](https://github.com/artur0x0/surfcad), or open the app with `?agent=1` / `localStorage surfcadAgent=1`).
2. Open the **profile** menu → **Local agent** → **Show pairing code** and leave the tab open.
3. Start `surfcad-mcp` with that code in `SURFCAD_PAIRING_CODE`, or call the MCP **`pair`** tool with `{ "code": "ABCDEF" }`.
4. Click **Allow connection** in SurfCAD when prompted.

The Vite dev/preview server starts the relay automatically. Nothing pairs silently — you must show the code and approve the connection.

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

## Monorepo maintenance

In the [SurfCAD monorepo](https://github.com/artur0x0/surfcad), `npm run export:agent` regenerates `data/commands.json` from `src/agent/commands.json`. CI fails if that copy is stale (`test/commandsFreshness.test.mjs`). Before publishing, run `export:agent` and `npm run smoke:pack` in this package.

Agent-oriented guide: [`docs/agent/SKILL.md`](https://github.com/artur0x0/surfcad/blob/main/docs/agent/SKILL.md). Scripted demo from a full checkout: `npm run demo:mcp` at the repo root.

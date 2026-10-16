# SurfCAD agent (MCP)

Drive an open SurfCAD tab through **`packages/surfcad-mcp`**: stdio MCP → loopback WebSocket relay (M1) → `window.surfcad.call`. Tool names match `src/agent/commands.json` (`npm run export:agent`).

## Pair

1. Run SurfCAD with the bridge on (`npm run dev`, or `?agent=1` / `localStorage surfcadAgent=1`).
2. **Local agent** → **Show pairing code** (six characters).
3. Start `surfcad-mcp` with that code; click **Allow connection** in the tab.

**Cursor** (`.cursor/mcp.json` or Settings → MCP):

```json
{
  "mcpServers": {
    "surfcad": {
      "command": "node",
      "args": ["/absolute/path/to/surfcad/packages/surfcad-mcp/bin/surfcad-mcp.js"],
      "env": { "SURFCAD_PAIRING_CODE": "ABCDEF" }
    }
  }
}
```

**Claude Desktop** — same block under `mcpServers` in `claude_desktop_config.json`.

Optional: `SURFCAD_AGENT_BRIDGE_WS_URL` (default `ws://127.0.0.1:17341`; preview/playtest can pass `?agentBridgeWs=ws://127.0.0.1:PORT` when the relay uses a free port). Or call MCP tool `pair` with `{ "code": "ABCDEF" }` instead of env.

## Core loop

1. **`status`** — volume, bbox, feature count (nulls if nothing ran yet).
2. **`list_faces`** / **`list_feature_edges`** — stable pick ids (see below).
3. **Make a feature** — e.g. `insert_cube`, then **`run`**; or `set_script` + `run`.
4. **Pick** — `select_faces` / `select_edges`, or **`pick_begin`** → `pick_next` → `pick_done` `{ "accept": true }` for Fillet/Hole cards.
5. **Commit** — helper inserts mutate the script and run; card flows end with `pick_done` `{ "accept": true }` or `confirm_feature`.
6. **`history`** — read the stack the feature bar would undo (sketch session, assembly joints, or active part): `entries`, `head`, labels, `canUndo` / `canRedo`.
7. **`undo`** / **`redo`** — one step on that same stack (not a separate bridge stack). Results include `applied` / `reverted` labels. A new committed edit clears redo, like the UI.

**Sheet metal (H14).** `sheet_open` → `sheet_start` `{ sku }` → `sheet_pick` `{ plane: "XY" }` → `sheet_set_params` / `sheet_commit` for base and bends; `sheet_check` / `sheet_refold` for flat pattern; `sheet_edit` on `sheet:base` to change gauge; one `undo` per committed write.

## Stable ids

- **Faces** — keys from `list_faces` / `selection`: `{ at, n, area, src?, ord? }` (same as viewport fingerprints).
- **Edges** — prefer grouped **`e0`**, **`e1`**, … from `list_feature_edges`; raw mesh edges are not stable. Grouped `eN` expands to the UI edge chain.
- **Parts** — assembly part ids from `parts` / `set_active_part`.
- **Sketch** — in-contour entities `p0`, `e0`, `a0`, …; saved contour block id is `@contour id=c1` on the script, not sketch prefixes.

Full shapes: `docs/agent-export.md`.

## Error envelopes (respect these)

MCP returns JSON text; bridge refusals use `isError: true` with:

| Code | Meaning |
| --- | --- |
| `not_paired` | No approved relay session — pair first. |
| `real_repo_blocked` | Git write on a real repo without consent (`details.reason`: `consent_pending` / `consent_declined`). |
| `confirm_required` | Destructive git op needs explicit user approval. |

Other codes (`unknown_face`, `picker_busy`, `pick_timeout`, …) match `docs/agent-export.md`.

**Never** pass `confirm: true` on `git_branch_delete`, `git_force_overwrite`, `git_behind_resolve`, or dirty `git_branch_switch` unless the user explicitly asked for that destructive action.

## Local demo

`npm run build:playtest && npm run demo:mcp` — playtest bundles only (`VITE_SURFCAD_PLAYTEST=1`); production `npm run build` never ships the auto-approve path. CI smoke builds playtest before goldens.

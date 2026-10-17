# SurfCAD agent (MCP)

Drive an open SurfCAD tab through **`packages/surfcad-mcp`**: stdio MCP → loopback WebSocket relay (M1) → `window.surfcad.call`. Tool names match `src/agent/commands.json` (`npm run export:agent`).

UI text and color: [docs/ui_style_guide.md](../ui_style_guide.md). Shared classes only; never dark text on dark chrome; user-facing copy says Chrome, not Edge.

## Pair

1. Open [https://surfcad.com](https://surfcad.com) (or local dev / `?agent=1`).
2. Open the **profile** chip (top-right AR initials) → **Connect Agent**. The profile menu closes and a pairing popup opens. Copy the setup prompt if the relay is not running yet; once the relay is found the prompt hides and the six-character pairing code appears. Esc or a backdrop tap before pairing cancels the attempt.
3. Run `npx surfcad-mcp` in your MCP client with that code (`SURFCAD_PAIRING_CODE` or the `pair` tool). **Allow** (green check) / **Deny** (grey X) replace the code in the same popup — they never show together. After Allow the popup closes and a green **Agent connected** toast appears.

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

**Paint and measure (H13).** `paint_open` → `paint_set_color` / `paint_faces` `{ keys }` from `list_faces` → `paint_confirm` (session undo via `paint_undo` before confirm). `measure_open` → `measure_pick` `{ face_keys }` → `measure_state` readout → `measure_clear` / `measure_close` (no write).

**FEA study.** `fea_open` → `fea_set_material` `{ id }` → `fea_set_fixture` / `fea_set_force` `{ magnitudeN, direction, keys }` (N and MPa regardless of the display toggle; magnitudes commit to the study) → `fea_run` → `fea_results`. `fea_run` / `fea_results` expose `dof`, stresses in MPa, and `maxDisplacement_m`. `fea_state` mirrors the open sheet; `fea_back_to_setup` leaves results. Off-scope `part_id` on `fea_pick` returns an error, not a throw.

## Stable ids

- **Faces** — `list_faces` rows: `id` (`f0`, `f1`, …, one per face a viewport click selects, same on a rerun of the same script), `type`, `center` / `normal` / `axis` / `radius`, `area`, and `key` `{ at, n, area, src?, ord? }` (same as viewport fingerprints). `joint_pick` takes `{ part_id, face_id }`; key-based tools take `key`.
- **Edges** — prefer grouped **`e0`**, **`e1`**, … from `list_feature_edges`; raw mesh edges are not stable. Grouped `eN` expands to the UI edge chain.
- **Parts** — assembly part ids from `parts` / `set_active_part`. The id is a stable UUID for the part's life. In a git assembly, `create_part` rows have no vault path until `git_save`, which writes `assemblies/<Assembly>/<Name>.js` and stores that path beside the same id. `rename_part` moves the file and keeps the id.
- **Sketch** — in-contour entities `p0`, `e0`, `a0`, …; saved contour block id is `@contour id=c1` on the script, not sketch prefixes.

Full shapes: `docs/agent-export.md`.

## Error envelopes (respect these)

MCP returns JSON text; bridge refusals use `isError: true` with:

| Code | Meaning |
| --- | --- |
| `not_paired` | No approved relay session — pair first. |
| `pairing_lost` | The tab or relay dropped; the server is re-pairing on its own. Retry in a few seconds (`retryable: true`); ask the user to keep SurfCAD open in Chrome. Do not ask for a new code. |
| `pair_pending` | Waiting for the user to click Allow in SurfCAD. |
| `consent_pending` | Git write on a real repo while the consent dialog is up. Nothing was written. Ask the user to click **Allow** in SurfCAD, then retry the same call (`details.retry_after_ms`). |
| `real_repo_blocked` | Git write on a real repo that cannot get consent: headless / automation (`details.reason` `consent_pending`) or the user denied this session (`consent_declined`). |
| `confirm_required` | Destructive git op needs explicit user approval. |

Other codes (`unknown_face`, `picker_busy`, `pick_timeout`, …) match `docs/agent-export.md`.

**Never** pass `confirm: true` on `git_branch_delete`, `git_force_overwrite`, `git_behind_resolve`, or dirty `git_branch_switch` unless the user explicitly asked for that destructive action.

## Local demo

`npm run build:playtest && npm run demo:mcp` — playtest bundles only (`VITE_SURFCAD_PLAYTEST=1`); production `npm run build` never ships the auto-approve path. CI smoke builds playtest before goldens.

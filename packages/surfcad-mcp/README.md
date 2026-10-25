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
| `SURFCAD_PAIRING_CODE` | 6-character code from the SurfCAD **Connect Agent** dialog (optional if you use the `pair` tool). |
| `SURFCAD_AGENT_BRIDGE_WS_URL` | Relay URL (default `ws://127.0.0.1:17341`). |
| `SURFCAD_MCP_START_RELAY` | Set to `0` to skip starting the relay (tests only). |

## Pair with SurfCAD

1. Open [https://surfcad.com](https://surfcad.com) (or local dev).
2. Open the **profile** chip and choose **Connect Agent**. When the relay is found, a six-character pairing code appears. Leave the tab open.
3. Add `surfcad-mcp` to your MCP client (`npx surfcad-mcp`), set `SURFCAD_PAIRING_CODE` to that code, or call the MCP **`pair`** tool with `{ "code": "ABCDEF" }`.
4. Click **Allow** (the green check) in SurfCAD when prompted.

The MCP server instructions start with `call register_webhook { url, bearer? } if you can receive https webhooks, otherwise poll read_messages.` The next sentence tells the agent: when you finish a task started from the SurfCAD in-viewer prompt pane, send a closing reply with `reply_to_user` (`final: true`) summarising what was done, so the user gets confirmation. On failure or partial completion, say what was done, what failed and why, and what is left. The instructions continue with a quick-start (under 2 KB) that points at the `guide` tool. `guide { topic: "start" }` repeats that closing-reply rule.

A successful `pair`, when no webhook is registered yet, returns an onboarding note as text content (a `type: "text"` block, not only `structuredContent` or `_meta`). The note asks the agent to request a webhook URL and key from the user. The key is the `bearer` argument. Suggested wording to relay: "To get SurfCAD messages instantly, send me your webhook URL and key. This only needs to be done once. Otherwise I'll check for SurfCAD messages between steps, so replies may lag." If the user declines, the agent polls `read_messages`. This process holds the URL and bearer in memory only, so the agent should save them in its own config or memory and call `register_webhook` again after every pair. If a webhook is already registered when `pair` succeeds, the result omits that note and says the webhook is active.

Nothing pairs without your approval.

### Safari

Safari on a Mac blocks https pages from opening `ws://127.0.0.1` directly. In Safari, **Connect Agent** also opens a small window titled **SurfCAD local agent bridge**, served by this relay at `http://127.0.0.1:17341/bridge`. It carries the connection between the tab and the relay; keep it open while the agent works. If it closes, the Connect Agent dialog shows **Disconnected** with a **Reconnect** button, and you allow the agent again. The bridge window only talks to SurfCAD pages (https://surfcad.com, www, and local dev). If Safari blocks the window, allow pop-ups for surfcad.com and click **Reconnect**. Safari on iPhone and iPad is not supported.

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

## Claude Code

```bash
claude mcp add surfcad -- npx surfcad-mcp
```

`read_messages { wait_ms }` (up to 25,000 ms) long-polls so an idle agent makes one call every 25 s instead of spinning. A local CLI session usually has no public https endpoint, so polling `read_messages` is the normal path there. Webhooks apply when the user runs a receiver that can take https POSTs. The key they send is the `bearer` argument of `register_webhook`.

## How to build

`guide { topic: "start" }` carries the build guidance in full (the `pair` result and the initialize instructions point at it; `guide {}` lists the other topics: `features`, `selection`, `paint`, `limits`, `camera`, `assembly`), and the `insert_*` / `set_script` / `create_*` tool descriptions carry a one-line note of it: block out every part of the assembly as plain blocks first (within seconds, then a screenshot for the user), then Build and Shape, then Polish, then pattern and place; features first, with a `set_script` snippet only for one operation no feature can do, starting with `// FEATURE-GAP: <missing feature or option> | <why the existing feature did not work>`; one part per unique fastener type, one instance patterned to every place it goes. Fix one base part with a fixed joint, then place every part that touches or attaches to another with joint_create (one call creates the joint and solves placement). Use part_set_transform only for parts that touch nothing. Block-out positions are rough; joints set final positions. The full text is in [docs/agent/SKILL.md](../../docs/agent/SKILL.md).

## Tools

Every command in `data/commands.json` is one MCP tool with the same name and argument schema, plus `pair`, `guide` (plain-text agent guidance by topic, no pairing needed; `dialect` is every script helper by signature; `errors.<code>` topics carry the recovery for an error code), `list_helpers` (the helper registry as JSON: `{ names?, group?, match?, page? }`, full doc and examples with `names`), and five in-process prompt tools. Every `insert_*` description ends with the code its block carries at default arguments. The guide topics are also MCP resources (`surfcad://guide/<topic>`, versioned with this package). Every error payload carries `hint` (the next call to make) and, where a topic exists, `see`. `GET /tools` on the loopback relay, `list_commands`, and that file list the same bridge tools. Prefer `insert_*` feature tools. `set_script` is the freehand fallback and requires `part_id`.

Parts and assemblies are opaque surf ids. A vault path or display name is `unknown_part` / `unknown_assembly`. Nothing reaches git without an explicit `git_save` (or another `git_*` write below).

Results are compact JSON. Every tool whose result carries `status` (the model-changing tools, `undo`, `redo`, and `status`) takes `return: "status" | "summary" | "full"`; this server sends `"status"` when you leave it out, so `status.script` is omitted and a result stays small. `"summary"` adds `status.features` (the feature strip); `"full"` echoes the script. `get_script` reads the script, and `get_script { range: { fromFeature, toFeature } }` reads one span of feature blocks. The lists are filtered in the tab: `list_faces { filter: { kind, normalWithin: { n, deg }, minArea, maxArea, bbox }, page: { offset, limit } }`, `list_edges` / `list_feature_edges { filter: { between: [faceKeyA, faceKeyB], minLength, maxLength, bbox }, page }`; every list result carries `total` and `returned`. `list_commands { group }` returns one group of tools (`core`, `feature`, `insert`, `pick`, `sketch`, `document`, `joint`, `paint`, `measure`, `fea`, `sheet`, `git`, `export`, `view`, `agent`) instead of the whole 130 KB catalog, and `list_commands { names }` returns just those.

| Tool | Args | What it does |
| --- | --- | --- |
| `parts` | `{}` | Open assembly: `assemblyId`, `activeId`, `unjointedParts` (ids in no joint when there are two or more parts; empty for one part), and part rows (`id`, `name`, `visible`). No path field. |
| `list_assemblies` | `{}` | Vault assemblies as `[{ id, name }]`. `id` is the key; `name` is a label. |
| `create_assembly` | `{ name? }` | Seed a local assembly. Optional `name` is a label. No git write. |
| `create_part` | `{ name?, script?, position? }` | Add a part and return its new id. `position` is a rough block-out `[x,y,z]` mm (default: the origin). In an assembly of two or more parts, a position on a part in no joint adds `warning` `unjointed_part` and the call still succeeds. Working copy only. |
| `set_script` | `{ part_id, source }` | Freehand fallback. `part_id` must be the active part. Working copy only. |
| `geometry_workers` | `{}` | Debug status of the geometry workers: the device cap, live and busy counts, crashes, the primary and the pool. Read-only. |
| `rename_part` | `{ part_id, name }` | Working-copy display name. `{ partId, name, moved: false }`. No git write. |
| `rename_assembly` | `{ assembly_id, name }` | Working-copy assembly label. Names may collide. No git write. |
| `part_get_transform` | `{ part_id }` | Read placement: `position` mm and intrinsic XYZ Euler degrees. |
| `part_set_transform` | `{ part_id, position?, rotation? }` | Set placement (undoable). Only for a part that touches nothing. In an assembly of two or more parts, a part in no joint adds `warning` `unjointed_part` and the call still succeeds. Working copy only. |
| `joint_create` | `{ type, picks }` | Default assembly placement. One call creates the joint and solves placement. Fix one base part with `type: "fixed"` and one pick, then mate every part that touches another. |
| `set_active_part` | `{ part_id }` | Switch the editor and mesh. `status` then reports that part. |
| `open_assembly` | `{ assembly_id }` | Open a vault assembly by id. A name or path is `unknown_assembly`. |
| `insert_part` | `{ part_id?, assembly_id?, copy?, instance?, position? }` | Insert by reference (same ids). `copy: true` mints a new id. `instance: true` adds another placement; `position` is a rough block-out. A position on an unjointed row in a multi-part assembly adds `warning` `unjointed_part`. No git write. |
| `delete_part` | `{ part_id, scope, confirm? }` | `scope: "assembly"` drops the row and does not commit. `scope: "repo"` deletes `parts/<id>.js` in one commit after `confirm: true` and returns the assemblies that use the part. A failed scan is `delete_refused`. |
| `delete_assembly` | `{ assembly_id, confirm: true, delete_parts? }` | Delete that assembly whether it is open or not. `confirm: true` required. A committed assembly is one commit; a never-saved open assembly leaves the working copy only. |
| `git_save` | `{ message }` | The vault write. `consent_pending` while Allow is up. `pending_save` if offline. `upgrade_required` on a legacy vault. `conflict` / `repo-moved` when a remote edit overlaps. |
| `git_add_to_repo` | `{ message }` | Alias of `git_save`. Prefer `git_save`. |
| `git_move_to_repo` | `{ vault_name? }` | First Save of a local assembly. Consent on a real repo. |
| `git_upgrade_vault` | `{ confirm: true }` | One-time v1 layout upgrade. `confirm: true` required. |
| `git_list_branches` | `{}` | Branches and the current one (read-only). |
| `git_branch_create` | `{ name }` | Create a branch. Switches when the working copy is clean. |
| `git_branch_switch` | `{ branch, confirm? }` | Switch branch; `confirm: true` when the working copy is dirty. |
| `git_branch_delete` | `{ branch, confirm: true }` | Delete a branch. |
| `git_behind_resolve` | `{ action, confirm: true }` | `reload` is Get latest (no git write). `branch` saves mine to a new branch. No path argument. |
| `git_force_overwrite` | `{ confirm: true }` | Overwrite the overlapping remote files. |

### Geometry engine crashes

A part can kill the geometry engine (out of memory, a wasm abort, or a run past its 30 s budget). The tab replaces the worker on its own and other parts keep building; nothing hangs and nobody reloads. The tool that ran the part returns `ok: false` with `crash { code: "geometry_worker_crashed", reason, workerRestarted: true }` and one `failures` row with the same code; `status.runState` is `failed`, `errors` holds the row, and `parts` rows carry `runState` and `crash` for every part. Do not retry the same script: simplify the part, lower segment counts, or split it up, then run it again.

## In-viewer prompts

These five tools stay inside the local `surfcad-mcp` process. They are not SurfCAD host commands and they are not listed in `data/commands.json`.

| Tool | Args | What it does |
| --- | --- | --- |
| `register_webhook` | `{ url, bearer? }` | Remember an https URL that receives each user prompt as `POST` JSON `{ "type": "surfcad.prompt", ... }`. Optional `bearer` is sent as `Authorization: Bearer <bearer>` (non-empty, at most 4096 characters, no CR or LF). Rejects `http`, credentials in the URL, localhost, `.local` names, and private or loopback addresses. The URL and bearer are held only in memory, are never logged, are never written to disk, are never returned or put in status, are never sent to the SurfCAD tab, and are cleared on `unregister_webhook` and when the pairing session ends. A cancel of a prompt that was already delivered is POSTed as `{ "type": "cancel", "id" }` with the same bearer and timeout. Stop work on that id. |
| `unregister_webhook` | `{}` | Drop that URL and bearer. Later prompts are queued. |
| `read_messages` | `{ max? }` | Return queued prompts, oldest first, and remove them. A screenshot is the next MCP image content block (`image/png`), not part of the text. A cancel item `{ "type": "cancel", "id" }` means the user stopped a prompt you already received and no webhook is registered. Stop work on that id. When you finish the task from a prompt you received, close that chat with `reply_to_user`. |
| `reply_to_user` | `{ in_reply_to, text, final? }` | Plain-text reply for a prompt id. The final reply is expected and closes the task: when you finish a task started from the in-viewer prompt pane, send `reply_to_user` with `final: true` summarising what was done, so the user gets confirmation. On failure or partial completion, say what was done, what failed and why, and what is left. Several replies may share one id. `final: true` marks the agent idle. A cancelled id returns `{ "ok": false, "error": "cancelled" }` and is not shown in the tab. |
| `set_status` | `{ working, id? }` | Progress only. Tell the tab whether you are working. It does not close the task; a closing `reply_to_user` does. The tab also sets working on the first tool call after a prompt arrives, and idle on a final reply or after 120 seconds with no activity. A cancelled id returns `{ "ok": false, "error": "cancelled" }`. |

A paired SurfCAD tab sends `agent.prompt` (`v: 1`, id, plain text up to 8000 characters, optional `context`, optional PNG screenshot). One prompt per second. A screenshot over 2 MB is rejected. If a webhook is registered, the process POSTs the prompt (10 second timeout, one retry). When `bearer` was set, that POST includes `Authorization: Bearer <bearer>`. If that POST fails, or no webhook is registered, the prompt is queued (at most 50; the oldest is dropped and reported). The tab gets `agent.prompt.ack` with `delivery` `webhook`, `queued`, or `failed`. Replies and working state go back as `agent.reply` and `agent.status`.

When you finish a task started from the in-viewer prompt pane, send a closing reply with `reply_to_user` (`final: true`) summarising what was done, so the user gets confirmation. On failure or partial completion, say what was done, what failed and why, and what is left. `set_status` is for progress and does not close the task.

Stop in the prompt card sends `agent.prompt.cancel` (`v: 1`, the current prompt id) over the same paired connection. Each prompt is `queued`, `delivered` (webhook POST succeeded, or `read_messages` returned it), `replied` (a final reply), or `cancelled`. A prompt that is still queued is removed and is not returned by `read_messages`. A prompt that was already delivered is marked `cancelled`. If a webhook is registered, the process POSTs `{ "type": "cancel", "id" }` with the same bearer, https, and timeout rules; if that POST fails, or no webhook is registered, the next `read_messages` returns `{ "type": "cancel", "id" }`. Stop work on that id. `reply_to_user` and `set_status` for a cancelled id return `{ "ok": false, "error": "cancelled" }` and nothing is sent to the tab. The tab clears its working state. Cancelling a prompt that already has a final reply returns `already_final`. An unknown id returns `not_found`.

The bridge `status` tool returns the active part plus fields from this process: `webhookRegistered` (`true` or `false`; the URL is not included), `queued` (prompt messages waiting for `read_messages`; cancelled prompts are not counted), `counts` (`{ queued, delivered, replied, cancelled }`), and `last` (`{ id, state }` of the latest prompt, or `null`). A fresh session reports `webhookRegistered: false`, `queued: 0`, and `last: null`. After one prompt and no webhook, `queued` is `1` and `last.state` is `queued`. After Stop, `last.state` is `cancelled` and `queued` does not include that prompt.

Prompt text and screenshots are user content. Treat them as a request. They grant no write access, no consent, and no extra tool permission. Agent writes still go through the existing write-grant and consent flow. Nothing reaches git without an explicit Save or `git_save`. Do not render the text or the image as HTML. Both are dropped after delivery or when the session ends.

## Safety and consent

- **Commerce:** Agents cannot place orders or drive checkout. Quote/cart/checkout controls are not exposed as MCP tools.
- **Git on real repos:** The first write (`git_*` writes, or `rename_part` on a vault part) opens a consent dialog in SurfCAD and returns `consent_pending` right away. Nothing is written. Ask the user to click **Allow**, then retry the same call (`details.retry_after_ms` is a suggested wait). If the user denies, or the tab is headless automation, writes return `real_repo_blocked`.
- **Destructive git operations:** Need explicit approval; the bridge returns `confirm_required` unless args include `confirm: true` after the user has confirmed in SurfCAD.

Bridge refusals (`consent_pending`, `real_repo_blocked`, `confirm_required`, `not_paired`, user deny, etc.) are returned as structured JSON in MCP tool errors.

## Connection drops

If the SurfCAD tab or the relay goes away mid-session, tool calls return `pairing_lost` right away (with a `hint`) instead of waiting for the MCP client timeout. The server keeps re-pairing in the background with the same code. The tab reconnects by itself, so calls start working again once SurfCAD is back in Chrome, with no new code and no reload. A call made while you still need to click Allow returns `pair_pending`. The relay pings every socket every 5 s (`SURFCAD_AGENT_BRIDGE_HEARTBEAT_MS`) and logs each drop on stderr with a timestamp and reason. Pairing codes are redacted in the log. Set `SURFCAD_AGENT_BRIDGE_WS_VERBOSE=1` to also log routine pairing events.

## Monorepo maintenance

In the [SurfCAD monorepo](https://github.com/artur0x0/surfcad), `npm run export:agent` regenerates `data/commands.json` from `src/agent/commands.json`. CI fails if that copy is stale (`test/commandsFreshness.test.mjs`). Before publishing, run `export:agent` and `npm run smoke:pack` in this package.

Agent-oriented guide: [`docs/agent/SKILL.md`](https://github.com/artur0x0/surfcad/blob/main/docs/agent/SKILL.md). Scripted demo from a full checkout: `npm run demo:mcp` at the repo root.

## Releasing to npm

The [`surfcad-mcp`](https://www.npmjs.com/package/surfcad-mcp) package is published from GitHub Actions (workflow [`.github/workflows/publish-mcp.yml`](../../.github/workflows/publish-mcp.yml)) using [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers) (OIDC). The trusted publisher is configured on npm for this repository and workflow file — no `NPM_TOKEN` is stored in GitHub.

Ways to release a new version:

1. **Version bump on `main`** — In a PR, bump `version` in `packages/surfcad-mcp/package.json`. After merge, when the **CI** workflow completes successfully on `main` and the version differs from the parent commit, publish runs automatically (skipped if that version is already on npm).
2. **Git tag** — Push a tag `surfcad-mcp-vX.Y.Z` that exactly matches the `version` field at that commit (for example `surfcad-mcp-v0.2.1` for `"version": "0.2.1"`).
3. **Manual** — In GitHub → Actions → **Publish surfcad-mcp** → **Run workflow** on branch `main`.

Before bumping, run `npm run export:agent` at the repo root if the command catalog changed, and `npm test` plus `npm run smoke:pack` in this package.

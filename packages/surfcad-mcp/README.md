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

## Tools

Every command in `data/commands.json` is one MCP tool with the same name and argument schema, plus `pair`. Call `list_commands` for the full catalog. The parts and git tools:

| Tool | Args | What it does |
| --- | --- | --- |
| `parts` | `{}` | Part rows (`id`, `name`, `visible`) and the active part. |
| `create_assembly` | `{}` | Seed a new assembly. |
| `create_part` | `{ name?, script?, position? }` | Add a part at the assembly origin (optional `[x,y,z]` mm). In a git assembly it has no vault path until `git_save`. |
| `rename_part` | `{ part_id, name }` | Rename a part. A vault part moves its committed `.js` to `<name>.js` in the same folder (`-2`, `-3` on collision) and updates that part's path/name in `.surf.json` in one commit. Pending script, placement, and other edits stay for the next Save. A part with no repo path renames locally and does not commit. Unknown ids return `unknown_part`. |
| `part_get_transform` | `{ part }` | Read placement: `position` mm and intrinsic XYZ Euler degrees (`eulerOrder: "XYZ"`). |
| `part_set_transform` | `{ part, position?, rotation? }` | Set placement (undoable assembly step). |
| `set_active_part` | `{ part_id }` | Switch the editor and mesh to a part. `status` then reports that part. |
| `git_save` | `{ message }` | Same as the app's Save: paths every path-less part, then commits those scripts, dirty parts, and the `.surf.json` in one commit. |
| `git_add_to_repo` | `{ part_id }` | Add one part to the vault; other path-less parts are pathed and committed with it. |
| `git_move_to_repo` | `{ vault_name? }` | Move a local assembly into the vault. |
| `git_list_branches` | `{}` | Branches and the current one (read-only). |
| `git_branch_create` | `{ name }` | Create and switch to a branch. |
| `git_branch_switch` | `{ branch, confirm? }` | Switch branch; `confirm: true` when the working copy is dirty. |
| `git_branch_delete` | `{ branch, confirm: true }` | Delete a branch. |
| `git_behind_resolve` | `{ action, path?, kind? }` | Get latest: `keep`, or `reload` / `branch` with `confirm: true`. |
| `git_force_overwrite` | `{ confirm: true }` | Overwrite main from the conflict prompt. |

## In-viewer prompts

These five tools stay inside the local `surfcad-mcp` process. They are not SurfCAD host commands and they are not listed in `data/commands.json`.

| Tool | Args | What it does |
| --- | --- | --- |
| `register_webhook` | `{ url }` | Remember an https URL that receives each user prompt as `POST` JSON `{ "type": "surfcad.prompt", ... }`. Rejects `http`, credentials in the URL, localhost, `.local` names, and private or loopback addresses. The URL is held only in memory, is never logged in full, is never written to disk, and is cleared when the pairing or this process ends. |
| `unregister_webhook` | `{}` | Drop that URL. Later prompts are queued. |
| `read_messages` | `{ max? }` | Return queued prompts, oldest first, and remove them. A screenshot is the next MCP image content block (`image/png`), not part of the text. |
| `reply_to_user` | `{ in_reply_to, text, final? }` | Plain-text reply for a prompt id. Several replies may share one id. `final: true` closes it and marks the agent idle. |
| `set_status` | `{ working, id? }` | Tell the tab whether you are working. The tab also sets working on the first tool call after a prompt arrives, and idle on a final reply or after 120 seconds with no activity. |

A paired SurfCAD tab sends `agent.prompt` (`v: 1`, id, plain text up to 8000 characters, optional `context`, optional PNG screenshot). One prompt per second. A screenshot over 2 MB is rejected. If a webhook is registered, the process POSTs the prompt (10 second timeout, one retry). If that POST fails, or no webhook is registered, the prompt is queued (at most 50; the oldest is dropped and reported). The tab gets `agent.prompt.ack` with `delivery` `webhook`, `queued`, or `failed`. Replies and status go back as `agent.reply` and `agent.status`.

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

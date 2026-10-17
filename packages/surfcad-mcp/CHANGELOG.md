# Changelog

## Unreleased

- New `rename_part` tool `{ part_id, name }`. A vault part also moves its `.js` path in the same folder (`-2`, `-3` on collision) and updates the `.surf.json` in one commit. Unknown ids return `unknown_part`.
- `git_save` saves like the app's Save button: parts without a vault path get one, and those scripts plus the `.surf.json` land in one commit. It no longer returns `no_repo_path`.
- `git_add_to_repo` works on a multi-part assembly whose other parts have no paths. They are pathed and committed with it instead of failing `.surf.json` validation on every call.
- Git writes on a real repo return `consent_pending` immediately (with `details.retry` and `details.retry_after_ms`) while the consent dialog waits, instead of blocking until the MCP client times out (`-32001`). Retry after the user clicks Allow. Headless tabs and a denied session still return `real_repo_blocked`.
- `create_part` in a git assembly no longer commits on its own; `git_save` writes it behind the consent dialog.

## 0.2.0

- `npx surfcad-mcp` starts (or reuses) the loopback agent-bridge relay on `127.0.0.1:17341` so production https://surfcad.com tabs can pair without the Vite dev server.
- Safari is not supported yet: it blocks `ws://127.0.0.1` connections from https pages.

/**
 * UI action ids not yet backed by a registry command `uiEntry`.
 *
 * Every id here must appear on a helper rail item, a `data-ui-action` literal
 * in `src/components` JSX, or in `EXTRA_ACTION_IDS` in `coverage.js`.
 * Commerce ids live only in `exempt.js`. When a command ships, remove its id
 * here — the coverage test fails if an allowlisted id is now covered.
 */

export const COVERAGE_ALLOWLIST = Object.freeze([
  Object.freeze({ id: 'data-mold-tools-toggle', reason: 'Molding tools drawer trigger. Opens the flyout; the four tools already have commands.' }),
  Object.freeze({ id: 'data-mold-report-resin', reason: 'Report resin menu. Agents set the same grade through mold_dfm and mold_quote.' }),
  Object.freeze({ id: 'data-mold-report-quantity', reason: 'Report quantity presets. Agents set the same quantity through mold_dfm and mold_quote.' }),
  Object.freeze({ id: 'data-mold-report-custom', reason: 'Report custom quantity. Agents set the same quantity through mold_dfm and mold_quote.' }),
  Object.freeze({ id: 'data-mold-report-export', reason: 'Downloads the open report as .xlsx. Agents read that same report from mold_dfm and mold_quote.' }),
  Object.freeze({ id: 'data-sm-unit-toggle', reason: 'Sheet metal display mm|in toggle (display chrome only).' }),
  Object.freeze({ id: 'data-game-exit', reason: 'Game mode exit to CAD (out of harness scope).' }),
  Object.freeze({ id: 'data-game-undo', reason: 'Game toolbar undo (out of harness scope).' }),
  Object.freeze({ id: 'data-game-redo', reason: 'Game toolbar redo (out of harness scope).' }),
  Object.freeze({ id: 'data-game-run', reason: 'Game toolbar run (out of harness scope).' }),
  Object.freeze({ id: 'data-game-pick-puzzle', reason: 'Game puzzle picker (out of harness scope).' }),
  Object.freeze({ id: 'data-game-hint', reason: 'Game hint overlay (out of harness scope).' }),
  Object.freeze({ id: 'data-feature-sheet-edit-script', reason: 'H5 edit script jump (editor navigation only).' }),
  Object.freeze({ id: 'data-agent-bridge-connect', reason: 'M1 open guided local agent pairing flow.' }),
  Object.freeze({ id: 'data-agent-bridge-copy-prompt', reason: 'M1 copy AI agent install prompt.' }),
  Object.freeze({ id: 'data-agent-bridge-copy-code', reason: 'M1 copy pairing code for MCP client.' }),
  Object.freeze({ id: 'data-agent-bridge-approve', reason: 'M1 approve local WS peer.' }),
  Object.freeze({ id: 'data-agent-bridge-reject', reason: 'M1 reject local WS peer.' }),
  Object.freeze({ id: 'data-agent-bridge-disconnect', reason: 'M1 disconnect local WS peer.' }),
  Object.freeze({ id: 'data-agent-connected-toast-disconnect', reason: 'Agent connected toast. Drops the live session. The toast is not a banner.' }),
  Object.freeze({ id: 'data-agent-disconnected-toast-reconnect', reason: 'Agent disconnected toast. Opens the pairing dialog. The chat hides on a live drop, not during the reload grace.' }),
  Object.freeze({ id: 'data-agent-bridge-copy-mcp', reason: 'M1 copy npx surfcad-mcp hint.' }),
  Object.freeze({ id: 'data-agent-bridge-copy-link', reason: 'M1 copy page URL for Chrome handoff.' }),
  Object.freeze({ id: 'data-agent-bridge-reconnect', reason: 'M1 reopen the Safari loopback bridge window.' }),
  Object.freeze({ id: 'data-agent-bridge-use-popup', reason: 'M1 switch a blocked direct socket to the bridge window.' }),
  Object.freeze({ id: 'data-agent-git-consent-allow', reason: 'H12 real-adapter write consent modal (session opt-in).' }),
  Object.freeze({ id: 'data-agent-git-consent-deny', reason: 'H12 real-adapter write consent modal (session deny).' }),
  Object.freeze({ id: 'data-privacy-choices-done', reason: 'Monitoring slice B privacy choices dialog (not agent scope).' }),
  Object.freeze({ id: 'data-privacy-consent-accept-all', reason: 'First-visit privacy consent popup (not agent scope).' }),
  Object.freeze({ id: 'data-privacy-consent-required-only', reason: 'First-visit privacy consent popup (not agent scope).' }),
  Object.freeze({ id: 'data-assembly-save-menu', reason: 'Desktop assembly Save split-button menu (rename).' }),
  Object.freeze({ id: 'data-git-behind-keep', reason: 'PR 8 removed git_behind_resolve keep (Go back is not a tool).' }),
  Object.freeze({ id: 'data-git-save-dismiss', reason: 'Save conflict Go back writes nothing (not an agent command).' }),
  Object.freeze({ id: 'data-git-branch-switch-go-back', reason: 'Branch-switch Go back changes neither the branch nor files (not an agent command).' }),
  Object.freeze({ id: 'data-git-install-app', reason: 'Save dialog opens the SurfCAD GitHub App install page when the signed-in user has not installed the app.' }),
  Object.freeze({ id: 'data-joints-row-scroll-prev', reason: 'Joints row overflow chevron: scrolls the row (reader chrome; agents read list_joints / joint_select).' }),
  Object.freeze({ id: 'data-joints-row-scroll-next', reason: 'Joints row overflow chevron: scrolls the row (reader chrome; agents read list_joints / joint_select).' }),
  Object.freeze({ id: 'data-agent-prompt-jump', reason: 'Agent prompt chat pane scroll-to-newest arrow (reader chrome only, no agent equivalent).' }),
  Object.freeze({ id: 'data-agent-relay-auto', reason: 'Account relay preference: try the localhost relay, then the server.' }),
  Object.freeze({ id: 'data-agent-relay-local', reason: 'Account relay preference: localhost relay only.' }),
  Object.freeze({ id: 'data-agent-relay-server', reason: 'Account relay preference: server relay only.' }),
  Object.freeze({ id: 'data-agent-token-revoke', reason: 'Account list revoke for a paired agent token.' }),
  Object.freeze({ id: 'data-agent-chat-open', reason: 'Phone stage pill opens the agent chat and folds it again while an agent is connected.' }),
]);

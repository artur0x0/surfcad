/**
 * UI action ids not yet backed by a registry command `uiEntry`.
 *
 * Every id here must appear on a helper rail item, a `data-ui-action` literal
 * in `src/components` JSX, or in `EXTRA_ACTION_IDS` in `coverage.js`.
 * Commerce ids live only in `exempt.js`. When a command ships, remove its id
 * here — the coverage test fails if an allowlisted id is now covered.
 */

export const COVERAGE_ALLOWLIST = Object.freeze([
  Object.freeze({ id: 'data-axis-helper-toggle', reason: 'Viewport axis helper toggle (non-product chrome).' }),
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
  Object.freeze({ id: 'data-agent-bridge-copy-mcp', reason: 'M1 copy npx surfcad-mcp hint.' }),
  Object.freeze({ id: 'data-agent-bridge-copy-link', reason: 'M1 copy page URL for Chrome handoff.' }),
  Object.freeze({ id: 'data-agent-bridge-reconnect', reason: 'M1 reopen the Safari loopback bridge window.' }),
  Object.freeze({ id: 'data-agent-bridge-use-popup', reason: 'M1 switch a blocked direct socket to the bridge window.' }),
  Object.freeze({ id: 'data-agent-git-consent-allow', reason: 'H12 real-adapter write consent modal (session opt-in).' }),
  Object.freeze({ id: 'data-agent-git-consent-deny', reason: 'H12 real-adapter write consent modal (session deny).' }),
  Object.freeze({ id: 'data-privacy-choices-done', reason: 'Monitoring slice B privacy choices dialog (not agent scope).' }),
  Object.freeze({ id: 'data-privacy-consent-accept-all', reason: 'First-visit privacy consent popup (not agent scope).' }),
  Object.freeze({ id: 'data-privacy-consent-required-only', reason: 'First-visit privacy consent popup (not agent scope).' }),
  Object.freeze({ id: 'data-assembly-save-menu', reason: 'Desktop assembly Save split-button menu (rename / branches).' }),
  Object.freeze({ id: 'data-assembly-rename-menu', reason: 'Rename assembly from Parts Save menu.' }),
  Object.freeze({ id: 'data-git-upgrade-dismiss', reason: 'PR 4 Upgrade vault Dismiss writes nothing (not an agent command).' }),
  Object.freeze({ id: 'data-git-save-dismiss', reason: 'PR 7 Save conflict Dismiss writes nothing (not an agent command).' }),
]);

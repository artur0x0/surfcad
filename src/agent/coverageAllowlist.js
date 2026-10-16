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
  Object.freeze({ id: 'data-agent-bridge-start', reason: 'M1 local WS pairing chrome (not a bridge command).' }),
  Object.freeze({ id: 'data-agent-bridge-approve', reason: 'M1 approve local WS peer.' }),
  Object.freeze({ id: 'data-agent-bridge-reject', reason: 'M1 reject local WS peer.' }),
  Object.freeze({ id: 'data-agent-bridge-disconnect', reason: 'M1 disconnect local WS peer.' }),
  Object.freeze({ id: 'data-agent-bridge-toggle', reason: 'M1 open/close pairing panel.' }),
  Object.freeze({ id: 'data-agent-git-consent-allow', reason: 'H12 real-adapter write consent modal (session opt-in).' }),
  Object.freeze({ id: 'data-agent-git-consent-deny', reason: 'H12 real-adapter write consent modal (session deny).' }),
]);

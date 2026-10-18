# Error toasts to Sentry

Scope for a later implementation. No code in this change.

Privacy, consent, and the existing Sentry client are in [docs/monitoring.md](../monitoring.md).

Today the only browser report is the crash boundary: `SentryErrorBoundary` calls `captureSentryException` in `src/utils/sentryClient.js`. Every error toast is shown and then dropped.

## Goal

Send every user-facing **error** toast to Sentry, including errors from the user’s own CAD script. Warnings, info, and success stay local. The toast on screen does not change.

## What counts as an error

`ErrorPopup` (`src/components/ErrorPopup.jsx`) takes a `tone`. The default is `error`.

| Tone | On screen | In this scope |
| --- | --- | --- |
| `error` | Red card | Yes |
| `banner` | Same red card; app-shell failures | Yes |
| `scrap` | Red, `role="status"` | No. Fillet quality note, not a failure. |
| `warn`, `amber` | Yellow | No |
| `success`, `cyan` | Green / cyan | No |

Two failure cards are not `ErrorPopup` and are still in scope: the red `role="alert"` rename / delete-assembly card in `src/components/PartFeed.jsx` (`data-rename-toast`).

The agent toast reader (`src/agent/state/toasts.js`, `readToasts` in `src/App.jsx`) mirrors some of these with `kind`. `kind: 'error'` matches the in-scope toasts (`execution-error`, `upload`). `kind: 'warn'` and `kind: 'info'` are out. Do not report from the reader or from popup render. Polls and re-renders would duplicate events and the stack would point at React.

Desktop and mobile in `src/App.jsx` both paint the upload, game, and assembly-open toasts. That is one state, one report.

## Categories

Every report gets a `category` tag. Use the catch site, not the message text.

| Category | Use for |
| --- | --- |
| `script` | The user’s CAD script failed while running (syntax, thrown script error, feature skip, broken contour ref). |
| `geometry` | Kernel or viewer failure that is not the script: Manifold not ready, cross-section apply, puzzle volume-fallback. |
| `git` | Vault, save, branch, rename sync, upgrade, add-to-repo. |
| `assembly` | Open, create, or delete-assembly sync. |
| `export` | Import and download, including the STEP sign-in gate on the import toast. |
| `agent` | Reserved. Pairing has no error toast today. |
| `checkout` | Reserved. Checkout and quote errors are inline, not toasts. |
| `game` | Puzzle failed to start. |
| `internal` | A toast whose cause is app state, not one of the above. None of the current toasts need it; keep it for a raise site that does not fit. |

`network` is not its own tag. A failed fetch is reported as the feature that caught it (`git`, `export`, `assembly`) so triage stays on the user-visible toast.

## Inventory

41 raise sites, 6 toast ids. Counted from the code on `main` at the time of this doc, not from a sample.

### `execution-error` — `src/components/Viewport.jsx`

Rendered once, `tone="error"`, `layout="stacked"`. Set with `setExecutionError`.

| Trigger | Category |
| --- | --- |
| `executeScript` catch (validation, user script, kernel throw). Message is `error.message`. | `script` |
| Broken contour reference (`failBrokenRefs`) | `script` |
| Feature skip after a recovered solid (`result.featureSkip`) | `script` |
| Cross-section plane apply throws | `geometry` |

Line and column for script errors already exist on the thrown value when the worker has them (`error.scriptLine`). Send those numbers only.

### `upload` — `src/App.jsx`

`setUploadError`. Painted in both shells with `tone="banner"` and `data-upload-toast-kind="error"`. Prefix on screen is `Upload Error:`.

| Trigger | Category |
| --- | --- |
| `handleLoadAssembly` — JSON parse failed | `export` |
| `handleToggleSource` — could not open the repo | `git` |
| `handleAddExistingPart` — path not allowed | `git` |
| `handleAddExistingPart` — missing in the vault | `git` |
| `handleAddExistingPart` catch | `git` |
| `handleAddToRepo` — result status `error` | `git` |
| `handleAddToRepo` catch | `git` |
| `handleV2PlanSave` catch, only when the error is file-too-large, carries `err.toast`, or is vault-tree unavailable | `git` |
| `handleGitCommit` catch, same three cases | `git` |
| `adoptSyncResult` — `not_a_vault` | `git` |
| `handleUpgradeVault` — upgraded working copy did not persist | `git` |
| `handleUpgradeVault` — `PersistCrash` | `git` |
| `handleUpgradeConflict` — persist incomplete | `git` |
| `handleSaveOnNewBranch` — save did not commit | `git` |
| `handleSaveOnNewBranch` catch | `git` |
| `handleRenameAssembly` — v2 rename blocked | `git` |
| `handleRenameAssembly` — name already taken | `git` |
| `handleNewAssembly` — local script save failed | `assembly` |
| `handleAddPart` — local script save failed | `assembly` |
| `seedOpenAssembly` (sheet-metal bind) — local script save failed | `assembly` |
| `handleImport` — sign in required for STEP | `export` |
| `handleImport` — Manifold not ready | `geometry` |
| `handleImport` — no assembly open | `assembly` |
| `handleImport` — raw file too large | `export` |
| `handleImport` — file produced no mesh | `export` |
| `handleImport` — stored mesh too large | `export` |
| `handleImport` — vault tree listing failed | `git` |
| `handleImport` — could not assign a vault path | `git` |
| `handleImport` — could not save the uploaded part | `export` |
| `handleImport` catch | `export` |
| `handleDownloadPart` — export mesh refused | `export` |
| `handleDownloadPart` catch | `export` |

Other git failures return `{ status: 'error' }` through `gitOpCatchResult` and are shown in dialogs, not this toast. Do not report those until they grow a toast. `handleV2PlanSave` and `handleGitCommit` must report only on the branches that call `setUploadError`.

### `game` — `src/App.jsx`

`setGameError`, `tone="banner"`, both shells.

| Trigger | Category |
| --- | --- |
| `loadPuzzle` catch | `game` |
| `handleGameRun` — match used the volume fallback | `geometry` |

### `assembly-open` — `src/components/AssemblyOpenSpinner.jsx`

`AssemblyOpenFailureToast`, `tone="banner"`. Raised by `createAssemblyOpenController` `onFailure` in `src/App.jsx` (thrown open error, or the safety timer in `src/utils/assemblyOpenOverlay.js`). Category `assembly`. The timeout string includes the assembly name; do not send that string.

### `rename` and `delete-assembly` — `src/components/PartFeed.jsx`

`adoptSyncResult` in `src/App.jsx` stores `result.toast` on `renameNotice` when a flush fails. The sync worker (`src/utils/git/syncWorker.js`) builds that object:

| Builder | Trigger | Category | Toast id |
| --- | --- | --- | --- |
| `renameFailureToast` in `src/utils/git/gitRename.js` | Rename op failed during flush | `git` | `rename` |
| `deleteAssemblyFailureToast` in `src/utils/git/gitDeleteAssembly.js` | Delete-assembly op failed during flush | `assembly` | `delete-assembly` |

Both messages embed the name the user typed. Send the op and the error, not the label.

An assembly rename that is held for retry (`code: 'rename-held'`) does not set `toast`. No report.

## Out of scope (looked at, not error toasts)

| Surface | Why it is out |
| --- | --- |
| `uploadNotice` | `tone="warn"` |
| `GitBehindToast` | `tone="warn"`. Remote-ahead choice, not a failure. |
| Repo-moved card | `tone="warn"` |
| Repo-saved card, agent-connected toast (`AgentBridgePairing.jsx`) | `tone="success"` |
| `FeatureDeleteToast`, fillet toast | `tone="warn"`. Undo / refusal. |
| Edge-mode toast | `tone="amber"` |
| Contour, shell, sheet-metal delete toasts | `tone="cyan"` |
| Fillet scrap notice | `tone="scrap"` |
| Puzzle-unlock toast | Short success note |
| Agent `shell` row in `viewportToastRows` | `kind: 'info'` |
| Pairing “reconnecting” / “lost the local agent” | Inline dialog copy, not a toast |
| FEA `data-fea-notice` | Inline amber line on the study panel |
| Part row “Script failed” | Status on the row. The execution toast is the report. |
| Init failure screen (`setInitError`) | Full-page gate, not a toast. The crash boundary does not see it. |
| Checkout `data-checkout-error`, quote, order, login, account, partners, admin | Inline form or page errors |
| `gitOpCatchResult` callers that never call `setUploadError` | Dialog or return value only |

## Design

One helper, called at the catch (or at the `setX` that shows the toast):

```js
reportHandledError(error, {
  category,   // tag above
  toast,      // execution-error | upload | game | assembly-open | rename | delete-assembly
  reason,     // optional stable code, no user text: file_too_large, vault_tree_unavailable, …
})
```

`error` is the caught value when there is one. If the UI only has a string, wrap it at the call site (`new Error(code)`) so the stack is the catch, not `ErrorPopup`.

Do not call it from `ErrorPopup`, `buildToasts`, or `readToasts`.

Sentry event:

- Level `error`.
- Tags: `category`, `toast`, `handled` = `true`. Add `reason` when the call site has a stable code.
- Mechanism: `captureException` through the existing `captureSentryException`. No new client and no new DSN.
- Fingerprint:
  - Default: `['handled', category, toast, reason or error name]`.
  - `script`: `['handled', 'script', error name, message pattern]`. The pattern drops quoted text, numbers, paths, and file names so one bug in many scripts is one issue. Do not put the script body, part id, or raw message in the fingerprint.
- Dedupe for the page load: one event per `category + toast + fingerprint`. Cap script reports at 8 per page load and all handled reports at 20. Further repeats are dropped in the helper, not sampled away. A user who keeps Run on a broken script should not open a new issue each time.
- Unset `VITE_SENTRY_DSN` stays a no-op, including dev, staging, CI, and unit tests.

## Privacy

Follow `src/utils/sentryClient.js` and `src/utils/sentryPii.js`. `sendDefaultPii` stays false. `beforeSend` / `beforeBreadcrumb` keep scrubbing query strings, bodies, auth headers, and file-name extensions.

Never send:

- CAD script source
- Mesh, model, or file bytes
- File names, part names, or assembly names the user typed
- Vault paths (`Missing in vault: …` is a path)
- Tokens, pairing codes, DSNs, Stripe keys
- Visitor IPs (do not turn on default PII or attach a request IP)

Script reports may include error name, a scrubbed message, and numeric line/column. Scrub quoted literals and anything that looks like a path or file name before the message is attached. If scrubbing would leave only user text, send the error name and line/column and omit the message.

Rename, delete-assembly, and assembly-open copy include names. Those call sites pass `reason` and the underlying `Error`, not the toast sentence.

No new env vars. Do not put `VITE_SENTRY_DSN`, `SENTRY_DSN`, or analytics keys in dev or staging env files. Production keys stay where [docs/monitoring.md](../monitoring.md) already says.

## Noise

Script errors will outnumber app bugs. They stay in Sentry because the owner asked for them, and they stay out of the app-bug queue:

- Tag `category:script` and fingerprint by type and message pattern, not by user or script.
- Alert on `handled:true` and `category` not `script`. Script issues are a separate view or a digest, not a page.
- Triage the other categories on the `category` and `toast` tags (`git` + `upload`, `assembly` + `assembly-open`, and so on).
- The per-page-load cap above is the client brake. Do not drop script events with a sample rate; that hides the pattern the fingerprint is meant to group.

The crash boundary stays as it is (`handled` unset). Do not mark uncaught render errors as handled.

## Rollout and tests

Later PRs, still no toast-UX change:

1. Helper, fingerprint, scrub, and page-load cap. Unit tests with the DSN unset (no network) and a fake `captureException`. Assert tags, fingerprint, dropped script source, and dropped names. Warn and success toasts are not in the helper’s call list.
2. Wire `execution-error` (script and the one geometry path) and the two sync toasts (`rename`, `delete-assembly`).
3. Wire `upload`, `game`, and `assembly-open`.

Each PR should name the toast ids it wires. A call site that sets an error toast and does not call the helper fails review against the inventory above.

Manual check needs a production build with a DSN pointed at a non-prod Sentry project, or a test double. Dev with an empty DSN cannot prove delivery. Confirm one script error, one git upload toast, and one warning toast: the warning does not report, and the two errors do not repeat when the same toast renders again on mobile.

## Open questions

- The volume-fallback game toast is a successful match with `tone="banner"`. This doc reports it as `geometry`. If playtest treats it as a warning, move it out and change the tone.
- The full-page init failure (`setInitError`) and checkout `pageError` are real user-facing errors and are not toasts. A follow-up can add them; they are not part of this slice.
- Exact cap numbers (8 script / 20 total) are a starting point. Change them if Sentry volume says otherwise.
- `internal` has no raise site yet. Use it only when a new error toast does not fit the table.

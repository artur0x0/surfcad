# VALIDATION.md — the contract for changing the kernel

Every PR to this repo is checked against a gate that the contributor **cannot
edit**. Read this before writing code; your PR review starts from its output.

## The one command

```bash
npm run verify
```

Runs both tiers below, prints `✅ VERIFY PASS` or `❌ VERIFY FAIL (<n> failing checks)`,
exit 0/1. Include the full output in your PR description — an unverified PR is
auto-returned without review.

**Authoritative invocation** (what the reviewer actually runs — the npm script is a
thin convenience shim that points at it; the shim itself lives here, the gate does not):

```bash
node /home/artur/cadgen-workspace/harness/verify_all.mjs           # fresh pilot measurement too
node /home/artur/cadgen-workspace/harness/verify_all.mjs --skip-pilot   # kernel tier only (~90 s)
```

The gate header prints its own provenance (`referee code … (outside APP ✓)`).
It must always point at the **harness repo**, never inside this checkout.

## Tier T1 — kernel (fast, no servers, ~90 s)

Six Node suites in `cadgen-workspace/harness/`, all green required:

| suite | proves |
|---|---|
| `test_helpers.mjs` | C3/C4 helpers (loft/sweep/shell/addDraft…) load from the **real** `sandboxWorker.js` and build valid manifolds |
| `test_c2.mjs` | the verification core itself: symdiff verdict, 24-orientation search, weld ladder, OBJ round-trip |
| `test_c4.mjs` | selection/feature helpers vs analytic volumes + the real 648b1adc T-strap vs STEP ground truth |
| `test_c6.mjs` | `filletEdges` against circle-exact analytic removals |
| `test_status_fix_bundled.mjs` | the status-shape guards under the **bundled** build (the npm build masks these) |
| `test_real_worker.mjs` | **the shipped worker over its real message protocol** (`init → execute → result`) against the bundled `built/manifold.wasm`, incl. zero-area negative cases that must throw loudly |

Why "bundled" matters: `built/manifold.{js,wasm}` (committed) is the kernel the
browser runs; the npm `manifold-3d` package is a *different build*. The C8
makeExtrude/makeRevolve bug shipped 24/24-green under npm and was red in the
browser. **A change to `src/workers/sandboxWorker.js` is only proven by
`test_real_worker.mjs` green.** The gate reads the worker + built wasm from the
checkout under test — that is the code your PR may change; nothing else in the
gate reads this repo.

## Tier T2 — pilot (geometry regression, ~2 min, needs both servers up)

`pilot_eval.mjs` re-runs the cohort of transpiled parts through the live app
worker and compares every part against the **frozen baseline**
(`cadgen-workspace/reports/pilot/baseline.json`, minted from an authoritative
fresh-worker run):

- **REGRESSION (fails the gate):** a part that used to pass now fails, or no
  verdict recorded.
- **DRIFT (warns, reviewer judges):** `symRel` got worse by > 0.5 percentage points.
- Everything else reports `pass` / `fail(expected)` against the baseline's truth.
- Known-issue exclusions (paper trail in `pilot_baseline.mjs`): `9771f32b`
  (runaway loop wedges the worker — kernel TODO: op-budget guard),
  `f6f416e1` (no transpiled script yet).

Prereqs (fail loudly if missing): vite dev server on `:5173`
(`cd 3dculos && npm run dev`) and the pilot backend on `:3999`:

```bash
cd /home/artur/cadgen-workspace
WORKING_FOLDER=/home/artur/3dculos/backend/converter UPLOAD_FOLDER=/tmp/surfcad-uploads \
STAGE_OBJ_CONVERTER=/home/artur/cadgen-workspace/converter/obj_converter \
STAGE_OBJ_CONVERTER_LD=/home/artur/occt-install/lib \
PORT=3999 node /home/artur/3dculos/backend/server.js
```

Gate flags: `--tier=kernel` / `--tier=pilot`, `--reuse-run=<dir>` (re-parse an
authoritative run instead of re-driving the browser; the baseline comparison
still executes), `--server-url=http://…:<port>/` (aim the pilot tier at a dev
server booted FROM the checkout under test — pair with `CADGEN_APP`; the
worker-source fingerprint cross-check aborts the tier instead of scoring the
wrong code), `--skip-pilot`. **Evidence honesty:** every run's header prints
`APP under test : … [source]`, `referee code : … (outside APP ✓)`, and the pilot
tier prints `provenance ok: … serves worker <fp> == <APP> disk` — all three
lines must be present in the pasted output; a log missing them (or containing
`PROVENANCE VIOLATION`) is not acceptance evidence.
Machine-readable summary:
`/tmp/verify_all_last.json` — paste both it and the console output into the PR.

## The referee-integrity rule (hard)

Gate code, fixtures, ground truth, and frozen anchors live in
**`cadgen-workspace`** (the reviewer's side), never here. Therefore:

1. **Do not propose changes to anything under `cadgen-workspace/harness/` or
   `reports/pilot/baseline.json`.** If your diff touches the rulebook, the PR is
   rejected on sight (`RULEBOOK TOUCHED`).
2. **Intentional geometry changes fail the frozen anchors — that is the point.**
   If your helper change legitimately moves a volume, say so in the PR
   ("expected anchor impact: …"), the reviewer re-mints the baseline after
   accepting, and the gate goes green on the next run. Never "fix" a test to
   make it pass.
3. The dev hooks (`__STAGE__`, `__VIEWPORT__`) stay behind
   `import.meta.env.DEV` and the backend's `STAGE_OBJ_CONVERTER` override stays
   env-gated. The production paths (firejail converter, strict `importOBJ`)
   keep their shape.
4. **Do not weaken the guards to silence a failure** — the `status`-shape
   tolerance (npm string vs bundled enum object), the `result is EMPTY
   (volume 0)` throw, the zero-area negatives. They are the reason the gate can
   fail; a PR that deletes one to go green is a regression (this exact class of
   bug shipped once already, via a "fix" that dropped the empty check).

## PR checklist

- [ ] `npm run verify` → `✅ VERIFY PASS`; full console output + `/tmp/verify_all_last.json` pasted in the PR body
- [ ] If the PR adds/changes a helper: a test extension in the PR's own description (what it proves, which suite covers it) — harness edits are the reviewer's
- [ ] If the PR touches `sandboxWorker.js`: `test_real_worker.mjs` green called out explicitly
- [ ] For part-affecting changes: 4-view screenshots via `harness/pilot_shot.sh <id8>` (before/after) attached
- [ ] Known-issue exclusions untouched (`9771f32b`, `f6f416e1`)
- [ ] No commits to `main`; PRs only, branched from the current `main`

## Known gaps (honest section)

- `npm run lint` is **broken on this box** (eslint v9 flat-config vs the legacy
  `--ext` flag) — it is NOT part of the gate. Don't claim lint-green; fix the
  config in a dedicated PR.
- `test_helpers/c2/c4/c6` run against the **npm** build (fast iteration); only
  `test_status_fix_bundled` + `test_real_worker` pin the shipped kernel. A
  divergence between the two builds is real pilot data — report it in the PR,
  do not reconcile it by hand.
- `9771f32b`'s runaway loop is a **product bug for the game**: the execute
  timeout is a promise timeout, not a kill. Until the kernel grows an
  op-budget/iteration cap, a wedged script poisons its own worker (the harness
  recovers by worker restart, which the game cannot do mid-session).

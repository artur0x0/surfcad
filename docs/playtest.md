# Playtest and bug hunter (cloud agent recipe)

SurfCAD ships two browser harnesses on top of the same playtest build (`npm run build:playtest`) and `window.surfcad` bridge:

| Command | Purpose |
| --- | --- |
| `npm run playtest` | Scripted scenarios (`scripts/playtest/scenarios/`) — deterministic CI/nightly |
| `npm run bug-hunter` | Regression seeds (PR #484–#486 fixes) + optional LLM explorer |

Both are **frontend-only** (Vite preview on loopback, IndexedDB seed, API mocks). No Mongo.

## Cloud agent prompt (bug hunter)

Use this when kicking off an autonomous run:

> On branch `main`, run the SurfCAD bug hunter against a playtest build. Drive only `window.surfcad` bridge commands (or the MCP relay). Use regression seeds first, then explore with a cheap OpenAI-compatible model. Respect step and cost caps. Watch for console errors, script failures, NaN dimensions, empty number boxes, undo/redo head mismatch, and overlapping bodies after Move. Treat `confirm_required`, `real_repo_blocked`, and pairing/git consent refusals as intentional, not bugs. When you find a defect, minimize the command sequence and write `reports/bug-hunter/report.json` plus `report.md` with screenshots. Do not commit API keys. CI must not call an LLM — unit tests mock the model.

## Environment

| Variable | Default | Notes |
| --- | --- | --- |
| `SURFCAD_LLM_API_KEY` or `OPENAI_API_KEY` | — | Required for `--explore` |
| `SURFCAD_LLM_BASE_URL` or `OPENAI_BASE_URL` | `https://api.openai.com/v1` | Any OpenAI-compatible chat API |
| `SURFCAD_LLM_MODEL` or `OPENAI_MODEL` | `gpt-4o-mini` | Prefer a cheap model |
| `BUG_HUNTER_MAX_STEPS` | `24` | Explorer iterations |
| `BUG_HUNTER_MAX_COST_USD` | `0.25` | Estimated spend cap |
| `BUG_HUNTER_OUT` | `reports/bug-hunter` | Report directory |
| `PLAYTEST_PORT` | `4175` (hunter) / `4174` (playtest) | Preview port |
| `CHROME_PATH` | system Chrome | Required on the runner |

Seeds-only (no LLM):

```bash
npm run build:playtest && npm run bug-hunter -- --seeds-only
```

Full explorer (local or cloud with keys in env, never in repo):

```bash
export OPENAI_API_KEY=...
npm run bug-hunter -- --explore
```

## Budget and safety

- The explorer stops when **steps** or **estimated cost** exceeds the caps (`scripts/bug-hunter/lib/budget.mjs`).
- Without an API key, `npm run bug-hunter` runs **seeds** plus a short deterministic bridge probe — no outbound LLM calls (safe for CI).
- Never set API keys in `environment.json` or git; inject via the cloud agent secret UI or shell env.

## Reports

After a run:

- `reports/bug-hunter/report.json` — machine-readable (seeds, findings, explorer trace, budget)
- `reports/bug-hunter/report.md` — human summary with embedded screenshot paths
- `reports/bug-hunter/latest/` — copy of the last run

A **finding** includes title, summary, minimized bridge command list, and PNGs under `reports/bug-hunter/screenshots/`.

## Turn a report into a PR

1. Reproduce locally with `node scripts/playtest/replay.mjs` if the finding includes replay steps, or paste the minimized JSON commands into a new playtest scenario under `scripts/playtest/scenarios/`.
2. Fix the product code; add or extend a golden (`scripts/golden/`) or a bug-hunter seed if it is a fixed regression.
3. Run `npm run lint`, `npm test`, and relevant goldens.
4. Open a PR; link the report JSON/md in the description (do not commit secrets or huge screenshots unless needed).

## Scripted playtest (P1+P2)

```bash
npm run playtest
npm run playtest -- --scenario history-interleave-undo
```

Reports go to `PLAYTEST_OUT` (default `/tmp/surfcad-playtest` or `/opt/cursor/artifacts/playtest` on cloud agents). See `docs/architecture.md` → **Scripted playtest**.

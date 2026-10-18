# AGENTS.md: rules for coding agents working on SurfCAD

SurfCAD is browser CAD, live at [surfcad.com](https://surfcad.com). Setup and an
overview for humans are in [README.md](README.md). This file holds the rules.
Where it links to a doc, follow that doc. Do not copy its content here.

## Read before you change

- UI text, color, type, chrome: [docs/ui-style-guide.md](docs/ui-style-guide.md). Read it before any UI change.
- Where a piece sits on screen and which file draws it: [docs/ui-map.md](docs/ui-map.md).
- Runtime wiring: [docs/architecture.md](docs/architecture.md).
- Manifold CAD script helpers: [docs/helper-functions.md](docs/helper-functions.md).
  - Fillet/chamfer/blend code: load [.claude/skills/fillets/SKILL.md](.claude/skills/fillets/SKILL.md) first.
- Kernel and goldens contract: [docs/validation.md](docs/validation.md).
- Git vault on-disk format: [docs/vault-schema.md](docs/vault-schema.md).
- Agent catalog and `window.surfcad` bridge: [docs/agent-export.md](docs/agent-export.md).
- MCP pairing loop: [docs/agent/SKILL.md](docs/agent/SKILL.md).
- Playtest and bug hunter: [docs/playtest.md](docs/playtest.md).

## Build and run

Use Node 22, the supported version (CI runs 22). The root is an npm workspace (`packages/surfcad-mcp`). `backend/` is separate and has its own lockfile.

```bash
npm ci                      # root + packages/surfcad-mcp
npm ci --prefix backend     # Express API (needed for backend tests and /api)
npm run dev                 # vite --host; proxies /api -> http://localhost:3000
npm run build               # vite build (production bundle)
npm run build:playtest      # VITE_SURFCAD_PLAYTEST=1 vite build (playtest-only auto-approve)
npm run preview             # vite preview
(cd backend && npm run dev) # NODE_ENV=development node server.js
```

- Never ship a `build:playtest` bundle to production. CI checks that the production bundle has no playtest auto-approve.
- After you add a helper, change a helper signature or docs, change the Manifold types, or change a bridge command, run `npm run export:agent` and commit the regenerated `src/agent/commands.json` and `src/lib/surfcad/catalog/`.
- The FEA and mesh wasm are committed (`packages/surfcad-fea/pkg`, `packages/surfcad-mesh/pkg`). If you change their sources, rebuild with `npm run fea:build` / `npm run fea:mesh`. CI fails on drift.

## Test locally before you open a PR

```bash
npm run lint                         # eslint --max-warnings 0 + scripts/ci/check-ui-contrast.mjs
npm run check:md-links               # relative .md links must resolve
npm run build
npm test                             # node scripts/ci/run-unit-tests.mjs, same as CI's unit step
npm run golden:<name>                # in-repo smokes, scripts/golden/; see docs/golden/README.md
```

- `npm test` covers `src/**/*.test.*`, `test/**`, `packages/surfcad-mcp/test`, and `backend/test` (needs the backend `npm ci`).
- Goldens: there is no per-area map. Choose from the `golden:*` scripts in root `package.json` and the golden steps in `.github/workflows/ci.yml`, and run the ones that touch your change. Browser goldens need Chrome (`CHROME_PATH`).
- `npm run verify` calls an external harness (`$CADGEN_HARNESS`) that is not in this repo and not in CI.
- New UI controls need a `data-ui-action` and a matching agent command, or an allowlist row with a reason in `src/agent/coverageAllowlist.js`. See [docs/architecture.md](docs/architecture.md).

## What CI runs

`.github/workflows/ci.yml` runs on every PR into `main` and every push to `main`:

| Job | Checks |
| --- | --- |
| lint, build, unit | `npm ci`, backend `npm ci`, `npm run lint`, `npm run check:md-links`, `npm run build`, nginx syntax test of `docs/` configs, `node scripts/ci/run-unit-tests.mjs` (= `npm test`), git save goldens |
| golden app-loads | production and playtest builds, the auto-approve guard, CSP app-load smoke, agent bridge goldens, scripted playtest, MCP demo, FEA goldens (headless Chrome) |
| Agent bridge FEA golden | playtest build + FEA bridge golden |
| Agent bridge Safari popup | WebKit + Chromium popup pairing |
| license | no copyleft or non-commercial npm deps; `public/THIRD_PARTY_NOTICES.txt` up to date |
| cargo-deny | Rust licence allow-list for `packages/surfcad-fea` (GPL is rejected) |
| wasm freshness / mesh wasm freshness | committed wasm matches a fresh rebuild |
| calculix reference | solver compared against an apt-installed `ccx` (external process only) |

GitHub does not enforce these as required checks, so read every job's result yourself. `playtest-nightly.yml` is a nightly scripted playtest and does not gate merges.

## PR flow

1. Keep each PR small: one slice or fix. Branch from `main` and target `main`.
2. Make CI green. Treat any failed job as a blocker.
3. Artur playtests the change. Merge only once CI is green and Artur has played it.
4. **Agents never deploy to prod or staging.** Prod and staging deploys and npm publishes need Artur's explicit go, and the lead coder carries them out. Do not SSH into hosts, reload nginx, or restart services.
5. `surfcad-mcp` publishes itself (`.github/workflows/publish-mcp.yml`). Any merge to `main` that changes `version` in `packages/surfcad-mcp/package.json` publishes once CI passes. Do not bump that version, push a `surfcad-mcp-v*` tag, or run the publish workflow unless Artur has said go for that release.

## Security rules

- **No secrets in PRs.** That covers keys, tokens, DSNs, `.env*` files (only `.env.example` files are tracked), `*.p8`, and **live Stripe keys** (`sk_live_`, `pk_live_`, `whsec_`). Stripe keys come from env (`backend/config/index.js`).
- **No analytics or Sentry keys in dev or staging env files.** `VITE_POSTHOG_KEY`, `VITE_SENTRY_DSN`, and `SENTRY_DSN` go only in the production env files. Leave them unset everywhere else so the SDKs stay no-ops. See [docs/monitoring.md](docs/monitoring.md) and [docs/staging.md](docs/staging.md).
- **npm publishes go through Trusted Publishing (OIDC) only.** Never add `NPM_TOKEN`, an `.npmrc` auth token, or a publish step that uses one.
- **Production never sends `Cross-Origin-Opener-Policy: same-origin`.** It cuts off the Safari loopback bridge popup. If COOP is ever needed, use `same-origin-allow-popups`. This covers nginx (`docs/nginx-snippets/surfcad-security.conf`, `docs/nginx-surfcad.com.conf`) and backend `helmet` (`backend/serverApp.js`). Details: [docs/ops/nginx-headers.md](docs/ops/nginx-headers.md).
- Do not add GPL/AGPL/LGPL or non-commercial dependencies. Never vendor, link, or bundle CalculiX.
- Uploaded STEP files are deleted right after conversion (`backend/routes/convert.js`, in `finally`). The prune timer (`deploy/systemd/`, [docs/ops/upload-prune.md](docs/ops/upload-prune.md)) exists only to catch leftovers from crashes, and it is not installed on prod yet. Never rely on it for cleanup, and do not loosen its guards.

## UI rules (summary; the style guide wins)

Use the shared classes from [docs/ui-style-guide.md](docs/ui-style-guide.md). Never put dark text on dark chrome. Meet WCAG AA. User-facing copy names Chrome, never Edge. A new color starts as a token, then becomes a class. Desktop and mobile are separate JSX trees in `src/App.jsx`, so change both ([docs/ui-map.md](docs/ui-map.md)).

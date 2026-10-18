# SurfCAD

Browser CAD at [surfcad.com](https://surfcad.com). This is the `artur0x0/surfcad` repo. The kernel is the shipped Manifold build in `built/manifold.js` and `built/manifold.wasm` ([ManifoldCAD](https://github.com/elalish/manifold)). The npm package `manifold-3d` is a different build.

Coding agents: read [AGENTS.md](AGENTS.md) for the repo rules (PR flow, CI, security).

## Install SurfCAD MCP for your agent

[`surfcad-mcp`](packages/surfcad-mcp/README.md) is a stdio MCP server. It lets an agent drive an open SurfCAD tab through a loopback relay on `127.0.0.1:17341`. It needs Node 18 or later.

```bash
npx surfcad-mcp
```

**Cursor** (Settings → MCP, or `.cursor/mcp.json`) and **Claude Desktop** (`claude_desktop_config.json`) take the same block:

```json
{
  "mcpServers": {
    "surfcad": {
      "command": "npx",
      "args": ["-y", "surfcad-mcp"],
      "env": { "SURFCAD_PAIRING_CODE": "ABCDEF" }
    }
  }
}
```

**Pair with surfcad.com:**
1. Open [surfcad.com](https://surfcad.com) in Chrome.
2. Open the profile chip and choose **Connect Agent**. When the relay is found, a six-character pairing code appears.
3. Put that code in `SURFCAD_PAIRING_CODE`, or call the MCP `pair` tool with `{ "code": "ABCDEF" }`.
4. Click **Allow** in SurfCAD. Nothing pairs without your approval.

Safari on a Mac pairs through a small bridge pop-up; keep it open while the agent works. Safari on iPhone and iPad is not supported. For tools, troubleshooting, and running from a checkout, see [packages/surfcad-mcp/README.md](packages/surfcad-mcp/README.md) and [docs/agent/SKILL.md](docs/agent/SKILL.md).

## Modes

**Local.** No GitHub token needed. The open document and part scripts autosave in IndexedDB (`surfcad-assembly`). A part row id is a bare key with no `local:` prefix. Vault chrome stays hidden.

**Git vault.** A GitHub token finds or creates one private repo. Its default name is `surfcad-vault`; a legacy `surfcad` repo is used instead when it carries the vault marker. Assemblies live at `assemblies/<Name>/.surf.json`, with that assembly's `.js` files beside it. Shared parts live in `parts/`. The on-disk contract, including groups, links, delete, and the outbox, is [docs/vault-schema.md](docs/vault-schema.md).

## Develop

Requires Node 22 (the supported version).

```bash
npm install                 # root + packages/surfcad-mcp workspace
npm run dev                 # vite --host (default port 5173); proxies /api to localhost:3000
npm run build
npm run preview
```

You only need the Express API in `backend/` for GitHub sign-in and other `/api` features. Local CAD works without it.

```bash
npm install --prefix backend
cp backend/.env.example backend/.env.development   # fill in what you need; see backend/config/index.js
cd backend && npm run dev
```

GitHub sign-in needs a GitHub App Client ID. Set `GITHUB_APP_CLIENT_ID` on the backend (served by `/api/config`) or `VITE_GITHUB_APP_CLIENT_ID` for the frontend.

Do not put Sentry or PostHog keys in dev env files. They are production-only ([docs/monitoring.md](docs/monitoring.md)).

## Check your change

```bash
npm run lint
npm run check:md-links
npm test          # runs scripts/ci/run-unit-tests.mjs, same as CI
```

The full CI matrix is in [AGENTS.md](AGENTS.md#what-ci-runs).

## FEA

The solver crate is `packages/surfcad-fea` (Apache-2.0). CalculiX is GPL-2.0-only and is not part of the build. CI may install the `ccx` binary with apt and compare displacements and von Mises against it. That binary is never vendored, linked, bundled, or committed, and it is never a Cargo dependency. The license gate and `cargo deny` stay closed to GPL. Details are in [packages/surfcad-fea/README.md](packages/surfcad-fea/README.md). The volume mesher is [packages/surfcad-mesh](packages/surfcad-mesh/README.md).

## Goldens

`npm run verify` runs the external harness at `${CADGEN_HARNESS:-/home/artur/cadgen-workspace}/harness/verify_all.mjs`. It is not in this repo and not in CI. The contract is [docs/validation.md](docs/validation.md). Two pilot parts are known exclusions and report `fail(expected)`: `9771f32b` (a script that wedges the worker) and `f6f416e1` (no transpiled script).

The in-repo smokes are `npm run golden:<name>` (`scripts/golden/`, see [docs/golden/README.md](docs/golden/README.md)). `npm run golden:agent-catalog` checks the generated helper catalog.

## Docs

- [Vault schema](docs/vault-schema.md): how assemblies are stored
- [Architecture](docs/architecture.md)
- [UI map](docs/ui-map.md)
- [UI style guide](docs/ui-style-guide.md)
- [Helpers](docs/helper-functions.md)
- [Validation](docs/validation.md)
- [Agent export](docs/agent-export.md)
- [Playtest and bug hunter](docs/playtest.md)
- [Performance](docs/performance.md)
- [Monitoring and privacy](docs/monitoring.md)
- [Win capture](docs/win-capture.md)
- [Spark staging](docs/staging.md): processes, ports, and ops on the spark host
- [Production ops](docs/ops/README.md)
- [Contributing](CONTRIBUTING.md)

## License

Apache-2.0, see [LICENSE](LICENSE). Shipped third-party notices are in `public/THIRD_PARTY_NOTICES.txt`.

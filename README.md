# SurfCAD

Browser CAD at [surfcad.com](https://surfcad.com). This repo is `surfcad` (repo artur0x0/surfcad). The kernel is the shipped Manifold build in `built/manifold.js` and `built/manifold.wasm` ([ManifoldCAD](https://github.com/elalish/manifold)). npm `manifold-3d` is a different build.

## Modes

**Local.** No GitHub token. The open document and part scripts autosave in IndexedDB (`surfcad-assembly`). A part row id is a bare key (no `local:` prefix). Vault chrome stays hidden.

**Git vault.** A GitHub token find-or-creates one private repo (default name `surfcad`). Assemblies live at `assemblies/<Name>/.surf.json` with that assembly's `.js` files beside it, and shared parts live in `parts/`. The on-disk contract, including groups, links, delete, and the outbox, is [docs/vault-schema.md](docs/vault-schema.md).

## Develop

```bash
npm install
npm run dev       # Vite on port 5173, --host. Proxies /api to localhost:3000
npm run build
npm run preview
```

GitHub sign-in needs the Express app in `backend/` (`npm run dev` there) and a Client ID (`VITE_GITHUB_APP_CLIENT_ID` or `/api/config`). Local CAD does not.

## FEA

The solver crate is `packages/surfcad-fea` (Apache-2.0). CalculiX is GPL-2.0-only and is not part of the build. CI may install the `ccx` binary with apt and compare displacements and von Mises against it. That binary is never vendored, linked, bundled, or committed, and it is never a Cargo dependency. The license gate and `cargo deny` stay closed to GPL. Details are in [packages/surfcad-fea/README.md](packages/surfcad-fea/README.md).

## Goldens

`npm run verify` runs the external harness (`cadgen-workspace/harness/verify_all.mjs`). The contract is [VALIDATION.md](VALIDATION.md). Two pilot parts are known exclusions and report `fail(expected)`: `9771f32b` (a script that wedges the worker) and `f6f416e1` (no transpiled script).

In-repo smokes are `npm run golden:*` (`scripts/golden/`). `npm run golden:agent-catalog` checks the generated helper catalog.

## Docs

- [Vault schema](docs/vault-schema.md) — how assemblies are stored
- [Architecture](docs/architecture.md)
- [Spark staging](docs/staging.md) — processes, ports, and ops on the spark host
- [UI map](docs/UI_MAP.md)
- [Agent export](docs/agent-export.md)
- [Performance](docs/performance.md)
- [Popup style](docs/POPUP_STYLE.md)
- [Helpers](HELPER_FUNCTIONS.md)
- [Validation](VALIDATION.md)

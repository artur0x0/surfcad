import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import reactPlugin from 'eslint-plugin-react'

// `globals` ships at least one malformed key (trailing space) in v11.x and
// eslint 8.57 hard-fails on it, so every merged globals map is sanitized.
const clean = (ns) =>
  Object.fromEntries(
    Object.entries(ns || {})
      .map(([k, v]) => [k.trim(), v])
      .filter(([k]) => k.length > 0),
  )

// The pinned `globals` fork predates some ubiquitous APIs — add what the code
// actually uses (node 18+ fetch family; newer browser compression streams).
const browserGlobals = {
  ...clean(globals.browser),
  ...clean(globals.builtin),
  CompressionStream: 'readonly',
  DecompressionStream: 'readonly',
  // globals.browser marks these false (readonly) in some forks; Hermes/analysis
  // tools sometimes treat false as missing — pin explicitly.
  requestAnimationFrame: 'readonly',
  queueMicrotask: 'readonly',
}
const nodeGlobals = {
  ...clean(globals.builtin),
  ...clean(globals.node),
  fetch: 'readonly',
  Request: 'readonly',
  Response: 'readonly',
  Headers: 'readonly',
  FormData: 'readonly',
  AbortController: 'readonly',
}

export default [
  {
    ignores: [
      'dist/**',
      'dist-ssr/**',
      'built/**', // emscripten-generated wasm glue — not ours to lint
      'packages/surfcad-fea/pkg/**', // wasm-pack glue
      'packages/surfcad-fea/target/**',
      'packages/surfcad-mesh/pkg/**', // emscripten glue
      'packages/surfcad-mesh/.deps/**',
      'packages/surfcad-mesh/build-native/**',
      'packages/surfcad-mesh/build-wasm/**',
      'packages/surfcad-mesh/pkg-rebuild/**',
      'backend/node_modules/**',
      'public/**',
      '.deploy-backups/**', // gitignored snapshots incl. minified bundles (flat config ignores .gitignore on its own)
      // Paste-only sample catalog (no importers): snippets share one top-level
      // scope and redeclare `const func` per example — unparseable as a unit,
      // yet correct for each snippet's real life (pasted alone into the editor).
      'codeSamples.js',
    ],
  },

  // Baseline for everything that gets linted (rules-only in eslint 8.57).
  { ...js.configs.recommended },

  // Unused-args policy: 'after-used' keeps positional signatures legal (the
  // `original` arg of getCutEdges is API even if the body only logs it today);
  // express callbacks must name positionals literally, so `next` is exempt.
  {
    rules: {
      'no-unused-vars': ['error', {
        args: 'after-used',
        argsIgnorePattern: '^(_|next)$',
        varsIgnorePattern: '^_.*$',
      }],
    },
  },

  // ── Web app: React components (.jsx) ──
  {
    files: ['src/**/*.jsx'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: browserGlobals,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: {
      react: reactPlugin,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Schema accepts allowConstantExport (singular) — the pre-fix config's
      // "allowConstantExports" was invalid; the --ext crash always masked it.
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      'react/jsx-uses-react': 'error',
      'react/jsx-uses-vars': 'error',
      'react/prop-types': 'off',
    },
    settings: { react: { version: 'detect' } },
  },

  // Hook files export hooks by design — the refresh rule is for HMR boundaries.
  {
    files: ['src/hooks/**'],
    rules: { 'react-refresh/only-export-components': 'off' },
  },

  // ── Web app: plain JS (utils, kernel helpers, worker bridge) ──
  {
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: browserGlobals,
    },
    plugins: {
      react: reactPlugin,
      'react-hooks': reactHooks,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
    },
  },

  // ── Sandbox worker: runs in a dedicated worker context ──
  {
    files: ['src/workers/**', 'src/lib/surfcad/runtime.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...browserGlobals,
        ...clean(globals.worker),
        self: 'readonly',
        importScripts: 'readonly',
      },
    },
  },

  // ── Node harness scripts ──
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: nodeGlobals },
  },

  // Golden puzzle scripts are DSL snippets evaluated inside the sandbox via
  // new Function(...) — function-body semantics, so top-level `return` is
  // legal ('commonjs' matches that shape; 'script'/'module' do not parse it)
  // and Manifold/helpers arrive through the injected scope, not globals.
  {
    files: ['scripts/golden/puzzle_*.js', 'scripts/golden/fixtures/LoftZilla.js', 'codeSamples.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: { ...clean(globals.builtin), Manifold: 'readonly' },
    },
    rules: { 'no-undef': 'off', 'no-redeclare': 'off' },
  },

  // Golden paint shots run in a real browser (Vite serves these modules).
  {
    files: ['scripts/golden/sheet_material_shot.js', 'scripts/golden/face_paint_shot.js', 'scripts/golden/face_skin_shot.js', 'scripts/golden/clear_cache_shot.js', 'scripts/golden/feature_edit_shot.js', 'scripts/golden/feature_edit_delete_shot.js', 'scripts/golden/feature_skip_midchain_shot.js', 'scripts/golden/rollback_bar_shot.js', 'scripts/golden/rollback_hit_shot.js', 'scripts/golden/rollback_insert_shot.js', 'scripts/golden/rollback_accept_shot.js', 'scripts/golden/rollback_sync_shot.js', 'scripts/golden/script_return_shot.js', 'scripts/golden/part_hide_thumbnail_shot.js', 'scripts/golden/part_thumb_cache_shot.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: browserGlobals,
    },
  },

  // ── Backend (node, ESM) ──
  {
    files: ['backend/**/*.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: nodeGlobals },
  },

  // ── node:test suite ──
  {
    files: ['test/**/*.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: nodeGlobals },
  },

  // Generated prompt text (gitignored artifact): markdown inside a template
  // literal legitimately carries \/ \# \* escapes that look useless to eslint.
  {
    files: ['backend/systemPrompt.js'],
    rules: { 'no-useless-escape': 'off' },
  },

  // ── Root tooling configs ──
  {
    files: ['*.config.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: browserGlobals },
  },
]

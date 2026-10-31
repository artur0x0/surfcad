import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import wasm from "vite-plugin-wasm"
import topLevelAwait from "vite-plugin-top-level-await"
import viteAgentBridgeWs from './scripts/vite-agent-bridge-ws.mjs'
import { surfcadBuildDefine } from './scripts/vite-surfcad-build-define.mjs'

const rootDir = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  define: surfcadBuildDefine(),
  // VITE_SURFCAD_PLAYTEST=1 (npm run build:playtest) enables playtest-only agent bridge
  // auto-approve in the client bundle; normal production builds omit it entirely.
  plugins: [
    react(),
    wasm(),
    topLevelAwait(),
    viteAgentBridgeWs(),
  ],
  build: {
    rollupOptions: {
      input: {
        index: resolve(rootDir, 'index.html'),
        // Emit the FEA worker and its wasm before any UI imports the client.
        // index.html does not load this chunk. Drop it once a caller imports
        // src/fea/feaClient.js, which pulls the same worker in through ?worker.
        feaWorker: resolve(rootDir, 'src/workers/feaWorker.js'),
      },
    },
  },
  worker: {
    format: 'es',
  },
  resolve: {
    alias: {
      '@': '/src',
    },
  },
  optimizeDeps: {
    exclude: ['@manifold/manifold', '@monaco-editor/react']
  },
  server: {
    // dev-only: allow cloudflared quick-tunnel hostnames
    allowedHosts: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      // Mirrors the prod nginx /agent block (docs/ops/agent-relay-nginx.md).
      // The caret makes this a regex so /agentx stays on the SPA. ws is on
      // so the tab socket reaches the backend instead of index.html.
      // Dev only: preview inherits server.proxy unless preview.proxy is set,
      // and the playtest's ws://127.0.0.1:<port>/agent would then die against
      // a backend that is not running.
      '^/agent(/|\\?|$)': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        ws: true,
      },
    }
  },
  preview: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
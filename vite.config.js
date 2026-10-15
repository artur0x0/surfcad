import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import wasm from "vite-plugin-wasm"
import topLevelAwait from "vite-plugin-top-level-await"
import viteAgentBridgeWs from './scripts/vite-agent-bridge-ws.mjs'

const rootDir = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
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
      }
    }
  }
});
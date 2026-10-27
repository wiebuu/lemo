import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

const analyzer = process.env.LEMO_ANALYZER_URL ?? 'http://127.0.0.1:8787'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // on-device analysis: ONNX Runtime loads its .wasm next to itself, and the worker is an ES module
  optimizeDeps: { exclude: ['onnxruntime-web'] },
  worker: { format: 'es' },
  server: {
    port: 5173,
    proxy: { '/api': { target: analyzer, changeOrigin: true } },
  },
})

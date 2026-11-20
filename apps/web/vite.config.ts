import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    port: 5173,
    // Open acme.localhost:5173, owner.localhost:5173 etc. (.localhost names reach this computer).
    proxy: {
      // changeOrigin stays false so the API sees the original host (acme.localhost)
      // and knows which client the request is for — the same as nginx in production.
      '/api': { target: 'http://localhost:4000', changeOrigin: false },
    },
  },
  build: {
    sourcemap: true,
  },
})

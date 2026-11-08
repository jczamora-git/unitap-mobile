/// <reference types="vitest" />

import legacy from '@vitejs/plugin-legacy'
import vue from '@vitejs/plugin-vue'
import path from 'path'
import { defineConfig } from 'vite'

// https://vitejs.dev/config/
export default defineConfig({
  server: {
    host: '0.0.0.0', // Explicit IPv4 to prevent IPv6 tunneling conflicts
    port: 5173,
    strictPort: true,
    allowedHosts: true, // Allows tunnel hosts (localtunnel, ngrok, cloudflared, etc.)
  },
  plugins: [
    vue(),
    legacy()
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/unit/setup.ts']
  }
})

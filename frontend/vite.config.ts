import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    // Use terser instead of esbuild for minification.
    // esbuild incorrectly removes `let r;` declarations in xterm.js's
    // enum IIFE pattern (`(P=>...)(r||={})`) causing "r is not defined" at runtime.
    minify: 'terser',
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001',
      '/ws': {
        target: 'ws://localhost:3001',
        ws: true,
      },
    }
  }
})

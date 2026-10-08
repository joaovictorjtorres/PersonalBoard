/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': { target: 'http://localhost:8787', ws: true },
      '/files': 'http://localhost:8787',
    },
  },
  test: { environment: 'node' },
})

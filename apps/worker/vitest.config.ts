import { cloudflareTest } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

// vitest-pool-workers 0.23 no longer has defineWorkersConfig / singleWorker / isolatedStorage:
// the pool is a Vite plugin, a single worker is the only mode and storage is not isolated per test.
export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: './wrangler.jsonc' } })],
})

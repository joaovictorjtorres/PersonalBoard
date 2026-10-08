import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  use: { baseURL: 'http://localhost:8787', viewport: { width: 1280, height: 720 } },
  webServer: {
    command: 'pnpm build && pnpm --filter @mesa/worker exec wrangler dev --port 8787',
    url: 'http://localhost:8787',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})

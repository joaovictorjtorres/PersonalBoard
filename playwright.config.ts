import { defineConfig } from '@playwright/test'

// O E2E sobe o próprio servidor: porta própria (padrão 8788), build próprio (apps/web/dist-e2e)
// e estado próprio (apps/worker/.wrangler/e2e-state). Nunca reaproveita nem mexe no `pnpm host`
// do usuário (porta 8787, apps/web/dist, apps/worker/.wrangler/state).
const PORT = Number(process.env.E2E_PORT ?? 8788)

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  use: { baseURL: `http://localhost:${PORT}`, viewport: { width: 1280, height: 720 } },
  webServer: {
    command:
      `pnpm build:e2e && pnpm --filter @mesa/worker exec wrangler dev --port ${PORT} --inspector-port ${PORT + 1000} ` +
      '--assets ../web/dist-e2e --persist-to .wrangler/e2e-state',
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
})

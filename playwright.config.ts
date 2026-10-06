import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  use: { baseURL: 'http://localhost:5184', viewport: { width: 1280, height: 800 } },
  webServer: {
    command: 'node node_modules/vite/bin/vite.js --port 5184 --strictPort',
    port: 5184,
    reuseExistingServer: false,
  },
})

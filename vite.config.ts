import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  server: { port: 5183 },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
})

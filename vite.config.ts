import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  server: { port: 5183 },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // three-bvh-csg が CJS 版 three を読むと二重読み込みになるため ESM として取り込む
    server: { deps: { inline: ['three-bvh-csg', 'three-mesh-bvh'] } },
  },
})

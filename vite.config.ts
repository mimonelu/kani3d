import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  // 相対パスで出力（GitHub Pages の /kani3d/ のようなサブパスでも動く）
  base: './',
  server: { port: 5183 },
  build: { chunkSizeWarningLimit: 1500 }, // three.js 同梱のため
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // three-bvh-csg が CJS 版 three を読むと二重読み込みになるため ESM として取り込む
    server: { deps: { inline: ['three-bvh-csg', 'three-mesh-bvh'] } },
  },
})

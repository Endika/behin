import { defineConfig } from 'vite'
import { resolve } from 'node:path'

export default defineConfig({
  base: '/behin/',
  resolve: { alias: { '@': resolve(__dirname, 'src') } },
  build: { sourcemap: true, target: 'es2022' },
})

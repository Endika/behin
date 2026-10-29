import { defineConfig } from 'vite'
import { resolve } from 'node:path'

export default defineConfig({
  base: '/behin/',
  resolve: { alias: { '@': resolve(import.meta.dirname, 'src') } },
  build: { sourcemap: true, target: 'es2022' },
})

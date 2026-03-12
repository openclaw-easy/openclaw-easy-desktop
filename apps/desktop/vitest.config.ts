import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '@moltbot-easy/shared': resolve(__dirname, '../../packages/shared/dist/index.js'),
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['installer-resources/**', 'node_modules/**', 'dist/**', 'out/**'],
    setupFiles: ['src/test-utils/setup.ts'],
    environment: 'node',
  },
})

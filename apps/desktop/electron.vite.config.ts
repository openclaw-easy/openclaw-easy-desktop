import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@moltbot-easy/shared': resolve('../../packages/shared/dist/index.js')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@moltbot-easy/shared': resolve('../../packages/shared/dist/index.js')
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@': resolve('src/renderer'),
        '@moltbot-easy/shared': resolve('../../packages/shared/dist/index.js')
      }
    },
    plugins: [react()]
  }
})
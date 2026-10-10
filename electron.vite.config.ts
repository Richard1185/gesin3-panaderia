import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: resolve(process.cwd(), 'electron/main.ts') } },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: resolve(process.cwd(), 'electron/preload.ts') } },
  },
  renderer: {
    root: process.cwd(),
    plugins: [react()],
    build: { rollupOptions: { input: resolve(process.cwd(), 'index.html') } },
  },
})

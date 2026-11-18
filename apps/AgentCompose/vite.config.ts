import { fileURLToPath, URL } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'
import { appVersionPlugin } from './build/appVersionPlugin'

export default defineConfig({
  plugins: [vue(), appVersionPlugin],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: { port: 5176, strictPort: true },
  clearScreen: false,
})

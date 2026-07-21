import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@lucide/vue': fileURLToPath(new URL('./src/icons/phosphorCompat.js', import.meta.url))
    }
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: [
      'livematch.vibestudio.work',
      '16af-2405-9800-b901-dd24-9176-268c-b0ce-4a.ngrok-free.app',
      '33e8-2405-9800-b901-dd24-9191-8383-8d66-de36.ngrok-free.app'
    ],
    proxy: {
      '/api': {
        target: process.env.VITE_DEV_API_PROXY || 'http://backend:8080',
        changeOrigin: true
      }
    }
  },
  test: {
    environment: 'jsdom',
    globals: true
  }
})

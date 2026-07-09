import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: [
      'livematch.vibestudio.work',
      '1eaf-2405-9800-b901-dd24-9176-268c-b0ce-4a.ngrok-free.app'
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

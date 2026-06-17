import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: ['livematch.vibestudio.work'],
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

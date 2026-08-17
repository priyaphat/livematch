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
      'badmintonphrae.club',
      'bpps.badmintonphrae.club',
      'badminton.vibestudio.work'
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

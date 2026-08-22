import { createApp } from 'vue'
import App from './App.vue'
import './style.css'
import { applyStoredTheme } from './theme'

applyStoredTheme()
createApp(App).mount('#app')

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error) => {
      console.warn('LiveMatch service worker registration failed', error)
    })
  })
}

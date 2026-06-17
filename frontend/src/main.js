import { createApp } from 'vue'
import App from './App.vue'
import './style.css'
import { applyStoredTheme } from './theme'

applyStoredTheme()
createApp(App).mount('#app')

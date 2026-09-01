import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Capacitor } from '@capacitor/core'
import './index.css'
import App from './App.tsx'
import { initTheme } from './theme'

// index.html stamps this before first paint; re-running it costs nothing and
// keeps the app correct if that inline script is ever stripped or blocked
initTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

/*
 * Offline caching is for the web build only. The native shell already serves
 * every asset from the device, so a service worker there adds nothing and can
 * shadow updated files after an app upgrade.
 */
if (!Capacitor.isNativePlatform() && 'serviceWorker' in navigator) {
  import('virtual:pwa-register')
    .then(({ registerSW }) => registerSW({ immediate: true }))
    .catch(() => {
      // no offline support is survivable; the app still runs
    })
}

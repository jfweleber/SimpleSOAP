import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  // relative paths so the build works from a subdirectory as well as a root
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // registered by hand in main.tsx, and only on the web — a service worker
      // inside the Android WebView just shadows assets the shell already serves
      injectRegister: null,
      includeAssets: ['icons/apple-touch-icon.png', 'favicon.png'],
      manifest: {
        name: 'SimpleSOAP',
        short_name: 'SimpleSOAP',
        description: 'Wilderness patient assessment and SOAP note documentation.',
        theme_color: '#0c1116',
        background_color: '#0c1116',
        display: 'standalone',
        orientation: 'portrait',
        start_url: './',
        scope: './',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // everything is local; there is nothing to fetch at runtime, so the
        // whole app is precached and the tool works with no signal at all
        globPatterns: ['**/*.{js,css,html,png,svg,woff2}'],
        cleanupOutdatedCaches: true,
        navigateFallback: 'index.html',
      },
      devOptions: { enabled: false },
    }),
  ],
})

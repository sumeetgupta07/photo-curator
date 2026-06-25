// vite.config.js — v2.0 Stage 1
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Photo Curator', short_name: 'Curator',
        description: 'Fast photo curation with swipe gestures',
        theme_color: '#0a0a0a', background_color: '#0a0a0a',
        display: 'standalone', orientation: 'portrait',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' }
        ]
      }
    })
  ],
  server: { allowedHosts: ['photo.sumeetg.duckdns.org'], host: true, port: 5173 }
})

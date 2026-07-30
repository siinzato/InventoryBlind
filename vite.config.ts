import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.png', 'pwa-192.png', 'pwa-512.png'],
      manifest: {
        name: 'InventoryBlind',
        short_name: 'InventoryBlind',
        description: 'Inteligência para inventários, estoque e gestão operacional',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        orientation: 'any',
        theme_color: '#18181b',
        background_color: '#09090b',
        icons: [
          { src: '/pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Cache only static app assets (precache). Never cache API/auth responses.
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        // Do not cache Supabase or any external API requests
        navigateFallback: '/index.html',
        runtimeCaching: [],
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
});
